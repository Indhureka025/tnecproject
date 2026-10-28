/**
 * Mock ERP webhook receiver. Stands in for the client's ERP/CRM callback endpoint.
 * Verifies the HMAC signature on every delivery (rejecting bad ones) and records
 * what it received so a contract test can assert the full exchange.
 *
 *   node verification/mock-erp/server.mjs --port 8190 --secret dev-secret-change-me
 */
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 8190));
const SECRET = arg("secret", "dev-secret-change-me");

const events = [];
let rejected = 0;

function verify(rawBody, ts, sig) {
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() - Date.parse(ts)) > 5 * 60_000) return false; // stale
  const expected = "sha256=" + createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/hook") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const ok = verify(raw, req.headers["x-ec-timestamp"], req.headers["x-ec-signature"]);
      if (!ok) { rejected++; res.writeHead(401); return res.end("bad signature"); }
      try {
        const evt = JSON.parse(raw);
        events.push({ receivedAt: new Date().toISOString(), event: evt.event, requestId: evt.requestId, reference: evt.reference, data: evt.data });
      } catch { /* ignore */ }
      res.writeHead(200); res.end("ok");
    });
    return;
  }
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ events, rejected }));
  }
  if (req.method === "POST" && req.url === "/reset") { events.length = 0; rejected = 0; res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => console.log(`mock ERP webhook receiver on http://localhost:${PORT}/hook`));
