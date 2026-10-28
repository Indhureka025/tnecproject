# AI verification record

**Status:** `AI VERIFIED` — automated tests pass and Claude ran the flows end-to-end
in this environment. **Pending human sign-off** (a person's own click-through).
`SIGNED OFF` is reserved for that.

**Date:** 10 September 2026 · **Env:** Windows 11, Node 22.13, service on localhost.

> **This is the Phase-0 first-pass record.** The project has since been built
> through Phase 4 (Postgres + durable queue, 595-SRO master data, browser
> automation vs a mock portal, OCR, certified async flow, ERP contract). The
> current record — **130+ checks across 7 suites** — is in
> [`QA-REPORT.md`](QA-REPORT.md).

## 1. Automated suite

```
$ npm run typecheck      # tsc --noEmit — clean, 0 errors
$ npm test               # vitest
  Test Files  7 passed (7)
  Tests       31 passed (31)
```

Suites: `validation`, `idempotency`, `masterdata`, `parse`, `router`, `webhook`, `lifecycle`.
See `docs/test-plan.md`.

## 2. Live service — end-to-end (mock provider)

Started `npx tsx src/index.ts` on :8080.

- `GET /healthz` → `{"ok":true,"providers":["mock","aggregator:landeed","aggregator:surepass","automation"],"backend":"memory"}`
- `POST /v1/ec-requests` (survey `123/4`) → `202 {status:"queued"}`
- `GET /v1/ec-requests/{id}` → `status:"completed"`, `outcome:"ENTRIES_FOUND"`,
  `encumbrancePresent:true`, one `MORTGAGE` entry with parties/dates/amounts, and the
  standing disclaimer string present.

Full response captured in `sample-run.json`.

## 3. Human-in-the-loop — operator console

Started a second instance with `HITL_MODE=console PROVIDER_ORDER=automation`.

- `POST /v1/ec-requests` → automation provider opened a `captcha` HITL task; request
  status went to `needs_human`; `ec.needs_human` webhook fired.
- Operator console (`/public/console.html`) rendered the CAPTCHA card with the
  context and an input + Submit. Screenshot: `console-captcha.png` (description
  below — binary not committed).
- `POST /ops/tasks/{id}/answer {kind:"captcha",value:"AB12CD"}` → task `answered`,
  `operatorId:"console-user"`; console then showed the empty state.
- Automation provider resumed and returned `failed / portal_unavailable`
  ("browser-automation worker not deployed (Phase 3). TNREGINET is also
  geo-restricted to India.") — the honest, expected outcome. The point proven:
  **the human step works and the job is never silently dropped.**

## 4. Screenshots (visually confirmed by Claude; binaries not in repo)

| Name | What it showed |
|---|---|
| `dashboard.png` | Project dashboard renders: status tiles, "what's built", 5 manual test step-cards each with numbered steps, a "what you should see" box, PASS/FAIL boxes, and an `AI VERIFIED` badge; decisions table; next actions. Dark + light palettes both defined. |
| `console-captcha.png` | Operator console with one open CAPTCHA task: request id, task id, context JSON, text input, Submit button. |
| `console-empty.png` | Operator console after answering: "No open tasks" empty state, "0 open" counter. |

## 5. Not verified here (needs external access)

- Real Landeed / SurePass API responses — needs vendor sandbox.
- Live TNREGINET automation (form fill → CAPTCHA → submit → PDF) — needs an India
  IP and the Phase-3 worker; `poc/SELECTORS.md` is the lock-down checklist.
- Postgres store, BullMQ queue, load behaviour.

## How to reproduce

```bash
cd service
npm install
npm run typecheck && npm test
npm run dev                 # then the curl commands in service/README.md
# operator console flow:
HITL_MODE=console PROVIDER_ORDER=automation npm run dev
```
