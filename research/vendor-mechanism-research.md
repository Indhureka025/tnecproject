# How do Landeed / SurePass actually get TN EC data? (research pass)

**Question:** Since there's no government API and vendors haven't replied yet, how do
these companies source the data — and can we just do the same thing ourselves?

**Method:** public sources only — company sites, a founder press interview, an
independent analysis blog, GitHub, Hacker News. No portal probing, no attempt to
find or use a bypass. Nothing here was reverse-engineered from their product —
it's a synthesis of what's already public, plus applying industry-standard
knowledge of how this category of company works in India.

## What's actually said, verbatim

| Source | Quote |
|---|---|
| landeed.com | "Landeed sources documents directly from government databases and provides authentic records." |
| landeed.com (marketing, aimed at agent-based competitors) | "...fetches all records directly from official state portals... **with no agents**, no delays, no uncertainty." |
| YourStory founder interview, Sep 2022 | "As sourcing from the government takes time, users find it easy... users pay for document aggregation." (Sanjay Mandava, co-founder) |
| Independent analysis (LegiScore blog) | "Each portal query is submitted as its own job, runs independently, and reports back when it finishes, while a durable ledger records what was searched and what came back." |
| SurePass product pages | "uses government land record databases" / "checks the information from the department" — no method stated. |

That's it. **No vendor — including SurePass, whose other products (Aadhaar, PAN)
do have real licensed government integrations they openly cite — states a specific
mechanism for land records.** No GitHub repo, no Hacker News thread, no engineering
blog post describes a TNREGINET (or any state EC portal) integration.

## What that silence itself tells you

When a company has a genuine licensed data-sharing agreement, they say so — it's a
trust signal, good marketing, and often a compliance requirement (SurePass does
exactly this for Aadhaar/PAN elsewhere on their own site). The fact that **land
records get the vaguest language on the entire site** ("directly from government
databases", no partner named, no MoU cited) is itself informative: the honest
description would likely cost them users' trust, which points at automation
against the same public citizen-facing portal everyone else uses — not a special
government channel.

The LegiScore description — one job per portal, async, durable ledger — describes
an **RPA/browser-automation backend**, not a client calling a REST API. That's the
shape you build when the "API" you're integrating with is actually a website meant
for humans, with per-portal quirks and variable latency. It's also, structurally,
**exactly the architecture already built in this repo** (`service/src/queue/`,
`pipeline.ts`, one provider per source, an audit trail) — which is a good sign we
scoped this correctly, not a coincidence to chase further.

## So what is the mechanism, most likely

Best-supported reconstruction, in descending order of how well the evidence backs it:

1. **Browser automation (RPA) against the same public TNREGINET portal a citizen
   would use**, at scale, from India-based infrastructure — this is what "no
   agents" + "directly from... portals" + the job-queue architecture all point to.
2. **CAPTCHA is the one step they don't talk about at all**, anywhere. Industry-standard
   options for this step, in order of how ethically/legally different they are:
   - *A human in the loop* — an operator (in-house or outsourced) clears it manually,
     same as the console this project already built. Legitimate; slow at real scale.
   - *A commercial CAPTCHA-solving service* (2Captcha, Anti-Captcha, CapMonster —
     real, widely-used services, mostly human-solve-as-a-service abroad) — this
     crosses from "automating a public page" into "defeating a bot-detection
     control the site owner put there on purpose." This is the point past which I
     won't help build or wire anything up — it's an explicit no for me regardless
     of who else does it.
   - *An ML/OCR solver trained on that specific portal's CAPTCHA style* — same
     legal/ethical line as above, just in-house instead of outsourced.
3. **A field-agent / "document writer" network for the minority of cases** (older
   records, certified/signed copies, portal outages) — TN Sub-Registrar Offices
   have licensed private "document writers" with registered bulk-access accounts
   as part of their normal job. Some regional players plug into that network
   instead of (or alongside) automation. Landeed's own copy explicitly disclaims
   using agents, which is a hint this is how some *competitor* does it, or how the
   category used to work before automation matured.
4. **A registered “authorised user” status directly with the Registration Department** —
   possible in principle (this is the closest thing to a real "official channel"
   short of a formal government API), but nothing public confirms any vendor has
   this specifically for TN, and this doc's earlier research (`findings.md`) found
   no public evidence of such a program existing.

None of this is a confirmed inside account — it's the most defensible reading of
everything publicly available, cross-checked against how this category of company
is known to operate elsewhere in India (the same pattern shows up for RTO/vehicle
data, GST, and court-record aggregators).

## What this means for "build it ourselves"

**The honest news: this project already built the thing being asked about.**
Phase 3 (`service/src/providers/automation-worker.ts`) is exactly option 1+2a above —
browser automation against the real portal, CAPTCHA/OTP routed to a human operator,
never auto-solved. It's proven end-to-end against a look-alike of TNREGINET
(`verification/mock-portal/`). The only thing standing between "proven on a
stand-in" and "doing what Landeed does" is:

- running it from an **India-region server** (the real portal geo-blocks this
  environment — confirmed directly, not assumed),
- a **real TNREGINET test account**, and
- accepting the same **legal exposure** every one of these companies is quietly
  carrying: TNREGINET's terms don't authorise automated access, and nobody in this
  space appears to have a documented waiver for it. `REPORT.md` §3.3 already flagged
  this as the highest-risk item in the direct-automation path — this research
  doesn't reduce that risk, it just confirms it's the bet the whole industry has made.

**Recommendation: keep both tracks open, don't treat the vendor route as dead yet.**
- It's been well under 48 hours since the emails went out — B2B replies routinely
  take 1–2 weeks, especially to a personal-project inquiry. "Not connecting" is too
  early a read; a follow-up in ~5–7 business days is the normal next move, not a pivot.
- In parallel, the direct-automation path is genuinely ready to try in a limited,
  low-volume way: get one India-region VM, register one test TNREGINET account,
  and run the existing worker for real — with you (or an operator) clearing
  CAPTCHA/OTP by hand, exactly as designed. That's a few hours of setup, not new
  engineering, and it's the same bet Landeed/SurePass made, made consciously
  instead of by accident.
- What I won't build regardless of outcome: anything that auto-solves CAPTCHA or
  otherwise defeats the portal's anti-automation controls. That line stays fixed
  whether or not a competitor crosses it.

## Sources
- [landeed.com](https://www.landeed.com/) / [landeed.com/post/how-landeed-makes-procuring-land-documents-easy](https://www.landeed.com/post/how-landeed-makes-procuring-land-documents-easy)
- [YourStory, "Proptech startup Landeed helps users check property records within seconds," Sep 2022](https://yourstory.com/2022/09/ycombinator-backed-proptech-startup-landeed-helps-check-property-records)
- [LegiScore, "Automated Government Land Record Search Across Indian States"](https://legiscore.in/blog/automated-government-land-record-search-india-states)
- [surepass.io/land-record-check-api](https://surepass.io/land-record-check-api/)
- GitHub / Hacker News search — no public TNREGINET or Indian-state EC scraper found.
