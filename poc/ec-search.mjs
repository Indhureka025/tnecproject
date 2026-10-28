/**
 * TNREGINET Encumbrance Certificate — feasibility POC
 * ==================================================
 * Drives the TNREGINET "Search & View EC" flow with Playwright, with a
 * HUMAN-IN-THE-LOOP pause for the CAPTCHA (and OTP, if login is used).
 * It does NOT attempt to defeat the CAPTCHA. Run from an India connection.
 *
 * USAGE
 *   npm install
 *   cp config.sample.json config.json   # then edit with YOUR OWN sample property
 *   npm run ec:search
 *
 * OPTIONAL config.json -> "run":
 *   "downloadDir": "C:/Users/you/Documents/EC-PDFs"   (default: your Downloads folder)
 *   "openAfterDownload": false                        (default: true = open the PDF)
 */

import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const cfg = JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url)));
const ARTIFACTS = path.resolve(cfg.run.artifactsDir ?? "./artifacts");
fs.mkdirSync(ARTIFACTS, { recursive: true });

// Where downloaded PDFs are saved (default: your normal Downloads folder)
const DOWNLOAD_DIR = path.resolve(cfg.run.downloadDir ?? path.join(os.homedir(), "Downloads"));
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const ts = () => new Date().toISOString().replace(/[:.]/g, "-");
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// Open a file with the default app (your PDF viewer)
function openFile(file) {
  const cmd =
    process.platform === "win32" ? `start "" "${file}"` :
    process.platform === "darwin" ? `open "${file}"` :
    `xdg-open "${file}"`;
  exec(cmd, (err) => err && log(`  could not auto-open: ${err.message}`));
}

// Save a portal download with a proper .pdf name, then open it
async function saveDownload(download) {
  let name = download.suggestedFilename();
  if (!/\.pdf$/i.test(name)) name += ".pdf"; // portal may give no extension
  const dest = path.join(DOWNLOAD_DIR, `${ts()}__${name}`);
  await download.saveAs(dest);
  log(`  DOWNLOAD saved -> ${dest}`);
  const head = fs.readFileSync(dest).subarray(0, 5).toString();
  if (head !== "%PDF-") log(`  note: file starts with "${head}", not a PDF — check what it really is`);
  if (cfg.run.openAfterDownload !== false) openFile(dest);
  return dest;
}

async function ask(question) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function snap(page, name) {
  const file = path.join(ARTIFACTS, `${ts()}__${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  log(`  screenshot -> ${file}`);
  return file;
}

async function dumpOnFailure(page, name, err) {
  log(`STEP FAILED: ${name} :: ${err?.message ?? err}`);
  await snap(page, `FAIL__${name}`);
  const html = await page.content().catch(() => "");
  const file = path.join(ARTIFACTS, `${ts()}__FAIL__${name}.html`);
  fs.writeFileSync(file, html);
  log(`  DOM dump   -> ${file}`);
}

/**
 * Try a list of selector candidates in order; return the first that resolves.
 */
async function firstVisible(page, candidates, { timeout = 8000 } = {}) {
  for (const sel of candidates) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: timeout / candidates.length });
      return loc;
    } catch {
      /* try next */
    }
  }
  throw new Error(`none of these selectors matched: ${JSON.stringify(candidates)}`);
}

async function dismissPromoModal(page) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const selector of [
    'button[aria-label="Close" i]',
    '[data-dismiss="modal"]',
    ".modal.show .close",
    ".modal .close",
    'button:has-text("×")',
    '[class*="close" i]:visible',
  ]) {
    const close = page.locator(selector).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => {});
      break;
    }
  }
  await page.evaluate(() => {
    document.querySelectorAll(".modal.show, .modal-backdrop").forEach((el) => el.remove());
    document.body.classList.remove("modal-open");
  }).catch(() => {});
}

async function waitForOptions(page, selector, timeout = 15000) {
  const select = page.locator(selector).first();
  await select.waitFor({ state: "visible", timeout });
  await select.locator("option").nth(1).waitFor({ state: "attached", timeout });
}

async function selectPortalOption(page, selector, label, fieldName) {
  const select = page.locator(selector).first();
  await select.waitFor({ state: "visible", timeout: cfg.run.stepTimeoutMs });
  try {
    await select.selectOption({ label });
  } catch (labelError) {
    const value = await select.locator("option").evaluateAll((options, wanted) => {
      const normalize = (text) => text.trim().toLocaleLowerCase();
      const target = normalize(wanted);
      const match = options.find((option) =>
        normalize(option.label) === target || normalize(option.value) === target);
      return match?.value;
    }, label);
    if (value === undefined) {
      throw new Error(`No ${fieldName} option matches "${label}": ${labelError.message}`);
    }
    await select.selectOption(value);
  }
}

function parseDmy(dmy) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  if (!match) throw new Error(`Invalid date "${dmy}"; expected DD/MM/YYYY`);
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid calendar date "${dmy}"`);
  }
  return { day, month, year };
}

