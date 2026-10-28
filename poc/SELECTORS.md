# TNREGINET selector lock-down

`poc/ec-search.mjs` ships with **candidate** selectors from public documentation.
The portal is geo-restricted, so they were never verified against the live DOM.
This is the checklist to finish that, from an India IP.

## Procedure

1. From an India machine, open <https://tnreginet.gov.in/portal/> in a normal browser.
2. Register a test Citizen account (needs an Indian mobile for OTP). Record the
   credentials in the secrets manager, not here.
3. Go to **E-Services → Encumbrance Certificate → Search & View EC**.
4. Open DevTools. For each field below, copy the real `id` / `name` / stable
   selector and replace the candidate array in `ec-search.mjs`.
5. Run `npm run ec:search` with `config.json` pointing at a known test property.
   On any failure the script writes `artifacts/*FAIL*.html` — read the real markup
   from there.

## Fields to confirm

| Step in `ec-search.mjs` | What to capture |
|---|---|
| `openPortal` | exact URL/path for the EC search view (the `actionVal=` param) |
| `maybeLogin` | login link, `#username`, `#password`, login CAPTCHA `<img>`, submit button, OTP field |
| `chooseSearchType` | the control for EC-wise vs Document-wise vs Plot/Flat/Ward-Block-wise (radios? tabs?) |
| `fillSearchForm` | `select` elements for zone / district / SRO / village; the AJAX that cascades them (and how long it takes); date inputs (format? datepicker widget?); survey no / subdivision inputs |
| `humanCaptcha` | CAPTCHA `<img>` selector, refresh button, the answer `<input>` |
| `submitAndCollect` | Search button; any submit-time OTP field; results table selector; the "download PDF" link; the "no records" message text/element |

## Known unknowns

- Whether the CAPTCHA is plain image, audio-enabled, or has changed to a widget.
- Rate-limiting thresholds — throttle test runs.
- Certified-EC ("Apply") flow selectors — separate lock-down, includes the payment gateway
  and its own account-lock/session quirks (see below).
- Exact element `id`s for the search form and CAPTCHA — confirmed reachable (below), but
  the raw HTML still hasn't been captured; screenshots + column headers only so far.

## Confirmed live (12 Sep 2026, real account, WARP/VPN off)

Superseding the "known unknowns" this replaces — these are no longer guesses:

- **"Search & View EC" (the free path) loads and is fully fillable with no login at
  all** — zone/district/SRO/village cascading selects, survey/document search modes.
  The header still shows unused Login/Register buttons at this point.
- **A logged-in property/document search does not land directly on an EC entries
  table.** It first resolves to a **document-index result** — one or more matching
  registered documents (document number, SRO, registration district, registration
  village, survey/sub-division numbers, property type) — each with an **"Apply
  Online"** action. Real example captured and now in the codebase as
  `service/src/parse/__fixtures__/ec-document-match.html`, parsed by
  `parseDocumentMatchTable()` in `service/src/parse/ec-html.ts`.
- **"Apply Online" here means requesting the certified/signed copy** (paid,
  Sub-Registrar-signed, days-long) — it is **not** re-registering the property and
  does not resubmit any document. The free instant view is a separate action from
  this same result row; exactly which link/button gives the free view directly
  is still unconfirmed — next thing to check.
- **The registration village name is not reliably guessable from a layout map or
  deed excerpt.** A real search on a real property returned "Kullamanaickenpatti"
  where a geography-based guess from the surrounding documents had said
  "Kullampalayam" — close, but wrong. Only the portal's own index has the
  authoritative village name.
- **A survey number printed on an old deed (e.g. "11/4") often no longer matches
  the current sub-division numbering** the portal indexes against (the same
  property came back as `11/1A1, 11/41A1A1A1, 11/47A1A1A1A, 11/4A1A1, 12/1A1A1A1A,
  12/2G1A1A1A`). A real "Search & View EC" run should search a *range* of related
  sub-divisions, not assume the deed's original number still resolves directly.
