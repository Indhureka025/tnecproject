/**
 * Playwright worker that drives a TNREGINET-shaped portal end to end:
 * login (+ CAPTCHA) -> EC search form -> CAPTCHA -> optional OTP -> scrape results.
 *
 * Points at AUTOMATION_PORTAL_URL. Against the real tnreginet.gov.in this needs
 * to run from India with a real account; against verification/mock-portal it runs
 * anywhere and is covered by tests. CAPTCHA/OTP are never solved here — each opens
 * a human-in-the-loop task with a screenshot; a real operator answers.
 */
import { chromium, type Browser } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RetrieveContext } from "./types.ts";
import { ProviderError } from "./types.ts";
import type { EcRequest } from "../contract.ts";
import { type EcResult, EC_DISCLAIMER, deriveOutcome } from "../canonical.ts";
import { parseEcHtml } from "../parse/ec-html.ts";

export interface WorkerConfig {
  portalUrl: string;
  username?: string;
  password?: string;
  headless?: boolean;
  /**
   * When set, records the whole run as a .webm video via Playwright's built-in
   * context recorder — useful for proving/inspecting a live run when there's no
   * way to show the (headless) browser's window on screen directly.
   */
  recordVideoDir?: string;
}

/**
 * The real portal runs promo modals — "Presence Less Registration" on most
 * navigations, and a separate "MobileAppModal" seen live intercepting a click
 * on a *fresh* session (no existing cookies dismissing it, as a real returning
 * visitor's browser would have) — that sit on top of whatever's underneath and
 * block Playwright from clicking it ("element is not visible" / "intercepts
 * pointer events"). There will likely be more of these over time; rather than
 * naming each one, try known close-button patterns first and, if any `.modal.show`
 * is still up after that, remove it and its backdrop directly — it's a marketing
 * overlay, not something the flow ever needs to interact with. Best-effort,
 * never throws: dismissing a promo popup is not part of the flow worth failing over.
 */
async function dismissPromoModal(page: import("playwright").Page): Promise<void> {
  try {
    await page.keyboard.press("Escape").catch(() => {});
    const candidates = [
      'button[aria-label="Close" i]',
      '[data-dismiss="modal"]',
      ".modal.show .close",
      ".modal .close",
      'button:has-text("×")',
      '[class*="close" i]:visible',
    ];
    for (const sel of candidates) {
      const el = page.locator(sel).first();
      if ((await el.count().catch(() => 0)) && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 2000 }).catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(300);
    // Guaranteed fallback: nothing legitimate in this flow is ever inside a
    // Bootstrap-style `.modal.show` overlay, so any still standing is a promo
    // that a close-button click missed — clear it and its backdrop directly.
    // Runs inside the browser page, not Node — this project's tsconfig has no
    // DOM lib (it's a server codebase), so `document` is reached via globalThis.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      doc.querySelectorAll(".modal.show").forEach((m: { remove: () => void }) => m.remove());
      doc.querySelectorAll(".modal-backdrop").forEach((m: { remove: () => void }) => m.remove());
      doc.body.classList.remove("modal-open");
    }).catch(() => {});
  } catch {
    // best-effort only
  }
}

/** For the mock portal only: read the answer it exposes so tests can proceed unattended. */
async function mockAnswer(page: import("playwright").Page): Promise<string | undefined> {
  return page.locator("#captcha-answer").first().textContent({ timeout: 200 }).catch(() => null).then((t) => t?.trim() || undefined);
}

/**
 * Try each candidate selector in order (real-portal id first, mock-portal id as
 * fallback) and act on the first one present. Both portals get a mix of <select>
 * and plain <input> for the "same" field (e.g. village is a cascading dropdown on
 * the real portal but a free-text field on the mock), so this always attempts
 * selectOption-by-label first and falls back to fill — exactly the pattern already
 * proven for zone/district/sro before this helper existed.
 */
async function fillFirst(page: import("playwright").Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    if (await page.locator(sel).count().catch(() => 0)) {
      await page.selectOption(sel, { label: value }).catch(() => page.fill(sel, value).catch(() => {}));
      return true;
    }
  }
  return false;
}

