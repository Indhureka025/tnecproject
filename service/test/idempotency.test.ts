import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AUTH, makeApp, sampleBody } from "./helpers.ts";

describe("idempotency", () => {
  let app: FastifyInstance;
  beforeEach(async () => ({ app } = await makeApp()));
  afterEach(async () => app.close());

  const key = "idem-" + "x".repeat(12);

  it("same key + same body returns the same requestId (200 on repeat)", async () => {
    const first = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": key }, payload: sampleBody() });
    const second = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": key }, payload: sampleBody() });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().requestId).toBe(first.json().requestId);
  });

  it("same key + different body returns 409", async () => {
    await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": key }, payload: sampleBody() });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": key },
      payload: sampleBody({ period: { from: "2010-01-01", to: "2020-01-01" } }),
    });
    expect(conflict.statusCode).toBe(409);
  });
});
