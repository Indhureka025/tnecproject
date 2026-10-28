# QA report — EC Service

**Tester:** Claude (automated + tool-driven + exploratory pass, pro-QA style)
**Date:** 11 September 2026
**Build:** branch `feature/phase-0-1-mvp`, through Phase 4
**Environment:** Windows 11, Node 22.13. Service run in-memory *and* on Postgres (PGlite). Playwright + Chromium for the browser flows. tesseract.js for OCR.
**Verdict:** ✅ **All suites green.** 1 defect found & fixed (DEF-1), 4 observations logged (none blocking). `AI VERIFIED` — a human click-through is still required before `SIGNED OFF`.

---

## 1. Test inventory

| Suite | Tool | Checks | Result | Run with |
|---|---|---|---|---|
| Unit + integration | Vitest (`service/test/`) | 50 | ✅ | `cd service && npm test` |
| API black-box (functional / negative / security / boundary / webhook / perf / rate-limit) | custom runner | 31 | ✅ | `node verification/qa/run-e2e.mjs` |
| Browser UI (dashboard, operator console, demo client) | Playwright | 16 | ✅ | `node verification/qa/ui-tests.mjs` |
| Browser automation E2E (vs mock TNREGINET portal) | Playwright | 15 | ✅ | `node verification/qa/automation-e2e.mjs` |
| ERP integration contract (vs mock ERP receiver) | custom | 13 | ✅ | `node verification/qa/erp-contract.mjs` |
| OCR (scanned EC → text → entries) | Playwright + tesseract.js | 5 | ✅ | `node verification/qa/ocr-test.mjs` |
| Load (sustained concurrent submit) | custom | pass | ✅ | `node verification/qa/load-test.mjs` |
| **Total** | | **130 + load** | ✅ | |

## 2. Coverage by area

### 2.1 Persistence & queue (Phase 2)
- **Postgres store** (PGlite): create / read / update with append-only audit trail; idempotency-key lookup; dedupe window query. Full request lifecycle end-to-end on `BACKEND=postgres` — audit rows and job rows verified in the DB.
- **Durable queue**: enqueued job runs and is marked `done`; failing job retries with exponential backoff then `failed`; a job whose lease expired (simulated crashed worker) is re-leased; delayed jobs are not picked up early.
- **Object storage** (memory + local-fs): content-addressed keys, SHA-256, HMAC-signed time-limited URLs; expired / tampered tokens rejected.
- **Rate limiting**: per-tenant; 429 + `Retry-After` after the limit; independent per tenant.
- **Load**: 21k requests / 12s at 25 concurrent, p50 13 ms / p99 35 ms, 0 errors, queue fully drained, ~42k webhooks delivered.

### 2.2 Master data (Phase 2)
- All **595 SROs across 11 zones** loaded; `resolveUnit` matches by name (case/punctuation-insensitive), applies zone aliases (Thanjavur→Tanjore …), and when an SRO is real but in the wrong zone the error names the right one; unknown SRO → clean `unresolvable` failure.

### 2.3 Browser automation (Phase 3) — vs the mock TNREGINET portal
- Login + login-CAPTCHA (HITL) → EC search form fill (cascading selects + text fields) → search-CAPTCHA (HITL) → **OTP branch** (HITL) → results scrape → `parseEcHtml` → canonical result + screenshot artifact.
- Entries found (2 scraped, parties + amounts + dates), nil result (`NIL_UNCONFIRMED`, `encumbrancePresent: null`), OTP path all verified.
- **Scanned pre-1987 EC**: results served as an image → downloaded → OCR (tesseract.js, ~92% confidence) → rough entry extraction → `OCR_LOW_CONFIDENCE` caveat + `ocr_review` HITL task.
- CAPTCHA/OTP are **never solved automatically** — each opens a HITL task with a screenshot.

### 2.4 Certified EC async flow (Phase 4)
- `certified: true` → provider retrieve → **payment** HITL task → status `awaiting_signature` + `ec.awaiting_signature` webhook + `estimate: {type: "days"}` → (simulated SRO signing delay) → re-entrant job completes it → signed copy delivered as an `ec_pdf` document with a `CERTIFIED_COPY_SIGNED` caveat.
- Payment declined → `failed / payment_required`.