/**
 * Confirmed live: a promo modal can reappear well into the flow, not just at
 * page load — one blocked a click for 30+ seconds during diagnosis. The
 * previous version of this helper swallowed a failed click and returned true
 * regardless (it only checked that the element existed, not that the click
 * landed), which meant a modal silently blocking the final "Search" click was
 * invisible: the worker pressed on to scrape whatever page was left, producing
 * a false "no records found" instead of a real result or a real failure. Now
 * it clears any blocking modal and retries once before honestly reporting
 * whether the click actually happened.
 */
async function clickFirst(page: import("playwright").Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      try {
        await el.click({ timeout: 5000 });
        return true;
      } catch {
        await dismissPromoModal(page);
        try {
          await el.click({ timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      }
    }
  }
  return false;
}

/**
 * Confirmed live, the hard way, after a lengthy investigation: the EC Start/End
 * Date fields are bound to a JS calendar widget that page.fill() does not
 * actually update — it can open the picker (side effect of focusing the field)
 * but the real portal reads the fields as still empty afterward, which is what
 * was silently failing the site's own mandatory-field check on every run.
 * Drives the actual picker instead: click the field, click "Today" if that's
 * the target date, otherwise step month-by-month via the picker's own
 * Prev/Next controls (the one navigation every version of this kind of widget
 * reliably supports) until the header shows the target month/year, then click
 * the target day cell. No-ops harmlessly if the field doesn't exist (the mock
 * portal's plain #from/#to inputs), since count() short-circuits before any
 * of this runs.
 */
async function pickDate(page: import("playwright").Page, fieldSelector: string, iso: string): Promise<void> {
  const field = page.locator(fieldSelector).first();
  if (!(await field.count().catch(() => 0))) return;

  await field.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  const todayIso = new Date().toISOString().slice(0, 10);
  if (iso === todayIso) {
    const todayBtn = page.getByText("Today", { exact: true }).first();
    if (await todayBtn.count().catch(() => 0)) {
      await todayBtn.click({ timeout: 3000 }).catch(() => {});
      return;
    }
  }

  const target = new Date(`${iso}T00:00:00Z`);
  const targetMonthIdx = target.getUTCMonth();
  const targetYear = target.getUTCFullYear();
  const targetDay = target.getUTCDate();
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const headerLoc = page.locator("text=/^[A-Za-z]+\\s+\\d{4}$/").first();

  for (let i = 0; i < 240; i++) { // safety cap: 20 years of month-steps
    const headerText = (await headerLoc.textContent().catch(() => null))?.trim() ?? "";
    const m = headerText.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!m) break;
    const shownWord = (m[1] ?? "").toLowerCase();
    const shownYear = Number(m[2] ?? "0");
    // The widget's own header text is truncated ("Septembe" for September,
    // confirmed live) — match by whichever prefix relationship holds.
    const shownMonthIdx = monthNames.findIndex((name) => name.startsWith(shownWord) || shownWord.startsWith(name.slice(0, shownWord.length)));
    if (shownYear === targetYear && shownMonthIdx === targetMonthIdx) break;
    const shownTotal = shownYear * 12 + shownMonthIdx;
    const targetTotal = targetYear * 12 + targetMonthIdx;
    const navBtn = targetTotal < shownTotal ? page.getByText("Prev", { exact: true }).first() : page.getByText("Next", { exact: true }).first();
    if (!(await navBtn.count().catch(() => 0))) break;
    await navBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(150);
  }

  const dayCell = page.locator("td", { hasText: new RegExp(`^${targetDay}$`) }).first();
  await dayCell.click({ timeout: 3000 }).catch(() => {});
}

/**
 * Playwright's own video recorder proved unreliable for the specific moment
 * right around clicking Search — twice, with two different fix attempts, it
 * cut off before showing the click's effect (confirmed by a direct
 * page.screenshot() showing the same page state the video's last frame did,
 * ruling out a settle-timing problem in our own code). Explicit screenshots
 * have worked every single time tonight (the CAPTCHA image, the post-submit
 * screenshot), so build the video from a rapid burst of those instead of
 * depending on Playwright's internal screencast encoder at all. Runs
 * concurrently with the actual click/submit flow — start it just before
 * clicking, stop it a few seconds after the page settles.
 */