- **The homepage's "Presence Less Registration" promo modal reappears on most
  navigations/reloads**, including over the login popup — has to be dismissed
  (its close `×` button) before interacting with whatever is underneath. This is
  a real UX obstacle for a naive automation script, independent of CAPTCHA/OTP.
- **Account lockout is a real, distinct failure mode**, separate from wrong
  password: a login can return "account is locked, try after some time" for a
  password/username that's otherwise correct, likely triggered by an earlier
  interrupted registration (see the JS-crash note above). The login popup has
  three separate recovery links — Unlock Account, Forgot Username, Forgot
  Password — and only the first is relevant to a locked-account error; the
  latter two additionally require the *exact* mobile number on file (not email),
  in the exact format it was stored in.

## Confirmed live (12 Sep 2026, second session) — full free search cycle, no login

Ran the whole "Search & View EC" flow end to end against the real portal with no
account at all, and captured the real element ids (now wired into
`service/src/providers/automation-worker.ts` as the primary selectors, mock-portal
ids kept as fallbacks so both keep working):

- **No stable URL for this screen.** The homepage link "Search/View EC" (footer,
  under Online Services) drives a client-side AJAX swap — the address bar keeps
  showing the homepage's `actionVal=homePage` throughout. `page.goto()` to a
  guessed URL doesn't work; you have to click the link.
- **Real element ids, all human-readable** (not JSF-mangled as feared):
  `#cmb_Zone`, `#cmb_District`, `#cmb_SroName`, `#cmb_Village` (selects, cascading
  — see below), `#txt_SurveyNo`, `#txt_SubDivisionNo` (plain inputs),
  `#txt_PeriodStartDt` / `#txt_PeriodEndDt` (date inputs), `#btn_AddSurvey`,
  `#btn_SearchDoc`, `#btn_ResetForm`, `#txt_Captcha` (input), `#captcha` (the
  actual `<img>` — matches the automation worker's existing generic
  `img[id*="captcha" i]` fallback with no code change needed there).
- **Zone -> District -> SRO -> Village is a real cascading AJAX chain** (each
  fires a `POST .../loadDistrictCombo?...&comboValue=<parentValue>` and the
  child `<select>` only gets its options ~1s later). A tool that sets a select's
  value without dispatching a real change event won't trigger it — worth knowing
  if a future automation approach isn't Playwright's own `selectOption`.
- **Survey No. and Subdivision No. are separate fields that reject a combined
  value.** Typing the old deed's `11/1A1` into one box fails silently
  ("Only numbers are allowed") — it has to be split into Survey No. `11` +
  Subdivision No. `1A1`. Confirms and sharpens last session's finding about old
  survey numbers not matching current sub-division numbering.
- **The CAPTCHA doesn't exist until you click "Add"** to register the survey
  detail as a row (the form supports adding several rows — the multi-sub-division
  search the earlier note recommended). Screenshotting for CAPTCHA before this
  point captures whatever else is on the page, not a CAPTCHA — this is exactly
  what produced an unreadable/wrong image in the very first live automation
  attempt tonight, since the worker's assumed `/portal/ec-search` URL doesn't
  exist on the real portal and it silently continued on the wrong page.
- **Date fields didn't accept plain typed input** in manual testing (value stuck
  only after using the built-in calendar widget: click the field, click the
  month/year header to jump to a month directly, click the day) — unconfirmed
  whether Playwright's `page.fill()` behaves differently (it often does, being a
  lower-level input mechanism than synthetic keystrokes); the worker tries
  `fill()` first and this needs a live check.
- **A real, successful, login-free cycle completed**: Zone=Salem,
  District=Salem West, SRO=Omalur, Village=Kullamanaickenpatti, Survey 11 / Sub
  1A1, a 10-day date window, real CAPTCHA solved by a human operator, real
  result: "No Documents registered during the Search Period." (a true nil result
  for that narrow window, not a bug) — proving the whole chain works end to end
  when pointed at the real ids.

## Confirmed live (12 Sep 2026, third session) — the automated worker's first real end-to-end run

