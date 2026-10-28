/**
 * UI regression tests (Playwright + Chromium) for the two web pages the project
 * ships: the project dashboard and the operator console.
 *
 *   node verification/qa/ui-tests.mjs
 *
 * Spawns its own service instances. Exit 0 = pass, 1 = fail. Writes ui-results.json
 * and screenshots into verification/qa/screens/.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "../../poc/node_modules/playwright/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICE_DIR = path.join(ROOT, "service");
const SCREENS = path.join(ROOT, "verification", "qa", "screens");
mkdirSync(SCREENS, { recursive: true });

const results = [];
const procs = [];
const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", x: "\x1b[0m" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(id, desc, fn) {
  const t = Date.now();
  try { await fn(); results.push({ id, desc, status: "PASS", ms: Date.now() - t }); console.log(`${C.g}PASS${C.x} ${id} ${C.dim}${desc}${C.x}`); }
  catch (e) { results.push({ id, desc, status: "FAIL", ms: Date.now() - t, error: String(e?.message ?? e) }); console.log(`${C.r}FAIL${C.x} ${id} ${C.dim}${desc}${C.x}\n     ${C.r}${e?.message ?? e}${C.x}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

function startService(port, env) {
  const p = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVICE_DIR,
    env: { ...process.env, PORT: String(port), LOG_LEVEL: "silent", TENANT_KEYS: '{"qa":"qa-key"}', WEBHOOK_SIGNING_SECRET: "qa", ...env },
    stdio: "ignore", windowsHide: true,
  });
  procs.push(p);
  return `http://localhost:${port}`;
}
async function waitHealthy(base) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* */ } await sleep(500); }
  throw new Error(`${base} not healthy`);
}
function teardown() {
  for (const p of procs) { try { p.kill("SIGKILL"); } catch { /* */ } if (process.platform === "win32" && p.pid) try { spawnSync("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" }); } catch { /* */ } }
}

