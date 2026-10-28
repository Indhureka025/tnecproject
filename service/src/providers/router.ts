import type { EcProvider, RetrieveContext } from "./types.ts";
import { ProviderError } from "./types.ts";
import type { EcRequest } from "../contract.ts";
import type { EcResult } from "../canonical.ts";

interface Breaker {
  failures: number;
  openUntil: number; // epoch ms; 0 = closed
}

/**
 * Tries providers in configured order; the first whose supports() is true and whose
 * circuit breaker is closed handles the request. On a retryable ProviderError it
 * falls through to the next provider. A non-retryable error stops the chain.
 */
export class ProviderRouter {
  private breakers = new Map<string, Breaker>();

  constructor(
    private readonly providers: EcProvider[],
    private readonly opts = { failureThreshold: 3, cooldownMs: 60_000 },
  ) {}

  private breaker(name: string): Breaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = { failures: 0, openUntil: 0 };
      this.breakers.set(name, b);
    }
    return b;
  }

  private isOpen(name: string): boolean {
    return this.breaker(name).openUntil > Date.now();
  }

  private recordFailure(name: string): void {
    const b = this.breaker(name);
    b.failures += 1;
    if (b.failures >= this.opts.failureThreshold) {
      b.openUntil = Date.now() + this.opts.cooldownMs;
      b.failures = 0;
    }
  }

  private recordSuccess(name: string): void {
    this.breakers.set(name, { failures: 0, openUntil: 0 });
  }

  candidates(req: EcRequest): EcProvider[] {
    return this.providers.filter((p) => p.supports(req) && !this.isOpen(p.name));
  }

  async retrieve(req: EcRequest, ctx: Omit<RetrieveContext, "log"> & { log: RetrieveContext["log"] }): Promise<{ result: EcResult; provider: string }> {
    const tried: string[] = [];
    let lastErr: unknown;

    for (const provider of this.candidates(req)) {
      tried.push(provider.name);
      try {
        const result = await provider.retrieve(req, { ...ctx, log: (e, d) => ctx.log(e, { provider: provider.name, ...d }) });
        this.recordSuccess(provider.name);
        return { result, provider: provider.name };
      } catch (err) {
        lastErr = err;
        this.recordFailure(provider.name);
        ctx.log("provider.failed", { provider: provider.name, error: (err as Error).message });
        if (err instanceof ProviderError && !err.retryable) throw err;
        // retryable -> try next provider
      }
    }

    if (lastErr instanceof ProviderError) throw lastErr;
    throw new ProviderError(
      "provider_error",
      tried.length ? `all providers failed (${tried.join(", ")})` : "no provider supports this request",
      tried.length > 0,
    );
  }
}
