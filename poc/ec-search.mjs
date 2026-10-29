/**
 * TNREGINET Encumbrance Certificate — feasibility POC  (BATCH VERSION)
 * ====================================================================
 * Runs MANY samples one after another. For each sample the script opens the
 * portal, fills every field, then waits for YOU to type the CAPTCHA; after that
 * it clicks through the OK popups and downloads the PDF by itself.
 * It does NOT attempt to defeat the CAPTCHA. Run from an India connection.
 *
 * USAGE
 *   npm run ec:search
 *
 * config.json
 *   "search":  default values (zone, district, sro, village, dates ...)
 *   "samples": [ { "village": "...", "surveyNumber": "...", "subdivisionNumber": "..." }, ... ]
 *              each sample may override ANY "search" field (zone, district, sro, dates, label)
 *              (no samples -> a single run using "search", exactly like before)
 *   "run": {
 *     "downloadDir":      "C:/Users/you/Documents/TNECT"  PDFs go here
 *     "pdfName":          ""      empty = automatic name from the sample
 *     "captchaInput":     "browser" | "terminal"   (browser = type it in the portal's own box + Enter)
 *     "captchaRetries":   2       re-try a sample if the portal says the CAPTCHA was wrong
 *     "delayBetweenMs":   3000    pause between samples (be gentle with the portal)
 *     "samplesFile":      ""      optional CSV (see samples.sample.csv)
 *     "openAfterDownload": false  (default true = open each PDF; set false for big batches)
 *   }
 *
 * PDF file name: <name>_<date>_<time>.pdf
 *   e.g. EC_Thiruvettriyur_123-4_2026-10-28_14-35-20.pdf
 */

import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url)));
const ARTIFACTS = path.resolve(cfg.run.artifactsDir ?? "./artifacts");
fs.mkdirSync(ARTIFACTS, { recursive: true });

// Where downloaded PDFs are saved (default: Documents/TNECT). Only PDFs go here.
function expandHome(p) { return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p; }
const DOWNLOAD_DIR = path.resolve(expandHome(cfg.run.downloadDir ?? path.join(os.homedir(), "Documents", "TNECT")));
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

let PDF_NAME = "EC";     // set for every sample (see resolvePdfName)
let lastSaved = null;    // path of the PDF saved for the current sample
let lastDialogMsg = "";  // last native alert()/confirm() text shown by the portal

// local time stamp, e.g. 2026-10-28_14-35-20
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function cleanName(s) {
  return String(s ?? "").replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().replace(/\s+/g, "_").slice(0, 80);
}
// <downloadDir>/<name>_<timestamp>.pdf  (adds _1, _2 if the same name already exists)
function nextPdfPath() {
  const base = `${PDF_NAME}_${stamp()}`;
  let file = path.join(DOWNLOAD_DIR, `${base}.pdf`);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(DOWNLOAD_DIR, `${base}_${i}.pdf`);
  return file;
}
// Automatic name from the sample: EC_<village>_<survey>-<subdivision>
// (or the sample's "label", or the fixed run.pdfName, if you set one)
function resolvePdfName() {
  const s = cfg.search ?? {};
  const custom = cleanName(s.label || cfg.run.pdfName);
  if (custom) return custom;
  const sub = s.subdivisionNumber ? `-${s.subdivisionNumber}` : "";
  const name = cleanName(`EC_${s.village ?? ""}_${s.surveyNumber ?? ""}${sub}`.replace(/[\/\\]/g, "-"))
    .replace(/_+/g, "_").replace(/^_|_$/g, "");
  return name || "EC";
}

// ---- samples: from config.json "samples" and/or a CSV file ----
function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return [];
  const head = lines.shift().split(",").map((h) => h.trim());
  return lines.map((l) => {
    const cells = l.split(",").map((c) => c.trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]).filter(([, v]) => v !== ""));
  });
}
function loadSamples() {
  let list = Array.isArray(cfg.samples) ? [...cfg.samples] : [];
  if (cfg.run.samplesFile) {
    const file = path.resolve(HERE, cfg.run.samplesFile);
    list = list.concat(parseCsv(fs.readFileSync(file, "utf8")));
  }
  return list.filter((s) => s && typeof s === "object" && !Object.keys(s).every((k) => k.startsWith("_")));
}

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

