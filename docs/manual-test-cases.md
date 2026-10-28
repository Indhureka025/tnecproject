# Manual test cases — plain language

For a non-technical tester. Each case: what it checks · numbered steps · what you
should see · pass/fail. Technical notes are in a separate block at the end, never
mixed into the steps.

Setup (once): open a terminal in the `service` folder, run `npm install`, then
`npm run dev`. Leave it running. "Send a request" below means run the sample
command from `service/README.md` (adjust the values as the step says).

---

## TC1 — Get an EC result back for a property

**What this checks:** the ERP can ask for an Encumbrance Certificate and get a
structured answer, without anyone opening the government website.

1. Send a request for: Chennai zone, North Chennai district, office code `CHN-NO-TVL`, survey number `123/4`, dates `2004-01-01` to `2024-12-31`.
2. Note the `requestId` in the reply.
3. Ask for the status using that `requestId`.

**What you should see:** the first reply says `queued`. Within a few seconds the
status becomes `completed`. The result lists one mortgage entry (borrower, bank,
dates, amount) and a flag `encumbrancePresent: true`, plus a sentence saying an EC
is not proof of ownership.

**Result:** ☐ Pass ☐ Fail

---

## TC2 — A person can clear a CAPTCHA the robot got stuck on

**What this checks:** when the automated route hits a CAPTCHA, a staff member can
solve it and the job carries on — it is never dropped silently.

1. Stop the service. Start it again with operator mode on (set `HITL_MODE=console` and `PROVIDER_ORDER=automation`, then `npm run dev`).
2. Open the operator console page in a browser (`/public/console.html`).
3. Send any EC request.
4. A "captcha" card appears on the console. Type any text and click **Submit**.

**What you should see:** the card disappears. The request briefly showed a
"needs a person" state, then continued. (It then says the government portal isn't
reachable — that's expected from outside India and is a separate later piece of
work. The thing being tested here is that the human step works.)

**Result:** ☐ Pass ☐ Fail

---

## TC3 — A wrong office code is rejected with a helpful message

**What this checks:** bad location details fail immediately with a clear message,
not a confusing error later on.

1. Send an EC request but set the office code to `NOPE-999`.
2. Check the status.

**What you should see:** status `failed`, reason `unresolvable`, and a message that
lists the office codes that *are* valid for that district.

**Result:** ☐ Pass ☐ Fail

---

## TC4 — "Nothing found" is never reported as "clean title"

**What this checks:** an empty result must not be turned into "this property is
clear" unless a person has confirmed the search was done correctly.

1. Send an EC request with survey number `777`.
2. Check the result.

**What you should see:** status `partial`, outcome `NIL_UNCONFIRMED`, and the
"encumbrance present" field is `null` (unknown) — **not** `false`. There is a note
saying it hasn't been confirmed by an operator.

**Result:** ☐ Pass ☐ Fail

---

## TC5 — The same lookup twice doesn't cost twice

**What this checks:** if the identical search is asked for again within two weeks,
the saved answer is reused instead of paying a data provider again.

1. Stop the service; start it with `DEDUPE_WINDOW_DAYS=14`.
2. Send an EC request for survey `123/4`; wait for it to complete.
3. Send the exact same request again (use a different idempotency key).

**What you should see:** the second one finishes almost instantly with the same
result. The service log shows a `dedupe_hit`.

**Result:** ☐ Pass ☐ Fail

---

<details>
<summary>Technical notes (files, functions, coverage)</summary>

| Case | Automated coverage | Key code |
|---|---|---|
| TC1 | `test/lifecycle.test.ts` "completes with ENTRIES_FOUND" | `src/pipeline.ts`, `src/providers/mock.ts` |
| TC2 | `test/lifecycle.test.ts` "goes through needs_human", `test/router.test.ts` | `src/hitl/*`, `src/providers/automation.ts`, `public/console.html` |
| TC3 | `test/lifecycle.test.ts` "fails with 'unresolvable'", `test/masterdata.test.ts` | `src/masterdata/index.ts` |
| TC4 | `test/lifecycle.test.ts` "returns partial + NIL_UNCONFIRMED", `test/parse.test.ts` | `src/canonical.ts` `deriveOutcome()` |
| TC5 | `test/lifecycle.test.ts` `describe("dedupe")` | `src/util/hash.ts`, `src/pipeline.ts` |

Root cause context: there is no official EC API, so the service wraps swappable
sources (aggregator / automation) behind one contract. The mock provider stands in
until aggregator sandbox access exists. TNREGINET is geo-restricted, so the live
automation last-mile is a Phase-3 task run from India.
</details>