async function pickPortalDate(page, selector, dmy) {
  const target = parseDmy(dmy);
  const field = page.locator(selector).first();
  await field.waitFor({ state: "visible", timeout: cfg.run.stepTimeoutMs });
  await field.focus();
  await page.evaluate(({ selector, day, month, year }) => {
    const jquery = window.jQuery;
    if (!jquery?.fn?.datepick) {
      throw new Error("TNREGINET date-picker plugin is not available on the page");
    }
    const dateField = jquery(selector);
    if (!dateField.length) throw new Error(`Date field "${selector}" was not found`);
    dateField.datepick("setDate", new Date(year, month - 1, day));
  }, { selector, ...target });

  await field.blur();
  const selected = (await field.inputValue()).trim();
  const selectedMatch = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/.exec(selected);
  const expectedMonth = new Date(target.year, target.month - 1, target.day)
    .toLocaleString("en", { month: "short" }).slice(0, 3).toLowerCase();
  const actualMonth = selectedMatch?.[2].slice(0, 3).toLowerCase();
  if (!selectedMatch
    || Number(selectedMatch[1]) !== target.day
    || actualMonth !== expectedMonth
    || Number(selectedMatch[3]) !== target.year) {
    const alertSelector = selector === "#txt_PeriodStartDt" ? "#incRegDateFrom" : "#incRegDateTo";
    const alert = (await page.locator(alertSelector).textContent().catch(() => ""))?.trim();
    throw new Error(
      `Portal did not accept ${dmy} for ${selector}; field contains "${selected || "(blank)"}".`
      + (alert ? ` ${alert}` : ""),
    );
  }
}

// ---------------------------------------------------------------------------
// flow steps
// ---------------------------------------------------------------------------

