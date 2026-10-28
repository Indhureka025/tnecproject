import type { EcRequest } from "../contract.ts";
import type { EcResult } from "../canonical.ts";
import type { HitlAnswer, HitlTask } from "../hitl/types.ts";

export interface EcProvider {
  readonly name: string; // "aggregator:landeed" | "aggregator:surepass" | "automation" | "mock"
  /** Cheap check: can this provider serve this request (district coverage, search type, certified)? */
  supports(req: EcRequest): boolean;
  /** Do the retrieval. Long-running; always called from a queue worker, never a request handler. */
  retrieve(req: EcRequest, ctx: RetrieveContext): Promise<EcResult>;
}

export interface RetrieveContext {
  requestId: string;
  log: (event: string, data?: Record<string, unknown>) => void;
  /** Park a task for a human operator and wait for the answer. */
  requestHuman: (task: Omit<HitlTask, "id" | "createdAt" | "status" | "requestId">) => Promise<HitlAnswer>;
}

export type ProviderErrorCode =
  | "unsupported" | "portal_unavailable" | "provider_error" | "no_records_unconfirmed"
  | "payment_required" | "not_digitised" | "captcha_unrecoverable" | "timeout";

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}
