# Project charter — TN EC → ERP Integration

**Status:** Initiation
**Owner:** Raakesh R
**Started:** 10 September 2026
**Feasibility basis:** [`REPORT.md`](REPORT.md)

---

## 1. Goal

Give the client's ERP a single, reliable way to retrieve Tamil Nadu Encumbrance
Certificate (EC) data programmatically, replacing manual entry on TNREGINET and
manual PDF handling — with a clearly defined, small human-in-the-loop.

**In scope:** EC search + retrieval (informational and certified), parsing to a
structured result, delivery to the ERP.
**Out of scope:** Patta/Chitta/Adangal/FMB generation, mutation, any automated
legal conclusion about ownership or clear title.

## 2. Approach (from the feasibility assessment)

Hybrid, aggregator-first:

- **Internal EC Service** — one async REST contract the ERP calls (`POST /ec-requests`
  → webhook). Source of the data is swappable behind it.
- **Primary source:** a licensed third-party API (Landeed or SurePass), chosen by RFP.
- **Fallback source:** supervised, India-hosted browser automation of TNREGINET,
  with a human-in-the-loop console for CAPTCHA / OTP / QA. Never bypasses portal
  security controls.
- **Certified ECs** are asynchronous on every path (a Sub-Registrar signs them).

## 3. Two parallel tracks

| Track | Who | Now |
|---|---|---|
| **A — Decisions & commercials** | Client + Raakesh | Scope sheet, aggregator RFPs, legal review. Longest lead time — drives the go/no-go. |
| **B — Technical foundation** | Raakesh | Internal API contract, canonical result model, repo skeleton, from-India automation spike. Buildable now, independent of Track A outcome. |

## 4. Decisions required before Phase 1 build

| # | Decision | Needed from | Blocks |
|---|---|---|---|
| D1 | Monthly EC volume + certified-vs-informational mix | Client | Sizing, vendor pricing |
| D2 | Districts / SROs in scope | Client | Vendor coverage check |
| D3 | Budget for per-EC fees (aggregator opex) | Client | Vendor selection |
| D4 | Risk appetite: aggregator-only, or is supervised own-automation allowed? | Client + legal | Whether Track B fallback is built |
| D5 | Who owns the ops function (HITL console + Indian SIM/mailbox for OTP) | Client | Fallback + certified-EC flow |
| D6 | Data retention + residency rules for stored ECs | Client | Storage design |
| D7 | Tech stack for the EC Service | Raakesh (proposed: Node + TypeScript, Fastify, BullMQ/Redis, Postgres) | Repo skeleton |
| D8 | Any existing IGR Tamil Nadu / TNeGA relationship | Client | Whether to pursue an official MoU/API in parallel |

Log outcomes in [`docs/decision-log.md`](docs/decision-log.md).

## 5. Phases

All phases **built and tested against mocks**. What stays blocked: the real
Landeed/SurePass API responses (need a sandbox key) and the automation worker
against the *real* TNREGINET host (needs an India runner + a real account).

| Phase | Scope | Status |
|---|---|---|
| **0 — Initiation** | Charter, API contract + OpenAPI, canonical model, RFP pack, service skeleton, operator console, dashboard, demo client | ✅ done |
| **1 — EC Service** | Async API, validation, provider router (failover + circuit breaker), canonical model, webhooks + polling, dedupe | ✅ done (mock provider; real Landeed/SurePass adapters are mapping-stubs pending sandbox) |
| **2 — Production infra** | Postgres store + audit trail, durable job queue, object storage + signed document URLs, `/metrics`, per-tenant rate limiting, **full 595-SRO master data**, load-test harness | ✅ done |
| **3 — Browser automation** | Playwright worker (login/CAPTCHA/form/OTP/scrape) proven E2E against a mock TNREGINET portal; OCR (tesseract.js) for scanned pre-1987 ECs; HITL console | ✅ done (mock portal). ⏭️ real portal: needs India infra + `poc/SELECTORS.md` lock-down |
| **4 — Certified EC + ERP** | Certified async state machine (payment → `awaiting_signature` → signed), mock payment step, mock ERP receiver + full webhook/signature/document contract tests | ✅ done (mock payment; real gateway pending) |

Test totals: **50 unit/integration + 31 API + 16 UI + 15 automation-E2E + 13 ERP-contract + 5 OCR + load** — all green. See `verification/QA-REPORT.md`.

## 6. Immediate next actions

| # | Action | Owner | Output | State |
|---|---|---|---|---|
| 1 | Send scope sheet (D1–D8) to client | Raakesh | Filled scope sheet | ⏭️ draft ready: [`docs/client-scope-sheet.md`](docs/client-scope-sheet.md) |
| 2 | Send RFP to Landeed + SurePass | Raakesh | Sandbox keys + quotes | ✅ sent: [`docs/vendor-rfp/`](docs/vendor-rfp/) — ⏭️ awaiting vendor response |
| 3 | Request legal review of aggregator + direct-automation routes | Client legal | Go/no-go on Track B fallback | ⏭️ |
| 4 | Agree internal API contract with ERP team | Raakesh + ERP team | Signed-off `docs/openapi.yaml` | ✅ drafted; ⏭️ ERP review |
| 5 | Aggregator sandbox spike (pull 1 EC → canonical model) | Raakesh | Working proof, gap list | ⏭️ after #2 — adapter stub in `service/src/providers/landeed.ts` |
| 6 | From-India automation run (lock real portal selectors) | Raakesh | Real-portal fallback | ⏭️ if D4 allows — worker proven vs mock portal; checklist in [`poc/SELECTORS.md`](poc/SELECTORS.md) |
| 7 | EC Service (Phases 1–4) | Raakesh | Runnable + tested | ✅ [`service/`](service/) — 130+ checks, all green |

## 7. Key risks

| Risk | Mitigation |
|---|---|
| Aggregator can't meet SLA / coverage for the client's districts | RFP two vendors; keep the supervised-automation fallback |
| Legal blocks direct automation | Aggregator-only is still viable; only the fallback is lost |
| TNREGINET redesign breaks automation | Fallback only; monitoring + on-call runbook; aggregator absorbs it on the primary path |
| Certified-EC latency (1–10 days) unacceptable to ERP UX | Set expectations early; make the ERP flow async with visible status |
| No vendor is a *government-authorised* channel | Contractual rep/warranty + indemnity; re-check official API route in 6–12 months |
