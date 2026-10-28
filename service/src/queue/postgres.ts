/**
 * Durable job queue on a Postgres `jobs` table. Survives restarts; a crashed
 * worker's in-flight job is re-leased after `lockMs`. Replaces queue/memory.ts
 * when BACKEND=postgres.
 *
 * Single-process polling loop with `FOR UPDATE SKIP LOCKED`, so multiple service
 * instances can safely share one table.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/pg.ts";
import type { Job, Queue } from "./types.ts";

export class PostgresQueue<T> implements Queue<T> {
  private handler?: (job: Job<T>) => Promise<void>;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly kind: string,
    private readonly opts = { pollMs: 250, lockMs: 60_000, maxAttempts: 5, baseDelayMs: 1000 },
  ) {}

  async add(payload: T, opts?: { delayMs?: number }): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO jobs (id, kind, payload, max_attempts, run_at)
       VALUES ($1, $2, $3::jsonb, $4, now() + (($5)::text || ' milliseconds')::interval)`,
      [id, this.kind, JSON.stringify(payload), this.opts.maxAttempts, String(opts?.delayMs ?? 0)],
    );
    return id;
  }

  process(handler: (job: Job<T>) => Promise<void>): void {
    this.handler = handler;
    this.stopped = false;
    this.tick();
  }

  private tick(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.drainOnce().finally(() => this.tick());
    }, this.opts.pollMs);
    this.timer.unref?.();
  }

  /** Lease and run at most one job. Exposed for tests to step deterministically. */
  async drainOnce(): Promise<boolean> {
    if (!this.handler || this.running) return false;
    this.running = true;
    try {
      const leased = await this.db.query<{ id: string; payload: T; attempts: number }>(
        `UPDATE jobs SET status='active', locked_until = now() + (($2)::text || ' milliseconds')::interval, updated_at = now()
         WHERE id = (
           SELECT id FROM jobs
           WHERE kind = $1
             AND ( (status='queued' AND run_at <= now())
                OR (status='active' AND locked_until < now()) )
           ORDER BY run_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING id, payload, attempts`,
        [this.kind, String(this.opts.lockMs)],
      );
      const row = leased.rows[0];
      if (!row) return false;

      const job: Job<T> = { id: row.id, payload: row.payload, attempt: row.attempts + 1 };
      try {
        await this.handler(job);
        await this.db.query(`UPDATE jobs SET status='done', attempts = attempts + 1, updated_at = now() WHERE id = $1`, [row.id]);
      } catch (err) {
        const attempts = row.attempts + 1;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempts >= this.opts.maxAttempts) {
          await this.db.query(`UPDATE jobs SET status='failed', attempts=$2, last_error=$3, updated_at=now() WHERE id=$1`, [row.id, attempts, msg]);
        } else {
          const backoff = this.opts.baseDelayMs * 2 ** (attempts - 1);
          await this.db.query(
            `UPDATE jobs SET status='queued', attempts=$2, last_error=$3, run_at = now() + (($4)::text || ' milliseconds')::interval, locked_until=NULL, updated_at=now() WHERE id=$1`,
            [row.id, attempts, msg, String(backoff)],
          );
        }
      }
      return true;
    } finally {
      this.running = false;
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // let an in-flight drain settle
    for (let i = 0; i < 40 && this.running; i++) await new Promise((r) => setTimeout(r, 25));
  }
}
