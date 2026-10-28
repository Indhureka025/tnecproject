# Tamil Nadu Encumbrance Certificate (EC) → ERP Integration
## Technical Feasibility Assessment

**Prepared by:** Raakesh R
**Date:** 10 September 2026
**Effort:** ~2 days (research + POC + write-up)
**Question being answered:** *Can the client's ERP reliably retrieve Tamil Nadu EC data automatically, and if not fully automatically, exactly where and why is human intervention required?*

**Update — 12 September 2026:** the automation was run for the first time against the **real** `tnreginet.gov.in` portal (previously only a stand-in copy had been tested). See §6.5 for what was confirmed live and the one bug found; see §8.4 for a batch-processing extension using the existing architecture. Neither changes the recommendation in §9.

---

## 1. Executive summary

**Short answer: partial automation only. ~70–80% of the workflow can be automated; a human touch is required on at least one step per EC (CAPTCHA, and — for the full certificate — login/OTP), and certified ECs are additionally gated by a government-side manual step.**

| Route | Verdict | One-line reason |
|---|---|---|
| **Direct official TNREGINET API** | ❌ Not possible | No public/official API exists for EC search or EC download. None is planned or published. |
| **API Setu (apisetu.gov.in)** | ❌ Not relevant | Enumerated directly. Tamil Nadu exposes only DigiLocker birth/death/marriage + 20 e-District *personal* certificates. No land record, no property registration, no EC. |
| **Third-party B2B API** (Landeed / SurePass / mypatta) | ✅ Feasible, recommended primary | They already operate this exact retrieval as a business, absorb the CAPTCHA/OTP/geo/uptime problem, give a JSON contract + SLA. Cost is per-transaction; none is an *officially authorised* government partner. |
| **Own browser automation of TNREGINET** | ⚠️ Feasible but fragile | Technically works up to the CAPTCHA. Cannot run unattended (CAPTCHA every search; login/OTP for the PDF; portal geo-blocks non-India traffic; frequent maintenance). Viable only as a supervised fallback on India infrastructure. |

**Recommendation:** **Hybrid.** Build a thin internal **EC Service** (REST + queue + webhook) that the ERP calls. Behind it, use a **licensed third-party API as the primary source**, and keep a **supervised, India-hosted browser-automation worker as a fallback** for coverage gaps, with a small **human-in-the-loop console** for CAPTCHA / OTP / result QA. Certified ECs are always asynchronous because a Sub-Registrar must digitally sign them.

---

## 2. Scope and key distinctions (read before acting on this)

- **This assessment is about EC retrieval only.** Not Patta generation, not mutation, not Chitta/Adangal/FMB.
- **EC ≠ Patta ≠ legal ownership / clear title.** An EC lists *registered instruments* (sale, mortgage, gift, release, partition, lien, court attachment, etc.) against a property for a stated period. It does **not** establish who owns the land, and the **absence** of entries does **not** mean the land is unencumbered or unoccupied — it can mean unregistered transactions, an oral/possessory claim, a wrong search key (village/survey/period), or records not digitised.
- **Online EC covers ~1975 onwards only.** Older periods require a manual Sub-Registrar Office (SRO) visit.
- Any ERP feature built on this must present the EC as **one input to title due diligence**, with the search parameters and period shown, and must not render a legal conclusion automatically.

---

## 3. TNREGINET — official API findings

**Portal:** `https://tnreginet.gov.in/portal/` — Inspector General of Registration (IGR), Tamil Nadu; Commercial Taxes & Registration Department; system built and run by TCS.

### 3.1 Is there an official/public API for EC search? — No

- No developer portal, no API documentation, no OpenAPI/Swagger, no sandbox, no published partner-API programme for EC search or guideline-value/registration search.
- The archived portal home page (Apr 2025 snapshot, inspected) shows the EC function only as two **interactive web-UI actions** under "வில்லங்கச் சான்று / Encumbrance Certificate":
  - **இணைய வழி விண்ணப்பித்தல் / Apply online** (request a certified EC)
  - **வில்லங்கச் சான்றினைத் தேடுதல்/பார்வையிடுதல் / Search & View EC** (informational)
- No "API", "Developers", or "Web Services" entry anywhere in the portal menu.
- Third-party blog claims that "banks use TNREGINET's API" are **unsubstantiated** — no official documentation supports them. Where banks consume EC data programmatically today, it is via aggregators or bespoke arrangements, not a public API.

