import type { EcRequest, RequestStatus } from "../contract.ts";

export interface StoredRequest {
  status: RequestStatus;
  request: EcRequest;
  idempotencyKey: string;
  paramHash: string;
  createdAt: string;
  updatedAt: string;
  /** append-only audit trail */
  audit: Array<{ at: string; event: string; detail?: unknown }>;
}

export interface RequestStore {
  create(rec: StoredRequest): Promise<void>;
  get(requestId: string): Promise<StoredRequest | undefined>;
  update(requestId: string, patch: Partial<RequestStatus>, auditEvent: string, detail?: unknown): Promise<StoredRequest>;
  findByIdempotencyKey(key: string): Promise<StoredRequest | undefined>;
  /** most recent completed request with the same paramHash newer than `since` (dedupe) */
  findRecentByParamHash(paramHash: string, since: Date): Promise<StoredRequest | undefined>;
}
