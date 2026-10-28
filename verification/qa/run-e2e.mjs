/**
 * Black-box QA suite for the EC Service.
 *
 * Spawns its own hermetic service instances + a webhook receiver, then exercises
 * the HTTP API the way a tester would: the 5 manual test cases (TC1-TC5) plus
 * negative, security, boundary, webhook and performance checks.
 *
 *   node verification/qa/run-e2e.mjs
 *
 * Exit code 0 = all pass, 1 = one or more failures. Writes verification/qa/results.json.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICE_DIR = path.join(ROOT, "service");
const SECRET = "qa-secret";
const TENANT_KEY = "qa-key";
const SINK = "http://localhost:9109";

const results = [];
const procs = [];
let sink;

// ---------- tiny test harness ----------
const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", x: "\x1b[0m" };
async function check(id, category, desc, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ id, category, desc, status: "PASS", ms: Date.now() - started });
    console.log(`${C.g}PASS${C.x} ${id} ${C.dim}${desc}${C.x}`);
  } catch (err) {
    results.push({ id, category, desc, status: "FAIL", ms: Date.now() - started, error: String(err?.message ?? err) });
    console.log(`${C.r}FAIL${C.x} ${id} ${C.dim}${desc}${C.x}\n     ${C.r}${err?.message ?? err}${C.x}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${base} never became healthy`);
}

function startService(name, port, env) {
  // No shell: p.pid is the real node process so p.kill() works on Windows.
  const p = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVICE_DIR,
    env: { ...process.env, PORT: String(port), LOG_LEVEL: "silent", WEBHOOK_SIGNING_SECRET: SECRET, TENANT_KEYS: JSON.stringify({ qa: TENANT_KEY }), RATE_LIMIT_MAX: "100000", CERTIFIED_SIGN_DELAY_MS: "800", ...env },
    stdio: "ignore",
    windowsHide: true,
  });
  procs.push({ name, p });
  return `http://localhost:${port}`;
}

function body(over = {}) {
  return JSON.stringify({
    searchType: "EC_WISE",
    certified: false,
    property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "123/4", subdivisionNumber: "1" },
    period: { from: "2004-01-01", to: "2024-12-31" },
    callbackUrl: `${SINK}/hook`,
    reference: "QA",
    ...over,
  });
}

async function post(base, raw, headers = {}) {
  return fetch(`${base}/v1/ec-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TENANT_KEY}`, "idempotency-key": `qa-${Math.random().toString(36).slice(2)}${Date.now()}`, ...headers },
    body: raw,
  });
}
async function get(base, id) {
  return fetch(`${base}/v1/ec-requests/${id}`, { headers: { authorization: `Bearer ${TENANT_KEY}` } });
}
async function submitAndWait(base, over = {}, timeoutMs = 8000) {
  const res = await post(base, body(over));
  eq(res.status, 202, "submit should be 202");
  const { requestId } = await res.json();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await (await get(base, requestId)).json();
    if (["completed", "partial", "failed"].includes(s.status)) return s;
    await sleep(50);
  }
  throw new Error(`request ${requestId} did not finish in ${timeoutMs}ms`);
}

// ---------- suite ----------
async function run() {
  sink = spawn("node", [path.join(ROOT, "verification", "qa", "webhook-sink.mjs"), "9109", SECRET], { stdio: "ignore" });
  const A = startService("A-mock", 8100, { PROVIDER_ORDER: "mock", HITL_MODE: "auto", DEDUPE_WINDOW_DAYS: "14" });
  const B = startService("B-automation", 8101, { PROVIDER_ORDER: "automation", HITL_MODE: "console", DEDUPE_WINDOW_DAYS: "0" });

  await waitHealthy(SINK.replace("/hook", "") + "/health").catch(() => {});
  await waitHealthy(A);
  await waitHealthy(B);
  await fetch(`${SINK}/reset`, { method: "POST" });

  // ===== TC1 — happy path, entries found =====
  await check("TC1", "functional", "EC_WISE survey 123/4 -> completed, ENTRIES_FOUND, mortgage entry, disclaimer", async () => {
    const s = await submitAndWait(A);
    eq(s.status, "completed", "status");
    eq(s.result.outcome, "ENTRIES_FOUND", "outcome");
    eq(s.result.encumbrancePresent, true, "encumbrancePresent");
    eq(s.result.entryCount, 1, "entryCount");
    eq(s.result.entries[0].instrumentType, "MORTGAGE", "instrumentType");
    assert(/not proof/i.test(s.result.disclaimer), "disclaimer text present");
    assert(s.result.entries[0].parties.length === 2, "two parties");
  });

  // ===== TC2 — CAPTCHA human-in-the-loop =====
  await check("TC2", "functional", "automation provider opens a CAPTCHA task, operator answers, job continues", async () => {
    const res = await post(B, body());
    eq(res.status, 202, "submit 202");
    const { requestId } = await res.json();
    // wait for needs_human + the task
    let task;
    for (let i = 0; i < 60; i++) {
      const tasks = (await (await fetch(`${B}/ops/tasks?status=open`)).json()).tasks;
      task = tasks.find((t) => t.requestId === requestId && t.kind === "captcha");
      if (task) break;
      await sleep(100);
    }
    assert(task, "a captcha task was opened");
    const st1 = await (await get(B, requestId)).json();
    eq(st1.status, "needs_human", "status is needs_human while task open");
    const ans = await fetch(`${B}/ops/tasks/${task.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-operator-id": "qa-bot" },
      body: JSON.stringify({ kind: "captcha", value: "QA123" }),
    });
    eq(ans.status, 200, "answer accepted");
    // job resumes then fails portal_unavailable (no worker) — that is expected/honest
    for (let i = 0; i < 60; i++) {
      const s = await (await get(B, requestId)).json();
      if (["failed", "completed", "partial"].includes(s.status)) {
        eq(s.status, "failed", "resumes then fails (no worker deployed)");
        eq(s.failure.code, "portal_unavailable", "honest failure code");
        return;
      }
      await sleep(100);
    }
    throw new Error("job did not resume after operator answered");
  });

  await check("TC2b", "functional", "answered HITL task disappears from the open list", async () => {
    const open = (await (await fetch(`${B}/ops/tasks?status=open`)).json()).tasks;
    assert(!open.some((t) => t.kind === "captcha" && t.status === "open" && t.answeredAt), "no answered task still shown as open");
  });

  // ===== TC3 — unknown SRO =====
  await check("TC3", "functional", "unknown SRO -> failed / unresolvable with helpful message", async () => {
    const s = await submitAndWait(A, { property: { zone: "Chennai", district: "Chennai", sroCode: "NOPE-999", village: "X", surveyNumber: "1" } });
    eq(s.status, "failed", "status");
    eq(s.failure.code, "unresolvable", "failure code");
    assert(/Examples in Chennai|Adayar|Thiruvottiyur/i.test(s.failure.message), "message lists valid SROs");
    eq(s.failure.retryable, false, "not retryable");
  });

  // ===== TC4 — nil not reported as clean =====
  await check("TC4", "functional", "no records + not verified -> partial / NIL_UNCONFIRMED, encumbrancePresent null", async () => {
    const s = await submitAndWait(A, { property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "777", subdivisionNumber: "1" } });
    eq(s.status, "partial", "status");
    eq(s.result.outcome, "NIL_UNCONFIRMED", "outcome");
    eq(s.result.encumbrancePresent, null, "encumbrancePresent must be null, never false");
    assert(s.result.caveats.some((c) => c.code === "NIL_NOT_HUMAN_VERIFIED"), "carries NIL_NOT_HUMAN_VERIFIED caveat");
  });

  // ===== TC5 — dedupe =====
  await check("TC5", "functional", "identical informational request within window served from cache", async () => {
    const uniqueSurvey = "44" + Date.now().toString().slice(-4); // contains 4 -> entries
    const first = await submitAndWait(A, { property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: uniqueSurvey, subdivisionNumber: "1" } });
    eq(first.status, "completed", "first completes");
    const t0 = Date.now();
    const second = await submitAndWait(A, { property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: uniqueSurvey, subdivisionNumber: "1" } });
    const dt = Date.now() - t0;
    eq(second.status, "completed", "second completes");
    eq(second.result.entryCount, first.result.entryCount, "same result");
    assert(dt < 400, `second served fast (dedupe) — took ${dt}ms`);
  });

  await check("TC5b", "functional", "certified EC: payment -> awaiting_signature -> signed", async () => {
    const survey = "48" + Date.now().toString().slice(-4);
    const prop = { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: survey, subdivisionNumber: "1" };
    const a = await submitAndWait(A, { certified: true, property: prop }, 12000);
    eq(a.certified, true, "certified flag");
    eq(a.status, "completed", "eventually completed");
    eq(a.result?.provenance?.certified, true, "result marked certified/signed");
    assert(a.result?.caveats?.some((c) => c.code === "CERTIFIED_COPY_SIGNED"), "signed caveat present");
    assert(a.documents?.some((d) => d.kind === "ec_pdf"), "signed PDF document delivered");
  });

  await check("RL1", "robustness", "per-tenant rate limit returns 429 with Retry-After", async () => {
    const R = startService("RL", 8109, { PROVIDER_ORDER: "mock", HITL_MODE: "auto", RATE_LIMIT_MAX: "5", RATE_LIMIT_WINDOW_MS: "60000" });
    await waitHealthy(R);
    let got429 = false, retryAfter = null;
    for (let i = 0; i < 12; i++) {
      const r = await post(R, body({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "T", surveyNumber: `4${i}` } }));
      if (r.status === 429) { got429 = true; retryAfter = r.headers.get("retry-after"); break; }
    }
    assert(got429, "429 after exceeding the limit");
    assert(Number(retryAfter) > 0, `Retry-After header present (${retryAfter})`);
  });

  // ===== Negative / robustness =====
  await check("N1", "negative", "no auth header -> 401", async () => {
    const r = await fetch(`${A}/v1/ec-requests`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "n1-xxxxxxxx" }, body: body() });
    eq(r.status, 401, "status");
  });
  await check("N2", "negative", "wrong bearer token -> 401", async () => {
    const r = await post(A, body(), { authorization: "Bearer WRONG" });
    eq(r.status, 401, "status");
  });
  await check("N3", "negative", "missing Idempotency-Key -> 400", async () => {
    const r = await fetch(`${A}/v1/ec-requests`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TENANT_KEY}` }, body: body() });
    eq(r.status, 400, "status");
  });
  await check("N4", "negative", "malformed JSON -> 400, not 500", async () => {
    const r = await post(A, "{not json");
    assert(r.status === 400, `expected 400, got ${r.status}`);
  });
  await check("N5", "negative", "missing required field (period) -> 400", async () => {
    const b = JSON.parse(body()); delete b.period;
    const r = await post(A, JSON.stringify(b));
    eq(r.status, 400, "status");
  });
  await check("N6", "negative", "period.from after period.to -> 400", async () => {
    const r = await post(A, body({ period: { from: "2024-01-01", to: "2020-01-01" } }));
    eq(r.status, 400, "status");
    assert(/from must be <= to/i.test(await r.text()), "explains the problem");
  });
  await check("N7", "negative", "DOCUMENT_WISE without documentNumber -> 400", async () => {
    const r = await post(A, body({ searchType: "DOCUMENT_WISE", property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur" } }));
    eq(r.status, 400, "status");
  });
  await check("N8", "negative", "invalid date format -> 400", async () => {
    const r = await post(A, body({ period: { from: "2024-13-45", to: "2025-01-01" } }));
    eq(r.status, 400, "status");
  });
  await check("N9", "negative", "unknown searchType enum -> 400", async () => {
    const r = await post(A, body({ searchType: "TELEPATHY" }));
    eq(r.status, 400, "status");
  });
  await check("N10", "negative", "empty body -> 400", async () => {
    const r = await post(A, "");
    eq(r.status, 400, "status");
  });
  await check("N11", "negative", "GET unknown requestId -> 404", async () => {
    const r = await get(A, "does-not-exist");
    eq(r.status, 404, "status");
  });
  await check("N12", "negative", "same Idempotency-Key + different body -> 409", async () => {
    const key = "n12-" + Date.now();
    await post(A, body(), { "idempotency-key": key });
    const r2 = await post(A, body({ period: { from: "2011-01-01", to: "2019-01-01" } }), { "idempotency-key": key });
    eq(r2.status, 409, "status");
  });
  await check("N13", "negative", "same Idempotency-Key + same body -> 200 replay, same id", async () => {
    const key = "n13-" + Date.now();
    const r1 = await post(A, body(), { "idempotency-key": key });
    const r2 = await post(A, body(), { "idempotency-key": key });
    eq(r2.status, 200, "replay status");
    eq((await r2.json()).requestId, (await r1.json()).requestId, "same requestId");
  });

  // ===== Security =====
  await check("S1", "security", "injection-ish string in surveyNumber is handled, no 500", async () => {
    const r = await post(A, body({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "1' OR '1'='1", subdivisionNumber: "1" } }));
    assert(r.status === 202 || r.status === 400, `graceful, got ${r.status}`);
    if (r.status === 202) {
      const s = await (async () => { const id = (await r.json()).requestId; for (let i = 0; i < 60; i++) { const x = await (await get(A, id)).json(); if (["completed", "partial", "failed"].includes(x.status)) return x; await sleep(50); } })();
      assert(["completed", "partial", "failed"].includes(s.status), "settles without crashing");
    }
  });
  await check("S2", "security", "oversized field (20KB) does not crash the service", async () => {
    const r = await post(A, body({ reference: "x".repeat(20000) }));
    assert([400, 413, 202].includes(r.status), `handled, got ${r.status}`);
    assert((await fetch(`${A}/healthz`)).ok, "service still healthy after");
  });
  await check("S3", "security", "reference length cap enforced (>120 chars -> 400)", async () => {
    const r = await post(A, body({ reference: "y".repeat(200) }));
    eq(r.status, 400, "status");
  });
  await check("S4", "security", "FINDING CHECK: GET request by id has no per-tenant ownership check", async () => {
    // submit as tenant qa, then read it back with the same key (only tenant configured).
    // A pro would flag: any valid tenant key can read ANY requestId. Documented as a finding.
    const res = await post(A, body());
    const { requestId } = await res.json();
    const r = await get(A, requestId);
    eq(r.status, 200, "readable");
    // This test PASSES (documents current behaviour); the finding is in QA-REPORT.md.
  });

  // ===== Boundary =====
  await check("B1", "boundary", "period.from == period.to is allowed", async () => {
    const r = await post(A, body({ period: { from: "2020-06-01", to: "2020-06-01" } }));
    eq(r.status, 202, "accepted");
  });
  await check("B2", "boundary", "pre-1975 period -> PERIOD_GAP, encumbrancePresent null", async () => {
    const s = await submitAndWait(A, { period: { from: "1960-01-01", to: "2024-12-31" }, property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "301", subdivisionNumber: "1" } });
    eq(s.result.outcome, "PERIOD_GAP", "outcome");
    eq(s.result.encumbrancePresent, null, "null, not false");
    assert(s.result.caveats.some((c) => c.code === "ONLINE_DATA_FROM_1975"), "carries 1975 caveat");
  });
  await check("B4", "boundary", "survey 999 triggers a nil_review HITL task (auto-answered), webhook needs_human fired", async () => {
    const res = await post(A, body({ property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "999", subdivisionNumber: "1" } }));
    const { requestId } = await res.json();
    for (let i = 0; i < 80; i++) { const s = await (await get(A, requestId)).json(); if (["completed", "partial", "failed"].includes(s.status)) break; await sleep(50); }
    await sleep(300);
    const evs = await (await fetch(`${SINK}/events`)).json();
    assert(evs.some((e) => e.requestId === requestId && e.event === "ec.needs_human"), "ec.needs_human webhook delivered");
  });
  await check("B5", "boundary", "concurrent duplicate submits (same key) create only one request", async () => {
    const key = "b5-" + Date.now();
    const [a, b] = await Promise.all([
      post(A, body(), { "idempotency-key": key }),
      post(A, body(), { "idempotency-key": key }),
    ]);
    const ids = new Set([(await a.json()).requestId, (await b.json()).requestId]);
    eq(ids.size, 1, "exactly one requestId across the race");
  });

  // ===== Webhook contract =====
  await check("W1", "webhook", "ec.received + ec.completed delivered with a VALID signature", async () => {
    await fetch(`${SINK}/reset`, { method: "POST" });
    const s = await submitAndWait(A, { property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "412", subdivisionNumber: "1" }, reference: "W1" });
    eq(s.status, "completed", "completed");
    await sleep(400);
    const evs = await (await fetch(`${SINK}/events`)).json();
    const mine = evs.filter((e) => e.requestId === s.requestId);
    assert(mine.some((e) => e.event === "ec.received"), "ec.received delivered");
    assert(mine.some((e) => e.event === "ec.completed"), "ec.completed delivered");
    assert(mine.every((e) => e.signatureValid), "every delivery had a valid HMAC signature");
  });

  // ===== Performance smoke =====
  await check("P1", "performance", "20 sequential requests all complete; report p50/p95", async () => {
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      const s = await submitAndWait(A, { property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: `4${i}${Date.now().toString().slice(-3)}`, subdivisionNumber: "1" } });
      assert(s.status === "completed", `#${i} completed`);
      times.push(Date.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p50 = times[10], p95 = times[19];
    results.push({ id: "P1-metrics", category: "performance", desc: `p50=${p50}ms p95=${p95}ms (mock provider, in-memory)`, status: "INFO" });
    console.log(`${C.y}INFO${C.x} P1 latency p50=${p50}ms p95=${p95}ms`);
    assert(p95 < 3000, `p95 under 3s (was ${p95}ms)`);
  });
}

// ---------- teardown + report ----------
async function teardown() {
  const all = [...procs.map((x) => x.p), sink].filter(Boolean);
  for (const p of all) {
    try { p.kill("SIGKILL"); } catch { /* */ }
    if (process.platform === "win32" && p.pid) {
      try { spawnSync("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" }); } catch { /* */ }
    }
  }
  await sleep(300);
}

run()
  .catch((err) => {
    results.push({ id: "SUITE", category: "infra", desc: "suite crashed", status: "FAIL", error: String(err?.stack ?? err) });
    console.error(err);
  })
  .finally(async () => {
    await teardown();
    const pass = results.filter((r) => r.status === "PASS").length;
    const fail = results.filter((r) => r.status === "FAIL").length;
    const info = results.filter((r) => r.status === "INFO").length;
    const summary = { at: new Date().toISOString(), total: pass + fail, pass, fail, info, results };
    writeFileSync(path.join(ROOT, "verification", "qa", "results.json"), JSON.stringify(summary, null, 2));
    console.log(`\n${"=".repeat(50)}\n  ${pass} passed, ${fail} failed, ${info} info\n${"=".repeat(50)}`);
    process.exit(fail > 0 ? 1 : 0);
  });
