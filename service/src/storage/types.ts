export interface StoredObject {
  key: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

export interface ObjectStore {
  /** store bytes, return a content-addressed key */
  put(prefix: string, contentType: string, data: Buffer): Promise<StoredObject>;
  get(key: string): Promise<{ contentType: string; data: Buffer } | undefined>;
  /** a time-limited URL path the API can serve (token embedded) */
  signedPath(key: string, ttlMs: number): { path: string; expiresAt: string };
  verify(key: string, exp: string, token: string): boolean;
}
