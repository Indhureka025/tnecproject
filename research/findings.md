# Research log — TN EC integration

Raw notes backing `REPORT.md`. Dated 10 Sep 2026.

## 1. TNREGINET official API

- Portal: https://tnreginet.gov.in/portal/ — IGR Tamil Nadu, built by TCS.
- EC surfaced only via web UI: `E-Services → Encumbrance Certificate → Search & View EC` and `→ Apply` (certified).
- No developer portal / OpenAPI / partner API published anywhere.
- Three EC search modes: EC-wise (zone, district, SRO, start+end date, village, survey no, subdivision no); Document-wise (SRO, doc no, year); Plot/Flat/Ward-Block-wise.
- Full EC view/download now requires a **logged-in registered account** (older portal allowed anonymous search). Registration: username, password, security Q, email, **Indian mobile**, ID proof, **email/mobile OTP**. Account deactivates after 3 months idle; must log in within 7 days of registering.
- **CAPTCHA** (text-image) required before every EC search submit. Sometimes an additional OTP confirmation on submission.
- Free EC PDF is "informational / for reference only".
- **Certified / digitally-signed EC:** separate Apply flow. Fee ≈ ₹15–100 per year of search + portal charges. Request routed to Sub-Registrar Office, which uploads a **QR-code digitally-signed EC** against the request. Async, human-gated at SRO, hours–days.
- Online EC data coverage: **1975 onwards only** (pre-1975 not digitised → manual SRO visit).
- Portal reliability: frequent scheduled-maintenance windows; slow under load; known to degrade/deny for non-India IPs; VPN/proxy/ad-blockers reported to break CAPTCHA + login.

## 2. APISetu (apisetu.gov.in / directory.apisetu.gov.in)

Enumerated directly in a browser on 10 Sep 2026.

- TN location page: "177 publishers, 279 APIs".
- **Registration Department, Tamil Nadu** (`/api-collection/tnreginet`), provided via DigiLocker, OAS 3.0, server `https://apisetu.gov.in/certificate/v3/tnreginet`:
  - `POST /btcer` Birth Certificate
  - `POST /dtcer` Death Certificate
  - `POST /rmcer` Marriage Certificate
  - Schemas: `ConsentArtifactSchema`, `AcademicCertificateSchema`. "issuing … certificates to the citizens registered from Dec 2018."
- **Tamil Nadu eGovernance Agency / e-District** (`/api-collection/edistricttn`), via DigiLocker, server `https://apisetu.gov.in/certificate/v3/edistricttn` — 20 APIs:
  - aicer Agriculture Income, cmcer Community, drcer Deserted, uncer Employment/Unemployment, frcer Farmer, incer Income, imcer Inter-Caste Marriage, ismfc Small & Marginal Farmer, lhcer Legal Heir, micer Migration, mlcer Money Lending, ntcer Nativity, ngcer Non-Graduate, obcer OBC, oscer One and the Same, pbcer Pawnbroker, rscer Residence, slcer Solvency, umcer Unmarriage, wwcer Widow/Divorce.
- No land record / patta / chitta / adangal / guideline value / EC / property-registration API in any TN collection.
- All APIs are DigiLocker consent-artifact document pulls: they return **the requesting citizen's own issued certificate**, not a searchable property/title dataset.
- General principle confirmed: land & property **registration is a State subject**; there is no central-government open API for it. APISetu only carries what states have published, and TN has published none for land.

## 3. Third-party aggregators

### Landeed (landeed.com) — YC-backed, Hyderabad, founded 2022
- App **+ API**. Marketing: "app and API let owners, agents, developers, lenders and lawyers pull encumbrance certificates, sale deeds, RTC, 7/12, Patta and other land records from dozens of state and federal sources in seconds." 24 states, 120+ doc types. DigiLocker integration.
- TN EC: search by survey no / plot / doc no. Data sourced from TNREGINET.
- **Instant** informational EC PDF in "a few minutes" (marked informational-use-only). **Certified EC: 7–10 days.**
- Pricing (consumer): ≈ ₹999–₹1,999 per EC by search span; ₹3,999 for full history from ~1950s. **No public B2B/API price list.**
- API onboarding: contact sales — `ravi@landeed.com`, landeed.com/contact. No public API docs found.

### mypatta (mypatta.in)
- App-first; EC, CC, Patta, Chitta, Adangal. States: TN, KA, AP, TG, MH, OD, GJ.
- Digitally-signed EC "in minutes". B2B: contact.

### SurePass (surepass.io)
- KYC/verification API vendor. Products: "Land Record Check API", "Land Record Monitoring API", state-specific land APIs (Gujarat, Karnataka, Telangana pages exist).
- Claims "Instant EC downloads … in seconds for Telangana, Karnataka, Andhra Pradesh, Tamil Nadu, and Maharashtra."
- Land Record Check API inputs: state, city, taluk, village (per marketing page; full schema not public).
- Onboarding: API key via `surepass.io/get-api-key/`, contact `contact@surepass.io`. No public per-hit price.