Wiring in the ids above wasn't enough on its own: the very first automated
(headless Playwright) run against the real portal still produced a garbled
CAPTCHA capture, same as the very first manual one had. Root-caused with a
standalone diagnostic script rather than guessing — two real, distinct bugs,
both now fixed in `automation-worker.ts`:

- **A fresh session renders the whole page in Tamil by default.** Every English
  text/selector match (the "Search/View EC" link included) silently finds
  nothing until the page's own "English" link (`a[href*="changeLanguage('en')"]`)
  is clicked. A manual walkthrough never hits this because a human's browser
  profile already carries the language choice from an earlier session — an
  automated worker starting cold always sees Tamil first.
- **A second promo modal exists** (`id="MobileAppModal"`, distinct from the
  "Presence Less Registration" one already handled) that blocked a click on a
  first-time/cookie-less session. Rather than special-casing another modal by
  name, `dismissPromoModal()` now also force-removes any `.modal.show` /
  `.modal-backdrop` left standing after the close-button attempt — a promo
  overlay is never something the flow needs to interact with, so this should
  hold for whatever the next one turns out to be called.
- Also fixed in the same pass: the login-branch check was `if (#username
  exists)`, but `#username` exists in the real page's DOM from load (hidden
  behind a header toggle) regardless of whether login is actually needed —
  meaning the worker was *always* taking the login branch on the real portal.
  Checking `isVisible()` instead means it only logs in when a portal (like the
  mock) presents the field up front, matching what's actually confirmed: this
  free search needs no account at all.
- Diagnosed via a disposable standalone Playwright script rather than
  instrumenting the real request path first — much faster to iterate (dump
  `navigator.webdriver`, `page.content()`, live link lists) without waiting on
  the queue/HITL round trip each time.
- **Result: a fully autonomous run, end to end**, live: page load -> language
  switch -> both promo modals cleared -> "Search/View EC" clicked -> Zone(5) ->
  District(20030) -> SRO(20387:1) -> Village(16094) cascaded and set -> Survey
  11 / Sub 1A1 added -> a real CAPTCHA rendered in the operator console -> a
  human solved it -> outcome `NIL_UNCONFIRMED`. No manual click-through needed
  anywhere in this run. **Correction below: this "0 entries" outcome turned out
  to be unreliable, not confirmed-genuine — see the next section.**

## Correction (12 Sep 2026, later the same night) — the "0 entries" results above were not verified genuine

Added a debug line logging the page's own text immediately after the Search
click. It showed the **homepage**, not a results page, on every run checked —
including one where the human answered within 38 seconds (ruling out a
session/CSRF-timeout explanation). `clickFirst()` was also found to report
"click succeeded" whenever an element merely *existed*, regardless of whether
the click itself threw — so a blocked click was invisible. Fixed both:
`clickFirst()` now clears any reappeared promo modal and retries once before
honestly reporting failure, and the worker fails loudly (`portal_unavailable`)
if the click didn't land or the post-click page still reads as the homepage,
instead of silently scraping whatever's on screen.

That fix did **not** resolve it — a fresh live check after applying it still
landed on the homepage with the click reporting success. A follow-up
standalone diagnostic script (bypassing the queue, to test the actual
government site directly) then hit a *different* failure: clicking "Search/View
EC" itself stopped reliably reaching the search form at all, with no modal and
no error — just an empty homepage. That happened after roughly 15-20+ full page
loads against tnreginet.gov.in from this machine within a couple of hours
(automated runs plus standalone diagnostic scripts stacked back to back).

**Working theory, not confirmed**: the site may be quietly rate-limiting or
flagging repeated automated traffic from one IP, rather than this being a pure
code bug. Deliberately stopped further live testing rather than keep hammering
the real portal to chase it down further tonight.

**Honest status as of now**: the free-search flow's *setup* (login-skip,
navigation, cascading dropdowns, Add step, real CAPTCHA rendering) is solidly
proven across many live runs. Whether the final Search submission reliably
reaches a genuine results page is **unconfirmed** — every `NIL_UNCONFIRMED`
result produced tonight after this was discovered should be treated as
unverified, not as evidence of a real "no records" outcome. Next real test
should happen after a cooldown period, with a single well-spaced attempt
rather than rapid repeated ones, before trusting this path again.

