# RFP — Tamil Nadu EC retrieval API

**From:** [Client] via Raakesh R
**Re:** B2B API for programmatic retrieval of Tamil Nadu Encumbrance Certificates
**Response requested by:** [date, ~2 weeks out]

We are integrating TN EC retrieval into a client ERP and are evaluating API
providers. Please answer inline; a call after is welcome.

## A. Coverage

1. Do you cover **Tamil Nadu EC** retrieval today via API (not just app)? Since when?
2. Which **search modes** are supported: EC-wise (zone/district/SRO/village/survey/subdivision),
   document-number-wise, plot/flat/ward-block-wise?
3. Which **districts / SRO offices** are covered? Any known gaps? (Our in-scope list: [attach])
4. Earliest year of data available online. How do you handle **pre-1975 / non-digitised** periods?
5. Do you return an **informational** EC, a **certified / digitally-signed (QR)** EC, or both?
   Typical turnaround for each?

## B. API

6. Sync or async? If async, callback/webhook or polling? Sample request + response payloads.
7. Do you return **structured data** (list of entries, parties, instrument type, dates,
   amounts) or only a PDF? Field list / schema please.
8. How is a **"no records found"** result represented, and do you distinguish a
   human-verified nil from an unverified one?
9. Sandbox / test environment available? Test credentials + docs link.
10. Auth model, IP allow-listing, API versioning / deprecation policy.

## C. Reliability & scale

11. Published **SLA** (uptime, response time, success rate)? Credits for breach?
12. Rate limits. Expected throughput at [X] requests/day, peak [Y]/hour.
13. How do you handle **TNREGINET downtime / maintenance / portal changes** — retries,
    queueing, status visibility to us?
14. Historical success rate for TN EC over the last 3–6 months.

## D. Compliance & legal

15. On what basis do you access TNREGINET data? Are you an **authorised / empanelled**
    channel of the Tamil Nadu Registration Department, or an independent platform?
16. Will you provide a written **representation & warranty** that data is obtained
    lawfully, plus **indemnity** against third-party/regulatory claims arising from supply?
17. **DPA** available? Where is data processed and stored? Do you retain the ECs /
    property parameters we query, and for how long? Can we require India-only processing
    and zero-retention?
18. Any past regulatory notices, takedowns, or litigation regarding land-record access?

## E. Commercials

19. **Pricing** — per successful EC, tiered by volume; separate price for informational
    vs certified; charge model for "no records" and for failed retrievals.
20. Minimum commitment / setup fee / monthly platform fee.
21. Payment terms; prepaid wallet vs postpaid invoicing.
22. Contract term, notice period, exit / data-portability terms.

## F. Support & onboarding

23. Onboarding timeline from signature to production.
24. Support channels, hours, escalation, technical account manager?
25. Status page / incident comms.

---

**Attachments to send with this RFP:** in-scope district/SRO list; expected volume
(D1 from the scope sheet); our canonical result model (`docs/canonical-ec-result.md`)
so they can tell us how cleanly they map to it.