### 3.2 Can EC documents be downloaded via an API? — No

- The EC result is delivered as an **HTML table + a PDF** rendered for humans inside an authenticated portal session. Older records are scanned images.
- The portal's *internal* AJAX calls (what the UI itself fires) are **not a public contract**: undocumented, session- and token-bound, CAPTCHA-gated, and subject to change without notice. Consuming them = the same fragility and the same terms exposure as full browser automation.

### 3.3 Authentication / authorization / documentation / restrictions

| Aspect | Finding |
|---|---|
| **Authentication** | Portal account (User Type = Citizen). Registration requires username, password, security question, email, **Indian mobile number**, ID proof, and **email/mobile OTP** verification. A **text-image CAPTCHA** is shown on the login form itself. |
| **Authorization model** | Designed for individual citizen self-service. No B2B / service-account / bulk tier. **Confirmed verbatim on the portal's own registration page (11 Sep 2026):** a new account must use any Registered User service within **7 days** of creation or it's auto-deactivated; an existing account must use one every **3 months** from its last activity or it's auto-deactivated. |
| **Documentation** | None (public). Only citizen "how-to" help pages and FAQs. |
| **Access restrictions observed / documented** | (a) **Geo-restriction** — the portal refused all connections from the (non-India) test environment: `ECONNREFUSED 103.59.65.24:443` on HTTPS fetch and navigation failure in a headless browser. Widely reported that TNREGINET degrades/blocks non-India IPs and that VPN/proxy/ad-blockers break its CAPTCHA/login. (b) **CAPTCHA** on every EC search and on login. (c) **Frequent scheduled-maintenance windows**; slow under load. (d) Undocumented rate-limiting / anti-automation typical of government portals. |
| **Terms of use** | The portal carries a Terms & Conditions / Disclaimer. It is oriented to end-user citizen use; nothing authorises programmatic, automated, or bulk access. CAPTCHA + OTP are deliberate anti-automation controls. **Legal sign-off is required before shipping any direct automation.** |
| **Fees** | "Search & View EC" (informational PDF) is **free**. A **certified / digitally-signed EC** costs a small statutory fee (≈ ₹15–30 for year 1 + ₹5–10 per additional year, + ₹100 computerisation for post-1987 records), paid through the portal's online payment ("STAR") gateway. |
| **Direction of travel** | Tamil Nadu is expanding *faceless / online registration* (e.g. mandatory online mortgage-deed registration for banks/NBFCs from 15 Sep 2026) and the Registration Department is introducing **API-based real-time verification for death and legal-heir certificates** — but **not for EC**. Worth re-checking in 6–12 months. |

**A genuine EC API would require a formal request / MoU with IGR Tamil Nadu (and likely TNeGA / the state IT department).** That is a government-relations effort with an uncertain, multi-month timeline — only worth pursuing if the client already has that channel.

---

## 4. API Setu (apisetu.gov.in) — findings

API Setu is MeitY's central government API exchange. **Enumerated directly in a browser** (not assumed).

- **Tamil Nadu total:** 177 publishers, 279 APIs.
- **"Registration Department, Tamil Nadu"** collection (`/api-collection/tnreginet`), *provided via DigiLocker*, server `https://apisetu.gov.in/certificate/v3/tnreginet`:
  - `POST /btcer` — Birth Certificate
  - `POST /dtcer` — Death Certificate
  - `POST /rmcer` — Marriage Certificate
  - Schemas: `ConsentArtifactSchema`, `AcademicCertificateSchema`. Covers certificates issued from Dec 2018.
- **"Tamil Nadu eGovernance Agency" / e-District** collection (`/api-collection/edistricttn`), via DigiLocker — **20 APIs**, all *personal* certificates: Income, Community, Nativity, Legal Heir, Residence, Solvency, Farmer, Small & Marginal Farmer, OBC, Widow/Divorce, Inter-Caste Marriage, Migration, Money Lending, Pawnbroker, Non-Graduate, Deserted, Agriculture Income, One-and-the-Same, Unmarriage, Employment/Unemployment.
- **Nothing for land records, patta, chitta, adangal, FMB, guideline value, property registration, or EC** in any Tamil Nadu collection.
- **Nature of these APIs** (verified, not assumed): every one is a **DigiLocker consent-artifact document pull** — it returns *the requesting citizen's own already-issued certificate* after that citizen consents. There is no "search a property and return its encumbrance history" capability, and no third-party lookup.
- **Structural reason:** land & property registration is a **State subject**; each state runs its own portal, and there is **no central-government open API** for it. API Setu only carries what states publish, and Tamil Nadu has published none for land.

