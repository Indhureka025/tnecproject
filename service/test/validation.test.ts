import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AUTH, makeApp, sampleBody } from "./helpers.ts";

describe("POST /v1/ec-requests validation", () => {
  let app: FastifyInstance;
  beforeEach(async () => ({ app } = await makeApp()));
  afterEach(async () => app.close());

  it("rejects a missing Idempotency-Key", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: AUTH, payload: sampleBody() });
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].field).toBe("Idempotency-Key");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { "idempotency-key": "k".repeat(12) }, payload: sampleBody() });
    expect(res.statusCode).toBe(401);
  });

  it("rejects period.from after period.to", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "k".repeat(12) },
      payload: sampleBody({ period: { from: "2024-01-01", to: "2020-01-01" } }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("from must be <= to");
  });

  it("rejects an impossible calendar date (2024-13-45)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "k".repeat(12) },
      payload: sampleBody({ period: { from: "2024-13-45", to: "2025-01-01" } }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a real-shape but non-existent date (2023-02-29)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "k".repeat(12) },
      payload: sampleBody({ period: { from: "2023-02-29", to: "2025-01-01" } }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires documentNumber + registrationYear for DOCUMENT_WISE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "k".repeat(12) },
      payload: sampleBody({ searchType: "DOCUMENT_WISE", property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur" } }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a well-formed request with 202 + requestId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "k".repeat(12) },
      payload: sampleBody(),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().requestId).toBeTruthy();
    expect(res.json().status).toBe("queued");
  });
});