### DigiVerification (digiverification.com)
- Lists "Encumbrance Certificate Check" API among property/land APIs. States not specified (TN unconfirmed). Contact/demo only. +91 70425 76161.

### Others
- IDfy, Karza/Perfios, Digitap, Deepvue, Signzy — property / RERA / title-verification products exist but **TN EC not specifically advertised**. Enterprise contracts. Only worth an RFP if Landeed/SurePass fail SLA.

## 4. POC execution notes

- `WebFetch https://tnreginet.gov.in/portal/` → `connect ECONNREFUSED 103.59.65.24:443`.
- Headless browser `navigate` to `https://tnreginet.gov.in/` and `/portal/` and `https://www.tnreginet.gov.in/` → "navigation … denied or failed".
- Consistent with documented geo-restriction of non-India traffic and/or maintenance window. Live submit→download run not possible from this environment.
- APISetu navigated fine (not geo-restricted) → §2 confirmed against primary source.
- Playwright scaffold written in `poc/` encoding the EC-wise flow with HITL pauses; selectors marked `TODO: verify` pending a run from India.

## 5. Second research pass (deeper)

### Archived TNREGINET home page (web.archive.org snapshot 2025-04-04, loaded via browser)
- EC menu (Tamil): வில்லங்கச் சான்று →
  - இணைய வழி விண்ணப்பித்தல் (apply online / certified)
  - வில்லங்கச் சான்றினைத் தேடுதல்/பார்வையிடுதல் (search & view EC)
  - also under "விண்ணப்பம் உருவாக்கல்" and "எனது ஆவணங்கள்" (My Documents) → EC + Certified Copy.
- Login box present on home page with "காண்பிக்கப்படும் குறியீட்டைத் தட்டச்சு செய்க" = "type the code shown" → **CAPTCHA on the login form**, confirmed.
- No "API" / "Developers" / "Web Services" menu entry anywhere. "இணைய வழி கூட்டாண்மை நிறுவனங்கள் பதிவு" = *partnership-firm registration*, NOT an API-partner programme.
- Payments: "STAR" scheme — online payment of department fees via banks; DD up to ₹5000 / unlimited online / PoS up to ₹1000 at SRO.
- WebFetch of web.archive.org is blocked for this tool; the browser tool works for archive.org.

### Fees (secondary sources, consistent)
- "Search & View EC" informational PDF = **free**.
- Certified copy: statutory search fee ≈ ₹15–30 for year 1 + ₹5–10 per extra year; computerisation fee ₹100 for post-1987 records. Paid via portal online payment gateway.
- Full EC PDF download requires a **free registered account**; a basic search may run without login but the complete details + PDF need login.
- **Confirmed directly (11 Sep 2026, live portal, logged-out session):** the "வில்லங்கச் சான்று விவரம் பார்வையிடுதல்" (EC details view — the free/informational path) search form loads and is fully fillable (search-by-property or search-by-document, zone/district/SRO/village cascading selects) **with no login prompt at all** — the header still shows "User Registration"/"Login" as unused options. Not yet confirmed how far past clicking Search a logged-out session gets (whether the results table itself, or only the CAPTCHA/submit step, additionally requires login) — the cascading district dropdown didn't populate during this check, which is a portal/interaction quirk to retest, not evidence either way.

### Aggregator compliance posture
- Landeed: "independent technology platform, does not represent any government department"; claims "100% compliant with state data policies", "records fetched directly from official state portals". YC-backed, founded 2022, Hyderabad. Competitors named: Teal, mypatta, Zapkey.
- mypatta: also independent, not government-affiliated.
- **Neither is an officially authorised / designated government partner.** They operate the same portal-retrieval we would, as a business, with a (self-asserted) compliance posture. → In the comparison, "compliance advantage" of the aggregator route = *risk transfer + contractual rep/warranty*, not *official authorisation*.

### Direction of travel (TN Registration Dept)
- Stamps & Registration Policy Note 2026–27: mandatory online / faceless registration for **mortgage deeds** (banks/NBFCs) from 15 Sep 2026; expansion to settlement/release/partition/revocation and (from 15 Oct 2026) family-arrangement docs.
- Registration Dept "will use API technology to verify **death and legal-heir** certificates in real time" — NOT EC.
- No public news of an EC data-sharing agreement / API for banks or fintechs.
- TN FinTech Policy 2021 mentions a state "APIs exchange" for banks/FIs/startups — generic, no EC endpoint identified.

### TNREGINET terms of use
- Official portal carries T&C + Disclaimer pages (could not load live). Oriented to citizen end-user use; no clause authorising automated/bulk/programmatic access. CAPTCHA + OTP are deliberate anti-automation controls. → legal sign-off needed before any direct automation.
- Many "tnreginet*.com/.org/.in" sites are SEO/affiliate microsites carrying their own disclaimers ("not an official govt website") — not authoritative.