**Conclusion: API Setu is not a viable route for EC and will not become one without Tamil Nadu first building and publishing such an API.**

---

## 5. Third-party API / provider comparison

### 5.1 Who exists

| Provider | TN EC? | Interface | Instant (informational) | Certified EC | Access / pricing | Authorised by govt? |
|---|---|---|---|---|---|---|
| **Landeed** (landeed.com, YC-backed, Hyderabad, 2022) | Yes — by survey no / plot / doc no | **App + REST API** (24 states, 120+ doc types), DigiLocker integration | "few minutes", marked informational-only | 7–10 days | API = **contact sales** (`ravi@landeed.com`). Consumer price ≈ ₹999–₹1,999 per EC by span; ₹3,999 full history. No public B2B price list. | **No.** "Independent technology platform, does not represent any government department"; claims "100% compliant with state data policies", records "fetched directly from official state portals". |
| **SurePass** (surepass.io) | Advertises "instant EC downloads … for TN, KA, AP, TG, MH"; also Land Record Check / Monitoring APIs | **REST API**, KYC/verification vendor | "seconds" where available, else async | via application | API key onboarding (`surepass.io/get-api-key/`), **contact sales** for price. | No. Independent verification vendor. |
| **mypatta** (mypatta.in) | Yes — EC, CC, Patta, Chitta, Adangal (TN, KA, AP, TG, MH, OD, GJ) | App-first; B2B on request | "minutes" | "minutes–days" | Contact. | No. Independent platform. |
| **DigiVerification** (digiverification.com) | Lists an "Encumbrance Certificate Check" API; **TN not confirmed** | REST | not stated | — | Contact / demo. | No. |
| IDfy / Karza-Perfios / Digitap / Deepvue / Signzy | Property / RERA / title-verification products exist; **TN EC not specifically advertised** | REST | — | — | Enterprise contract. | No. |

### 5.2 Comparison — third-party API vs own browser automation

| Dimension | Third-party API (Landeed / SurePass) | Own TNREGINET browser automation |
|---|---|---|
| **Feasibility** | High — it is their core product; integration is days of work. | Medium — flow works up to CAPTCHA; last mile needs India infra + a human. |
| **Reliability / SLA** | Contractual SLA, retries, uptime handled by vendor. Still ultimately dependent on TNREGINET. | We own every portal outage, redesign, and selector break. No SLA. |
| **Security** | We send property keys (not personal PII) to a third party over TLS; vendor stores the EC. Need a DPA. Fewer credentials for us to hold. | We hold a pool of TNREGINET accounts + an Indian SIM/mailbox for OTP — a real secret-management and abuse-risk surface. |
| **Compliance / legal** | Vendor carries the "is automated portal access allowed" risk; we contract for lawful supply. Still: none is an *authorised* govt channel, so residual risk exists. Get a written rep/warranty + indemnity. | We directly automate a government portal against controls (CAPTCHA/OTP) it put there on purpose, with T&Cs that don't permit it. Highest legal exposure. Needs explicit legal sign-off. |
| **Cost** | Per-EC fee (₹ tens–low hundreds at B2B volume, to be negotiated) + integration. Opex scales with volume. | Low marginal cost per EC, but real fixed cost: India-hosted browser workers, proxies/IPs, account pool upkeep, an ops team for CAPTCHA/OTP, and ongoing selector maintenance. |
| **Maintenance** | Vendor absorbs portal changes. We maintain one JSON adapter. | Continuous — every TNREGINET UI change can break us; needs monitoring, fast patching, an on-call runbook. |
| **Data freshness / completeness** | Same underlying source (TNREGINET). Same 1975+ limitation. | Identical. |
| **Control / auditability** | Depend on vendor's audit trail; less visibility into the raw session. | Full control of the raw session, screenshots, and every step — better for a regulated audit trail. |

**Net:** the third-party API wins on feasibility, reliability, compliance, and maintenance; own-automation wins only on marginal cost and raw auditability. Hence: primary = third-party, fallback = supervised automation.

---

## 6. POC — methodology and results

### 6.1 Methodology

