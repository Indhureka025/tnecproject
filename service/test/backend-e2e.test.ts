import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AUTH, makeApp, sampleBody, waitForTerminal, type FakeWebhooks } from "./helpers.ts";

/** The whole service on the Postgres backend (PGlite) + durable queue. */
describe("end-to-end on BACKEND=postgres", () => {
  let app: FastifyInstance;
  let webhooks: FakeWebhooks;
  beforeEach(async () => {
    ({ app, webhooks } = await makeApp({ BACKEND: "postgres", DATABASE_URL: "pglite://memory" }));
  });
  afterEach(async () => app.close());

  it("healthz reports the postgres backend", async () => {
    const h = await app.inject({ method: "GET", url: "/healthz" });
    expect(h.json()).toMatchObject({ backend: "postgres", db: "connected" });
  });

  it("completes a request end to end and persists it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "pg-e2e-0001" },
      payload: sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "123/4", subdivisionNumber: "1" } }),
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().requestId as string;

    const final = await waitForTerminal(app, id, 8000);
    expect(final.status).toBe("completed");
    expect(final.result?.outcome).toBe("ENTRIES_FOUND");
    expect(final.documents).toHaveLength(1);
    expect(webhooks.byName("ec.completed")).toHaveLength(1);

    // audit trail is in the DB
    const db = app._internals.db!;
    const audit = await db.query<{ event: string }>("SELECT event FROM ec_request_audit WHERE request_id = $1 ORDER BY at", [id]);
    expect(audit.rows.map((r) => r.event)).toEqual(expect.arrayContaining(["received", "in_progress", "completed"]));
    const jobs = await db.query<{ status: string }>("SELECT status FROM jobs");
    expect(jobs.rows[0]?.status).toBe("done");
  });

  it("idempotency + dedupe work against the DB", async () => {
    const body = sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "123/4", subdivisionNumber: "1" } });
    const a = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": "pg-idem-xxxx" }, payload: body });
    const b = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": "pg-idem-xxxx" }, payload: body });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(200);
    expect(b.json().requestId).toBe(a.json().requestId);
  });
});
