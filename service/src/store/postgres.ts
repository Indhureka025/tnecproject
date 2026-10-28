/**
 * Postgres-backed RequestStore. Runs on PGlite in dev/test and on a real Postgres
 * in production (same SQL). Replaces store/memory.ts when BACKEND=postgres.
 */
import type { Db } from "../db/pg.ts";
import type { RequestStore, StoredRequest } from "./types.ts";
import type { EcRequest, RequestStatus } from "../contract.ts";

interface Row {
  request_id: string;
  idempotency_key: string;
  param_hash: string;
  request_json: EcRequest;
  status_json: RequestStatus;
  created_at: string;
  updated_at: string;
}

export class PostgresRequestStore implements RequestStore {
  constructor(private readonly db: Db) {}

  private async hydrate(row: Row): Promise<StoredRequest> {
    const audit = await this.db.query<{ at: string; event: string; detail: unknown }>(
      `SELECT at, event, detail FROM ec_request_audit WHERE request_id = $1 ORDER BY at, id`,
      [row.request_id],
    );
    return {
      status: row.status_json,
      request: row.request_json,
      idempotencyKey: row.idempotency_key,
      paramHash: row.param_hash,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      audit: audit.rows.map((r) => ({ at: new Date(r.at).toISOString(), event: r.event, detail: r.detail ?? undefined })),
    };
  }

  async create(rec: StoredRequest): Promise<void> {
    await this.db.query(
      `INSERT INTO ec_requests (request_id, idempotency_key, param_hash, status, certified, reference, request_json, status_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb, now(), now())`,
      [
        rec.status.requestId,
        rec.idempotencyKey,
        rec.paramHash,
        rec.status.status,
        rec.status.certified,
        rec.status.reference ?? null,
        JSON.stringify(rec.request),
        JSON.stringify(rec.status),
      ],
    );
    for (const a of rec.audit) {
      await this.db.query(`INSERT INTO ec_request_audit (request_id, event, detail) VALUES ($1,$2,$3::jsonb)`, [
        rec.status.requestId,
        a.event,
        a.detail === undefined ? null : JSON.stringify(a.detail),
      ]);
    }
  }

  async get(requestId: string): Promise<StoredRequest | undefined> {
    const r = await this.db.query<Row>(`SELECT * FROM ec_requests WHERE request_id = $1`, [requestId]);
    return r.rows[0] ? this.hydrate(r.rows[0]) : undefined;
  }

  async update(requestId: string, patch: Partial<RequestStatus>, auditEvent: string, detail?: unknown): Promise<StoredRequest> {
    const cur = await this.db.query<Row>(`SELECT * FROM ec_requests WHERE request_id = $1`, [requestId]);
    const row = cur.rows[0];
    if (!row) throw new Error(`no such request ${requestId}`);
    const status = { ...row.status_json, ...patch };
    await this.db.query(
      `UPDATE ec_requests SET status = $2, status_json = $3::jsonb, updated_at = now() WHERE request_id = $1`,
      [requestId, status.status, JSON.stringify(status)],
    );
    await this.db.query(`INSERT INTO ec_request_audit (request_id, event, detail) VALUES ($1,$2,$3::jsonb)`, [
      requestId,
      auditEvent,
      detail === undefined ? null : JSON.stringify(detail),
    ]);
    return (await this.get(requestId))!;
  }

  async findByIdempotencyKey(key: string): Promise<StoredRequest | undefined> {
    const r = await this.db.query<Row>(`SELECT * FROM ec_requests WHERE idempotency_key = $1`, [key]);
    return r.rows[0] ? this.hydrate(r.rows[0]) : undefined;
  }

  async findRecentByParamHash(paramHash: string, since: Date): Promise<StoredRequest | undefined> {
    const r = await this.db.query<Row>(
      `SELECT * FROM ec_requests
       WHERE param_hash = $1 AND status = 'completed' AND created_at >= $2
       ORDER BY created_at DESC LIMIT 1`,
      [paramHash, since.toISOString()],
    );
    return r.rows[0] ? this.hydrate(r.rows[0]) : undefined;
  }
}
