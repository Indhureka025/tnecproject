import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LocalObjectStore, MemoryObjectStore } from "../src/storage/index.ts";
import { AUTH, makeApp, sampleBody, waitForTerminal, type FakeWebhooks } from "./helpers.ts";

describe("object store", () => {
  for (const make of [() => new MemoryObjectStore("s"), () => new LocalObjectStore("s", mkdtempSync(path.join(tmpdir(), "ec-obj-")))]) {
    const store = make();
    it(`${store.constructor.name}: put / get / signed-path round trip`, async () => {
      const obj = await store.put("ec/x", "text/html", Buffer.from("<h1>hi</h1>"));
      expect(obj.bytes).toBe(11);
      expect(obj.sha256).toMatch(/^[0-9a-f]{64}$/);
      const got = await store.get(obj.key);
      expect(got?.data.toString()).toBe("<h1>hi</h1>");
      expect(got?.contentType).toBe("text/html");

      const signed = store.signedPath(obj.key, 60_000);
      const u = new URL("http://x" + signed.path);
      expect(store.verify(obj.key, u.searchParams.get("exp")!, u.searchParams.get("token")!)).toBe(true);
      expect(store.verify(obj.key, u.searchParams.get("exp")!, "tampered")).toBe(false);
      expect(store.verify(obj.key, "1", u.searchParams.get("token")!)).toBe(false); // expired
    });
  }
});

describe("documents flow through the pipeline", () => {
  let app: FastifyInstance;
  let webhooks: FakeWebhooks;
  beforeEach(async () => ({ app, webhooks } = await makeApp()));
  afterEach(async () => app.close());

  it("a completed request has a downloadable EC summary", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ec-requests",
      headers: { ...AUTH, "idempotency-key": "doc-test-0001" },
      payload: sampleBody({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "123/4", subdivisionNumber: "1" } }),
    });
    const id = res.json().requestId as string;
    const final = await waitForTerminal(app, id);
    expect(final.status).toBe("completed");
    expect(final.documents.length).toBe(1);
    const doc = final.documents[0]!;
    expect(doc.kind).toBe("ec_summary");
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);

    // the signed URL resolves without a bearer token
    const dl = await app.inject({ method: "GET", url: doc.url });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("text/html");
    expect(dl.body).toContain("Encumbrance Certificate");
    expect(dl.body).toContain("MORTGAGE");

    // a tampered token is rejected
    const bad = await app.inject({ method: "GET", url: doc.url.replace(/token=[0-9a-f]+/, "token=deadbeef") });
    expect(bad.statusCode).toBe(403);

    expect(webhooks.byName("ec.completed")).toHaveLength(1);
  });
});