1. **Official-source enumeration** — navigated API Setu's Tamil Nadu directory and the two relevant collections directly; read the OpenAPI operation lists and schemas. Attempted to reach `tnreginet.gov.in` directly (HTTPS fetch + headless browser). Inspected an archived snapshot of the portal home page to confirm the EC menu structure and the login CAPTCHA.
2. **Aggregator review** — product pages, API positioning, pricing signals, and compliance statements for Landeed, SurePass, mypatta, DigiVerification.
3. **Automation scaffold** — a Playwright script (`poc/ec-search.mjs`) that encodes the full "EC-wise" search flow with **explicit human-in-the-loop pauses** at the CAPTCHA and OTP. **By design it does not attempt to solve or bypass CAPTCHA, OTP, rate limits, or auth** — it stops and asks a human. It captures per-step screenshots and dumps the DOM on any failure so selectors can be locked down from an India IP.
4. **Sample data** — placeholder test property (Chennai zone / Thiruvottiyur SRO / sample survey no) in `poc/config.sample.json`. No real third-party property data used.

### 6.2 What worked

- **API Setu fully enumerated** — it is now *certain*, not assumed, that no EC/land API exists there (§4).
- **Portal EC flow mapped** end-to-end from the archived UI + documentation: login (with CAPTCHA) → E-Services → Encumbrance Certificate → Search & View EC → choose search type (EC-wise / Document-wise / Plot-Flat-Ward-Block-wise) → cascading Zone→District→SRO→Village dropdowns + dates + survey/subdivision → CAPTCHA → submit → results table → PDF.
- **Aggregator landscape mapped** — Landeed and SurePass confirmed as viable B2B API routes; commercial model and compliance posture documented.
- **Playwright scaffold** written, syntax-verified, and structured so the last-mile validation from India is quick (resilient multi-selector strategy, artifact capture, machine-readable run summary).

### 6.3 What failed

- **Live end-to-end run could not be completed.** `tnreginet.gov.in` refused every connection from the test environment (`ECONNREFUSED … :443`; headless-browser navigation denied) — consistent with the portal's geo-restriction of non-India traffic and/or a maintenance window. So the actual **submit-search → download-PDF** step was not exercised. The scaffold is built to finish this from India-hosted infrastructure.
- Because the live DOM was unreachable, exact element IDs and the CAPTCHA widget details are taken from documentation, not verified. Every such selector is marked `TODO: verify` in the code.

### 6.4 Blockers

