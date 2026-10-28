/**
 * ERP integration contract test. Spawns the EC Service + a mock ERP webhook
 * receiver and asserts the full exchange the client's ERP would see:
 *   - ec.received then ec.completed / ec.partial / ec.failed, in order
 *   - every delivery carries a valid HMAC signature (bad ones are rejected)
 *   - the EC summary document downloads via its signed URL and has the right content
 *   - GET /v1/ec-requests/{id} (polling fallback) agrees with the webhook payload
 *
 *   node verification/qa/erp-contract.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SVC = 8182, ERP = 8190, SECRET = "contract-secret";
const KEY = "dev-tenant-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const kill = () => procs.forEach((p) => { try { p.kill("SIGKILL"); } catch {} if (process.platform === "win32" && p.pid) spawnSync("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" }); });
process.on("exit", kill);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`\x1b[32mPASS\x1b[0m ${m}`); } else { fail++; console.log(`\x1b[31mFAIL\x1b[0m ${m}`); } };

async function submit(prop, extra = {}) {
  const r = await fetch(`http://localhost:${SVC}/v1/ec-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "idempotency-key": `c-${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({ searchType: "EC_WISE", certified: false, property: prop, period: { from: "2004-01-01", to: "2024-12-31" }, callbackUrl: `http://localhost:${ERP}/hook`, ...extra }),
  });
  return (await r.json()).requestId;
}
async function events() { return (await (await fetch(`http://localhost:${ERP}/events`)).json()); }
async function waitEvents(requestId, n, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const e = (await events()).events.filter((x) => x.requestId === requestId);
    if (e.length >= n) return e;
    await sleep(300);
  }
  return (await events()).events.filter((x) => x.requestId === requestId);
}

async function main() {
  procs.push(spawn(process.execPath, [path.join(ROOT, "verification/mock-erp/server.mjs"), "--port", String(ERP), "--secret", SECRET], { stdio: "ignore", windowsHide: true }));
  procs.push(spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(ROOT, "service"),
    env: { ...process.env, PORT: String(SVC), LOG_LEVEL: "silent", BACKEND: "memory", HITL_MODE: "auto", PROVIDER_ORDER: "mock", DEDUPE_WINDOW_DAYS: "0", WEBHOOK_SIGNING_SECRET: SECRET, TENANT_KEYS: `{"t":"${KEY}"}` },
    stdio: "ignore", windowsHide: true,
  }));
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${SVC}/healthz`)).ok && (await fetch(`http://localhost:${ERP}/events`)).ok) break; } catch {} await sleep(500); }

  const base = { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", subdivisionNumber: "1" };

  // --- happy path ---
  console.log("\n— completed EC —");
  const id1 = await submit({ ...base, surveyNumber: "123/4" }, { reference: "DEAL-1" });
  const e1 = await waitEvents(id1, 2);
  ok(e1[0]?.event === "ec.received", `first event is ec.received`);
  ok(e1.some((x) => x.event === "ec.completed"), `ec.completed delivered`);
  ok(e1.every((x) => x.reference === "DEAL-1"), `reference echoed on every event`);
  const done = e1.find((x) => x.event === "ec.completed");
  ok(done?.data?.result?.outcome === "ENTRIES_FOUND", `payload carries the result`);
  ok((await events()).rejected === 0, `no deliveries rejected for bad signature`);

  // document download via the signed URL from the webhook payload
  const doc = done?.data?.documents?.[0];
  ok(!!doc?.url, `webhook payload includes a document URL`);
  const dl = await fetch(`http://localhost:${SVC}${doc.url}`);
  ok(dl.status === 200, `signed document URL resolves (200)`);
  const dlBody = await dl.text();
  ok(dlBody.includes("Encumbrance Certificate") && dlBody.includes("MORTGAGE"), `document content is the EC summary`);
  const tampered = await fetch(`http://localhost:${SVC}${doc.url.replace(/token=[0-9a-f]+/, "token=deadbeef")}`);
  ok(tampered.status === 403, `tampered document token rejected (403)`);

  // polling fallback agrees
  const polled = await (await fetch(`http://localhost:${SVC}/v1/ec-requests/${id1}`, { headers: { authorization: `Bearer ${KEY}` } })).json();
  ok(polled.status === done?.data?.status, `GET status matches webhook payload`);

  // --- partial (nil) ---
  console.log("\n— partial (no records) —");
  const id2 = await submit({ ...base, surveyNumber: "777" });
  const e2 = await waitEvents(id2, 2);
  ok(e2.some((x) => x.event === "ec.partial"), `ec.partial delivered for an unverified nil`);

  // --- failed (bad SRO) ---
  console.log("\n— failed (unresolvable) —");
  const id3 = await submit({ ...base, sroCode: "NOPE-999", surveyNumber: "1" });
  const e3 = await waitEvents(id3, 2);
  ok(e3.some((x) => x.event === "ec.failed"), `ec.failed delivered`);
  ok(e3.find((x) => x.event === "ec.failed")?.data?.failure?.code === "unresolvable", `failure code is unresolvable`);

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}ERP contract: ${pass} passed, ${fail} failed\x1b[0m`);
  kill();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); kill(); process.exit(1); });
