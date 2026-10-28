import type { RequestStore, StoredRequest } from "./types.ts";
import type { RequestStatus } from "../contract.ts";

/** In-process store. Fine for dev/tests; Phase 1 swaps in store/postgres.ts. */
export class MemoryRequestStore implements RequestStore {
  private byId = new Map<string, StoredRequest>();
  private byIdem = new Map<string, string>();

  async create(rec: StoredRequest): Promise<void> {
    this.byId.set(rec.status.requestId, rec);
    this.byIdem.set(rec.idempotencyKey, rec.status.requestId);
  }

  async get(requestId: string): Promise<StoredRequest | undefined> {
    return this.byId.get(requestId);
  }

  async update(requestId: string, patch: Partial<RequestStatus>, auditEvent: string, detail?: unknown): Promise<StoredRequest> {
    const rec = this.byId.get(requestId);
    if (!rec) throw new Error(`no such request ${requestId}`);
    rec.status = { ...rec.status, ...patch };
    rec.updatedAt = new Date().toISOString();
    rec.audit.push({ at: rec.updatedAt, event: auditEvent, detail });
    return rec;
  }

  async findByIdempotencyKey(key: string): Promise<StoredRequest | undefined> {
    const id = this.byIdem.get(key);
    return id ? this.byId.get(id) : undefined;
  }

  async findRecentByParamHash(paramHash: string, since: Date): Promise<StoredRequest | undefined> {
    let best: StoredRequest | undefined;
    for (const rec of this.byId.values()) {
      if (rec.paramHash !== paramHash) continue;
      if (rec.status.status !== "completed") continue;
      if (new Date(rec.createdAt) < since) continue;
      if (!best || rec.createdAt > best.createdAt) best = rec;
    }
    return best;
  }
}
