# Client scope sheet — TN EC Integration

Please fill in. These answers unblock vendor pricing, the architecture, and the
Phase-1 build estimate. Nothing here changes the interface your ERP team codes to.

## D1 — Volume & mix
- Approx. EC checks per month: ______
- Of those, how many need a **certified / digitally-signed** EC (for banks / courts / registration) vs an **informational** one? ______
- Expected peak (checks in a single day)? ______
- Is volume steady, or tied to deal flow / seasonality? ______

## D2 — Geography
- Which TN **districts** are in scope? ______
- Which **Sub-Registrar offices** (if known)? ______
- Any properties outside Tamil Nadu? ______

## D3 — Budget
- Rough budget per EC lookup (helps us pick vendor tier vs build): ______
- Is a monthly platform fee acceptable, or strictly pay-per-use? ______

## D4 — Risk appetite
- Are you comfortable with us running **our own automation** against the TNREGINET portal as a fallback, or should we use **licensed data vendors only**? ______
- Do you have a legal/compliance contact we should loop in now? ______

## D5 — Operations
- Who will staff the **operator console** (clears CAPTCHA / OTP / reviews "no records")? Existing team, or new? ______
- Who owns an **Indian mobile number + email** dedicated to this (for portal OTPs)? ______
- What hours does that team cover? ______

## D6 — Data & compliance
- Retention: how long should we keep retrieved ECs and the property/party data? ______
- Any requirement that all processing/storage stays **in India**? ______
- Do you need a signed DPA with any data vendor? ______

## D7 — Technology
- Any constraint on our stack? (Proposed: Node + TypeScript, Postgres, Redis, deployed in an India cloud region.) ______
- Where will this run — your cloud account, ours, or on-prem? ______
- How does your ERP prefer to receive results — **webhook**, **polling**, or both? ______
- Your ERP's callback endpoint URL (staging): ______

## D8 — Government relationship
- Do you (or the client) have any existing relationship, MoU, or contact with the **TN Registration Department / IGR / TNeGA**? ______
- Any appetite to pursue an official data-sharing agreement in parallel (longer, but removes the vendor dependency)? ______

---

**Also useful now:** 3–5 **real sample properties** (survey no. + village + SRO) we
can use to validate coverage with vendors and, later, the automation flow.