## Follow-up (12 Sep 2026, same night) — a real captured example, and a fix that's still incomplete

One more recorded run (with the request user answering as fast as possible)
finally caught the real behavior on video: after submitting, the page showed
**"Please Enter Valid Captcha"** with a freshly-regenerated code — not a
homepage redirect. This is a normal, expected rejection message, not a broken
page. Best explanation: the round trip from "operator sees the screenshot" to
"answer is typed, submitted, and the page reacts" easily runs 20-40+ seconds
through this HITL console, and a real-world government CAPTCHA commonly has a
much shorter validity window specifically to defeat this pattern — a human
answering it live and immediately doesn't hit this at all, which matches every
successful manual walkthrough earlier tonight.

Fixed: the worker now retries up to 3 times, taking a *fresh* screenshot each
time, when it detects "Please Enter Valid Captcha" on the page — tested for
real via a new mock-portal scenario (survey number starting `RETRY`) that
forces exactly one rejection before accepting. The operator console also now
shows a live elapsed-time counter next to the CAPTCHA image (turns amber past
30s) so it's visible how much of that window has already been used.

**This did not fully close the loop.** A live retest after shipping the fix
hit a *third* variant: the post-click page read as a plain homepage-like
response — not the "Please Enter Valid Captcha" text the retry logic looks
for, and not matching the existing homepage safety-check either (which needs
two specific homepage phrases both present, and apparently they don't always
render into `innerText()` the same way). So the retry never triggered, and a
false NIL_UNCONFIRMED slipped through again. The detection needs broadening —
ideally a positive check for something that only ever appears on a genuine
results page (e.g. "Data Availability Period", "No Documents registered",
an actual results table), rather than trying to enumerate every way a
rejected/expired submission can look. Left as a known gap rather than guessed
at further tonight, given how many live hits this portal has already taken in
one evening.

## Sharper finding (still 12 Sep 2026) — the click may not be visibly doing anything at all

Wanted proof of what the page looks like right after the Search click, for a
human to review. Video recording turned out unreliable for this specific
moment — even after moving the settle-wait to fire immediately after the
click (rather than after the later scrape/parse work), the recorded video
still consistently cut off at "CAPTCHA answer filled in, Search button still
showing," never capturing the click's effect. Two separate fix attempts, same
result — this looks like a real limitation of Playwright's video encoder for
this fast a transition, not a wait-placement problem.

Stopped fighting the video and instead saved a **direct `page.screenshot()`**
to disk from deep in the worker's own "scrape" step — taken well after the
click, the retry-loop's rejection check, a 2.5s settle, and the OTP check.
That screenshot (not video — no encoder involved) showed **the exact same
thing**: the pre-submit form, CAPTCHA still filled in, Search button still
sitting there. Two independent capture methods now agree: as far as we can
tell, **clicking "Search" does not visibly change the page at all**, within
any window we've waited.

This reframes the whole night's mystery. It's no longer obviously about a
CAPTCHA expiring after being screenshotted for the operator — it may be that
the click on `#btn_SearchDoc` isn't actually triggering a real form
submission in the first place (wrong element behind an invisible overlay, a
JS handler that needs a different event sequence than Playwright's synthetic
click produces, etc.). **Not confirmed** — next real step, without touching
the live portal again tonight, is to listen for whether a network request
actually fires on click (`page.on('request', ...)`) to tell "click did
nothing" apart from "click worked but the response is genuinely this page."
Also fixed in the same pass: `rawArtifactRefs` was truncating a base64
screenshot to 24 characters (the exact same bug class as the CAPTCHA-image
truncation from the night before) — now a proper reference string, matching
every other provider's convention.

## Correction to the above — the "homepage" reads were a red herring, not a real redirect

