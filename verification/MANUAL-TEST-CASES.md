# Manual test cases — TN EC Integration

Plain-language, step-by-step test cases a non-technical tester can run by hand, easiest via the [manual test client](../service/public/demo). This is the detailed version behind the numbers shown on the [dashboard](../service/public/dashboard.html); the technical record (which suite covers each one, file/function references) is in [`QA-REPORT.md`](QA-REPORT.md).

`AI VERIFIED` below means the automated suite confirms it and Claude ran it — still pending a human click-through before final sign-off.

---

## TC1 · Submit a property and get an EC result back
**Task:** EC Service — request intake & result delivery
**What this checks:** the ERP can ask for an EC and receive a structured answer without anyone touching the government portal.

1. Start the service: in the `service` folder run `npm install` then `npm run dev`.
2. Send a test request (copy the `curl` command from `service/README.md`) with a sample property: Chennai zone, SRO "Thiruvottiyur", village "Thiruvottiyur", survey number "123/4", dates 2004–2024.
3. Note the `requestId` that comes back.
4. Ask for the status: `GET /v1/ec-requests/<requestId>`.

**What you should see:** First response: `status: "queued"`. Within a few seconds the status becomes `"completed"` with a result that lists one mortgage entry, an `encumbrancePresent: true` flag, and a plain-English disclaimer that an EC is not proof of ownership.

**Result:** ✅ PASS — `AI VERIFIED`

<details><summary>Technical detail</summary>

```
Covered by test/lifecycle.test.ts →
  "completes with ENTRIES_FOUND when the survey number triggers an entry"
Path: POST /v1/ec-requests → MemoryQueue → pipeline.run →
  masterdata.resolveUnit → ProviderRouter → MockProvider → store.update → webhook ec.completed
The mock provider returns an entry when the survey number contains "4".
Replace MockProvider with the Landeed adapter once sandbox keys exist.
```
</details>

---

## TC2 · An operator clears a CAPTCHA the worker got stuck on
**Task:** Human-in-the-loop — operator console
**What this checks:** when automation hits a CAPTCHA, a person can solve it and the job continues — the job is never silently failed.

1. Start the service with the operator mode on: set `HITL_MODE=console` and `PROVIDER_ORDER=automation` in `.env`, then `npm run dev`.
2. Open the operator console (`/public/console.html`) in a browser.
3. Send a test EC request (as in TC1).
4. Watch the console — a "captcha" task appears. Type any text and click **Submit**.

**What you should see:** The task disappears from the console after you submit. The request's status briefly showed `needs_human` and a `ec.needs_human` webhook was sent; after you answer it moves on (and then reports the portal isn't reachable, which is expected outside India — see note).

> The browser-automation worker itself is a later phase and the TNREGINET portal is geo-blocked outside India, so the run ends with a clear "portal unavailable" — the point of this test is the human handshake, which works.

**Result:** ✅ PASS — `AI VERIFIED`

<details><summary>Technical detail</summary>

```
Covered by test/lifecycle.test.ts → "goes through needs_human ..." and test/router.test.ts.
HITL model: src/hitl/*. Console API: GET /ops/tasks, POST /ops/tasks/:id/answer.
AutomationProvider opens a 'captcha' task via ctx.requestHuman(), waits up to 15 min,
then (no worker deployed) throws ProviderError("portal_unavailable").
```
</details>

---

## TC3 · A wrong Sub-Registrar office is rejected clearly
**Task:** EC Service — input validation
**What this checks:** bad location details fail fast with a helpful message, instead of a confusing error later.

1. With the service running, send an EC request but set the SRO to `NOPE-999`.
2. Check the request status.

**What you should see:** Status becomes `failed` with reason `unresolvable` and a message listing the SRO offices that *are* known for that district. A `ec.failed` webhook is sent.

**Result:** ✅ PASS — `AI VERIFIED`

<details><summary>Technical detail</summary>

```
Covered by test/lifecycle.test.ts → "fails with 'unresolvable' for an unknown SRO"
and test/masterdata.test.ts. Master data is a PARTIAL seed
(src/masterdata/tn-registration-units.json) — needs a full SRO list before Phase 1.
```
</details>

---

## TC4 · "No records" is never reported as "clean title"
**Task:** EC Service — result correctness
**What this checks:** a safety check — an empty EC result must not be turned into "this property is clear" without a human confirming the search was done right.

1. Send an EC request with survey number "777" (the mock returns nothing for it).
2. Check the result.

**What you should see:** Status `partial`, outcome `NIL_UNCONFIRMED`, `encumbrancePresent: null` (not `false`), and a caveat saying it has not been confirmed by an operator. The ERP must treat this as "needs review", not "clean".

**Result:** ✅ PASS — `AI VERIFIED`

<details><summary>Technical detail</summary>