function startBurstCapture(page: import("playwright").Page, dir: string, intervalMs = 300, maxDurationMs = 15000) {
  const state = { stop: false };
  const done = (async () => {
    let i = 0;
    const start = Date.now();
    while (!state.stop && Date.now() - start < maxDurationMs) {
      i += 1;
      // jpeg, not png: the frames get piped into Playwright's own bundled
      // ffmpeg afterward to build a video, and that build only has an mjpeg
      // decoder wired in (no png decoder) — confirmed by testing it directly.
      const shot = await page.screenshot({ type: "jpeg", quality: 85 }).catch(() => null);
      if (shot) await writeFile(path.join(dir, `f-${String(i).padStart(4, "0")}.jpg`), shot).catch(() => {});
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return { stop: () => { state.stop = true; }, done };
}

/**
 * The real portal's Zone -> District -> SRO -> Village chain is a genuine
 * network round-trip (confirmed live: each select's options only populate after
 * its own AJAX call returns), not a fixed local delay — a flat sleep guessed too
 * short here on a first live automated run and produced a garbage CAPTCHA capture
 * (the worker pressed on to a page state that was never actually ready). Poll for
 * the child <select> to actually gain options instead of guessing a duration.
 * No-ops immediately for selectors that don't exist (e.g. the mock portal, whose
 * equivalents aren't cascading) or that already have options (nothing to wait for).
 */
async function waitForOptions(page: import("playwright").Page, selector: string, minCount = 2, timeoutMs = 10000): Promise<void> {
  const el = page.locator(selector).first();
  if (!(await el.count().catch(() => 0))) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await el.locator("option").count().catch(() => 0)) >= minCount) return;
    await page.waitForTimeout(250);
  }
}

async function solveCaptcha(page: import("playwright").Page, ctx: RetrieveContext, inputSelectors: string[]): Promise<void> {
  // Only one of these ever exists on a given portal, so joining into one CSS
  // selector resolves to exactly the right single element either way.
  const inputSel = inputSelectors.join(", ");
  // Screenshot just the CAPTCHA image itself when we can find one near the answer
  // box — smaller and clearer for the operator than a full-page capture. Common
  // patterns: an <img> right next to/before the answer input, or one whose id/src
  // hints at "captcha". Falls back to the full page if none of that matches.
  const imgCandidates = [
    ...inputSelectors.map((sel) => `${sel} ~ img`),
    `img[id*="captcha" i]`,
    `img[src*="captcha" i]`,
    `img[alt*="captcha" i]`,
  ];
  // Poll briefly rather than checking once: on the real portal the CAPTCHA
  // image only exists after the "Add" step's re-render settles, and checking
  // too early is exactly what produced a full-page (garbage) capture on the
  // first live automated run.
  let shot: Buffer | undefined;
  const deadline = Date.now() + 5000;
  while (!shot && Date.now() < deadline) {
    for (const sel of imgCandidates) {
      const img = page.locator(sel).first();
      if (await img.count().catch(() => 0)) {
        shot = await img.screenshot().catch(() => undefined);
        if (shot) break;
      }
    }
    if (!shot) await page.waitForTimeout(250);
  }
  shot ??= await page.screenshot();

  const _mockAnswer = await mockAnswer(page);
  const ans = await ctx.requestHuman({
    kind: "captcha",
    // full image, not a truncated fragment — the operator has to actually read this
    context: { note: "portal CAPTCHA", imageBase64: `data:image/png;base64,${shot.toString("base64")}`, _mockAnswer },
  });
  if (ans.kind !== "captcha" || !ans.value) throw new ProviderError("captcha_unrecoverable", "no CAPTCHA answer");
  await page.fill(inputSel, ans.value);
}

