/**
 * End-to-end test of the browser-automation provider against the mock TNREGINET
 * portal (verification/mock-portal). Proves: login + CAPTCHA, EC search form fill,
 * search CAPTCHA, OTP branch, results scrape -> canonical result -> back to the ERP.
 *
 *   node verification/qa/automation-e2e.mjs
 *
 * The real portal is geo-restricted to India and needs a real account; this
 * exercises every step of the worker except the specific target host.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORTAL_PORT = 8170;
const SVC_PORT = 8180;
const KEY = "dev-tenant-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const procs = [];
function spawnProc(name, cmd, args, env) {
  const p = spawn(cmd, args, { cwd: path.join(ROOT, "service"), env: { ...process.env, ...env }, stdio: "ignore", windowsHide: true });
  p._name = name;
  procs.push(p);
  return p;
}
function killAll() {
  for (const p of procs) {
    try { p.kill("SIGKILL"); } catch {}
    if (process.platform === "win32" && p.pid) spawnSync("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
  }
}
process.on("exit", killAll);

async function waitUp(url) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok || (await fetch(url)).status < 500) return; } catch {} await sleep(500); }
  throw new Error(`not up: ${url}`);
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`\x1b[32mPASS\x1b[0m ${m}`); } else { fail++; console.log(`\x1b[31mFAIL\x1b[0m ${m}`); } };

async function submit(prop, period = { from: "2004-01-01", to: "2024-12-31" }) {
  const r = await fetch(`http://localhost:${SVC_PORT}/v1/ec-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "idempotency-key": `auto-${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({ searchType: "EC_WISE", certified: false, property: prop, period, callbackUrl: "http://localhost:9/hook" }),
  });
  const { requestId } = await r.json();
  for (let i = 0; i < 120; i++) {
    const s = await (await fetch(`http://localhost:${SVC_PORT}/v1/ec-requests/${requestId}`, { headers: { authorization: `Bearer ${KEY}` } })).json();
    if (["completed", "partial", "failed"].includes(s.status)) return s;
    await sleep(500);
  }
  throw new Error("timeout");
}

async function main() {
  spawnProc("portal", process.execPath, [path.join(ROOT, "verification/mock-portal/server.mjs"), "--port", String(PORTAL_PORT)], {});
  spawnProc("service", process.execPath, ["--import", "tsx", "src/index.ts"], {
    PORT: String(SVC_PORT), LOG_LEVEL: "silent", BACKEND: "memory", HITL_MODE: "auto",
    PROVIDER_ORDER: "automation", DEDUPE_WINDOW_DAYS: "0", TENANT_KEYS: `{"t":"${KEY}"}`,
    AUTOMATION_PORTAL_URL: `http://localhost:${PORTAL_PORT}`, AUTOMATION_USERNAME: "worker", AUTOMATION_PASSWORD: "worker",
  });
  await waitUp(`http://localhost:${PORTAL_PORT}/portal`);
  await waitUp(`http://localhost:${SVC_PORT}/healthz`);

  const base = { zone: "Chennai", district: "North Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", subdivisionNumber: "1" };

  console.log("\n— entries found (survey contains 4) —");
  const a = await submit({ ...base, surveyNumber: "123/4" });
  ok(a.status === "completed", `status completed (got ${a.status})`);
  ok(a.source === "automation", `source is automation`);
  ok(a.result?.outcome === "ENTRIES_FOUND", `outcome ENTRIES_FOUND (got ${a.result?.outcome})`);
  ok(a.result?.entries?.length === 2, `2 entries scraped (got ${a.result?.entries?.length})`);
  ok(a.result?.entries?.[1]?.instrumentType === "MORTGAGE", `entry 2 is a MORTGAGE`);
  ok(a.result?.entries?.[0]?.parties?.some((p) => p.name === "R. Sundaram"), `party names scraped`);
  ok(a.documents?.length === 1, `EC summary document produced`);

  console.log("\n— no records (survey without 4) —");
  const b = await submit({ ...base, surveyNumber: "301" });
  ok(b.status === "partial", `status partial (got ${b.status})`);
  ok(b.result?.outcome === "NIL_UNCONFIRMED", `outcome NIL_UNCONFIRMED`);
  ok(b.result?.encumbrancePresent === null, `encumbrancePresent is null, not false`);

  console.log("\n— OTP branch (survey ends in 7) —");
  const c = await submit({ ...base, surveyNumber: "1247" });
  ok(c.status === "completed", `status completed through the OTP step (got ${c.status})`);
  ok(c.result?.entries?.length === 2, `entries scraped after OTP`);

  console.log("\n— CAPTCHA rejected once, retried with a fresh one (survey starts RETRY) —");
  const e = await submit({ ...base, surveyNumber: "RETRY4" });
  ok(e.status === "completed", `status completed after one retry (got ${e.status})`);
  ok(e.result?.outcome === "ENTRIES_FOUND", `outcome ENTRIES_FOUND (got ${e.result?.outcome})`);
  ok(e.result?.entries?.length === 2, `2 entries scraped after retry (got ${e.result?.entries?.length})`);

  console.log("\n— scanned pre-1987 EC -> OCR + review flag —");
  const d = await submit({ ...base, surveyNumber: "OLD-88/2" });
  ok(["completed", "partial"].includes(d.status), `status terminal (got ${d.status})`);
  ok(d.result?.caveats?.some((x) => x.code === "OCR_LOW_CONFIDENCE"), `OCR_LOW_CONFIDENCE caveat present`);
  ok((d.result?.entries?.length ?? 0) >= 1, `OCR extracted at least one entry (got ${d.result?.entries?.length})`);

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}automation e2e: ${pass} passed, ${fail} failed\x1b[0m`);
  killAll();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); killAll(); process.exit(1); });
