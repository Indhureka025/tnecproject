import type { EcProvider, RetrieveContext } from "./types.ts";
import { ProviderError } from "./types.ts";
import type { EcRequest } from "../contract.ts";
import type { EcResult } from "../canonical.ts";

/**
 * SurePass aggregator adapter — STUB (secondary provider).
 *
 * Same treatment as landeed.ts: mapping shape is provisional, confirm against the
 * SurePass API docs during onboarding (docs/vendor-rfp/). Reports unsupported until
 * credentials are configured, so the router skips it.
 */
export class SurepassProvider implements EcProvider {
  readonly name = "aggregator:surepass";

  constructor(private readonly cfg: { baseUrl: string; apiKey: string }) {}

  supports(req: EcRequest): boolean {
    if (!this.cfg.baseUrl || !this.cfg.apiKey) return false;
    return req.searchType === "EC_WISE";
  }

  async retrieve(_req: EcRequest, ctx: RetrieveContext): Promise<EcResult> {
    ctx.log("surepass.retrieve", { requestId: ctx.requestId });
    // TODO: implement once sandbox access is granted. See landeed.ts for the pattern.
    throw new ProviderError("provider_error", "SurePass adapter not implemented (awaiting sandbox access)");
  }
}
