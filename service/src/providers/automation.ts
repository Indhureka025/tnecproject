import type { EcProvider, RetrieveContext } from "./types.ts";
import { ProviderError } from "./types.ts";
import type { EcRequest } from "../contract.ts";
import { type EcResult, EC_DISCLAIMER, deriveOutcome } from "../canonical.ts";
import { parseEcHtml } from "../parse/ec-html.ts";

/**
 * Browser-automation adapter — the fallback provider for when no aggregator
 * covers a district (or as commercial leverage / continuity).
 *
 * Three modes:
 *  - `portalUrl` set  -> drives a real browser through the portal (Playwright).
 *    Against verification/mock-portal this runs anywhere and is tested; against
 *    the real tnreginet.gov.in it needs an India-hosted worker + a real account.
 *  - `simulateHtml` set -> just exercise the results-table -> canonical parse.
 *  - neither -> reports portal_unavailable (honest: no worker deployed here).
 *
 * CAPTCHA and OTP are never solved automatically — each opens a human-in-the-loop
 * task; a real operator answers from the console.
 */
export class AutomationProvider implements EcProvider {
  readonly name = "automation";

  constructor(
    private readonly opts: {
      portalUrl?: string;
      username?: string;
      password?: string;
      headless?: boolean;
      recordVideoDir?: string;
      simulateHtml?: string;
    } = {},
  ) {}

  supports(req: EcRequest): boolean {
    // certified ECs add a payment + SRO-signing step handled elsewhere.
    return !req.certified;
  }

  async retrieve(req: EcRequest, ctx: RetrieveContext): Promise<EcResult> {
    ctx.log("automation.retrieve.start", { requestId: ctx.requestId, mode: this.mode() });

    if (this.opts.portalUrl) {
      const { runWorker } = await import("./automation-worker.ts");
      return runWorker(
        {
          portalUrl: this.opts.portalUrl,
          username: this.opts.username,
          password: this.opts.password,
          headless: this.opts.headless,
          recordVideoDir: this.opts.recordVideoDir,
        },
        req,
        ctx,
      );
    }

    // no live portal — still prove the HITL handshake
    const captcha = await ctx.requestHuman({ kind: "captcha", context: { note: "TNREGINET EC search CAPTCHA", imageRef: "automation://captcha.png" } });
    if (captcha.kind !== "captcha" || !captcha.value) throw new ProviderError("captcha_unrecoverable", "no CAPTCHA answer from operator");

    if (!this.opts.simulateHtml) {
      throw new ProviderError(
        "portal_unavailable",
        "no automation worker configured (set AUTOMATION_PORTAL_URL). The real TNREGINET portal is geo-restricted to India.",
        true,
      );
    }

    const now = new Date().toISOString();
    const entries = parseEcHtml(this.opts.simulateHtml);
    const { outcome, encumbrancePresent, caveats } = deriveOutcome({ entries, periodFrom: req.period.from, nilHumanVerified: false });
    return {
      schemaVersion: "1.0",
      search: { type: req.searchType, property: { ...req.property }, period: req.period, performedAt: now },
      outcome,
      encumbrancePresent,
      entryCount: entries.length,
      entries,
      documents: [],
      caveats,
      provenance: { source: this.name, sourceReference: null, certified: false, retrievedAt: now, operatorId: "operator", rawArtifactRefs: ["automation://results.html"] },
      disclaimer: EC_DISCLAIMER,
    };
  }

  private mode(): string {
    return this.opts.portalUrl ? "live-portal" : this.opts.simulateHtml ? "simulate-html" : "no-worker";
  }
}
