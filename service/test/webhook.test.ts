import { describe, expect, it, vi } from "vitest";
import { signPayload, verifySignature } from "../src/webhook/sign.ts";
import { HttpWebhookDeliverer } from "../src/webhook/deliver.ts";
import type { RequestStatus } from "../src/contract.ts";

const status: RequestStatus = {
  requestId: "req-1",
  status: "completed",
  certified: false,
  source: "mock",
  submittedAt: "2026-09-10T00:00:00Z",
  completedAt: "2026-09-10T00:01:00Z",
  result: null,
  documents: [],
  failure: null,
};

describe("webhook signing", () => {
  it("verifies a good signature and rejects a tampered body", () => {
    const ts = "2026-09-10T00:00:00Z";
    const sig = signPayload("s3cr3t", '{"a":1}', ts);
    expect(verifySignature("s3cr3t", '{"a":1}', ts, sig)).toBe(true);
    expect(verifySignature("s3cr3t", '{"a":2}', ts, sig)).toBe(false);
    expect(verifySignature("wrong", '{"a":1}', ts, sig)).toBe(false);
  });
});

describe("webhook delivery", () => {
  it("stops after the first 2xx", async () => {
    const sink = vi.fn(async (_url: string, _headers: Record<string, string>, _body: string) => ({ statusCode: 200 }));
    const d = new HttpWebhookDeliverer("s", { attempts: 5, baseDelayMs: 1 }, () => {}, sink);
    await d.send("ec.completed", status, "https://cb.example");
    expect(sink).toHaveBeenCalledTimes(1);
    const call = sink.mock.calls[0]!;
    const headers = call[1];
    const body = call[2];
    expect(headers["x-ec-signature"]).toMatch(/^sha256=/);
    expect(verifySignature("s", body, headers["x-ec-timestamp"]!, headers["x-ec-signature"]!)).toBe(true);
  });

  it("retries on non-2xx up to the attempt budget", async () => {
    const sink = vi.fn(async (_url: string, _headers: Record<string, string>, _body: string) => ({ statusCode: 500 }));
    const d = new HttpWebhookDeliverer("s", { attempts: 3, baseDelayMs: 1 }, () => {}, sink);
    await d.send("ec.failed", status, "https://cb.example");
    expect(sink).toHaveBeenCalledTimes(3);
  });
});
