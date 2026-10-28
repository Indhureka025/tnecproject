# POC Demo — what the walkthrough shows

**Files:** `POC-Demo-Walkthrough.gif` (quick preview) / `POC-Demo-Walkthrough.webm` (full quality) — ~32 seconds.

Per the assignment's ask for "an automated flow that submits an EC search request
and retrieves the resulting certificate," I built a working prototype service
around that flow rather than a single throwaway script, so the walkthrough shows
the whole thing running live, end to end:

1. **A project status dashboard** — what was researched and built.
2. **A test client submitting an EC search** — a real request goes in, gets
   validated, queued, and routed to a data source.
3. **Three outcomes in sequence**, each handled distinctly and safely:
   - A search that finds registered entries → returns the structured result.
   - A search that finds nothing → flagged as **"needs review," not "clean"** —
     the system never silently reports an empty result as a clear title.
   - A search with a bad office code → rejected with a clear, specific error.
4. **The CAPTCHA hand-off** — the request stalls with a "waiting for an
   operator" status, a human clears the CAPTCHA in an operator console, and the
   job resumes and completes. **This is deliberate and permanent**, not a gap:
   CAPTCHA and OTP are never solved automatically anywhere in this system —
   see the Blockers section of the main report for why.

**What this demo runs against:** a local stand-in of the TNREGINET portal, not
the live government site. The live site geo-blocks non-India traffic and is
gated by CAPTCHA/OTP by design — see the report's §3 and §6 for exactly what
was and wasn't possible to test directly, and why. The point of this demo is
the *architecture and the human-in-the-loop pattern*, which are the same either
way; wiring in a live data source (a licensed vendor API, or the same automation
pointed at the real portal from an India host) is the "next phase," not a
redesign.