export async function runWorker(cfg: WorkerConfig, req: EcRequest, ctx: RetrieveContext): Promise<EcResult> {
  let browser: Browser | undefined;
  let context: import("playwright").BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: cfg.headless ?? true });
    context = await browser.newContext(
      cfg.recordVideoDir ? { recordVideo: { dir: cfg.recordVideoDir, size: { width: 1280, height: 900 } } } : {},
    );
    const page = await context.newPage();
    const base = cfg.portalUrl.replace(/\/$/, "");

    // 1. login (only if actually required)
    // Confirmed live (12 Sep 2026): the real portal's free "Search & View EC"
    // needs no account at all. #username exists in its DOM from page load
    // regardless — it's a hidden header toggle for an optional citizen login —
    // so checking count() alone (as an earlier version of this code did) means
    // ALWAYS taking the login branch on the real portal, which is wrong for this
    // search and was the actual cause of a garbled/wrong CAPTCHA capture tonight.
    // Checking visibility instead means: log in only when a portal (like the
    // mock) actually presents the field up front; never chase down a hidden one.
    await page.goto(`${base}/portal`, { waitUntil: "domcontentloaded" });
    // The real portal's footer links (incl. "Search/View EC") are rendered by
    // client-side JS that finishes shortly after domcontentloaded, not at it —
    // looking for them too early found nothing on a live run. Give it a moment.
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    // Confirmed live: a fresh session (no prior language cookie, as any first-time
    // automated run has) renders the whole page in Tamil by default — every
    // English text/selector match below silently finds nothing until this runs.
    // A manual walkthrough doesn't hit this because a human already switched
    // language earlier in the same browser profile.
    const englishLink = page.locator("a[href*=\"changeLanguage('en')\"]");
    if (await englishLink.count().catch(() => 0)) {
      await dismissPromoModal(page);
      await englishLink.first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    }
    await dismissPromoModal(page);
    if (await page.locator("#username").first().isVisible().catch(() => false)) {
      await page.fill("#username", cfg.username ?? "worker");
      await page.fill("#password", cfg.password ?? "worker");
      await solveCaptcha(page, ctx, ["#captcha"]);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), page.click("#login-submit")]);
      ctx.log("automation.logged_in");
    }

    // 2. EC search form
    // Confirmed live (12 Sep 2026): the real portal's search screen isn't a
    // separately loadable URL — it's a client-side AJAX swap of the homepage
    // (the address bar keeps showing actionVal=homePage throughout). It's reached
    // only by clicking the actual "Search/View EC" link. The mock portal, by
    // contrast, *is* a real separate page at /portal/ec-search — try the direct
    // URL there, and fall back to the real portal's click-through otherwise.
    const hasSearchForm = async () => (await page.locator("#ec-submit, #btn_SearchDoc").count()) > 0;
    if (!(await hasSearchForm())) {
      // Not getByRole("link", ...): the real portal's footer anchor has no href
      // attribute (onclick-driven nav instead), so it carries no accessible
      // "link" role for Playwright to match on — confirmed the hard way live.
      // Match on visible text instead, which works regardless of markup style.
      const searchLink = page.locator("a", { hasText: /search\s*\/?\s*view\s*ec/i });
      const linkFound = await searchLink.count().catch(() => 0);
      ctx.log("automation.debug", { step: "search_link", found: linkFound > 0, url: page.url() });
      if (linkFound) {
        await dismissPromoModal(page);
        await searchLink.first().click({ timeout: 5000 }).catch((e) => ctx.log("automation.debug", { step: "search_link_click_failed", error: String(e) }));
        await page.waitForTimeout(800);
      }
      if (!(await hasSearchForm())) {
        await page.goto(`${base}/portal/ec-search`, { waitUntil: "domcontentloaded" }).catch(() => {});
      }
      await dismissPromoModal(page);
    }
    ctx.log("automation.debug", { step: "search_form_reached", found: await hasSearchForm(), url: page.url() });

    const p = req.property;
    // Zone -> District -> SRO -> Village cascade via AJAX on the real portal —
    // wait for each child's options to actually arrive rather than guessing a
    // fixed delay (see waitForOptions).
    await fillFirst(page, ["#cmb_Zone", "#zone"], p.zone);
    await waitForOptions(page, "#cmb_District").catch(() => {});
    await fillFirst(page, ["#cmb_District", "#district"], p.district);
    await waitForOptions(page, "#cmb_SroName").catch(() => {});
    await fillFirst(page, ["#cmb_SroName", "#sro"], p.sroCode);
    if (p.village) {
      await waitForOptions(page, "#cmb_Village").catch(() => {});
      await fillFirst(page, ["#cmb_Village", "#village"], p.village);
    }
    ctx.log("automation.debug", {
      step: "cascade_filled",
      zone: await page.locator("#cmb_Zone, #zone").first().inputValue().catch(() => "?"),
      district: await page.locator("#cmb_District, #district").first().inputValue().catch(() => "?"),
      sro: await page.locator("#cmb_SroName, #sro").first().inputValue().catch(() => "?"),
      village: await page.locator("#cmb_Village, #village").first().inputValue().catch(() => "?"),
    });
    // Real portal: survey number and subdivision number are separate fields
    // (e.g. "11" and "1A1", not the combined "11/1A1" printed on an old deed —
    // confirmed live) that must be added as a row before the CAPTCHA even renders.
    if (p.surveyNumber) await fillFirst(page, ["#txt_SurveyNo", "#survey"], p.surveyNumber);
    if (p.subdivisionNumber) await fillFirst(page, ["#txt_SubDivisionNo", "#subdiv"], p.subdivisionNumber);
    const addClicked = await clickFirst(page, ["#btn_AddSurvey"]);
    if (addClicked) await page.waitForTimeout(500); // real-portal-only step; no-op on the mock
    ctx.log("automation.debug", { step: "add_survey", clicked: addClicked, captchaImgPresent: await page.locator("#captcha, #txt_Captcha ~ img, #ec-captcha ~ img").count().catch(() => 0) });
    // Confirmed live: page.fill() opens the picker widget but never actually
    // sets a value the real portal's own validation reads as non-empty — this
    // was the true, silent cause of every "nothing happens after Search"
    // result tonight, not a CAPTCHA or click problem at all. Drive the actual
    // picker on the real portal; fill() is kept for the mock's plain inputs.
    if (await page.locator("#txt_PeriodStartDt").count().catch(() => 0)) {
      await pickDate(page, "#txt_PeriodStartDt", req.period.from);
    } else {
      await fillFirst(page, ["#from"], isoToDmy(req.period.from));
    }
    if (await page.locator("#txt_PeriodEndDt").count().catch(() => 0)) {
      await pickDate(page, "#txt_PeriodEndDt", req.period.to);
    } else {
      await fillFirst(page, ["#to"], isoToDmy(req.period.to));
    }

    // 3. search CAPTCHA — retried with a *fresh* screenshot if the site rejects
    // the answer. Confirmed live: a real-world CAPTCHA here can expire between
    // when the operator sees the screenshot and when the answer actually gets
    // typed and submitted (read it, type it, click Submit in the console, then
    // the worker fills + clicks Search on the real page) — that round trip
    // easily takes 20-40+ seconds, and the site accepted the exact same kind of
    // answer fine when a human filled it live in one go. When that happens the
    // page shows "Please Enter Valid Captcha" and generates a new code for the
    // next try — so retry with that new code rather than treating one stale
    // answer as a hard failure.
    const MAX_CAPTCHA_ATTEMPTS = 3;
    let postClickText = "";
    for (let attempt = 1; attempt <= MAX_CAPTCHA_ATTEMPTS; attempt++) {
      await solveCaptcha(page, ctx, ["#txt_Captcha", "#ec-captcha"]);

      // Start the screenshot-burst right as we're about to click — see
      // startBurstCapture's doc comment for why this replaces Playwright's own
      // video recorder for this specific moment. Also listen for any network
      // activity to the portal's own host during this window, to answer the
      // open question directly: does clicking Search fire a request at all?
      const burstDir = cfg.recordVideoDir ? path.join(cfg.recordVideoDir, `click-burst-attempt${attempt}`) : null;
      if (burstDir) await mkdir(burstDir, { recursive: true }).catch(() => {});
      const burst = burstDir ? startBurstCapture(page, burstDir, 300, 40000) : null;

      const portalHost = new URL(base).host;
      const seenRequests: string[] = [];
      const onRequest = (req: import("playwright").Request) => {
        try {
          if (new URL(req.url()).host === portalHost) seenRequests.push(`${req.method()} ${req.url()}`);
        } catch { /* ignore unparseable urls */ }
      };
      page.on("request", onRequest);
      // Also capture the actual response body for the CAPTCHA-check call
      // itself — confirmed live that clicking Search fires exactly this async
      // request, so its response is the direct answer to whether the CAPTCHA
      // was actually accepted, rather than inferring it from page text.
      const seenResponses: { url: string; status: number; body: string }[] = [];
      const onResponse = (res: import("playwright").Response) => {
        if (/actionVal=checkCaptcha/i.test(res.url())) {
          res.text().then((body) => seenResponses.push({ url: res.url(), status: res.status(), body: body.slice(0, 300) })).catch(() => {});
        }
      };
      page.on("response", onResponse);
      // Confirmed live the checkCaptcha validation itself succeeds ("##true")
      // every time, with nothing visible happening afterward regardless of
      // timing (a blur-then-pause fix made no difference) — so it's neither a
      // wrong/expired CAPTCHA nor a race condition. Next candidate: the site's
      // own success-callback throwing a JS error partway through, silently,
      // with no on-page indication. Capture console output and page errors
      // for this same window to check directly instead of guessing again.
      const seenConsoleErrors: string[] = [];
      const onConsole = (msg: import("playwright").ConsoleMessage) => {
        if (msg.type() === "error") seenConsoleErrors.push(msg.text());
      };
      const onPageError = (err: Error) => seenConsoleErrors.push(`pageerror: ${err.message}`);
      page.on("console", onConsole);
      page.on("pageerror", onPageError);

      await page.locator("#txt_Captcha, #ec-captcha").first().blur().catch(() => {});
      await page.waitForTimeout(1200);

      // Three theories ruled out live tonight (wrong/expired CAPTCHA, a race
      // with the async check, a silent JS error) — rather than guess at a
      // fourth, read what the button's own code actually says it does. Pulls
      // the onclick attribute and, if it's a plain function-name call, that
      // function's real source straight out of the page.
      if (cfg.recordVideoDir) {
        // Runs inside the browser page, not Node — this project's tsconfig has
        // no DOM lib, so document/window are reached via globalThis.
        const btnInfo = await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const g = globalThis as any;
          const el = g.document.querySelector("#btn_SearchDoc");
          if (!el) return null;
          const onclick = el.getAttribute("onclick") ?? "";
          const fnNameMatch = onclick.match(/^\s*([a-zA-Z_$][\w$]*)\s*\(/);
          const fnName = fnNameMatch?.[1];
          const fnSource = fnName && typeof g[fnName] === "function" ? g[fnName].toString() : null;
          return { outerHTML: el.outerHTML.slice(0, 500), onclick, fnName: fnName ?? null, fnSource: fnSource?.slice(0, 2000) ?? null };
        }).catch((e) => ({ error: String(e) }));
        ctx.log("automation.debug", { step: "search_button_source", attempt, btnInfo });

        // The button's own source shows three gates before it does anything:
        // checkMandSearchDocYearWise() -> (async) getVillageDetails() ->
        // encryptPlotFlat(). If any is falsy the function just stops — no
        // error, no request, nothing visible, exactly what's been observed
        // all night. Call each directly to see which one is actually failing,
        // rather than continuing to infer it from the outside.
        const gateCheck = await page.evaluate(async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const g = globalThis as any;
          const out: Record<string, unknown> = {};
          try {
            out.checkMand = typeof g.checkMandSearchDocYearWise === "function" ? g.checkMandSearchDocYearWise() : "fn-missing";
            // checkMandSearchDocYearWise() only returns one boolean — read
            // every individual condition it checks directly, so we know
            // exactly which one(s) are actually failing instead of guessing.
            const $ = g.jQuery ?? g.$;
            out.mandFields = {
              zone: $("#cmb_Zone").val(),
              district: $("#cmb_District").val(),
              sro: $("#cmb_SroName").val(),
              revenueDistrict: $("#cmb_RevenueDistrict").val(),
              revenueTaluka: $("#cmb_RevenueTaluka").val(),
              periodStart: $("#txt_PeriodStartDt").val(),
              periodEnd: $("#txt_PeriodEndDt").val(),
              convExtent: $("#txt_convExtent").val(),
              surveyRowCount: g.document.getElementById("multiAddSurvey")?.getElementsByTagName("tbody")[0]?.rows.length ?? "elem-missing",
              validateCaptcheForEc: typeof g.validateCaptcheForEc === "function" ? g.validateCaptcheForEc() : "fn-missing",
              validateFromDate: typeof g.validateFromDate === "function" ? g.validateFromDate() : "fn-missing",
              validateToDate: typeof g.validateToDate === "function" ? g.validateToDate() : "fn-missing",
            };
          } catch (e) { out.checkMandError = String(e); }
          try { out.villageDetailsValid = typeof g.getVillageDetails === "function" ? await g.getVillageDetails() : "fn-missing"; } catch (e) { out.villageDetailsError = String(e); }
          try { out.encryptPlotFlat = typeof g.encryptPlotFlat === "function" ? g.encryptPlotFlat() : "fn-missing"; } catch (e) { out.encryptPlotFlatError = String(e); }
          return out;
        }).catch((e) => ({ error: String(e) }));
        ctx.log("automation.debug", { step: "search_gate_check", attempt, gateCheck });
      }

      const searchClicked = await clickFirst(page, ["#btn_SearchDoc", "#ec-submit"]);
      // Confirmed live: a reappeared promo modal silently ate this exact click —
      // clickFirst used to report success regardless, so the worker scraped the
      // unchanged homepage and reported a false "no records found". Now that
      // clickFirst honestly reports failure, treat it as a real failure too,
      // rather than pressing on to scrape whatever's on screen.
      const offAll = () => {
        page.off("request", onRequest);
        page.off("response", onResponse);
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
      };
      if (!searchClicked) {
        burst?.stop();
        offAll();
        throw new ProviderError("portal_unavailable", "could not click Search — the button was blocked (likely a promo modal)", true);
      }
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
      postClickText = await page.locator("body").innerText().catch(() => "");
      ctx.log("automation.debug", { step: "post_search_click", attempt, searchClicked, url: page.url(), bodyTextSample: postClickText.slice(0, 400) });
      // Give it a full 30s to actually settle before deciding nothing happened
      // — confirmed live that a 3-4s window wasn't enough to say either way.
      if (burst) { await page.waitForTimeout(30000).catch(() => {}); burst.stop(); await burst.done; }
      offAll();
      ctx.log("automation.debug", { step: "captcha_check_response", attempt, responses: seenResponses });
      ctx.log("automation.debug", {
        step: "post_click_network_activity",
        attempt,
        requestCount: seenRequests.length,
        requests: seenRequests.slice(0, 20),
      });
      ctx.log("automation.debug", { step: "post_click_console_errors", attempt, errors: seenConsoleErrors });

      if (!/please enter valid captcha/i.test(postClickText)) break; // accepted (or some other outcome) — stop retrying
      ctx.log("automation.captcha_rejected", { attempt, maxAttempts: MAX_CAPTCHA_ATTEMPTS });
      if (attempt === MAX_CAPTCHA_ATTEMPTS) {
        throw new ProviderError("captcha_unrecoverable", `CAPTCHA rejected ${MAX_CAPTCHA_ATTEMPTS} times in a row (likely expiring before the answer round-trips back)`, true);
      }
    }
    // Belt-and-braces: a successful click can still land somewhere unexpected
    // (a stale CSRF token, a server-side error page, etc.) — confirmed live
    // that this specific homepage tile text shows up when that happens. Fail
    // honestly instead of scraping a page that was never a real results page.
    if (/Registration of Document/i.test(postClickText) && /Token Availability/i.test(postClickText)) {
      throw new ProviderError("portal_unavailable", "search submitted but landed back on the homepage, not a results page", true);
    }
    // When recording, settle here — right after the click, before any of our
    // own screenshot()/content() calls below compete with the video encoder
    // for the same CDP pipe. Confirmed live: placing this settle wait *after*
    // the scrape step instead (right before returning) consistently produced
    // a recording that cut off at "answer filled in, not yet submitted" even
    // though the click and scrape had both already succeeded — the dwell time
    // existed, just in the wrong place to actually get captured.
    if (cfg.recordVideoDir) await page.waitForTimeout(2500).catch(() => {});

    // 4. optional OTP
    if (await page.locator("#otp-input").count()) {
      ctx.log("automation.otp_prompt");
      const otpHint = await page.locator("#otp-value").first().textContent().catch(() => null);
      const ans = await ctx.requestHuman({ kind: "otp", context: { channel: "sms", hint: "registered mobile", _mockAnswer: otpHint?.trim() } });
      if (ans.kind !== "otp" || !ans.value) throw new ProviderError("timeout", "no OTP from operator");
      await page.fill("#otp-input", ans.value);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), page.click("#otp-submit")]);
    }

    // 5. scrape
    if (await page.locator("#err").count()) {
      throw new ProviderError("provider_error", (await page.locator("#err").first().textContent()) ?? "portal error");
    }
    const now = new Date().toISOString();
    const shot = await page.screenshot();
    // Reuse recordVideoDir as a general "debug artifacts on" signal — saves the
    // actual post-submit page as a real file, since video capture has proven
    // unreliable for this specific fast transition (confirmed live: the click
    // and its result never showed up in the recorded video, even after moving
    // the settle wait). A direct screenshot doesn't have that problem.
    if (cfg.recordVideoDir) {
      await writeFile(path.join(cfg.recordVideoDir, "post-submit-screenshot.png"), shot).catch(() => {});
    }
    let entries: import("../canonical.ts").EcEntry[];
    const extraCaveats: import("../canonical.ts").Caveat[] = [];

    const scanned = page.locator("#scanned-ec");
    if (await scanned.count()) {
      // pre-1987 record served as a scanned image -> OCR, then flag for review
      ctx.log("automation.scanned_ec");
      const src = await scanned.getAttribute("src");
      const imgUrl = src?.startsWith("http") ? src : `${base}${src}`;
      const png = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());
      const { ocrEcImage } = await import("../parse/ocr.ts");
      const ocr = await ocrEcImage(png);
      entries = ocr.entries;
      extraCaveats.push({ code: "OCR_LOW_CONFIDENCE", message: `Result read from a scanned image by OCR (confidence ${ocr.confidence.toFixed(0)}%). Every entry must be verified by an operator.` });
      await ctx.requestHuman({ kind: "ocr_review", context: { rawText: ocr.text.slice(0, 500), fields: entries.map((e) => e.rawInstrumentType) } });
    } else {
      entries = parseEcHtml(await page.content());
    }

    const { outcome, encumbrancePresent, caveats } = deriveOutcome({ entries, periodFrom: req.period.from, nilHumanVerified: false, extraCaveats });

    return {
      schemaVersion: "1.0",
      search: { type: req.searchType, property: { ...req.property }, period: req.period, performedAt: now },
      outcome,
      encumbrancePresent,
      entryCount: entries.length,
      entries,
      documents: [],
      caveats,
      provenance: {
        source: "automation",
        sourceReference: null,
        certified: false,
        retrievedAt: now,
        operatorId: "operator",
        // A reference, not an embedded image — matches every other provider's
        // convention (see automation.ts, mock.ts). The previous version here
        // truncated a base64 PNG to 24 characters, producing a value that
        // wasn't a real reference *or* a usable image — same class of bug as
        // the CAPTCHA-image truncation fixed the night before.
        rawArtifactRefs: [`automation://post-submit-screenshot/${ctx.requestId}.png`],
      },
      disclaimer: EC_DISCLAIMER,
    };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("portal_unavailable", `automation worker failed: ${(err as Error).message}`, true);
  } finally {
    // context.close() must happen before browser.close() — it's what flushes
    // and finalizes the recorded .webm file, if recording was enabled.
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

function isoToDmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
