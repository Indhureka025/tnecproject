# RFP (lite) — Tamil Nadu EC API evaluation

**From:** Raakesh R (personal project / prototype evaluation)

Optional attachment to the outreach emails. The full 25-question version
(`rfp.md`) is written for a company procurement process — this trimmed list is
what actually matters for a solo evaluation. Send the full one only if a vendor
asks for it.

## Coverage
1. Do you support **TN Encumbrance Certificate** retrieval via API (not just an app)?
2. Search modes supported: survey-number-wise, document-number-wise, plot/flat-wise?
3. Which districts / SRO offices are covered? Any gaps in [my test districts]?
4. Earliest year of online data. How are pre-1975 / non-digitised periods handled?
5. Informational EC, certified/QR-signed EC, or both? Turnaround for each?

## API
6. Sync or async (webhook / polling)? Sample request + response, please.
7. Structured data (entries, parties, instrument type, dates, amounts) or PDF only?
   Field list / schema?
8. How is "no records found" represented?
9. Sandbox or pay-as-you-go tier for a low-volume evaluation? How do I get a key?
10. Auth model, rate limits.

## Commercials
11. Per-EC price at low volume; developer / free tier to start?
12. Any minimum commitment or monthly fee?

## Good to know
13. On what basis do you access TNREGINET data (independent platform vs authorised channel)?
14. Where is query data processed / stored? Do you retain it, and for how long?

## For a live demo
Sample properties (survey no. / village / SRO / period):
1. [ ___ ]
2. [ ___ ]
3. [ ___ ]
