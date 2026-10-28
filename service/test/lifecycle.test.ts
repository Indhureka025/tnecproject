import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AUTH, FakeWebhooks, makeApp, sampleBody, waitForTerminal } from "./helpers.ts";

describe("request lifecycle (mock provider)", () => {
  let app: FastifyInstance;
  let webhooks: FakeWebhooks;
  beforeEach(async () => ({ app, webhooks } = await makeApp()));
  afterEach(async () => app.close());

  async function submit(body: Record<string, unknown>, idem = "life-" + Math.random().toString(36).slice(2)): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": idem }, payload: body });
    expect(res.statusCode).toBe(202);
    return res.json().requestId;
  }

  it("completes with ENTRIES_FOUND when the survey number triggers an entry", async () => {
    const id = await submit(sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "123/4", subdivisionNumber: "1" } }));
    const final = await waitForTerminal(app, id);
    expect(final.status).toBe("completed");
    expect(final.result?.outcome).toBe("ENTRIES_FOUND");
    expect(final.result?.encumbrancePresent).toBe(true);
    expect(final.result?.disclaimer).toContain("not proof");
    expect(webhooks.byName("ec.completed")).toHaveLength(1);
    expect(webhooks.byName("ec.received")).toHaveLength(1);
  });

  it("returns partial + NIL_UNCONFIRMED when nothing is found and not verified", async () => {
    const id = await submit(sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "777", subdivisionNumber: "1" } }));
    const final = await waitForTerminal(app, id);
    expect(final.status).toBe("partial");
    expect(final.result?.outcome).toBe("NIL_UNCONFIRMED");
    expect(final.result?.encumbrancePresent).toBeNull();
    expect(webhooks.byName("ec.partial")).toHaveLength(1);
  });

  it("goes through needs_human when a nil review is triggered (auto-answered in tests)", async () => {
    const id = await submit(sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "999", subdivisionNumber: "1" } }));
    const final = await waitForTerminal(app, id);
    // auto HITL answers confirmedNil=false -> stays NIL_UNCONFIRMED/partial, but a needs_human webhook fired
    expect(webhooks.byName("ec.needs_human").length).toBeGreaterThanOrEqual(1);
    expect(["partial", "completed"]).toContain(final.status);
  });

  it("fails with 'unresolvable' for an unknown SRO", async () => {
    const id = await submit(sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "NOPE-999", village: "X", surveyNumber: "1" } }));
    const final = await waitForTerminal(app, id);
    expect(final.status).toBe("failed");
    expect(final.failure?.code).toBe("unresolvable");
    expect(webhooks.byName("ec.failed")).toHaveLength(1);
  });

  it("PERIOD_GAP when the requested period predates 1975", async () => {
    const id = await submit(sampleBody({ period: { from: "1960-01-01", to: "2024-12-31" }, property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "555", subdivisionNumber: "1" } }));
    const final = await waitForTerminal(app, id);
    expect(final.result?.outcome).toBe("PERIOD_GAP");
    expect(final.status).toBe("partial");
  });
});

describe("certified EC async flow", () => {
  it("goes payment -> awaiting_signature -> completed with a signed doc", async () => {
    const { app, webhooks } = await makeApp({ CERTIFIED_SIGN_DELAY_MS: "300" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "cert-flow-0001" },
      payload: sampleBody({ certified: true, property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "123/4", subdivisionNumber: "1" } }),
    });
    const id = res.json().requestId as string;
    expect(res.json().estimate).toEqual({ type: "days", value: 5 });

    const final = await waitForTerminal(app, id, 6000);
    expect(final.status).toBe("completed");
    expect(final.result?.provenance.certified).toBe(true);
    expect(final.result?.caveats.some((c) => c.code === "CERTIFIED_COPY_SIGNED")).toBe(true);
    expect(final.documents.some((d) => d.kind === "ec_pdf")).toBe(true);

    // the ERP saw the payment prompt and the awaiting-signature state
    expect(webhooks.byName("ec.needs_human").length).toBeGreaterThanOrEqual(1);
    expect(webhooks.byName("ec.awaiting_signature")).toHaveLength(1);
    expect(webhooks.byName("ec.completed")).toHaveLength(1);
    await app.close();
  });
});

describe("dedupe", () => {
  it("serves a second identical informational request from cache", async () => {
    const { app } = await makeApp({ DEDUPE_WINDOW_DAYS: "14" });
    const body = sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "123/4", subdivisionNumber: "1" } });
    const r1 = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": "d1-xxxxxxxx" }, payload: body });
    const id1 = r1.json().requestId as string;
    await waitForTerminal(app, id1);
    const r2 = await app.inject({ method: "POST", url: "/v1/ec-requests", headers: { ...AUTH, "idempotency-key": "d2-xxxxxxxx" }, payload: body });
    const id2 = r2.json().requestId as string;
    const final2 = await waitForTerminal(app, id2);
    expect(final2.status).toBe("completed");
    expect(final2.result?.outcome).toBe("ENTRIES_FOUND");
    await app.close();
  });
});