async function openPortal(page) {
  const url = cfg.portal.baseUrl;
  log(`STEP open portal homepage: ${url}`);
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.run.stepTimeoutMs });
  log(`  HTTP ${res?.status()}`);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await dismissPromoModal(page);

  const englishLink = page.locator("a[href*=\"changeLanguage('en')\"]");
  if (await englishLink.count().catch(() => 0)) {
    await englishLink.first().click({ timeout: 5000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }
  await dismissPromoModal(page);
  await snap(page, "01-landing");

  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  if (/maintenance|not available|try again later/i.test(bodyText)) {
    throw new Error("portal appears to be in a maintenance window");
  }

  const searchForm = page.locator("#btn_SearchDoc");
  if (!(await searchForm.isVisible().catch(() => false))) {
    const searchLink = page.locator("a:visible", { hasText: /search\s*\/?\s*view\s*ec/i }).first();
    if (!(await searchLink.count())) {
      throw new Error('Could not find the portal "Search/View EC" link. Check that the portal loaded and is displaying English.');
    }
    await dismissPromoModal(page);
    await searchLink.click({ timeout: 10000 });
    await searchForm.waitFor({ state: "visible", timeout: cfg.run.stepTimeoutMs });
  }
  log(`  EC search form ready: ${page.url()}`);
}

async function maybeLogin(page) {
  if (cfg.run.stopBeforeLogin || !cfg.account?.username) {
    log("STEP login: skipped (stopBeforeLogin=true or no credentials). " +
        "Anonymous mode can search but the full EC PDF needs a logged-in account.");
    return;
  }
  log("STEP login");
  // TODO: verify — login link + form field ids
  await (await firstVisible(page, ['a:has-text("Login")', "#loginLink", 'a[href*="login"]'])).click();
  await (await firstVisible(page, ["#username", 'input[name="username"]'])).fill(cfg.account.username);
  await (await firstVisible(page, ["#password", 'input[name="password"]'])).fill(cfg.account.password);

  // portal shows its own CAPTCHA on the login form too
  await humanCaptcha(page, "login");

  await (await firstVisible(page, ['button:has-text("Login")', 'input[type="submit"]'])).click();

  // OTP is sometimes required on login / on a new device
  const otpField = await firstVisible(page, ["#otp", 'input[name="otp"]']).catch(() => null);
  if (otpField) {
    const otp = await ask("  >> OTP sent to the registered Indian mobile/email. Enter it here: ");
    await otpField.fill(otp);
    await (await firstVisible(page, ['button:has-text("Verify")', 'button:has-text("Submit")'])).click();
  }
  await snap(page, "02-post-login");
}

async function chooseSearchType(page) {
  log(`STEP choose search type: ${cfg.search.type}`);
  if (cfg.search.type !== "EC_WISE") {
    throw new Error(`This POC currently supports EC_WISE only; configured type was "${cfg.search.type}".`);
  }
  await page.locator("#btn_SearchDoc").waitFor({ state: "visible", timeout: cfg.run.stepTimeoutMs });
  await snap(page, "03-search-type");
}

async function fillSearchForm(page) {
  log("STEP fill EC-wise search form");
  const s = cfg.search;
  await page.locator("#cmb_Zone").waitFor({ state: "visible", timeout: cfg.run.stepTimeoutMs });
  await selectPortalOption(page, "#cmb_Zone", s.zone, "zone");
  await waitForOptions(page, "#cmb_District");
  await selectPortalOption(page, "#cmb_District", s.district, "district");
  await waitForOptions(page, "#cmb_SroName");
  await selectPortalOption(page, "#cmb_SroName", s.sro, "SRO");
  await waitForOptions(page, "#cmb_Village");
  await selectPortalOption(page, "#cmb_Village", s.village, "village");

  await page.locator("#txt_SurveyNo").fill(s.surveyNumber);
  await page.locator("#txt_SubDivisionNo").fill(s.subdivisionNumber);
  await page.locator("#btn_AddSurvey").click();
  await page.waitForTimeout(500);

  await pickPortalDate(page, "#txt_PeriodStartDt", s.ecStartDate);
  await pickPortalDate(page, "#txt_PeriodEndDt", s.ecEndDate);

  await snap(page, "04-form-filled");
}

/**
 * HUMAN-IN-THE-LOOP. We show the operator the CAPTCHA and take the answer.
 * We do NOT call any solver service.
 */
async function humanCaptcha(page, where = "search") {
  log(`STEP captcha (${where}) — HUMAN INPUT REQUIRED`);
  const img = page.locator("#captcha");
  await img.waitFor({ state: "visible", timeout: cfg.run.stepTimeoutMs });
  const file = path.join(ARTIFACTS, `${ts()}__captcha-${where}.png`);
  await img.screenshot({ path: file }).catch(() => {});
  log(`  captcha image saved -> ${file}  (open it, read the code)`);
  const code = await ask("  >> Enter the CAPTCHA text exactly as shown: ");
  await page.locator("#txt_Captcha").fill(code);
}

async function submitAndCollect(page) {
  log("STEP submit search");
  await humanCaptcha(page, "search");
  await page.locator("#btn_SearchDoc").click();

  // Some submissions trigger a second OTP confirmation.
  const otpField = await firstVisible(page, ["#searchOtp", 'input[name="otp"]'], { timeout: 4000 }).catch(() => null);
  if (otpField) {
    const otp = await ask("  >> Search confirmation OTP (Indian mobile/email). Enter it: ");
    await otpField.fill(otp);
    await (await firstVisible(page, ['button:has-text("Verify")', 'button:has-text("Submit")'])).click();
  }

  await page.waitForLoadState("networkidle", { timeout: cfg.run.stepTimeoutMs }).catch(() => {});
  await snap(page, "05-results");

  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  if (/no records? found|no encumbrance|No Documents registered/i.test(bodyText)) {
    log("  RESULT: portal reports no records for this property/period.");
    log("  -> a HUMAN must confirm this is a genuine 'clean' EC and not a wrong village/period/survey.");
    return { outcome: "NO_RECORDS" };
  }

  if (cfg.run.downloadPdf === false) {
    log("  RESULT: results page reached; PDF download disabled by config.");
    return { outcome: "RESULTS_NO_DOWNLOAD" };
  }

  // TODO: verify — result table + the "download PDF" link
  const pdfLink = await firstVisible(page, ['a:has-text("PDF")', 'a:has-text("Download")', 'a[href$=".pdf"]'])
    .catch(() => null);
  if (pdfLink) {
    // The page-level "download" handler (see main) saves the file to DOWNLOAD_DIR and opens it.
    await Promise.all([
      page.waitForEvent("download", { timeout: cfg.run.stepTimeoutMs }),
      pdfLink.click(),
    ]);
    await page.waitForTimeout(1500); // give the handler time to save + open
    log("  RESULT: download triggered — saved and opened by the download handler (informational copy; certified EC is a separate Apply flow)");
    return { outcome: "PDF_DOWNLOADED", folder: DOWNLOAD_DIR };
  }

  log("  RESULT: results page reached but no download link located — inspect artifacts.");
  return { outcome: "RESULTS_NO_DOWNLOAD" };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const STEPS = [
  ["openPortal", openPortal],
  ["maybeLogin", maybeLogin],
  ["chooseSearchType", chooseSearchType],
  ["fillSearchForm", fillSearchForm],
  ["submitAndCollect", submitAndCollect],
];

(async () => {
  log(`TNREGINET EC POC — artifacts dir: ${ARTIFACTS}`);
  log(`PDF downloads go to: ${DOWNLOAD_DIR}`);
  const browser = await chromium.launch({
    headless: cfg.run.headless ?? false,
    slowMo: cfg.run.slowMoMs ?? 100,
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  // Also catches a download you click by hand in the browser window.
  page.on("download", (download) => {
    saveDownload(download).catch((e) => log(`  download save failed: ${e.message}`));
  });
  page.setDefaultTimeout(cfg.run.stepTimeoutMs ?? 45000);

  const summary = [];
  try {
    for (const [name, fn] of STEPS) {
      try {
        const r = await fn(page);
        summary.push({ step: name, ok: true, ...(r ? { result: r } : {}) });
      } catch (err) {
        await dumpOnFailure(page, name, err);
        summary.push({ step: name, ok: false, error: String(err?.message ?? err) });
        break; // stop at first failure — this is a diagnostic POC
      }
    }
  } finally {
    const file = path.join(ARTIFACTS, `${ts()}__run-summary.json`);
    fs.writeFileSync(file, JSON.stringify(summary, null, 2));
    log(`run summary -> ${file}`);
    log("\n==== SUMMARY ====");
    for (const s of summary) log(`  ${s.ok ? "OK  " : "FAIL"}  ${s.step}${s.error ? "  :: " + s.error : ""}`);
    if (!cfg.run.headless) {
      await ask("\nPress Enter to close the browser...");
    }
    await browser.close();
  }
})();
