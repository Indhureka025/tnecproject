import { describe, expect, it, vi } from "vitest";
import { ProviderRouter } from "../src/providers/router.ts";
import { ProviderError, type EcProvider, type RetrieveContext } from "../src/providers/types.ts";
import type { EcRequest } from "../src/contract.ts";
import { EC_DISCLAIMER, type EcResult } from "../src/canonical.ts";

const req = { searchType: "EC_WISE", certified: false, property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "T", surveyNumber: "1" }, period: { from: "2004-01-01", to: "2024-12-31" }, callbackUrl: "https://x", priority: "normal" } as EcRequest;

const ctx: Omit<RetrieveContext, "log"> & { log: RetrieveContext["log"] } = {
  requestId: "r1",
  log: () => {},
  requestHuman: async () => ({ kind: "captcha", value: "X" }),
};

function fakeResult(source: string): EcResult {
  return {
    schemaVersion: "1.0",
    search: { type: "EC_WISE", property: {}, period: req.period, performedAt: "t" },
    outcome: "NIL_CONFIRMED",
    encumbrancePresent: false,
    entryCount: 0,
    entries: [],
    documents: [],
    caveats: [],
    provenance: { source, sourceReference: null, certified: false, retrievedAt: "t", operatorId: null, rawArtifactRefs: [] },
    disclaimer: EC_DISCLAIMER,
  };
}

const provider = (name: string, impl: Partial<EcProvider>): EcProvider => ({
  name,
  supports: () => true,
  retrieve: async () => fakeResult(name),
  ...impl,
});

describe("ProviderRouter", () => {
  it("uses the first supporting provider", async () => {
    const p1 = provider("a", {});
    const p2 = provider("b", { retrieve: vi.fn() });
    const r = new ProviderRouter([p1, p2]);
    const out = await r.retrieve(req, ctx);
    expect(out.provider).toBe("a");
    expect(p2.retrieve).not.toHaveBeenCalled();
  });

  it("falls through on a retryable error", async () => {
    const p1 = provider("a", { retrieve: async () => { throw new ProviderError("portal_unavailable", "down", true); } });
    const p2 = provider("b", {});
    const r = new ProviderRouter([p1, p2]);
    const out = await r.retrieve(req, ctx);
    expect(out.provider).toBe("b");
  });

  it("stops on a non-retryable error", async () => {
    const p1 = provider("a", { retrieve: async () => { throw new ProviderError("payment_required", "pay", false); } });
    const p2 = provider("b", { retrieve: vi.fn() });
    const r = new ProviderRouter([p1, p2]);
    await expect(r.retrieve(req, ctx)).rejects.toThrow(/pay/);
    expect(p2.retrieve).not.toHaveBeenCalled();
  });

  it("opens the circuit breaker after repeated failures", async () => {
    const p1 = provider("a", { retrieve: async () => { throw new ProviderError("provider_error", "boom", true); } });
    const p2 = provider("b", {});
    const r = new ProviderRouter([p1, p2], { failureThreshold: 2, cooldownMs: 10_000 });
    await r.retrieve(req, ctx); // p1 fails (1)
    await r.retrieve(req, ctx); // p1 fails (2) -> breaker opens
    expect(r.candidates(req).map((p) => p.name)).toEqual(["b"]);
  });

  it("throws when no provider supports the request", async () => {
    const r = new ProviderRouter([provider("a", { supports: () => false })]);
    await expect(r.retrieve(req, ctx)).rejects.toThrow(/no provider supports/);
  });
});
