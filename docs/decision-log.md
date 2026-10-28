# Decision log

Lightweight ADRs. Newest first. Status: PROPOSED / ACCEPTED / SUPERSEDED.

---

## ADR-0009 — Certified ECs are a re-entrant async state machine
**Status:** ACCEPTED (2026-09-11) · **By:** Raakesh

`certified: true` → retrieve → `payment` HITL → status `awaiting_signature` +
`ec.awaiting_signature` webhook → a delayed job re-runs `pipeline.run()`, which
branches on the stored status and completes with a signed `ec_pdf`. The pipeline
stays a single `run()` entrypoint; the queue re-enqueue is the only new plumbing.
`CERTIFIED_SIGN_DELAY_MS` simulates the 1–10 day SRO wait; production polls the
portal/vendor for the signed copy instead.

## ADR-0008 — OCR output is always low-confidence + operator-gated
**Status:** ACCEPTED (2026-09-11) · **By:** Raakesh

Scanned pre-1987 ECs go through tesseract.js. Every OCR result carries an
`OCR_LOW_CONFIDENCE` caveat and opens an `ocr_review` HITL task — the ERP is never
told a definitive answer from OCR alone.

## ADR-0007 — Master data is zone → SRO (district advisory)
**Status:** ACCEPTED (2026-09-11) · **By:** Raakesh

The complete public data is 595 SROs mapped to the 11 registration zones. The
registration-district level (~50) and village jurisdiction are only in TNREGINET's
"Know Your Jurisdiction" (India IP). So `resolveUnit` validates zone + SRO and
treats `district` as advisory (echoed, not checked). Zone aliases handle
romanisation variants (Thanjavur↔Tanjore).

## ADR-0006 — Postgres store + a Postgres-backed durable queue (no Redis)
**Status:** ACCEPTED (2026-09-11) · **By:** Raakesh · supersedes the Redis/BullMQ note in ADR-0004

Postgres for the request store + audit trail. The job queue is a `jobs` table with
`FOR UPDATE SKIP LOCKED` + lease-expiry recovery — one datastore, no Redis to run,
still safe for multiple instances. PGlite runs the same SQL in dev/test with no
server. Revisit if throughput outgrows a single Postgres (then BullMQ/Redis).

## ADR-0005 — Provider router with ordered failover + circuit breaker
**Status:** ACCEPTED (2026-09-10) · **By:** Raakesh

Providers are tried in `PROVIDER_ORDER`; first `supports()` && breaker-closed wins.
Retryable `ProviderError` → fall through to next provider; non-retryable → stop.
3 failures opens a provider's breaker for 60s. Lets us run aggregator-primary with
automation-fallback and survive a vendor outage without code changes.

---

## ADR-0004 — Tech stack: Node 22 + TypeScript + Fastify; Postgres + Redis (Phase 1)
**Status:** ACCEPTED pending client D7 (2026-09-10) · **By:** Raakesh

Matches the client's existing Node/React estate and team skills. Fastify for a
small, fast API surface; zod for request validation; BullMQ/Redis for the queue;
Postgres for the request store + audit trail. Phase-0 runs fully in-memory so it
needs no infra to demo. Revisit if the client's platform team mandates otherwise.

---

## ADR-0003 — Async-only internal API (no synchronous EC endpoint)
**Status:** ACCEPTED (2026-09-10) · **By:** Raakesh

Every EC ultimately depends on an external portal with variable latency and uptime.
A synchronous endpoint would export that flakiness to the ERP. The contract is
submit → webhook, with a polling fallback (`GET /ec-requests/{id}`).

---

## ADR-0002 — Hybrid sourcing, aggregator-first
**Status:** ACCEPTED (2026-09-10) · **By:** Raakesh · **Basis:** REPORT.md §5, §9

Primary source = licensed third-party API (Landeed / SurePass), chosen by RFP.
Fallback = supervised India-hosted browser automation of TNREGINET with a
human-in-the-loop console. Rejected: (a) official TNREGINET/API Setu API — does not
exist; (b) automation-only — too fragile, highest legal exposure, needs a human per
search anyway.

Revisit if: no vendor meets coverage/SLA for the client's districts, or legal
blocks direct automation (then aggregator-only).

---

## ADR-0001 — Canonical EC result model
**Status:** ACCEPTED (2026-09-10) · **By:** Raakesh

One normalised result shape (`docs/canonical-ec-result.md` + JSON Schema). Adapters
map into it; the ERP integrates once. `caveats[]` is the formal channel for any
ambiguity the system detects; the service never emits a legal verdict.

---

## Open / pending

| Ref | Decision | Waiting on |
|---|---|---|
| D7 | Stack confirmed by client (ADR-0004 is provisional) | Client platform team |
| D4 | Whether the browser-automation fallback is built at all | Client + legal (risk appetite) |
| D5 | Ops ownership of the HITL console + Indian SIM/mailbox | Client |
| — | Primary aggregator: Landeed vs SurePass | RFP responses |
| D6 | Data retention window + residency (India) | Client compliance |
