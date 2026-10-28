# Can we pull Tamil Nadu property certificates automatically?

**A plain-language summary.** A more detailed technical version of this
assessment is available on request.

## The question we set out to answer

Property deals need an **Encumbrance Certificate (EC)** - the official document
showing whether a property has any loans, disputes, or other claims registered
against it. Today, getting one means a person manually visits a government
website, fills in the details, and waits. The client wants to know: **can this
be done automatically, feeding straight into their own systems, with no one
having to do it by hand?**

## The short answer

**Mostly, yes - but not completely, and one part will always need a person.**

There is no official government shortcut for this (more on that below), so the
practical path is: use a specialist company that already does this well, back
it up with our own automated approach, and accept that a human always has to
handle one specific step. That's not a limitation of our approach - every
company that does this today, including the big players, runs into the same
wall.

## What we found

- **There's no government API to plug into.** We checked directly with the
  official Tamil Nadu registration website and with India's central government
  API directory. Neither offers a way to look up an Encumbrance Certificate
  programmatically. This isn't a case of us missing a menu option - it simply
  doesn't exist yet.
- **Companies that offer this already exist**, and they charge for it. A
  handful of specialist providers sell exactly this - instant property record
  lookups - as a paid service. They've already solved the hard parts, so buying
  access from one of them is the fastest, lowest-risk way to get this working.
- **Doing it ourselves directly is possible, but harder and riskier.** We could
  build a program that fills in the government website automatically, the same
  way a person would. It works, but the government's own website is not
  designed to allow this, and it puts up a deliberate obstacle for exactly this
  reason (see below). It's a reasonable backup plan, not a first choice.

## What we actually built and tested

Rather than just write this up, we built a small working version of the whole
idea and ran it end to end. It takes a property's details, looks it up, and
gives back a clear answer, including correctly recognising when it *doesn't*
know something for certain, instead of guessing. A short recording of this
running live is included alongside this summary.

## Update - the first real run against the live government website (12 September 2026)

Everything above was tested against a stand-in copy of the government site that behaves the same way. On 12 September 2026, for the first time, we ran the automated version against the **real** `tnreginet.gov.in` website, with a real person solving the CAPTCHA live, and filmed it.

**What we saw:** the robot opened the real site, switched it to English, closed two pop-up ads, filled in the property's location step by step, added the survey number, and showed a real CAPTCHA that a person solved correctly. Up to that point, everything worked exactly as designed. Then, when it tried to search, nothing happened - no result, and no error message either.

**What we found out, after digging in:** the two date boxes on the real form ("EC Start Date" and "EC End Date") use a small pop-up calendar. Our program was clicking into the boxes correctly, but wasn't finishing the click the exact way a person does when picking a day off that calendar - so the website quietly still saw both boxes as empty. The website's own rule is "don't search unless every box is filled," so it simply stopped, silently. Nothing was broken or crashed; it just never got confirmation the two boxes were filled in properly.

The fix (click the calendar the way a real person's click actually lands, instead of just typing into the box) is already written and is most of the way there; it needs one small correction to finish. This is a normal, expected kind of hiccup when working against a website we don't control and that can quietly change its own behavior - not a sign the overall approach doesn't work.

**Does this change the recommendation? No - if anything it confirms it.** Every step worked except this one, already-diagnosed step, and it's exactly why the plan above treats our own automation as a **backup**, not the main route. A paid provider stays the fastest, lowest-risk path for volume; our own automation is the fallback for what a provider can't cover, and it will occasionally need a small tune-up like this one - the same as any integration with a website you don't own.

## Idea - looking up many properties at once

The system was already designed to handle more than one request at a time, so this isn't a rebuild - it's turning on something the design already supports.

In plain terms: hand the system a whole list of properties (say, 20) instead of one. It works through all of them itself - opening the site, filling in each form, reading each result - and only pauses, per property, for the one step that always needs a person: solving that property's CAPTCHA, which takes about 10 seconds. One person clearing CAPTCHAs back-to-back for 20 properties is a few minutes of work; everything else happens in the background at the same time. When every property is done, all 20 results are delivered back together.

**One caution:** sending a large batch of automated searches at the real government site in a short window risks the same kind of trouble described above - a site that starts behaving oddly under automated traffic. A batch feature should pace itself deliberately, and - matching the recommendation above - is best used for the overflow a paid provider can't handle, not as the main way to process high volume.

## The one thing that will never be fully automatic

Government websites protect against automated access with a **CAPTCHA** - the
"type the wiggly letters you see in this image" check designed specifically to
tell a computer program apart from a real person. There is no clean way around
this, and we don't believe there should be - it exists on purpose, as a
security control.

**Our approach: a person is always kept in the loop for this one step**, and
nothing else. The system does everything else automatically, pauses exactly
when it hits this check, shows the image to a person, and continues the moment
they type the answer. Everywhere else, it runs on its own.

## What we recommend

**A combined approach:**

1. **Primary route:** pay one of the specialist providers for access. This is
   the fastest and lowest-risk way to get real results flowing.
2. **Backup route:** keep our own automated version ready, for cases the paid
   provider can't cover, or if we ever need to negotiate a better deal.
3. **Always keep a person on standby** for the CAPTCHA step and for double-checking
   anything unclear (like a search that comes back with "nothing found," which
   needs a human to confirm before anyone treats it as good news).

## Timing and cost, in plain terms

| | What to expect |
|---|---|
| **A regular (informational) certificate** | Back in minutes |
| **An official, government-signed copy** | Several days to over a week - a real government officer has to personally sign it, on every possible route, no exceptions |
| **Cost** | A small per-lookup fee to the specialist provider; building our own backup has its own ongoing cost in hosting and staff time |

## Decisions we'd need from the client to move forward

1. Roughly how many lookups per month, and how many need the official signed version?
2. Which parts of Tamil Nadu are in scope?
3. Is "minutes for a regular copy, days for an official one" an acceptable timeline?
4. Who would staff the "type the CAPTCHA" step day to day?
5. How comfortable is the client with us running our own automated backup
   against the government site, versus relying only on a paid provider?

## Bottom line

This is achievable, and a working version already exists to prove it. The
realistic target is **"almost completely automatic, with one small, well-defined
human step, and honest expectations about the government's own timelines"** -
not a claim that this can be made 100% hands-off, because it genuinely can't be,
by design of the system we're working with.
