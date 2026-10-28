import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ObjectStore, StoredObject } from "./types.ts";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "text/html": "html",
  "image/png": "png",
  "application/octet-stream": "bin",
};

abstract class BaseStore implements ObjectStore {
  constructor(private readonly signingSecret: string) {}

  protected key(prefix: string, contentType: string, sha256: string): string {
    return `${prefix}/${sha256.slice(0, 16)}-${randomUUID().slice(0, 8)}.${EXT[contentType] ?? "bin"}`;
  }

  abstract put(prefix: string, contentType: string, data: Buffer): Promise<StoredObject>;
  abstract get(key: string): Promise<{ contentType: string; data: Buffer } | undefined>;

  signedPath(key: string, ttlMs: number): { path: string; expiresAt: string } {
    const exp = Date.now() + ttlMs;
    const token = createHmac("sha256", this.signingSecret).update(`${key}:${exp}`).digest("hex").slice(0, 32);
    return {
      path: `/v1/documents/${encodeURIComponent(key)}?exp=${exp}&token=${token}`,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  verify(key: string, exp: string, token: string): boolean {
    if (!exp || !token) return false;
    if (Number(exp) < Date.now()) return false;
    const expected = createHmac("sha256", this.signingSecret).update(`${key}:${exp}`).digest("hex").slice(0, 32);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export class MemoryObjectStore extends BaseStore {
  private objs = new Map<string, { contentType: string; data: Buffer }>();
  async put(prefix: string, contentType: string, data: Buffer): Promise<StoredObject> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = this.key(prefix, contentType, sha256);
    this.objs.set(key, { contentType, data });
    return { key, contentType, bytes: data.length, sha256 };
  }
  async get(key: string) {
    return this.objs.get(key);
  }
}

export class LocalObjectStore extends BaseStore {
  constructor(secret: string, private readonly root: string) {
    super(secret);
    mkdirSync(root, { recursive: true });
  }
  async put(prefix: string, contentType: string, data: Buffer): Promise<StoredObject> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = this.key(prefix, contentType, sha256);
    const full = path.join(this.root, key);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, data);
    writeFileSync(full + ".meta", contentType);
    return { key, contentType, bytes: data.length, sha256 };
  }
  async get(key: string) {
    const full = path.join(this.root, key);
    if (!existsSync(full)) return undefined;
    return { contentType: existsSync(full + ".meta") ? readFileSync(full + ".meta", "utf8") : "application/octet-stream", data: readFileSync(full) };
  }
}
