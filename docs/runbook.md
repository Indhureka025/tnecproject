# Runbook — EC Service

On-call procedures. Phase 1 owns paging; Phase 0 is best-effort.

## Health checks

- `GET /healthz` → `{ ok: true, providers: [...], backend }`
- Queue depth, DLQ size (Phase 1: BullMQ dashboard / metrics)
- Operator queue depth: `GET /ops/tasks?status=open`
- Provider circuit-breaker state (Phase 1: metric `ec_provider_breaker_open{provider=}`)

## Incident: TNREGINET portal down / maintenance

**Symptoms:** automation jobs failing `portal_unavailable`; aggregators may also slow/fail.

1. Confirm: check the portal from an India IP or a status source. Government maintenance windows are common early morning IST.
2. The queue auto-retries `retryable` failures with backoff — no action needed for a short outage.
3. If outage > 1h: post an internal notice; the ERP sees `portal_unavailable` and should show "temporarily unavailable". Certified-EC SLAs pause.
4. Do **not** raise concurrency or hammer retries — risks IP/account blocks.

## Incident: aggregator outage / elevated errors

**Symptoms:** `provider_error` rate up for `aggregator:landeed` (or surepass); circuit breaker opens.

1. Router auto-fails-over to the next provider in `PROVIDER_ORDER`. Confirm the secondary is healthy.
2. If both aggregators are down, jobs fall to `automation` (if `D4` allows) — expect slower, human-touched throughput.
3. Open a ticket with the vendor; attach `sourceReference` IDs from failed requests.
4. When recovered: breaker closes automatically after the cooldown; or restart the service to reset.

## Incident: TNREGINET DOM changed (automation selectors broken)

**Symptoms:** automation jobs failing mid-flow; `poc` run summaries show `FAIL` at a step with a DOM dump.

1. Pull the latest `FAIL__*.html` / `FAIL__*.png` artifacts for the failing step.
2. Update the selector candidate lists in `poc/ec-search.mjs` (and the worker's equivalent) — see `poc/SELECTORS.md`.
3. Re-run the `poc` from India against a known test property to confirm.
4. Deploy the worker patch. Meanwhile route traffic to aggregators.

## Incident: TNREGINET account pool locked / deactivated

**Symptoms:** automation login failing; `captcha_unrecoverable` or auth errors.

1. Accounts deactivate on two clocks, confirmed from the portal's own registration
   notice: a **new** account auto-deactivates if not used within **7 days** of
   creation; an **existing** account auto-deactivates if not used for **3 months**
   from its last activity. Check the keep-alive cron ran, and — for a freshly
   created account — that someone actually used it once inside the first week.
2. Rotate to a spare account in the pool.
3. Re-activate locked accounts manually (login + OTP from the controlled mailbox/SIM). This is an ops task.
4. Root-cause: were we hitting rate limits? Reduce per-account concurrency.

## Incident: operator queue backing up

**Symptoms:** `GET /ops/tasks?status=open` growing; `needs_human` requests aging.

1. Page the ops lead — more operators or extend hours.
2. Check whether one request type is generating excessive `nil_review` tasks (bad master data → wrong village → false nils).
3. Temporarily raise the HITL await timeout so jobs don't expire while the queue drains.

## Incident: webhook delivery failing to the ERP

**Symptoms:** `webhook.gave_up` in logs; ERP reports missing results.

1. Confirm the ERP callback endpoint is up and its signature verification matches `WEBHOOK_SIGNING_SECRET`.
2. Results are safe in the store — the ERP can `GET /ec-requests/{id}` to reconcile.
3. Phase 1: replay from the webhook outbox once the endpoint recovers.

## Routine: onboarding a new aggregator

1. Get sandbox creds; set `LANDEED_*` / `SUREPASS_*` env.
2. Fill in the real endpoint + response mapping in the adapter (`providers/*.ts`) — the `CONFIRM` comments list what to verify.
3. Run the aggregator sandbox spike: one EC → canonical result; diff against expectations.
4. Add the adapter name to `PROVIDER_ORDER`.
5. Watch success rate + turnaround for a week before making it primary.

## Routine: refreshing master data

1. From an India IP, walk the portal's cascading Zone→District→SRO→Village dropdowns (or obtain the official SRO master list).
2. Regenerate `service/src/masterdata/tn-registration-units.json`.
3. Run `npm test` — `masterdata.test.ts` will flag structural breakage.