Built a proper video of the click moment (see below) and, checking it against
the same run's debug log, noticed the `bodyTextSample` that had been read all
night as "landed on the homepage" is just the site's **universal header**
("Hon'ble Chief Minister of Tamil Nadu... About Us / Services / Help...") —
present at the top of *every* page on this site, the real search form
included. Logging only the first 400 characters of `body.innerText()` means
that header dominates the sample regardless of which page is actually
loaded. So "it bounced to the homepage" was never actually proven — that was
this session's own misreading of a page-detection check, not a finding about
the portal's behavior. The `Registration of Document` + `Token Availability`
homepage safety-check added earlier tonight is unaffected (it checks the full
text, not a 400-char slice) and should be kept; the `bodyTextSample` debug
field should not be trusted as a "which page is this" signal on its own.

What's still true, though, and now confirmed a *third* independent way: a
rapid screenshot burst captured continuously across the actual click (not
sampled once before/after, but a real sequence spanning the whole moment,
assembled into an actual video) shows **no visible change on screen for the
full ~4-second window** the burst covered. That's the real, narrower, better-
evidenced finding to chase next — not "it redirects to the homepage," but
"the click may not be producing any visible effect at all."

## Root cause found (12 Sep 2026, same night, much later) — and a fix that's close but not correct yet

Chased this all the way down with real evidence at every step rather than
more guessing:

1. **The click does fire a real network request** — exactly one, to
   `actionVal=checkCaptcha`, confirmed via `page.on('request', ...)`.
2. **That request succeeds** — response body is literally `##true`,
   confirmed by reading the actual response, not inferring from page text.
3. Two follow-up theories (a timing race with that async check; a silent JS
   exception in a success callback) were both tested directly and ruled out —
   zero console/page errors, and a deliberate pause before clicking made no
   difference.
4. **Read the Search button's own onclick source directly** rather than guess
   a fourth theory. It's `searchDocDtlsYearWise()`, an async function whose
   real search logic only runs past three sequential gates:
   `checkMandSearchDocYearWise()` → (async) `getVillageDetails()` →
   `encryptPlotFlat()`. Any one returning falsy makes the function return
   silently — no error, no request, nothing visible. This is the actual
   mechanism behind every "nothing happens" result from earlier tonight.
5. Called each gate directly: `checkMandSearchDocYearWise()` is the one that
   fails. Reading every individual condition it checks (rather than trusting
   just the boolean) found it precisely: **`#txt_PeriodStartDt` and
   `#txt_PeriodEndDt` were empty strings.** Zone/District/SRO, the survey row,
   Conveyed Extent, and all three `validate*()` calls were fine. The
   `#cmb_RevenueDistrict`/`#cmb_RevenueTaluka` fields I'd initially suspected
   from the function's source (added later per a `pragnesh-7896` code comment)
   turned out not to even exist in this form mode — a dead end, not the cause.
6. **The actual bug**: `page.fill()` on these two date fields opens the bound
   calendar widget (a focus side effect) but never sets a value the site's own
   validation reads as non-empty — exactly the risk flagged, then not followed
   up on, several hours earlier the same night.

**Fix attempted**: `pickDate()` — click the field, use the picker's "Today"
button when the target is today, otherwise step month-by-month via the
picker's own Prev/Next controls until the header shows the target month/year,
then click the target day cell.

**Live result: partial.** EC Start Date went from empty to `01-Sep-2026`
(some value now — the day-cell click works) but that's the *wrong* date; the
target was `01-Jan-2020`, meaning the Prev-button month-stepping loop isn't
actually navigating — it likely breaks on the very first iteration without
moving because its header-text locator (`text=/^[A-Za-z]+\s+\d{4}$/`) isn't
reliably matching the calendar's actual header element. EC End Date (target:
today) stayed completely empty, meaning the "Today" button click
(`getByText("Today", { exact: true })`) isn't landing either — quite possibly
the same class of selector-matching issue.

**Next step, not attempted tonight**: capture the calendar picker's actual
DOM (class names for the header, the Prev/Next/Today controls, and day
cells) directly, the same way the button's own onclick source was pulled
earlier — rather than guess at selectors again. The mechanism (drive the
picker instead of `fill()`) is now confirmed correct in principle; only the
specific selectors used to drive it need fixing.
