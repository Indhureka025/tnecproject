/**
 * OCR smoke test. Renders a scanned-EC-style snippet to a PNG with Chromium, then
 * runs it back through src/parse/ocr.ts and checks the text + rough extraction.
 * Standalone (not vitest) because tesseract.js downloads a model on first run.
 *
 *   node verification/qa/ocr-test.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// this script imports a .ts module — re-exec under tsx if not already loaded
if (!process.env.__TSX__) {
  const r = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    cwd: path.join(ROOT, "service"),
    env: { ...process.env, __TSX__: "1" },
  });
  process.exit(r.status ?? 1);
}

const { chromium } = await import(pathToFileURL(path.join(ROOT, "service/node_modules/playwright/index.mjs")).href);
const { ocrEcImage } = await import(pathToFileURL(path.join(ROOT, "service/src/parse/ocr.ts")).href);

const SNIPPET = `
<div style="font-family: Georgia, serif; font-size: 26px; line-height: 1.8; padding: 30px; width: 900px; background:#fff; color:#000; filter: grayscale(1) contrast(1.1);">
  <div style="text-align:center; font-weight:bold;">ENCUMBRANCE CERTIFICATE</div>
  <div>Village: THIRUVOTTIYUR &nbsp; Survey No: 123/4</div>
  <div>1. Sale Deed &nbsp; Doc No 1234 of 2016 &nbsp; 12-03-2016 &nbsp; Rs 2500000</div>
  <div>2. Simple Mortgage &nbsp; Doc No 2231 of 2019 &nbsp; 09-07-2019 &nbsp; Rs 3500000</div>
</div>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 320 } });
  await page.setContent(SNIPPET);
  const png = await page.locator("div").first().screenshot();
  await browser.close();

  console.log("running OCR (first run downloads the English model)…");
  const r = await ocrEcImage(png);

  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log(`\x1b[32mPASS\x1b[0m ${m}`); } else { fail++; console.log(`\x1b[31mFAIL\x1b[0m ${m}  (text: ${JSON.stringify(r.text.slice(0, 120))})`); } };

  ok(/ENCUMBRANCE/i.test(r.text), "reads the title");
  ok(/THIRUVOTTIYUR/i.test(r.text) || /survey/i.test(r.text), "reads the property line");
  ok(r.confidence > 40, `confidence > 40 (got ${r.confidence.toFixed(0)})`);
  ok(r.entries.length >= 1, `rough extraction found >=1 entry (got ${r.entries.length})`);
  ok(r.entries.some((e) => /mortgage|sale/i.test(e.rawInstrumentType)), "an entry has an instrument type");

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}OCR: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
