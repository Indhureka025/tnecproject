# Vendor outreach pack

For evaluating a licensed Tamil Nadu EC data provider as the data source, instead
of automating the TNREGINET portal. See `REPORT.md` §5 for the comparison.

**Context:** Raakesh is pursuing this as a personal project. The emails go out under
his own name — framed as a developer evaluation, not company procurement.

## Files

| File | What |
|---|---|
| `email-landeed.md` | Draft email to Landeed — `customers@landeed.com` (verified) + the contact form / API page |
| `email-surepass.md` | Draft email to SurePass — `contact@surepass.io` (verified) + self-serve get-api-key |
| `rfp-lite.md` | ~14-question list — optional attachment, right-sized for a solo eval |
| `rfp.md` | Full 25-question RFP — company-procurement style; send only if a vendor asks |
| `sample-properties.md` | Real TN properties (from public court records) for the sandbox test + a "no records" test |
| `attachment-in-scope-districts.md` | District/SRO list template (fill with your test districts) |
| `attachment-expected-volume.md` | Volume template — for a personal project this is just "tens/month while prototyping" |

## Before sending

1. Fill the `[ ]` placeholders — phone (optional), test districts, a response-by date.
2. List 3–5 real sample properties (survey no. + village + SRO + period) for the demo.
3. Send from raakeshofficial7777@gmail.com.

**Claude drafts only — Raakesh sends these.**

## Contact addresses — provenance

- `contact@surepass.io` — **verified** on surepass.io/contact-us (appears repeatedly;
  phone +91 9990690960). Self-serve key: surepass.io/get-api-key.
- `customers@landeed.com` — **verified** on landeed.com/contact and the Document
  Procurement API page. Landeed's contact page is half-templated (shows placeholder
  addresses like "Sales@yoursite.com"), so prefer the contact form and the API page
  https://www.landeed.com/document-procurement-api.
- `ravi@landeed.com` — surfaced only in third-party writeups (search summaries),
  likely the founder; **not confirmed on any official Landeed page.** Fallback only.

## Realistic expectations for a personal project

- **SurePass** has a self-serve API-key flow — you may be able to start testing
  without waiting for a reply. EC may need a separate onboarding; the email asks.
- **Landeed**'s API is sales-led ("Contact dev sales"); a personal project may get
  a slower or lighter response, or a pointer to a pay-as-you-go tier. That's fine.
- Enterprise asks (DPA, warranty, indemnity, SLA credits) don't really apply to a
  solo project — they're in `rfp.md` for if this ever becomes a real client build.

## After a reply

Get a test key → pull one real EC through each → map it to the canonical model
(`docs/canonical-ec-result.md`) → compare coverage / price / fit → wire the real
adapter (`service/src/providers/landeed.ts` / `surepass.ts`) and retire the mock.
