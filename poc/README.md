# TNREGINET EC — POC scaffold

A diagnostic Playwright script for the "Search & View EC" flow on tnreginet.gov.in.
It is **not** a product and **not** an unattended scraper — it pauses for a human
at the CAPTCHA (and OTP) because that is the point the assessment is making.

## Run it

```bash
npm install                       # installs Playwright + Chromium
cp config.sample.json config.json # then edit: YOUR OWN sample property details
npm run ec:search
```

A headed Chromium opens and walks the flow. When it reaches the CAPTCHA it saves
the CAPTCHA image to `./artifacts/` and waits for you to type the code in the
terminal. Every step also drops a screenshot; any failure dumps the page HTML.

## Important preconditions

- **Run from India.** The portal may refuse or degrade non-India connections.
- **Portal navigation and EC selectors.** The portal renders the homepage first,
  then opens "Search/View EC" through its client-side navigation. The POC follows
  that link, switches a fresh session to English, dismisses promo overlays, and
  uses the confirmed EC form IDs. The portal can still change its UI; if a step
  fails, inspect the `FAIL__*.html` dump and screenshot.
- **Survey fields are separate.** Enter the survey number and subdivision in
  their own fields (for example, survey `123` and subdivision `4`), not as
  `123/4` in the survey field. Update your local `config.json`; the sample
  values are only examples and may not identify a real property.
- **Dates use `DD/MM/YYYY` in `config.json`.** The script sets dates through
  the portal's date-picker plugin, then checks that each field contains the
  requested date. If the portal rejects a date or the picker changes it, the
  form step fails instead of continuing with a different date.
- **Anonymous vs logged-in.** With `run.stopBeforeLogin: true` the script searches
  without an account (the full EC PDF may require login). Set it to `false` and
  fill `account` to exercise the login + OTP path. Set `run.downloadPdf: false`
  to stop after reaching the results page without attempting a PDF download.

## What each step is checking

| Step | Purpose | Expected blocker |
|---|---|---|
| `openPortal` | reachability, maintenance detection | geo-block / maintenance window |
| `maybeLogin` | account + OTP handling | Indian-mobile OTP, per-session CAPTCHA |
| `chooseSearchType` | verifies the EC-wise search form is active | unsupported search type |
| `fillSearchForm` | cascading zone→district→SRO→village dropdowns, survey row, calendar dates | slow cascade, stale options |
| `submitAndCollect` | human CAPTCHA entry and result page | **CAPTCHA (human input required)**, portal/rate-limit response |

## Output

Everything lands in `./artifacts/`:
- `*__NN-step.png` — per-step screenshots
- `*__captcha-*.png` — the CAPTCHA image handed to the operator
- `*__FAIL__*.html` / `*__FAIL__*.png` — diagnostics on failure
- `*__EC.pdf` — the downloaded informational EC, if the run completes
- `*__run-summary.json` — machine-readable step outcomes

The sample config sets `run.downloadPdf` to `false`; this stops after reaching
the results page and does not attempt a PDF download.