### 2.5 ERP integration contract (Phase 4) — vs the mock ERP receiver
- Event ordering: `ec.received` first, then `ec.completed` / `ec.partial` / `ec.failed`.
- **Every delivery carries a valid HMAC-SHA256 signature** (verified by the mock ERP with the shared secret; bad signatures rejected — 0 rejections in the happy path).
- Signed document downloads via the URL in the webhook payload; a tampered token → 403.
- `GET /v1/ec-requests/{id}` (polling fallback) agrees with the webhook payload.
- `reference` echoed on every event.

### 2.6 The 5 dashboard manual test cases — all executed
| ID | Case | Result |
|---|---|---|
| TC1 | Submit → structured `ENTRIES_FOUND`, mortgage entry, disclaimer, downloadable summary | ✅ |
| TC2 | Automation CAPTCHA → operator answers → job continues (now completes against the mock portal) | ✅ |
| TC3 | Unknown SRO → `failed / unresolvable`, lists valid offices, not retryable | ✅ |
| TC4 | No records, unverified → `partial / NIL_UNCONFIRMED`, `encumbrancePresent: null` (never `false`) | ✅ |
| TC5 | Identical informational request → served from cache; certified never deduped | ✅ |

### 2.7 Negative / security / boundary (unchanged, still green)
Auth (401 no/wrong token), bad input (400 not 500 for malformed JSON, missing fields, `from > to`, bad `searchType`, empty body, **impossible calendar dates** — DEF-1 fix), idempotency (200 replay / 409 conflict / no race on concurrent dupes), injection string handled, 20 KB field rejected, `reference` cap, `PERIOD_GAP` for pre-1975.

## 3. Recorded walkthrough

Screen recording of a live manual-test session (`verification/qa/video/manual-test-walkthrough.{webm,gif}`): dashboard tour → Manual Test Client running TC1 / TC4 / TC3 / invalid-date → CAPTCHA operator handoff → job completes. Regenerate: `node verification/qa/record-walkthrough.mjs`.

## 4. Defects & observations

### DEF-1 — Impossible calendar dates accepted · Medium · **FIXED**
`period` was validated by regex shape only, so `2024-13-45` / `2023-02-29` passed. Fix: `contract.ts` now round-trips the date through `Date`. Regression tests added. Re-verified → 400 `"not a valid calendar date"`.

### OBS-1 — `GET /v1/ec-requests/{id}` is not tenant-scoped · Low · Open
Authenticates the caller but doesn't check the request belongs to that tenant. Moot with one tenant; scope reads before multi-tenant go-live.

### OBS-2 — Automation against the *real* portal is unverified · Not a defect
The worker is proven end-to-end against the mock portal. The real `tnreginet.gov.in` is geo-restricted to India and needs a registered account; `poc/SELECTORS.md` is the lock-down checklist for that run.

### OBS-3 — Long-running E2E harness needs a high rate limit · Fixed (test infra)
`submitAndWait` polls frequently; against one shared service instance the poll traffic tripped the per-tenant rate limit and starved a request. Test harness now sets `RATE_LIMIT_MAX` high; the feature itself is covered by RL1.

### OBS-4 — Dashboard PASS boxes are pre-filled · Low
Backed by this run, but a human should still click through before `SIGNED OFF`.

## 5. Not covered (needs external access)

- Real Landeed / SurePass API responses — needs a vendor sandbox key.
- The automation worker against the **real** TNREGINET host — needs an India-hosted runner + a real account.
- A real managed Postgres / Redis cluster under production load (PGlite proves the SQL and logic; not a perf substitute).
- Real payment-gateway integration for certified ECs (the flow + state machine are proven with a mock payment step).

## 6. How to re-run everything

```bash
cd service && npm test
cd ..
node verification/qa/run-e2e.mjs
node verification/qa/ui-tests.mjs
node verification/qa/automation-e2e.mjs      # spawns the mock TNREGINET portal
node verification/qa/erp-contract.mjs        # spawns the mock ERP receiver
node verification/qa/ocr-test.mjs
node verification/qa/load-test.mjs --duration 12 --concurrency 25
# cleanup if a run is interrupted:
powershell -ExecutionPolicy Bypass -File verification/qa/kill-orphans.ps1
```
