/**
 * Records a screen video of a live manual-test walkthrough of the EC Service:
 * dashboard tour -> demo client running TC1/TC4/TC3/invalid-date -> the CAPTCHA
 * human-in-the-loop flow (operator console clears it, job completes).
 *
 *   node verification/qa/record-walkthrough.mjs
 *
 * Output: verification/qa/video/manual-test-walkthrough.webm  (+ .mp4 and .gif if
 * Playwright's bundled ffmpeg is found). Spawns its own service instance.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, readdirSync, renameSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "../../poc/node_modules/playwright/index.mjs";
import { PNG } from "../../poc/node_modules/pngjs/lib/png.js";
import { GIFEncoder, quantize, applyPalette } from "../../poc/node_modules/gifenc/dist/gifenc.esm.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICE_DIR = path.join(ROOT, "service");
const OUT = path.join(ROOT, "verification", "qa", "video");
mkdirSync(OUT, { recursive: true });

const PORT = 8140;
const BASE = `http://localhost:${PORT}`;
const KEY = "dev-tenant-key";
let svc;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findFfmpeg() {
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  try {
    for (const d of readdirSync(root)) {
      if (d.startsWith("ffmpeg")) {
        for (const f of readdirSync(path.join(root, d))) if (/ffmpeg.*\.exe$/i.test(f)) return path.join(root, d, f);
      }
    }
  } catch { /* */ }
  return null;
}

async function startService() {
  svc = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVICE_DIR,
    env: { ...process.env, PORT: String(PORT), LOG_LEVEL: "silent", PROVIDER_ORDER: "mock", HITL_MODE: "console", DEDUPE_WINDOW_DAYS: "0", TENANT_KEYS: `{"demo":"${KEY}"}` },
    stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* */ } await sleep(500); }
  throw new Error("service did not start");
}
function stopService() {
  try { svc?.kill("SIGKILL"); } catch { /* */ }
  if (process.platform === "win32" && svc?.pid) try { spawnSync("taskkill", ["/F", "/T", "/PID", String(svc.pid)], { stdio: "ignore" }); } catch { /* */ }
}

async function smoothScroll(page, toPx, steps = 30) {
  const from = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), from + ((toPx - from) * i) / steps);
    await sleep(40);
  }
}

async function runScenario(page, label, expectText) {
  await page.click(`.scenarios button:has-text("${label}")`);
  await sleep(600);
  await page.click("#send");
  await page.waitForFunction((t) => document.querySelector("#result")?.textContent.includes(t), expectText, { timeout: 15000 });
  await sleep(1800);
}

async function main() {
  await startService();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
    colorScheme: "light",
  });
  const page = await context.newPage();

  // 1) dashboard tour
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await sleep(1500);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await smoothScroll(page, h - 800, 90);
  await sleep(1000);
  await smoothScroll(page, 0, 40);
  await sleep(800);

  // 2) demo client
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await sleep(1200);

  await runScenario(page, "TC1 · entries found", "ENTRIES_FOUND");
  await runScenario(page, "TC4 · no records", "NIL_UNCONFIRMED");
  await runScenario(page, "TC3 · bad SRO", "unresolvable");
  await runScenario(page, "invalid date", "not a valid calendar date");

  // 3) CAPTCHA human-in-the-loop
  await page.click('.scenarios button:has-text("CAPTCHA step (operator)")');
  await sleep(600);
  await page.click("#send");
  await page.waitForFunction(() => [...document.querySelectorAll("#timeline li")].some((l) => l.classList.contains("on") && l.dataset.s === "needs_human"), null, { timeout: 15000 });
  await sleep(1500);

  // operator opens the console and clears it
  await page.goto(`${BASE}/public/console.html`, { waitUntil: "networkidle" });
  await page.waitForSelector(".task", { timeout: 10000 });
  await sleep(1200);
  await page.fill('.task input[type="text"]', "DEMO-4X9Q");
  await sleep(700);
  await page.click('.task button:has-text("Submit")');
  await page.waitForSelector(".empty", { timeout: 8000 });
  await sleep(1200);

  // back to the demo client — it resumes and completes
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#result")?.textContent.includes("ENTRIES_FOUND"), null, { timeout: 15000 });
  await sleep(2500);

  const videoPath = await page.video().path();
  await context.close(); // finalizes the video
  await browser.close();

  const finalWebm = path.join(OUT, "manual-test-walkthrough.webm");
  if (existsSync(finalWebm)) { try { renameSync(finalWebm, finalWebm + ".old"); } catch { /* */ } }
  renameSync(videoPath, finalWebm);
  console.log("video:", finalWebm);

  await makeGif(finalWebm, path.join(OUT, "manual-test-walkthrough.gif"));
}

/**
 * webm -> gif. Playwright's bundled ffmpeg can decode vp8 and mux PNG frames but
 * has no gif muxer, so we extract PNGs and encode the gif in JS with gifenc.
 */
async function makeGif(webm, gifPath, { fps = 5, width = 720 } = {}) {
  const ff = findFfmpeg();
  if (!ff) { console.log("no ffmpeg — gif skipped (webm delivered)"); return; }
  const framesDir = path.join(OUT, "_frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir);
  const height = Math.round((width * 800) / 1280 / 2) * 2;
  const r = spawnSync(ff, ["-hide_banner", "-y", "-i", webm, "-r", String(fps), "-s", `${width}x${height}`, path.join(framesDir, "f_%04d.png")], { stdio: "ignore" });
  const files = readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
  if (r.status !== 0 || files.length === 0) { console.log("frame extraction failed — gif skipped"); return; }

  const enc = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (const f of files) {
    const png = PNG.sync.read(readFileSync(path.join(framesDir, f)));
    const palette = quantize(png.data, 256, { format: "rgba4444" });
    const index = applyPalette(png.data, palette, "rgba4444");
    enc.writeFrame(index, png.width, png.height, { palette, delay });
  }
  enc.finish();
  writeFileSync(gifPath, Buffer.from(enc.bytes()));
  rmSync(framesDir, { recursive: true, force: true });
  const kb = Math.round(readFileSync(gifPath).length / 1024);
  console.log(`gif: ${gifPath} (${files.length} frames, ${kb} KB)`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(stopService);