async function run() {
  const DASH = startService(8110, { PROVIDER_ORDER: "mock", HITL_MODE: "auto" });
  const OPS = startService(8111, { PROVIDER_ORDER: "automation", HITL_MODE: "console", DEDUPE_WINDOW_DAYS: "0" });
  await waitHealthy(DASH);
  await waitHealthy(OPS);

  const browser = await chromium.launch();

  // ===================== DASHBOARD =====================
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dpage = await dctx.newPage();
  const dErrors = [];
  dpage.on("console", (m) => { if (m.type() === "error") dErrors.push(m.text()); });
  dpage.on("pageerror", (e) => dErrors.push(String(e)));
  await dpage.goto(`${DASH}/dashboard`, { waitUntil: "networkidle" });

  await check("D1", "dashboard loads with correct title", async () => {
    eq(await dpage.title(), "TN EC Integration — Project Dashboard", "title");
  });
  await check("D2", "all core h2 sections present", async () => {
    const h2 = await dpage.$$eval("h2", (els) => els.map((e) => e.textContent.trim()));
    for (const s of ["Where things stand", "What's built so far", "How it's built", "Testing", "Decisions we need from the client", "Next actions"]) {
      assert(h2.includes(s), `missing section: ${s}`);
    }
  });
  await check("D3", "architecture diagram + frameworks table + testing numbers, no detailed TC cards", async () => {
    const cards = await dpage.$$(".card");
    eq(cards.length, 0, "detailed test-case cards should be removed in favor of summary numbers");
    const svgCount = await dpage.$$eval("svg", (els) => els.length);
    assert(svgCount >= 3, "expected the live-run, batch-idea, and architecture diagrams (>=3 svgs)");
    const tableHeaders = await dpage.$$eval("table tr:first-child th", (els) => els.map((e) => e.textContent.trim()));
    assert(tableHeaders.includes("Tool") && tableHeaders.includes("Category"), "frameworks table with Tool/Category columns present");
    const stats = await dpage.$$eval(".grid .stat .k", (els) => els.map((e) => e.textContent.trim()));
    assert(stats.includes("Manual test cases"), "testing section shows a manual-test-cases number stat");
  });
  await check("D4", "decisions table lists D1..D8", async () => {
    const rows = await dpage.$$eval("table tr td:first-child", (t) => t.map((x) => x.textContent.trim()));
    for (let n = 1; n <= 8; n++) assert(rows.includes(`D${n}`), `missing D${n}`);
  });
  await check("D5", "no 'SIGNED OFF' badge used for AI-only verification", async () => {
    // Exclude the status-legend paragraph, which explains what SIGNED OFF means rather than claiming it.
    const badges = await dpage.$$eval(".badge", (b) => b.filter((x) => !x.closest(".note")).map((x) => x.textContent.trim()));
    assert(!badges.includes("SIGNED OFF"), "AI-verified stats/sections must not claim SIGNED OFF");
  });
  await check("D6", "no console/page errors on load", async () => {
    assert(dErrors.length === 0, `console errors: ${dErrors.join(" | ")}`);
  });
  await check("D7", "dark mode: body background is dark, text is light", async () => {
    await dpage.emulateMedia({ colorScheme: "dark" });
    await dpage.reload({ waitUntil: "networkidle" });
    const { bg, fg } = await dpage.evaluate(() => {
      const s = getComputedStyle(document.body);
      const rgb = (v) => v.match(/\d+/g).map(Number);
      return { bg: rgb(s.backgroundColor), fg: rgb(s.color) };
    });
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    assert(lum(bg) < 80, `body bg should be dark, luminance ${lum(bg).toFixed(0)}`);
    assert(lum(fg) > 150, `body text should be light, luminance ${lum(fg).toFixed(0)}`);
    await dpage.screenshot({ path: path.join(SCREENS, "dashboard-dark.png"), fullPage: true });
  });
  await check("D8", "light mode renders and screenshot captured", async () => {
    await dpage.emulateMedia({ colorScheme: "light" });
    await dpage.reload({ waitUntil: "networkidle" });
    const bg = await dpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const l = bg.match(/\d+/g).map(Number).reduce((a, b) => a + b, 0) / 3;
    assert(l > 180, `light bg should be light, avg ${l.toFixed(0)}`);
    await dpage.screenshot({ path: path.join(SCREENS, "dashboard-light.png"), fullPage: true });
  });
  await check("D9", "mobile viewport: no horizontal overflow", async () => {
    await dpage.setViewportSize({ width: 375, height: 800 });
    await dpage.reload({ waitUntil: "networkidle" });
    const overflow = await dpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 1, `horizontal overflow of ${overflow}px on mobile`);
    await dpage.screenshot({ path: path.join(SCREENS, "dashboard-mobile.png"), fullPage: true });
  });
  await check("D10", "technical-detail sections are collapsed by default", async () => {
    await dpage.setViewportSize({ width: 1280, height: 900 });
    await dpage.reload({ waitUntil: "networkidle" });
    const open = await dpage.$$eval("details", (d) => d.filter((x) => x.open).length);
    eq(open, 0, "details open count");
  });
  await dctx.close();

  // ===================== OPERATOR CONSOLE =====================
  const octx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const opage = await octx.newPage();
  const oErrors = [];
  opage.on("console", (m) => { if (m.type() === "error") oErrors.push(m.text()); });
  opage.on("pageerror", (e) => oErrors.push(String(e)));

  await check("C1", "console loads with correct title", async () => {
    await opage.goto(`${OPS}/public/console.html`, { waitUntil: "networkidle" });
    eq(await opage.title(), "EC Service — Operator Console", "title");
  });
  await check("C2", "empty state shown when there are no tasks", async () => {
    await opage.reload({ waitUntil: "networkidle" });
    await opage.waitForSelector(".empty", { timeout: 4000 });
    const txt = await opage.textContent(".empty");
    assert(/no open tasks/i.test(txt), `empty text was: ${txt}`);
  });
  await check("C3", "a submitted request surfaces a CAPTCHA card with input + Submit", async () => {
    const res = await fetch(`${OPS}/v1/ec-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer qa-key", "idempotency-key": `ui-${Date.now()}` },
      body: JSON.stringify({ searchType: "EC_WISE", certified: false, property: { zone: "Chennai", district: "Chennai", sroCode: "Thiruvottiyur", village: "Thiruvottiyur", surveyNumber: "12", subdivisionNumber: "1" }, period: { from: "2004-01-01", to: "2024-12-31" }, callbackUrl: "https://example.com/x" }),
    });
    eq(res.status, 202, "submit accepted");
    await opage.waitForSelector(".task", { timeout: 8000 });
    const h3 = (await opage.textContent(".task h3")).trim().toLowerCase();
    assert(h3.includes("captcha"), `task kind heading was: ${h3}`);
    assert(await opage.$('.task input[type="text"]'), "has a text input");
    assert(await opage.$('.task button'), "has a Submit button");
    await opage.screenshot({ path: path.join(SCREENS, "console-task.png"), fullPage: true });
  });
  await check("C3b", "CAPTCHA input keeps focus and typed text across the 5s auto-refresh", async () => {
    // Regression test: the console used to rebuild the whole task list (including
    // a fresh <input>) on every 5s auto-refresh tick even when nothing had
    // changed, which stole focus and wiped out whatever the operator was mid-way
    // through typing. Fixed by skipping the rebuild when the open task ids are
    // unchanged from the last render.
    const input = await opage.$('.task input[type="text"]');
    await input.click();
    await input.type("PART");
    await opage.waitForTimeout(5600); // past the console's 5s auto-refresh interval
    const stillFocused = await opage.evaluate(
      () => document.activeElement === document.querySelector('.task input[type="text"]'),
    );
    const value = await opage.$eval('.task input[type="text"]', (el) => el.value);
    assert(stillFocused, "input lost focus across an auto-refresh tick with nothing changed");
    eq(value, "PART", "typed value was wiped by an auto-refresh tick with nothing changed");
  });
  await check("C4", "typing an answer + Submit clears the task from the list", async () => {
    await opage.fill('.task input[type="text"]', "QA-UI-123");
    await opage.click('.task button:has-text("Submit")');
    await opage.waitForSelector(".empty", { timeout: 6000 });
    assert(await opage.$(".empty"), "returned to empty state after answering");
    await opage.screenshot({ path: path.join(SCREENS, "console-empty.png"), fullPage: true });
  });
  await check("C5", "console links to the project dashboard", async () => {
    const href = await opage.getAttribute('a[href="/dashboard"]', "href");
    eq(href, "/dashboard", "dashboard link");
  });
  await check("C6", "no console/page errors during the console flow", async () => {
    const real = oErrors.filter((e) => !/Failed to load resource/i.test(e));
    assert(real.length === 0, `console errors: ${real.join(" | ")}`);
  });
  await octx.close();

  await browser.close();
}

run()
  .catch((e) => { results.push({ id: "SUITE", status: "FAIL", error: String(e?.stack ?? e) }); console.error(e); })
  .finally(() => {
    teardown();
    const pass = results.filter((r) => r.status === "PASS").length;
    const fail = results.filter((r) => r.status === "FAIL").length;
    writeFileSync(path.join(ROOT, "verification", "qa", "ui-results.json"), JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 2));
    console.log(`\n${"=".repeat(46)}\n  UI: ${pass} passed, ${fail} failed\n${"=".repeat(46)}`);
    process.exit(fail > 0 ? 1 : 0);
  });
