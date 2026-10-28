# EC Service

Async internal API the client ERP calls to retrieve Tamil Nadu Encumbrance
Certificates. One contract; the data source (licensed aggregator or supervised
browser automation) is hidden behind it.

Contract: [`../docs/internal-api-contract.md`](../docs/internal-api-contract.md) ·
[`../docs/openapi.yaml`](../docs/openapi.yaml).
Architecture: [`../docs/architecture.md`](../docs/architecture.md).

## Status

Built through Phase 4. **130+ automated checks, all green** (`../verification/QA-REPORT.md`).
Runs in-memory (default, no infra) or on Postgres + a durable queue. The `mock`
provider drives everything by default; the Landeed/SurePass adapters are
request/response-mapping stubs pending a sandbox key; the automation worker is
proven E2E against a mock TNREGINET portal (`../verification/mock-portal/`).

## Run

```bash
npm install          # Node >= 22
npm run dev          # http://localhost:8080  (tsx watch)
npm test             # vitest — 50 tests
npm run typecheck    # tsc --noEmit
```

No `.env` needed for a basic run — defaults are baked in. See `.env.example`.

### Backends

| | `BACKEND=memory` (default) | `BACKEND=postgres` |
|---|---|---|
| store | in-process Map | Postgres (`DATABASE_URL`; PGlite embedded by default, real PG in prod) |
| queue | in-process retry/backoff | durable `jobs` table, leased, crash-safe |
| storage | `STORAGE=memory` | `STORAGE=local:<dir>` (S3 later) |

`docker compose up` brings up the Postgres-backed stack.

### Try it

```bash
curl -s -XPOST localhost:8080/v1/ec-requests \
  -H 'authorization: Bearer dev-tenant-key' -H 'content-type: application/json' \
  -H 'idempotency-key: demo-0001' \
  -d '{"searchType":"EC_WISE","certified":false,
       "property":{"zone":"Chennai","district":"Chennai","sroCode":"Thiruvottiyur",
                   "village":"Thiruvottiyur","surveyNumber":"123/4","subdivisionNumber":"1"},
       "period":{"from":"2004-01-01","to":"2024-12-31"},
       "callbackUrl":"https://httpbin.org/post","reference":"ERP-DEAL-1"}'
# -> 202 { "requestId": "...", "status": "queued" }

curl -s localhost:8080/v1/ec-requests/<requestId> -H 'authorization: Bearer dev-tenant-key'
```

Mock-provider survey-number hooks: contains `4` → mortgage entry · `9` → nil-review
HITL · `CAP` → CAPTCHA HITL · `certified:true` → payment + async signing flow.

- Manual test client: <http://localhost:8080/demo>
- Operator console: <http://localhost:8080/> → `/public/console.html`
- Project dashboard: <http://localhost:8080/dashboard>
- Metrics: <http://localhost:8080/metrics>

## Layout

| Path | Role |
|---|---|
| `src/app.ts` / `src/index.ts` | Fastify factory (routes, auth, rate limit, wiring) / entrypoint |
| `src/config.ts` | env → config |
| `src/contract.ts` / `src/canonical.ts` | request/status types + zod schema / canonical EC result model |
| `src/db/` | Postgres access layer (PGlite or real `pg`) + schema |
| `src/store/` | `RequestStore` — `memory`, `postgres` |
| `src/queue/` | `Queue` — `memory`, `postgres` (durable, leased) |
| `src/storage/` | `ObjectStore` — `memory`, `local` (signed URLs) |
| `src/masterdata/` | all 595 TN SROs; `resolveUnit` (zone + SRO, advisory district) |
| `src/providers/` | `EcProvider` + `mock` / `landeed` / `surepass` / `automation` (+ `automation-worker` Playwright) / `router` |
| `src/parse/` | `ec-html` results-table parser + fixtures · `ocr` (tesseract.js) |
| `src/webhook/` | HMAC signing + retrying delivery |
| `src/hitl/` | human-in-the-loop task model (captcha/otp/nil_review/ocr_review/payment) + operator routes |
| `src/render/ec-doc.ts` | canonical result → HTML EC summary |
| `src/metrics.ts` | in-process counters/timers → `/metrics` |
| `src/pipeline.ts` | orchestration incl. the certified async state machine |
| `public/` | operator console · dashboard · manual test client |

## What still needs external access

Real Landeed/SurePass responses (sandbox key) · the automation worker against the
real geo-blocked portal (India runner + account) · a real payment gateway ·
managed Postgres/Redis under production load.