// Save a portal download as <name>_<timestamp>.pdf in DOWNLOAD_DIR, then open it
async function saveDownload(download) {
  const dest = nextPdfPath();
  await download.saveAs(dest);
  lastSaved = dest;
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
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy).trim());
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

  await page.locator("#txt_SurveyNo").fill(String(s.surveyNumber));
  await page.locator("#txt_SubDivisionNo").fill(String(s.subdivisionNumber));
  await page.locator("#btn_AddSurvey").click();
  await page.waitForTimeout(500);

  await pickPortalDate(page, "#txt_PeriodStartDt", s.ecStartDate);
  await pickPortalDate(page, "#txt_PeriodEndDt", s.ecEndDate);

  await snap(page, "04-form-filled");
}

/**
 * HUMAN-IN-THE-LOOP. The operator reads the CAPTCHA and types it.
 * We do NOT call any solver service.
 *   run.captchaInput = "browser"  -> type it straight into the portal's CAPTCHA box, press Enter (fastest)
 *   run.captchaInput = "terminal" -> type it in the terminal (default)
 *   operatorConsole configured    -> answered through the operator console page
 */
async function humanCaptcha(page, where = "search") {
  const label = `${cfg.search?.village ?? ""} ${cfg.search?.surveyNumber ?? ""}${cfg.search?.subdivisionNumber ? "/" + cfg.search.subdivisionNumber : ""}`.trim();
  log(`STEP captcha (${where}) — HUMAN INPUT REQUIRED  [${label}]`);
  const img = page.locator("#captcha");
  await img.waitFor({ state: "visible", timeout: cfg.run.stepTimeoutMs });
  const file = path.join(ARTIFACTS, `${ts()}__captcha-${where}.png`);
  await img.screenshot({ path: file }).catch(() => {});
  log(`  captcha image saved -> ${file}`);
  let code;
  const bridge = cfg.operatorConsole ?? {};
  const baseUrl = typeof bridge.baseUrl === "string" ? bridge.baseUrl.trim().replace(/\/+$/, "") : "";
  const bridgeToken = typeof bridge.bridgeToken === "string" ? bridge.bridgeToken.trim() : "";
  if (baseUrl || bridgeToken) {
    if (!baseUrl || !bridgeToken) {
      throw new Error("operatorConsole.baseUrl and operatorConsole.bridgeToken must both be configured.");
    }

    const headers = {
      "content-type": "application/json",
      "x-operator-bridge-token": bridgeToken,
    };
    const createResponse = await fetch(`${baseUrl}/ops/bridge/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: `poc-${randomUUID()}`,
        context: {
          note: `TNREGINET ${where} CAPTCHA`,
          imageBase64: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`,
        },
      }),
    });
    if (!createResponse.ok) {
      throw new Error(`Could not create operator CAPTCHA task (${createResponse.status}): ${await createResponse.text()}`);
    }
    const { taskId } = await createResponse.json();
    if (typeof taskId !== "string" || !taskId) {
      throw new Error("Operator service returned an invalid CAPTCHA task ID.");
    }

    const consoleUrl = `${baseUrl}/public/console.html`;
    let consolePage = context.pages().find((candidate) => candidate.url().startsWith(consoleUrl));
    if (!consolePage) consolePage = await context.newPage();
    await consolePage.goto(consoleUrl, { waitUntil: "domcontentloaded", timeout: cfg.run.stepTimeoutMs });
    await consolePage.bringToFront().catch(() => {}); // show the console tab so you can type the CAPTCHA
    log(`  CAPTCHA task ${taskId} opened in the operator console: ${consoleUrl}`);

    const taskUrl = `${baseUrl}/ops/bridge/tasks/${encodeURIComponent(taskId)}`;
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const taskResponse = await fetch(taskUrl, { headers: { "x-operator-bridge-token": bridgeToken } });
      if (!taskResponse.ok) {
        throw new Error(`Could not check operator CAPTCHA task (${taskResponse.status}): ${await taskResponse.text()}`);
      }
      const task = await taskResponse.json();
      if (task.status === "expired") {
        throw new Error("Operator CAPTCHA task expired before it was answered.");
      }
      if (task.status === "answered") {
        if (task.answer?.kind !== "captcha" || typeof task.answer.value !== "string" || !task.answer.value.trim()) {
          throw new Error("Operator console returned an invalid CAPTCHA answer.");
        }
        code = task.answer.value.trim();
        break;
      }
      if (task.status !== "open") {
        throw new Error(`Operator CAPTCHA task has unexpected status "${task.status}".`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!code) throw new Error("Timed out waiting for the operator to answer the CAPTCHA.");
  } else if (cfg.run.captchaInput === "browser") {
    // Fastest: type the code directly in the portal's own CAPTCHA box and press Enter.
    const field = page.locator("#txt_Captcha");
    await page.bringToFront().catch(() => {});
    await field.scrollIntoViewIfNeeded().catch(() => {});
    await field.fill("");
    await field.focus();
    log("  >> Type the CAPTCHA in the browser box and press ENTER (the script does the rest)");
    await page.evaluate(() => {
      window.__captchaDone = false;
      const el = document.querySelector("#txt_Captcha");
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); window.__captchaDone = true; }
      }, true);
    });
    await page.waitForFunction(() => window.__captchaDone === true, null, { timeout: 5 * 60_000 });
    code = (await field.inputValue()).trim();
    if (!code) throw new Error("CAPTCHA box was empty when Enter was pressed.");
  } else {
    code = await ask("  >> Enter the CAPTCHA text exactly as shown: ");
  }
  await page.locator("#txt_Captcha").fill(code);
}

