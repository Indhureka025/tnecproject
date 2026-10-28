import { randomUUID } from "node:crypto";
import type { Job, Queue } from "./types.ts";

/**
 * In-process queue with retry + exponential backoff. Sufficient for dev/tests and
 * a single-instance deployment. Phase 1 swaps in a BullMQ (Redis) implementation
 * so workers can scale horizontally and survive restarts.
 */
export class MemoryQueue<T> implements Queue<T> {
  private handler?: (job: Job<T>) => Promise<void>;
  private inflight = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private readonly opts: { maxAttempts: number; baseDelayMs: number; onDlq?: (job: Job<T>, err: unknown) => void } = {
      maxAttempts: 5,
      baseDelayMs: 1000,
    },
  ) {}

  async add(payload: T, opts?: { delayMs?: number }): Promise<string> {
    if (this.closed) throw new Error("queue closed");
    const job: Job<T> = { id: randomUUID(), payload, attempt: 1 };
    this.schedule(job, opts?.delayMs ?? 0);
    return job.id;
  }

  process(handler: (job: Job<T>) => Promise<void>): void {
    this.handler = handler;
  }

  private schedule(job: Job<T>, delayMs: number): void {
    const run = new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          if (!this.handler) throw new Error("no handler registered");
          await this.handler(job);
        } catch (err) {
          if (job.attempt < this.opts.maxAttempts) {
            const backoff = this.opts.baseDelayMs * 2 ** (job.attempt - 1);
            this.schedule({ ...job, attempt: job.attempt + 1 }, backoff);
          } else {
            this.opts.onDlq?.(job, err);
          }
        } finally {
          resolve();
        }
      }, delayMs).unref?.();
    });
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run));
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.inflight]);
  }
}
