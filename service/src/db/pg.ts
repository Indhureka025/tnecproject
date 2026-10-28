/**
 * Minimal Postgres access layer.
 *
 * Backed by PGlite (real Postgres 16 compiled to WASM, in-process) so the
 * Postgres store + queue run and are tested without a separate DB server. In a
 * real deployment, point DATABASE_URL at a Postgres instance and swap the driver
 * for `pg` (same `query` shape) — see openDb().
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

const SCHEMA = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");

/**
 * @param url  "pglite://<dir>" or "pglite://memory" (default) use the embedded
 *             engine; anything else is treated as a real Postgres connection
 *             string and requires the optional `pg` dependency.
 */
export async function openDb(url = "pglite://memory"): Promise<Db> {
  if (url.startsWith("pglite://") || url === "memory") {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = url.replace(/^pglite:\/\//, "");
    const pg = dir && dir !== "memory" ? new PGlite(dir) : new PGlite();
    await pg.waitReady;
    const db: Db = {
      query: async (sql, params) => {
        const r = await pg.query(sql, params as unknown[]);
        return { rows: r.rows as never[] };
      },
      exec: async (sql) => { await pg.exec(sql); },
      close: async () => { await pg.close(); },
    };
    await db.exec(SCHEMA);
    return db;
  }

  // Real Postgres. `pg` ships with the service; PGlite stays the default so tests
  // and `BACKEND=memory` need no native build.
  const dynImport = new Function("s", "return import(s)") as (s: string) => Promise<{ default: { Pool: new (o: { connectionString: string }) => PgPool } }>;
  const pgMod = await dynImport("pg").catch(() => {
    throw new Error(`DATABASE_URL points at Postgres ("${url}") but the "pg" package failed to load`);
  });
  const pool = new pgMod.default.Pool({ connectionString: url });
  const db: Db = {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const r = await pool.query(sql, params);
      return { rows: r.rows as T[] };
    },
    exec: async (sql) => { await pool.query(sql); },
    close: async () => { await pool.end(); },
  };
  await db.exec(SCHEMA);
  return db;
}
