/**
 * Test webhook receiver. Records every delivery and independently verifies the
 * HMAC-SHA256 signature (does NOT reuse the service's signing code).
 *   node webhook-sink.mjs [port] [secret]
 * Endpoints:
 *   POST /hook        -> 200, records the event
 *   GET  /events      -> JSON array of everything received
 *   POST /reset       -> clears
 *   GET  /health      -> ok
 */
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const port = Number(process.argv[2] ?? 9109);
const secret = process.argv[3] ?? "qa-secret";
const events = [];

function verify(rawBody, ts, sig) {
  if (!ts || !sig) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/events") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify(events));
  }
  if (req.method === "GET" && req.url === "/health") return res.end("ok");
  if (req.method === "POST" && req.url === "/reset") {
    events.length = 0;
    return res.end("reset");
  }
  if (req.method === "POST" && req.url === "/hook") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ts = req.headers["x-ec-timestamp"];
      const sig = req.headers["x-ec-signature"];
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* keep raw */ }
      events.push({
        receivedAt: new Date().toISOString(),
        event: req.headers["x-ec-event"] ?? parsed?.event ?? null,
        attempt: req.headers["x-ec-delivery-attempt"] ?? null,
        signaturePresent: Boolean(sig),
        signatureValid: verify(body, ts, sig),
        requestId: parsed?.requestId ?? null,
        status: parsed?.data?.status ?? null,
      });
      res.statusCode = 200;
      res.end("ok");
    });
    return;
  }
  res.statusCode = 404;
  res.end("nope");
});

server.listen(port, () => console.log(`webhook-sink on :${port} (secret "${secret}")`));
