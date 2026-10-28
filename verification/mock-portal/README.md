# Mock TNREGINET portal

A stand-in for `tnreginet.gov.in` used to prove the browser-automation provider
end to end. The real portal is geo-restricted to India and needs a registered
account, so it cannot be driven from this environment — this mock reproduces the
same friction so the *worker logic* can be tested:

- login page: username + password + text CAPTCHA
- EC search form: Zone → District → SRO selects, village, survey/subdivision, dates, CAPTCHA
- an OTP prompt for some searches
- results as an HTML table (column order matches `service/src/parse/ec-html.ts`), or "no records"

CAPTCHA/OTP answers are exposed in a hidden element so unattended tests proceed;
a real operator would read the image. The automation worker never solves them.

```bash
node verification/mock-portal/server.mjs --port 8170
# then point the service at it:
AUTOMATION_PORTAL_URL=http://localhost:8170 PROVIDER_ORDER=automation \
AUTOMATION_USERNAME=worker AUTOMATION_PASSWORD=worker npm --prefix service run dev
```

End-to-end test: `node verification/qa/automation-e2e.mjs`.

## Behaviour hooks

| Survey number | Result |
|---|---|
| contains `4` | two entries (sale + mortgage) |
| ends in `7` | OTP step, then entries/nil per the `4` rule |
| otherwise | "No Encumbrance found" |
