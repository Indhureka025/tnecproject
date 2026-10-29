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

No `.env` is needed for a basic run — defaults are baked in. If `service/.env`
exists, `npm run dev` and `npm start` load it automatically. Restart the server
after changing `.env`.

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
- Operator console: <http://localhost:8080/public/console.html> (open this
  separately while a request is waiting; the demo page does not redirect there)
- Project dashboard: <http://localhost:8080/dashboard>
- Metrics: <http://localhost:8080/metrics>

### Test the operator handoff

To exercise the demo CAPTCHA task without a live portal, set these values in
`service/.env`, restart `npm run dev`, choose **CAPTCHA step (operator)**, and
open the operator console in another tab:

```dotenv
PROVIDER_ORDER=mock
HITL_MODE=console
```

This is only a workflow simulation; it does not display or validate a real
CAPTCHA. For a live CAPTCHA, use `PROVIDER_ORDER=automation` and configure
`AUTOMATION_PORTAL_URL` for an accessible portal runner. The real portal needs
an India-hosted worker; without a portal URL the automation provider has no
CAPTCHA image to show and cannot retrieve an EC.

### Connect the standalone Playwright POC

The `poc/ec-search.mjs` runner can send its real portal CAPTCHA image to this
service's operator console and wait for the operator's answer:

1. Generate a private bridge token:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Put that token in `service/.env` as `OPERATOR_BRIDGE_TOKEN=<token>` and set
   `HITL_MODE=console`. Restart the service.
3. In the ignored local `poc/config.json`, add:

   ```json
   "operatorConsole": {
     "baseUrl": "http://localhost:8080",
     "bridgeToken": "<the same token>"
   }
   ```

4. Run `npm run ec:search` from `poc`. When a CAPTCHA appears, the runner opens
   the operator console in another browser tab and waits for the answer. With
   both settings empty, CAPTCHA input continues to use the terminal.

The bridge refuses task creation unless the token is configured and
`HITL_MODE=console`; this prevents auto-answer mode from bypassing the operator.
Keep the service and console on a trusted local machine: the console UI itself
is intended for local development and is not protected by production
authentication. The bridge only carries CAPTCHA tasks; OTP input remains in
the terminal.

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
