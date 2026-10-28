# Test plan

Full results: [`../verification/QA-REPORT.md`](../verification/QA-REPORT.md).
Latest: **50 vitest + 31 API + 16 UI + 15 automation-E2E + 13 ERP-contract + 5 OCR + load = 130+, all green.**

## Unit + integration — `cd service && npm test` (Vitest, 50)

| Suite | Covers |
|---|---|
| `validation.test.ts` | request schema, auth, idempotency-key, period order + **real calendar date**, DOCUMENT_WISE fields, 202 |
| `idempotency.test.ts` | same key+body → 200 same id; different body → 409 |
| `masterdata.test.ts` | SRO resolution (name/alias/wrong-zone hint); unknown SRO; 595-SRO coverage |
| `parse.test.ts` | EC HTML → canonical entries; instrument classification; `deriveOutcome` |
| `router.test.ts` | first-supporting provider; failover; stop on non-retryable; circuit breaker |
| `webhook.test.ts` | HMAC sign/verify; tamper; stop-after-2xx; retry budget |
| `storage.test.ts` | object store put/get; signed URL verify (good/expired/tampered); document flows through the pipeline and downloads |
| `backend-postgres.test.ts` | PostgresRequestStore CRUD + audit + dedupe; PostgresQueue run/retry/re-lease/delay |
| `backend-e2e.test.ts` | full lifecycle on `BACKEND=postgres`; DB rows verified |
| `lifecycle.test.ts` | ENTRIES_FOUND, NIL_UNCONFIRMED, needs_human, unresolvable, PERIOD_GAP, **certified async flow**, dedupe |

## Black-box + browser — `verification/qa/` (each spawns its own services)

| Script | What | Count |
|---|---|---|
| `run-e2e.mjs` | API: TC1–TC5, TC5b (certified), RL1 (rate limit), negative/security/boundary/webhook/perf | 31 |
| `ui-tests.mjs` | Playwright: dashboard structure (8 cards), dark/light, mobile no-overflow, live console CAPTCHA click-through | 16 |
| `automation-e2e.mjs` | Playwright worker vs `verification/mock-portal/`: login+CAPTCHA, form, OTP, scrape, nil, scanned/OCR | 15 |
| `erp-contract.mjs` | vs `verification/mock-erp/`: event order, HMAC signatures, signed-doc download + tamper, polling agreement, partial/failed | 13 |
| `ocr-test.mjs` | render snippet → PNG → tesseract.js → text + rough entries | 5 |
| `load-test.mjs` | 25-concurrent sustained submit + local webhook sink; queue drains; latency; 0 errors | pass |
| `record-walkthrough.mjs` | records the manual-test walkthrough video (webm + gif) | — |

## Still needs external access

- Real Landeed / SurePass API responses — vendor sandbox key.
- The automation worker against the **real** geo-blocked portal — India runner + account.
- Managed Postgres under production load; real payment gateway.
- Chaos: real provider 500s / portal timeouts / ERP endpoint down over a long soak.
