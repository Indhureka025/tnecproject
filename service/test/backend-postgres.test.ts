import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/pg.ts";
import { PostgresRequestStore } from "../src/store/postgres.ts";
import { PostgresQueue } from "../src/queue/postgres.ts";
import type { StoredRequest } from "../src/store/types.ts";
import { sampleBody } from "./helpers.ts";
import type { EcRequest, RequestStatus } from "../src/contract.ts";

function rec(id: string, key: string, over: Partial<RequestStatus> = {}): StoredRequest {
  const req = sampleBody() as unknown as EcRequest;
  const now = new Date().toISOString();
  return {
    status: { requestId: id, status: "queued", certified: false, source: null, submittedAt: now, completedAt: null, result: null, documents: [], failure: null, ...over },
    request: req,
    idempotencyKey: key,
    paramHash: "hash-" + key,
    createdAt: now,
    updatedAt: now,
    audit: [{ at: now, event: "received" }],
  };
}

describe("PostgresRequestStore (pglite)", () => {
  let db: Db;
  let store: PostgresRequestStore;
  beforeEach(async () => {
    db = await openDb("pglite://memory");
    store = new PostgresRequestStore(db);
  });
  afterEach(async () => db.close());

  it("creates and reads back a request with audit", async () => {
    await store.create(rec("11111111-1111-1111-1111-111111111111", "idem-a"));
    const got = await store.get("11111111-1111-1111-1111-111111111111");
    expect(got?.idempotencyKey).toBe("idem-a");
    expect(got?.audit[0]?.event).toBe("received");
  });

  it("updates status and appends audit", async () => {
    await store.create(rec("22222222-2222-2222-2222-222222222222", "idem-b"));
    await store.update("22222222-2222-2222-2222-222222222222", { status: "completed", completedAt: new Date().toISOString() }, "completed", { provider: "mock" });
    const got = await store.get("22222222-2222-2222-2222-222222222222");
    expect(got?.status.status).toBe("completed");
    expect(got?.audit.map((a) => a.event)).toContain("completed");
    expect(got?.audit.at(-1)?.detail).toMatchObject({ provider: "mock" });
  });

  it("finds by idempotency key", async () => {
    await store.create(rec("33333333-3333-3333-3333-333333333333", "idem-c"));
    expect((await store.findByIdempotencyKey("idem-c"))?.status.requestId).toBe("33333333-3333-3333-3333-333333333333");
    expect(await store.findByIdempotencyKey("nope")).toBeUndefined();
  });

  it("dedupe: findRecentByParamHash returns only recent completed rows", async () => {
    const r = rec("44444444-4444-4444-4444-444444444444", "idem-d");
    r.paramHash = "shared";
    await store.create(r);
    await store.update(r.status.requestId, { status: "completed", result: { schemaVersion: "1.0" } as never }, "completed");
    const hit = await store.findRecentByParamHash("shared", new Date(Date.now() - 60_000));
    expect(hit?.status.requestId).toBe(r.status.requestId);
    expect(await store.findRecentByParamHash("shared", new Date(Date.now() + 60_000))).toBeUndefined();
  });
});

describe("PostgresQueue (pglite)", () => {
  let db: Db;
  beforeEach(async () => { db = await openDb("pglite://memory"); });
  afterEach(async () => db.close());

  it("runs an enqueued job and marks it done", async () => {
    const q = new PostgresQueue<{ n: number }>(db, "t", { pollMs: 5, lockMs: 5000, maxAttempts: 3, baseDelayMs: 10 });
    const seen: number[] = [];
    q.process(async (job) => { seen.push(job.payload.n); });
    await q.add({ n: 7 });
    expect(await q.drainOnce()).toBe(true);
    expect(seen).toEqual([7]);
    const row = await db.query<{ status: string }>("SELECT status FROM jobs");
    expect(row.rows[0]?.status).toBe("done");
    await q.close();
  });

  it("retries a failing job with backoff then marks it failed", async () => {
    const q = new PostgresQueue<{ x: string }>(db, "t", { pollMs: 5, lockMs: 5000, maxAttempts: 2, baseDelayMs: 1 });
    let calls = 0;
    q.process(async () => { calls++; throw new Error("boom"); });
    await q.add({ x: "a" });
    await q.drainOnce();                       // attempt 1 -> requeued
    await db.query("UPDATE jobs SET run_at = now() - interval '1 second'"); // make it due
    await q.drainOnce();                       // attempt 2 -> failed
    expect(calls).toBe(2);
    const row = await db.query<{ status: string; attempts: number; last_error: string }>("SELECT status, attempts, last_error FROM jobs");
    expect(row.rows[0]?.status).toBe("failed");
    expect(row.rows[0]?.attempts).toBe(2);
    expect(row.rows[0]?.last_error).toContain("boom");
    await q.close();
  });

  it("re-leases a job whose lock expired (crashed worker)", async () => {
    const q = new PostgresQueue<{ x: number }>(db, "t", { pollMs: 5, lockMs: 5000, maxAttempts: 3, baseDelayMs: 1 });
    q.process(async () => {});
    await q.add({ x: 1 });
    // simulate a crash mid-job: mark active with an already-expired lock
    await db.query("UPDATE jobs SET status='active', locked_until = now() - interval '1 minute'");
    expect(await q.drainOnce()).toBe(true);
    const row = await db.query<{ status: string }>("SELECT status FROM jobs");
    expect(row.rows[0]?.status).toBe("done");
    await q.close();
  });

  it("honours a delayed job", async () => {
    const q = new PostgresQueue<{ x: number }>(db, "t", { pollMs: 5, lockMs: 5000, maxAttempts: 3, baseDelayMs: 1 });
    q.process(async () => {});
    await q.add({ x: 1 }, { delayMs: 60_000 });
    expect(await q.drainOnce()).toBe(false); // not due yet
    await q.close();
  });
});