```
Covered by test/lifecycle.test.ts → "returns partial + NIL_UNCONFIRMED ..."
and test/parse.test.ts. Logic in src/canonical.ts → deriveOutcome().
Pre-1975 periods return outcome PERIOD_GAP with the same protection.
```
</details>

---

## TC5 · The same lookup twice is served from cache
**Task:** EC Service — de-duplication / cost control
**What this checks:** we don't pay a provider twice for the identical search within a short window.

1. Set `DEDUPE_WINDOW_DAYS=14` in `.env` and start the service.
2. Send an EC request for survey "123/4" and wait for it to complete.
3. Send the *same* request again with a different Idempotency-Key.

**What you should see:** The second request completes almost instantly with the same result, and the logs show a `dedupe_hit` referencing the first request. Certified-EC requests are never de-duplicated.

**Result:** ✅ PASS — `AI VERIFIED`

<details><summary>Technical detail</summary>

```
Covered by test/lifecycle.test.ts → describe("dedupe").
Param hash in src/util/hash.ts (ignores callbackUrl / reference). Window from config.dedupeWindowDays.
```
</details>

---

## TC6 · Nothing is lost if the service restarts mid-job
**Task:** Production infra — database & queue
**What this checks:** requests and their history survive a crash — they live in a real database, and half-finished jobs get picked up again.

1. Start the service in database mode: set `BACKEND=postgres` and start it (`docker compose up` brings up the database too).
2. Send an EC request; note the `requestId`.
3. Ask for the status and check it completed.

**What you should see:** The request completes as normal. In the database, the `ec_requests` row and an `ec_request_audit` trail (received → in progress → completed) are there, and the job row shows `done`. If the service is killed while a job is running, another instance re-runs it — nothing is dropped.

**Result:** ✅ PASS — `AI VERIFIED`

<details><summary>Technical detail</summary>

```
Covered by test/backend-postgres.test.ts (8) + test/backend-e2e.test.ts (3).
PostgresRequestStore + PostgresQueue on PGlite; schema in src/db/schema.sql.
Queue uses FOR UPDATE SKIP LOCKED + lease expiry for crash recovery.
```
</details>

---

## TC7 · The robot logs in, fills the form, clears CAPTCHA/OTP, and reads the result
**Task:** Browser automation — the fallback route
**What this checks:** the automation worker end to end. The real TNREGINET portal is blocked outside India, so this runs against a stand-in copy that behaves the same way.

1. Start the stand-in portal: `node verification/mock-portal/server.mjs`.
2. Run `node verification/qa/automation-e2e.mjs`.

**What you should see:** All checks pass: the worker logs in (CAPTCHA goes to a person), fills the search form, clears the search CAPTCHA and an OTP, and scrapes 2 entries into the standard result format. A "no records" search, a scanned old certificate (read by OCR, every line flagged for review), and a rejected-then-retried CAPTCHA also pass.

**Result:** ✅ PASS — `AI VERIFIED`

> Since this test case was first written, the worker has also been run once against the **real** government site — see the "Latest update" section on the dashboard for what happened there. That live run is a separate, one-off exercise, not part of this repeatable automated test.

<details><summary>Technical detail</summary>

```
src/providers/automation-worker.ts (Playwright) vs verification/mock-portal/.
CAPTCHA/OTP never auto-solved — each opens a HITL task with a screenshot.
Scanned images -> src/parse/ocr.ts (tesseract.js) + OCR_LOW_CONFIDENCE caveat.
Real portal: needs an India runner + account; checklist in poc/SELECTORS.md.
Suite now also covers one CAPTCHA rejection + automatic retry with a fresh CAPTCHA.
```
</details>

---

## TC8 · A certified copy: pay, wait for the Sub-Registrar to sign, get the PDF
**Task:** Certified (signed) EC — the async flow
**What this checks:** the certified-copy path. A real certified EC takes 1–10 days because a government officer must digitally sign it — the ERP sees this as a normal async job.

1. Send an EC request with `certified: true`.
2. Watch the status.

**What you should see:** The estimate comes back "in days". The request goes: needs a person (payment) → `awaiting_signature` → `completed`, with a signed PDF document and a "digitally signed by the Sub-Registrar" note. The ERP gets a webhook at each step.

**Result:** ✅ PASS — `AI VERIFIED`

<details><summary>Technical detail</summary>

```
Covered by test/lifecycle.test.ts → "certified EC async flow" and run-e2e.mjs TC5b.
Pipeline is re-entrant: a delayed job re-runs run() which branches on the stored
status. New status "awaiting_signature" + webhook "ec.awaiting_signature".
CERTIFIED_SIGN_DELAY_MS simulates the SRO wait; real deployments poll the portal/vendor.
Payment is a HITL "payment" task (mock auto-approves; operator approves in console mode).
```
</details>

---

**Status legend** — `AI VERIFIED`: automated tests pass & Claude ran it, pending human confirmation · `SIGNED OFF`: a person completed the click-through · `PENDING`: not started.
