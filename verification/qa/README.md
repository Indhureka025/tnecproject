# QA suites

Professional test pass over the EC Service. Report: [`../QA-REPORT.md`](../QA-REPORT.md).

| File | What it does |
|---|---|
| `run-e2e.mjs` | API black-box suite. Spawns its own hermetic service instances (ports 8100/8101) + a webhook receiver, runs the 5 manual test cases plus negative / security / boundary / webhook / performance checks, tears everything down. Writes `results.json`. Exit non-zero on failure. |
| `ui-tests.mjs` | Playwright + Chromium tests for the dashboard and operator console. Spawns instances on 8110/8111. Writes `ui-results.json` and screenshots to `screens/`. Needs `cd poc && npm install && npx playwright install chromium` first. |
| `webhook-sink.mjs` | Standalone webhook receiver used by `run-e2e.mjs`. Independently verifies the HMAC signature on every delivery. |
| `record-walkthrough.mjs` | Records a ~32 s screen video of a live manual-test session (dashboard → demo client → CAPTCHA operator flow). Output in `video/` as `.webm` + `.gif`. |
| `kill-orphans.ps1` | Manual cleanup if a run is interrupted and leaves services on test ports. |

## Run

```bash
cd service && npm test                       # 33 unit/integration
node verification/qa/run-e2e.mjs              # 30 API black-box
node verification/qa/ui-tests.mjs             # 16 browser UI
node verification/qa/record-walkthrough.mjs   # re-record the video
```

All three are independent and each cleans up after itself.