| Blocker | Present? | Detail | Consequence |
|---|---|---|---|
| **CAPTCHA** | ✅ Yes — hard blocker | Text-image CAPTCHA on **every** EC search and on login. | No legitimate unattended automation. A human (or a licensed aggregator that handles it) must solve it per search. |
| **OTP** | ✅ Yes | Email/**Indian-mobile** OTP at account registration; sometimes on login from a new device; possibly on sensitive submits. | Need a controlled Indian SIM/mailbox and a human/automated OTP-reader step. Blocks fully headless account creation. |
| **Authentication / session** | ✅ Yes | Full EC PDF needs a logged-in account; server-side session + per-form tokens; short timeouts; account deactivation after 7 days unused (new) / 3 months unused (existing) — confirmed exact figures, see §3.3 authorization model row. | Worker must log in, carry cookies/tokens, refresh the form each request, and run an account keep-alive job (touch every account inside the 3-month window; use a brand-new account within 7 days of creating it). |
| **Geo-restriction** | ✅ Yes (observed) | Portal refused non-India connections in this test. | Automation workers **must** run from within India (cloud ap-south / on-prem TN). |
| **Payment authorization** | ⚠️ Conditional | Free for informational "view EC"; **certified EC requires a portal payment** (STAR gateway). | If certified ECs are in scope, a human or a pre-funded wallet / approved payment instrument is needed. Card/credential entry must be human per policy. |
| **Rate limiting / anti-bot** | ⚠️ Likely (undocumented) | Government portals throttle/block aggressive clients. | Low concurrency (1–2 per account/IP), jitter, backoff. Aggressive runs risk the account/IP being blocked. |
| **Portal instability** | ✅ Yes | Frequent maintenance windows; slow under load. | SLA must be "minutes–hours", not "seconds"; need a maintenance detector + retry queue. |
| **Government / SRO step** | ✅ Yes (for certified EC) | A Sub-Registrar must digitally sign & upload the certified EC against the online request. | Inherently asynchronous, human-gated on the government side — hours to days — on **every** channel including aggregators. |
| **Non-machine-readable output** | ✅ Yes | EC is a human-laid-out HTML/PDF; older ECs are scanned images. | Downstream parsing + OCR needed to produce a structured result for the ERP; low-confidence cases go to QA. |
| **Data not digitised (pre-1975)** | ✅ Yes | Online EC starts ~1975. | System must detect the gap and raise a manual-SRO task, not fail silently or imply "clean". |

### 6.5 Update — first live run against the real portal (12 September 2026)

The POC above (§6.3) could not reach `tnreginet.gov.in` at all from the assessment environment. Since then, the automation worker has been run — end to end, with a real person solving the CAPTCHA live — against the **real** portal for the first time, from an environment that could reach it. Full request/response trace, console output, and the exact line of the portal's own client-side JavaScript that was read to confirm the root cause are in `poc/SELECTORS.md`; a screen recording of the run is at `service/public/video/live-portal-automated-run.webm` (also embedded on the project dashboard).

**Confirmed working, live, against the real site:**
- Loading the portal and it defaulting to Tamil for a fresh session; switching to English.
- Dismissing two recurring promotional modal pop-ups.
- Filling the cascading Zone → District → Sub-Registrar Office → Village dropdowns via the portal's real AJAX (`loadDistrictCombo` etc.).
- Adding the survey number / subdivision number row.
- Rendering a real, solvable CAPTCHA and submitting it — the portal's own async validation call (`actionVal=checkCaptcha`) returned success (`##true`).

**Bug found, root-caused, fix in progress:** the two date fields ("EC Start Date" / "EC End Date") are driven by a JS-bound calendar widget. `page.fill()` — the standard way an automated browser sets a text field's value — only opens that calendar as a side effect of focusing the field; it does not set a value the widget itself recognises as filled. The page's own pre-submit validation function (`checkMandSearchDocYearWise()`, extracted and read live via `page.evaluate`) requires both date fields to be non-empty before it allows `searchDocDtlsYearWise()` to fire the actual search — so the click on "Search" was silently rejected by the page's own client-side check, with no error surfaced to the user. This is precisely the kind of frequent, undocumented front-end behaviour flagged as a maintenance risk in §5.2 and §8.2 ("Runbook" / "Continuous — every TNREGINET UI change can break us"). A fix (drive the calendar widget itself, i.e. click a day cell, instead of typing into the field) is written and mostly working; one selector for calendar month-navigation needs a final correction.

**Net effect on this assessment:** no change to the findings or the recommendation. Every gate the real portal enforces before considering a submission (location fields, CAPTCHA, date fields) is now independently confirmed to exist and behave as this report assumed; the one step that stalled is a diagnosed, narrow front-end bug, not a structural blocker, and is exactly the class of "own-automation maintenance burden" this report already priced in as a reason to keep a licensed aggregator as the primary route (§5.2, §9).

---

## 7. Automation vs human-intervention breakdown

Legend: 🟢 fully automatable · 🟡 automatable with a managed dependency · 🔴 human required.
"Own automation" = we drive TNREGINET. "Via aggregator API" = we call Landeed/SurePass.

| # | Workflow step | Own automation | Via aggregator API | Why / notes |
|---|---|---|---|---|
| 1 | Receive property details from ERP | 🟢 | 🟢 | Plain REST endpoint. |
| 2 | Validate inputs (zone/district/SRO/village codes, survey format, date range, search-type) | 🟢 | 🟢 | Validate against a cached master list of TN registration units; reject early. |
| 3 | Navigate TNREGINET to the EC search | 🟢 (from India) | n/a | 🔴 from outside India — geo-blocked. |
| 4 | Authenticate (account login) | 🟡 | n/a | Automatable *most of the time* with a managed account pool; 🔴 when a fresh OTP / re-verification is triggered. Account creation itself is 🔴 (OTP). |
| 5 | Enter property / search details | 🟢 | 🟢 | Cascading dropdowns; needs AJAX-settle waits. Aggregator takes the same fields as JSON. |
| 6 | **Solve CAPTCHA** | 🔴 | 🟢 (vendor handles it) | The decisive step. Per search on our own automation. |
| 7 | Submit request | 🟢 | 🟢 | After CAPTCHA. |
| 8 | Enter submit-time OTP (if prompted) | 🔴 | 🟢 | Occasional; needs the controlled mailbox/SIM. |
| 9 | Track request status | 🟡 | 🟡 | Informational EC is synchronous. Certified EC → poll the portal / vendor "application status". Portal has no status webhook. |
| 10 | Detect EC availability / "no records" | 🟢 | 🟢 | Parse the results page / API response. |
| 11 | Interpret an empty result | 🔴 | 🔴 | A human must confirm "genuinely no entries" vs wrong village/period/survey vs transliteration mismatch. High-liability. |
| 12 | Pay the fee (certified EC) | 🔴 | 🟡 | 🔴 on the portal (card/credential entry is human per policy). 🟡 via aggregator if pre-funded B2B billing. |
| 13 | Wait for the SRO to sign/upload the certified EC | 🔴 (govt side) | 🔴 (govt side) | Government-side manual step. Unavoidable on any channel. Hours–days. |
| 14 | Download the EC (informational or signed) | 🟢 | 🟢 | Once available. |
| 15 | Parse EC → structured result (entries, parties, instrument types, period, encumbrance-present flag) | 🟡 | 🟡 | Text ECs parse cleanly; scanned/older ECs need OCR → 🔴 QA for low-confidence. |
| 16 | Store document + result (object store + DB, encrypted, access-logged) | 🟢 | 🟢 | |
| 17 | Return result to ERP via API / webhook | 🟢 | 🟢 | Signed webhook + polling fallback. |
| 18 | Handle automation failure / portal change | 🔴 → 🟢 | 🟡 | Own automation: 🔴 to diagnose & patch selectors, then automated again. Aggregator: vendor absorbs it; we monitor. |
| 19 | Handle "period not digitised" (pre-1975) | 🔴 | 🔴 | Raise a manual-SRO-visit task. |

**Summary of unavoidable human points:**

1. **CAPTCHA** — every search, on our own automation (removed only by using an aggregator).
2. **OTP** — account creation always; login/submit occasionally. Needs a controlled Indian SIM/mailbox.
3. **Empty-result interpretation** — every "no records" case, on any channel, before the ERP is told "no encumbrance".
4. **Payment** for certified ECs — human on the portal; can be pre-funded via an aggregator.
5. **SRO signing** of certified ECs — government-side, asynchronous, on every channel.
6. **Failure/DOM-change recovery** — engineer intervention on our own automation.
7. **Pre-1975 / non-digitised** — manual SRO visit.

**Best achievable:** aggregator path → **0 human touches** for an informational EC (steps 11 and 18 become monitoring, not blocking); own-automation path → **1 quick human touch** (CAPTCHA) per informational EC; **certified EC is asynchronous and partly human on every path.**

---

## 8. Recommended production architecture

### 8.1 Principle

The ERP calls **one internal contract**. It never knows whether an EC came from an aggregator or from browser automation. The source is swappable behind that seam.

```
                        ┌──────────────────────── EC Service (our backend, India region) ────────────────────────┐
                        │                                                                                        │
 ERP / CRM ─POST /ec-requests─►  API layer ──►  Request store ──►  Queue ──►  Provider router                     │
     ▲   │                       (authn, validate,   (Postgres:     (BullMQ/   │                                  │
     │   │                        quote, idempotency) status, audit)  SQS)     ├─► Adapter: Landeed API (primary) │
     │   │                                                                     ├─► Adapter: SurePass  (secondary) │
     │   └──── webhook: ec.completed / ec.failed / ec.partial ◄───────┐        └─► Browser worker pool (fallback)  │
     │        (+ GET /ec-requests/{id} polling fallback)              │                    │                       │
     │                                                                │                    ▼                       │
     └──── canonical result: {entries[], encumbrancePresent, period,  │        Human-in-the-loop console           │
           parties[], sourcePdfUrl, certified, retrievedAt, caveats}  │        (CAPTCHA, OTP, empty-result QA,     │
                                                                       │         OCR low-confidence QA)             │
                    Object store (PDFs, screenshots) ◄────────────────┤                                            │
                    Result DB (parsed EC + audit trail) ◄─────────────┘                                            │
                        └────────────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Components

| Component | Choice / notes |
|---|---|
| **API layer** | REST, async. `POST /ec-requests` → `202` + `requestId`. `GET /ec-requests/{id}`. Body: search-type, zone/district/SRO/village (or doc-no + year), survey/subdivision, date range, `callbackUrl`, `Idempotency-Key`, `certified: bool`. Per-tenant auth (mTLS or signed API key). |
| **Request store** | Postgres. One row per request: params hash (idempotency), `status` (`queued → dispatched → in_progress → needs_human → completed / failed / partial`), provider used, cost, operator id, artifact refs, full timestamped audit trail (regulated use case). |
| **Queue** | BullMQ (Redis) or SQS-equivalent. Per-provider queues. Exponential backoff + jitter; dead-letter after N attempts; visibility timeout > portal worst-case latency; separate lane for certified-EC polling. |
| **Provider router** | Policy, config-driven per district / document-age: (1) Landeed API; (2) on error/coverage-miss → SurePass; (3) on both miss, or caller needs a control/audit path → browser worker. Circuit-breaker per provider. |
| **Aggregator adapters** | Thin HTTP clients mapping our request ↔ vendor schema; handle vendor async callbacks; normalise output to the **canonical EC result model**. |
| **Browser worker pool** | Playwright + Chromium, **hosted in India** (AWS ap-south-1 / Azure Central India / GCP Mumbai) or client on-prem in TN. 1–2 concurrent sessions per account/IP, jittered. Managed pool of TNREGINET Citizen accounts + keep-alive cron (login ≤ every 3 months). Per-step screenshots + DOM dumps to the object store. **No CAPTCHA/OTP bypass** — it parks a task for a human. |
| **Human-in-the-loop console** | Internal web app for the client's India-based ops team. Worker parks a task when it hits: **CAPTCHA** (show image → operator types code → worker resumes same session), **OTP** (operator reads it from the controlled mailbox/SIM), **empty-result QA**, **OCR low-confidence QA**. Target: operator responds < 2 min in business hours; overnight queue drains next morning. |
| **EC parsing** | Deterministic parser for modern text ECs → canonical model. OCR (Textract / Tesseract) for scanned/older ECs, flagged `low_confidence` → QA. Never emit a legal conclusion — emit entries + an `encumbrancePresent` boolean + `caveats[]` (period covered, digitisation gap, transliteration notes). |
| **Storage** | PDFs + screenshots in encrypted, versioned, access-logged object storage. Parsed results + audit in Postgres. Retention per client compliance policy; data residency = India. |
| **Delivery to ERP** | Signed webhook `ec.completed` / `ec.failed` / `ec.partial` + short-lived download URL; `GET` polling fallback; idempotent retry-with-backoff on delivery. |
| **Caching / dedupe** | If an identical (SRO + survey + subdivision + date-range) EC was fetched within *N* days, return the cached result. Default: off for `certified`, 7–30 days for informational. Significant cost saver for repeated due diligence on one project. |
| **Observability** | Dashboards: success rate & turnaround by provider, CAPTCHA rate, OTP rate, human-touch rate, block events, cost per EC. Alerts on provider error-rate spike, portal-down, DLQ growth. |
| **Runbook** | On-call procedure for "portal DOM changed" / "provider outage" / "account pool locked". |

### 8.3 Rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Commercials & legal** (week 1, parallel) | RFP to Landeed + SurePass (district coverage, SLA, per-EC price, sandbox keys, DPA, rep & warranty on lawful supply). Legal review of own-automation T&C risk. | Signed sandbox agreement with ≥1 aggregator; documented go/no-go on own automation. |
| **1 — EC Service MVP** (weeks 1–3) | API layer + request store + queue + **Landeed adapter only** + canonical model + webhook/polling. ERP integration in staging. | ERP submits an EC request in staging and receives a parsed result + PDF via the aggregator sandbox. |
| **2 — Second provider + caching + dashboards** (weeks 3–5) | SurePass adapter, provider router + circuit breaker, dedupe cache, observability. | Automatic failover demonstrated; cost/turnaround metrics live. |
| **3 — Supervised browser fallback** (weeks 5–8) | Playwright worker on India infra, account pool + keep-alive, HITL console, EC parser + OCR. Lock selectors against the live portal from India. | End-to-end EC via automation with one human CAPTCHA touch; selectors stable 2 weeks. |
| **4 — Harden** (weeks 8–10) | Load test, maintenance/block handling, alerting, retention/audit, DR, runbook. | Meets agreed SLA at expected volume; on-call runbook signed off. |

### 8.4 Extension — batch processing multiple properties at once (update — 12 September 2026)

The architecture in §8.1–8.2 already treats each EC lookup as an independent, queued, asynchronous job routed through the provider router — nothing about it assumes one lookup at a time. Accepting a **list** of properties in a single ERP request is therefore additive, not a redesign:

- **Intake:** `POST /ec-requests/batch` accepts an array of the same per-property payload already defined in §8.2, and fans it out into the existing queue as N independent jobs sharing a `batchId`.
- **Execution:** the provider router, aggregator adapters, and browser-worker pool all already run per-job — a batch of 20 properties simply means 20 queued jobs, most of which (via the primary aggregator route) need no human step at all.
- **The one shared bottleneck:** every job that falls through to the own-automation fallback still needs a human to clear its CAPTCHA. The existing human-in-the-loop console (§8.2) already lists *every* open task, not just one — so a batch surfaces as several tasks queued for the same operator, cleared back-to-back (each takes on the order of 10 seconds), rather than requiring a new capability.
- **Delivery:** results are delivered as they complete (existing per-job webhook), plus a `batch.completed` webhook once every job in the `batchId` has reached a terminal state, for callers that want to wait for the whole set.
- **New risk to manage:** issuing many automated searches at the real portal in a short window raises the likelihood of the kind of anti-automation friction described in §6.5 and the "rate limiting / anti-bot" row of the blockers table (§6.4). A batch feature should pace own-automation jobs deliberately (the existing per-account/IP concurrency limit in §8.2 already caps this) and should be positioned — consistent with §9 — as a way to clear the overflow a licensed aggregator can't cover, not as the primary way to process high volume.

**Effort:** this is a thin API + queue-fan-out change on top of the existing service, not new infrastructure — closer to a Phase 1/2 addition (§8.3) than a new phase of its own.

---

## 9. Final recommendation

**Adopt the hybrid model, aggregator-first.**

1. **Do not wait for / build on an official TNREGINET or API Setu API — neither exists and neither is on a credible near-term roadmap for EC.**
2. **Primary route: a licensed third-party API (Landeed or SurePass), selected via a short RFP.** This gets the ERP a reliable JSON contract in ~3 weeks, moves the CAPTCHA/OTP/geo/uptime burden to the vendor, and — with a proper DPA + rep/warranty + indemnity — puts the client in the strongest compliance position available short of a government MoU.
3. **Secondary route: a supervised, India-hosted browser-automation worker** behind the same internal EC Service, for coverage gaps and as commercial leverage / continuity if a vendor fails. It runs with a human-in-the-loop console and **never bypasses portal security controls**.
4. **Set ERP expectations:** informational EC in minutes; **certified EC in 1–10 days** (government-side SRO signing — true on every channel). The ERP workflow must be asynchronous with visible status.
5. **Keep the legal framing tight:** the EC is one input to title due diligence. The system surfaces registered entries + the exact search parameters and period; it must not auto-conclude ownership or "clear/unencumbered/unoccupied".
6. **Re-evaluate the official-API route in 6–12 months** given Tamil Nadu's move to faceless registration and new API-based certificate verification.

**If the client's actual priority is a fully hands-off pipeline:** that is **not achievable** for direct portal automation (CAPTCHA + OTP + empty-result QA), and only *nearly* achievable via an aggregator (empty-result interpretation and certified-EC latency remain). The honest target is **"mostly automated, with a defined and small human-in-the-loop, and a clearly async certified-EC path."**

---

## 10. Open questions for the client

1. **Volume & mix** — EC checks/month, and % needing a **certified** EC vs informational.
2. **Districts / SROs in scope** — to size aggregator coverage and price.
3. **Latency tolerance** — is "informational in minutes, certified in days" acceptable to the ERP process?
4. **Ops ownership** — who runs the India-based HITL console and owns the Indian SIM/mailbox?
5. **Risk appetite** — aggregator-only, or is supervised own-automation acceptable?
6. **Existing government relationship** — any channel to IGR Tamil Nadu / TNeGA that could unlock a real API or a data-sharing MoU?
7. **Data retention / residency** for stored ECs and property data.
8. **Definition of "done" for a title check** in the ERP — what does the client want the system to assert vs leave to a human reviewer?

---

## 11. Sources

Full list in [`research/sources.md`](research/sources.md). Primary sources inspected directly: API Setu Tamil Nadu directory and the `tnreginet` + `edistricttn` collections; archived TNREGINET portal home page (Apr 2025); Landeed and SurePass product/API pages. TNREGINET itself was unreachable from the assessment environment (documented in §6.3). SEO/affiliate microsites (`tnreginet*.com/.org/.in`, which are **not** the government portal) were not used for factual claims.
