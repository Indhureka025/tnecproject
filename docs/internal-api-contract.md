# EC Service — internal API contract

The single contract the client's ERP/CRM integrates against. The ERP does not know
or care whether an EC came from an aggregator or from browser automation.

**Style:** async. Submit → get a `requestId` → receive the result by webhook (with a
polling fallback). Nothing blocks on portal/vendor latency.

**Base URL (staging):** `https://ec-svc.staging.<client>.internal/v1`
**Auth:** per-tenant. mTLS, or `Authorization: Bearer <api-key>` + HMAC request
signature (`X-Signature`, `X-Timestamp`). Rotate keys per tenant.

---

## POST /ec-requests

Submit an EC retrieval request.

**Headers**

| Header | Required | Notes |
|---|---|---|
| `Idempotency-Key` | yes | UUID. Same key + same body → same `requestId`, no new work. |
| `Authorization` / `X-Signature` | yes | See Auth. |

**Body**

```jsonc
{
  "searchType": "EC_WISE",              // EC_WISE | DOCUMENT_WISE | PLOT_FLAT_WARD_WISE
  "certified": false,                   // false = informational PDF; true = SRO-signed (async, 1–10 days)
  "property": {
    "zone": "CHENNAI",
    "district": "CENTRAL CHENNAI",
    "sroCode": "TVL",                   // Sub-Registrar Office
    "village": "THIRUVOTTIYUR",
    "surveyNumber": "123/4",
    "subdivisionNumber": "1",
    // for DOCUMENT_WISE instead:
    "documentNumber": null,
    "registrationYear": null
  },
  "period": { "from": "2004-01-01", "to": "2024-12-31" },  // ISO dates
  "callbackUrl": "https://erp.<client>.internal/hooks/ec",
  "reference": "ERP-DEAL-88213",        // opaque, echoed back
  "priority": "normal"                  // normal | high
}
```

**Responses**

| Code | Meaning | Body |
|---|---|---|
| `202 Accepted` | Queued | `{ "requestId": "...", "status": "queued", "estimate": { "type": "minutes"|"days", "value": 5 } }` |
| `200 OK` | Idempotency-Key hit an existing request | current status object |
| `400` | Validation failed | `{ "error": "validation", "details": [ { "field": "...", "message": "..." } ] }` |
| `401 / 403` | Auth | — |
| `409` | Same Idempotency-Key, different body | `{ "error": "idempotency_conflict" }` |
| `422` | Well-formed but unusable (e.g. unknown SRO code) | `{ "error": "unresolvable", "details": [...] }` |
| `429` | Tenant rate limit | `Retry-After` header |

---

## GET /ec-requests/{requestId}

Poll for status/result (fallback for missed webhooks).

```jsonc
{
  "requestId": "9f1c...",
  "reference": "ERP-DEAL-88213",
  "status": "completed",   // queued | in_progress | needs_human | completed | partial | failed
  "certified": false,
  "source": "aggregator:landeed",       // aggregator:<name> | automation
  "submittedAt": "2026-09-10T09:00:00Z",
  "completedAt": "2026-09-10T09:04:12Z",
  "result": { /* canonical EC result — see docs/canonical-ec-result.md */ },
  "documents": [
    { "kind": "ec_pdf", "url": "https://.../ec.pdf?token=...", "expiresAt": "2026-09-10T10:04:12Z", "sha256": "..." }
  ],
  "failure": null                        // populated when status = failed/partial
}
```

**Status meanings**

| Status | Meaning |
|---|---|
| `queued` | Accepted, not started |
| `in_progress` | Being fetched from a provider |
| `needs_human` | Parked for an operator (CAPTCHA / OTP / QA). Still progressing — not an error. |
| `completed` | Result + document(s) available |
| `partial` | Result available but flagged (e.g. period only partly digitised, OCR low-confidence) — see `result.caveats` |
| `failed` | Could not complete — see `failure` |

---

## Webhook — POST {callbackUrl}

Sent on every terminal state and on `needs_human`. Signed (`X-Signature`, `X-Timestamp`);
retried with backoff for 24h; idempotent on `eventId`.

```jsonc
{
  "eventId": "evt_...",
  "event": "ec.completed",     // ec.received | ec.needs_human | ec.completed | ec.partial | ec.failed
  "requestId": "9f1c...",
  "reference": "ERP-DEAL-88213",
  "occurredAt": "2026-09-10T09:04:12Z",
  "data": { /* same shape as GET /ec-requests/{id} */ }
}
```

The ERP should treat `ec.completed` / `ec.partial` as "fetch the document via the
signed URL and store your own copy" — URLs are short-lived.

---

## Failure object

```jsonc
{
  "code": "portal_unavailable",   // validation | unresolvable | portal_unavailable |
                                  // provider_error | no_records_unconfirmed | payment_required |
                                  // not_digitised | captcha_unrecoverable | timeout
  "message": "human-readable",
  "retryable": true,
  "operatorNote": "optional note from HITL QA"
}
```

- `no_records_unconfirmed` — the portal/provider returned nothing **and** a human has
  not yet confirmed it is a genuine clean result. The ERP must **not** treat this as
  "no encumbrance".
- `not_digitised` — the requested period predates digitisation (~1975); needs a manual
  SRO visit.

---

## Design notes

- **No synchronous "get me an EC now" endpoint.** Even informational ECs depend on an
  external portal; forcing sync would just export its flakiness to the ERP.
- **One document store, short-lived URLs.** The service keeps the canonical copy +
  audit trail; the ERP keeps its own copy for the deal file.
- **Idempotency + dedupe are different.** Idempotency-Key stops double-submits.
  Server-side dedupe (identical SRO+survey+subdivision+period within N days) is a
  cost optimisation and is disabled for `certified: true`.
- **The service never returns a legal verdict** — only registered entries, the exact
  parameters/period searched, and `caveats`.