// portal's wrong-CAPTCHA message (text or alert box)
const WRONG_CAPTCHA = /(invalid|incorrect|wrong|mismatch|not\s*match)[^.]{0,40}captcha|captcha[^.]{0,40}(invalid|incorrect|wrong|mismatch|not\s*match)/i;

let context;
async function submitAndCollect(page) {
  log("STEP submit search");
  lastDialogMsg = "";
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

  if (cfg.run.downloadPdf === false) {
    log("  RESULT: results page reached; PDF download disabled by config.");
    return { outcome: "RESULTS_NO_DOWNLOAD" };
  }

  // Portal flow after the CAPTCHA (confirmed from real screenshots):
  //   [optional "Data Availability Period ... Ok" popup]
  //   -> Acknowledgement page: "Your PDF has been generated successfully! Click here to download PDF"  [OK]
  // NOTE: the search form itself has an unrelated "Click Here to know data availability period" link,
  // so we ONLY click "Click here" once the Acknowledgement text is on screen.
  const ackText = page.getByText(/PDF has been generated|to download PDF/i).first();
  const noRecords = page.getByText(/no records? found|no encumbrance|No Documents registered/i).first();
  const wrongCaptchaText = page.getByText(WRONG_CAPTCHA).first();
  const okSel = [
    '.swal2-confirm', '.swal-button--confirm', '.bootbox .btn-primary',
    'button:text-matches("^\\s*ok\\s*$", "i")',
    'input[value="OK" i]', 'a:text-matches("^\\s*ok\\s*$", "i")',
    '#btnOk', '#btn_Ok',
  ].join(", ");

  log("  waiting for the 'PDF generated' page (auto-clicking any OK popup on the way)...");
  let pdfLink = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (cfg.run.downloadSelector && await page.locator(cfg.run.downloadSelector).first().isVisible().catch(() => false)) {
      pdfLink = page.locator(cfg.run.downloadSelector).first();
      break;
    }
    if (await ackText.isVisible().catch(() => false)) {
      log("  'PDF has been generated' page reached");
      pdfLink = page.getByText(/click\s*here/i).first();
      break;
    }
    if (await noRecords.isVisible().catch(() => false)) {
      log("  RESULT: portal reports no records for this property/period (visible on screen).");
      log("  -> a HUMAN must confirm this is a genuine 'clean' EC and not a wrong village/period/survey.");
      return { outcome: "NO_RECORDS" };
    }
    if (WRONG_CAPTCHA.test(lastDialogMsg) || await wrongCaptchaText.isVisible().catch(() => false)) {
      log("  portal says the CAPTCHA was wrong");
      return { outcome: "CAPTCHA_WRONG" };
    }
    const ok = page.locator(okSel).first();
    if (await ok.isVisible().catch(() => false)) {
      log("  OK popup found — clicking OK");
      await ok.click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(700);
  }

  if (pdfLink) {
    log(`  download button found: "${(await pdfLink.textContent().catch(() => "")).trim()}" — clicking`);
    const before = new Set(context.pages());
    const dl = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
    await pdfLink.click();
    const got = await dl;
    if (got) {
      await page.waitForTimeout(1500); // let the download handler save + open it
      log("  RESULT: PDF downloaded automatically (informational copy; certified EC is a separate Apply flow)");
      return { outcome: "PDF_DOWNLOADED", folder: DOWNLOAD_DIR };
    }
    // No download event: the PDF may have opened in a new tab / inline viewer. Save it ourselves.
    const popup = context.pages().find((p) => !before.has(p));
    const target = popup ?? page;
    await target.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
    const res = await context.request.get(target.url()).catch(() => null);
    const body = res ? await res.body().catch(() => null) : null;
    if (body && body.subarray(0, 5).toString() === "%PDF-") {
      const dest = nextPdfPath();
      fs.writeFileSync(dest, body);
      lastSaved = dest;
      log(`  DOWNLOAD saved -> ${dest}`);
      if (cfg.run.openAfterDownload !== false) openFile(dest);
      return { outcome: "PDF_DOWNLOADED", folder: DOWNLOAD_DIR };
    }
    await snap(target, "06-after-download-click");
    log("  clicked the button but no PDF came back — see the screenshot in artifacts.");
  } else {
    await snap(page, "06-no-download-button");
    fs.writeFileSync(path.join(ARTIFACTS, `${ts()}__results-page.html`), await page.content().catch(() => ""));
    log("  no download button matched — saved results-page screenshot + HTML to artifacts. Set run.downloadSelector in config.json to the button's selector.");
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

// Run all steps for ONE sample. Never throws.
async function runSample(page) {
  const steps = [];
  let outcome = null;
  let error = null;
  for (const [name, fn] of STEPS) {
    try {
      const r = await fn(page);
      steps.push({ step: name, ok: true });
      if (r?.outcome) outcome = r.outcome;
    } catch (err) {
      await dumpOnFailure(page, name, err);
      error = `${name}: ${String(err?.message ?? err)}`;
      outcome = "FAILED";
      steps.push({ step: name, ok: false, error });
      break; // skip the rest of THIS sample, then continue with the next one
    }
  }
  return { outcome: outcome ?? "UNKNOWN", error, steps };
}

// close PDF tabs / popups left over from the previous sample (keep the main page + operator console)
async function closeExtraPages(mainPage) {
  for (const p of context.pages()) {
    if (p !== mainPage && !p.url().includes("/public/console.html")) await p.close().catch(() => {});
  }
}

(async () => {
  log("ec-search VERSION 6 (BATCH: many samples, auto-fill, you only enter the CAPTCHAs)");
  const baseSearch = { ...cfg.search };
  const samples = loadSamples();
  const jobs = samples.length ? samples : [{}];
  const retries = cfg.run.captchaRetries ?? 2;
  log(`TNREGINET EC POC — ${jobs.length} sample(s) — artifacts dir: ${ARTIFACTS}`);
  log(`PDFs will be saved to: ${DOWNLOAD_DIR}`);
  log(`CAPTCHA input mode: ${cfg.operatorConsole?.baseUrl ? "operator console" : (cfg.run.captchaInput === "browser" ? "type in the browser box + Enter" : "terminal")}`);

  const browser = await chromium.launch({
    headless: cfg.run.headless ?? false,
    slowMo: cfg.run.slowMoMs ?? 100,
  });
  context = await browser.newContext({
    acceptDownloads: true,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  // Also catches a download you click by hand in the browser window.
  const onDownload = (download) => {
    saveDownload(download).catch((e) => log(`  download save failed: ${e.message}`));
  };
  // Native browser alert()/confirm() boxes (the "OK" screen may be one): accept automatically.
  const onDialog = (d) => { lastDialogMsg = d.message(); log(`  portal dialog: "${lastDialogMsg}" -> OK`); d.accept().catch(() => {}); };
  page.on("download", onDownload);
  page.on("dialog", onDialog);
  context.on("page", (p) => { p.on("download", onDownload); p.on("dialog", onDialog); }); // popups/new tabs
  page.setDefaultTimeout(cfg.run.stepTimeoutMs ?? 45000);

  const results = [];
  try {
    for (let i = 0; i < jobs.length; i++) {
      let attempt = 0;
      let res;
      while (true) {
        attempt++;
        cfg.search = { ...baseSearch, ...jobs[i] };
        PDF_NAME = resolvePdfName();
        lastSaved = null;
        const s = cfg.search;
        log(`\n===== SAMPLE ${i + 1}/${jobs.length}: ${s.village} survey ${s.surveyNumber}/${s.subdivisionNumber}` +
            `  (attempt ${attempt}) =====`);
        res = await runSample(page);
        if (res.outcome === "CAPTCHA_WRONG" && attempt <= retries) {
          log("  -> wrong CAPTCHA: trying this sample again with a fresh CAPTCHA");
          await closeExtraPages(page);
          continue;
        }
        break;
      }
      results.push({
        n: i + 1,
        village: cfg.search.village,
        survey: `${cfg.search.surveyNumber}/${cfg.search.subdivisionNumber}`,
        outcome: res.outcome,
        file: lastSaved ?? "",
        attempts: attempt,
        error: res.error ?? "",
      });
      await closeExtraPages(page);
      if (i < jobs.length - 1) await page.waitForTimeout(cfg.run.delayBetweenMs ?? 3000);
    }
  } finally {
    const base = path.join(ARTIFACTS, `${ts()}__batch-summary`);
    fs.writeFileSync(`${base}.json`, JSON.stringify(results, null, 2));
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    fs.writeFileSync(`${base}.csv`, ["n,village,survey,outcome,attempts,file,error"]
      .concat(results.map((r) => [r.n, r.village, r.survey, r.outcome, r.attempts, r.file, r.error].map(q).join(","))).join("\n"));
    log(`batch summary -> ${base}.csv`);

    log("\n==== BATCH SUMMARY ====");
    for (const r of results) {
      log(`  #${String(r.n).padStart(2)}  ${String(r.outcome).padEnd(20)} ${r.village} ${r.survey}${r.file ? "  -> " + path.basename(r.file) : ""}${r.error ? "  :: " + r.error : ""}`);
    }
    const count = (o) => results.filter((r) => r.outcome === o).length;
    log(`  downloaded: ${count("PDF_DOWNLOADED")}   no records: ${count("NO_RECORDS")}   failed/other: ${results.length - count("PDF_DOWNLOADED") - count("NO_RECORDS")}   of ${results.length}`);
    log(`  PDFs are in: ${DOWNLOAD_DIR}`);
    if (!cfg.run.headless) {
      await ask("\nPress Enter to close the browser...");
    }
    await browser.close();
  }
})();
