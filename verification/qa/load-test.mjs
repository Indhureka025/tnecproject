/**
 * Load test — sustained POST /v1/ec-requests against a spawned service instance,
 * each request unique (own idempotency key), with a local webhook sink. Verifies
 * the queue drains, latency stays sane, and nothing errors. Mock provider only —
 * this is not a benchmark of the real EC providers.
 *
 *   node verification/qa/load-test.mjs [--duration 15] [--concurrency 25]
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8155;
const BASE = `http://localhost:${PORT}`;
const KEY = "dev-tenant-key";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? Number(process.argv[i + 1]) : d; };
const durationS = arg("duration", 15);
const concurrency = arg("concurrency", 25);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let webhooksReceived = 0;
const sink = createServer((req, res) => { webhooksReceived++; req.resume(); res.writeHead(200); res.end("ok"); });
await new Promise((r) => sink.listen(8156, r));

const svc = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: path.join(ROOT, "service"),
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: "silent", BACKEND: "memory", PROVIDER_ORDER: "mock", HITL_MODE: "auto", DEDUPE_WINDOW_DAYS: "0", RATE_LIMIT_MAX: "1000000", TENANT_KEYS: `{"load":"${KEY}"}` },
  stdio: "ignore", windowsHide: true,
});
const cleanup = () => {
  try { svc.kill("SIGKILL"); } catch {}
  if (process.platform === "win32" && svc.pid) spawnSync("taskkill", ["/F", "/T", "/PID", String(svc.pid)], { stdio: "ignore" });
  sink.close();
};
process.on("exit", cleanup);

for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {} await sleep(500); }

const body = (n) => JSON.stringify({
  searchType: "EC_WISE", certified: false,
  property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: `1${n % 9}${n % 7}`, subdivisionNumber: "1" },
  period: { from: "2004-01-01", to: "2024-12-31" }, callbackUrl: "http://localhost:8156/hook",
});

const lat = [];
let ok = 0, bad = 0, err = 0, seq = 0;
const deadline = Date.now() + durationS * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const n = seq++;
    const t = performance.now();
    try {
      const r = await fetch(`${BASE}/v1/ec-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "idempotency-key": `load-${n}-${Math.random().toString(36).slice(2)}` },
        body: body(n),
      });
      lat.push(performance.now() - t);
      if (r.status === 202) ok++; else bad++;
      await r.text();
    } catch {
      err++;
    }
  }
}

const start = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = (Date.now() - start) / 1000;

await sleep(4000); // let the queue drain
const metrics = await (await fetch(`${BASE}/metrics`)).text();
const m = (re) => (metrics.match(re)?.[1] ?? "?");

lat.sort((a, b) => a - b);
const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(0) : "0";

console.log("\n=== load test ===");
console.log(`config        : ${concurrency} concurrent, ${durationS}s`);
console.log(`accepted (202): ${ok}  (${(ok / elapsed).toFixed(0)}/s)`);
console.log(`non-202       : ${bad}   errors: ${err}`);
console.log(`accept latency: p50 ${pct(0.5)}ms  p95 ${pct(0.95)}ms  p99 ${pct(0.99)}ms  max ${pct(1)}ms`);
console.log(`\nafter drain:`);
console.log(`  ec_requests_total     : ${m(/ec_ec_requests_total (\d+)/)}`);
console.log(`  pipeline_run_count    : ${m(/ec_pipeline_run_count (\d+)/)}`);
console.log(`  pipeline_run avg / max: ${m(/ec_pipeline_run_sum_ms ([\d.]+)/)}ms sum, ${m(/ec_pipeline_run_max_ms ([\d.]+)/)}ms max`);
console.log(`  webhooks to sink      : ${webhooksReceived}`);

const drained = Number(m(/ec_pipeline_run_count (\d+)/)) >= ok * 0.99;
const pass = bad === 0 && err === 0 && drained;
console.log(`\n${pass ? "PASS" : "FAIL"} — ${pass ? "all accepted, queue drained, no errors" : "see numbers above"}`);
cleanup();
process.exit(pass ? 0 : 1);
