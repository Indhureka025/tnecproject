# Working assumptions

The client has not yet answered the D1–D8 decisions (see `PROJECT.md` §4 and
`client-scope-sheet.md`). The Phase-0 build proceeds on these assumptions. Each is
cheap to revise; none is baked into the ERP-facing contract.

| ID | Assumption | Why chosen | Revisit when |
|---|---|---|---|
| A1 | Primary source will be a licensed aggregator (Landeed or SurePass); own automation is a fallback, not the default. | Feasibility conclusion (`REPORT.md` §9). Lower legal + ops risk. | D4 answered, or legal blocks aggregators. |
| A2 | Volume is "moderate" — hundreds to low-thousands of EC checks/month, mostly informational. | Typical for a single-ERP client doing title due diligence. Drives "1–2 concurrent sessions per account" sizing and per-EC pricing tier. | D1 answered. |
| A3 | The client's properties are spread across mainstream TN districts (Chennai / Chengalpattu / Coimbatore / Madurai belt), not obscure taluks. | Aggregator coverage is strongest there; master-data seed reflects it. | D2 answered — then load the full SRO list. |
| A4 | Certified ECs are a minority of requests and a 1–10 day SLA is acceptable. | Government-side signing makes faster impossible on any channel. | D1 / latency tolerance answered. |
| A5 | Dedupe window for informational ECs = 14 days; certified never deduped. | Balances cost saving against staleness for active due diligence. `config.dedupeWindowDays`. | Client states a freshness requirement. |
| A6 | Webhook retry budget = 8 attempts, 2s base exponential backoff (~4 min total). | Standard for internal service-to-service delivery. | ERP team states their ingest SLA. |
| A7 | Tech stack: Node 22 + TypeScript + Fastify + Postgres (durable queue on Postgres, no Redis — ADR-0006). | Matches the client's Node/React estate; one datastore to run. **Built on this.** | D7 sign-off. |
| A8 | HITL operators are India-based and reachable during IST business hours; overnight queue drains next morning. | Only workable model given Indian-mobile OTP + geo-restriction. | D5 answered. |
| A9 | Data is processed and stored in an India region (ap-south-1 / Central India). | Portal geo-restriction + likely client data-residency preference. | D6 answered. |
| A10 | The ERP can consume an async contract (submit → webhook) and show a "pending" state. | Any portal-backed retrieval is inherently async. | ERP team review of `openapi.yaml`. |
| A11 | Master data now covers all 595 SROs / 11 zones (`tn-sros.json`, from the public Proquiro directory). District-level and village jurisdiction still need TNREGINET data. | Proquiro cites the TN Registration Dept, verified Apr 2026. | Cross-check against TNREGINET "Know Your Jurisdiction" from India. |
| A12 | TNREGINET EC results HTML structure roughly matches `service/src/parse/__fixtures__/` and `verification/mock-portal/`. | Portal unreachable from the build environment; fixtures + mock portal are synthetic-but-representative. | First real run from India — capture real HTML, update parser + fixtures. |
