import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature: HMAC-SHA256 over `${timestamp}.${rawBody}` using the shared
 * secret. Sent as headers `X-EC-Signature: sha256=<hex>` and `X-EC-Timestamp`.
 * The ERP verifies with the same secret and rejects timestamps older than ~5 min.
 */
export function signPayload(secret: string, rawBody: string, timestamp: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `sha256=${mac}`;
}

export function verifySignature(secret: string, rawBody: string, timestamp: string, signature: string): boolean {
  const expected = signPayload(secret, rawBody, timestamp);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
