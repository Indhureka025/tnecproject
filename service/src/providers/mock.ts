import type { EcProvider, RetrieveContext } from "./types.ts";
import type { EcRequest } from "../contract.ts";
import { type EcResult, EC_DISCLAIMER, deriveOutcome, type EcEntry } from "../canonical.ts";

/**
 * Deterministic stand-in provider for Phase 0 so the ERP can integrate against the
 * contract before a real aggregator adapter exists.
 *
 * Demo rules (based on surveyNumber):
 *   contains "4"  -> one MORTGAGE entry (ENTRIES_FOUND)
 *   contains "9"  -> triggers a nil_review HITL task
 *   period.from < 1975 -> PERIOD_GAP
 *   otherwise     -> NIL_UNCONFIRMED
 */
export class MockProvider implements EcProvider {
  readonly name = "mock";

  supports(_req: EcRequest): boolean {
    return true;
  }

  async retrieve(req: EcRequest, ctx: RetrieveContext): Promise<EcResult> {
    ctx.log("mock.retrieve", { requestId: ctx.requestId });
    const now = new Date().toISOString();
    const survey = req.property.surveyNumber ?? "";

    const entries: EcEntry[] = survey.includes("4") || survey.toUpperCase().includes("CAP")
      ? [
          {
            seq: 1,
            instrumentType: "MORTGAGE",
            rawInstrumentType: "Simple Mortgage",
            documentNumber: `${req.property.sroCode}/2231/2019`,
            sroName: req.property.sroCode,
            executionDate: "2019-07-04",
            registrationDate: "2019-07-09",
            presentationDate: "2019-07-04",
            considerationAmount: { value: 3_500_000, currency: "INR" },
            marketValue: { value: 4_200_000, currency: "INR" },
            extentSurveyed: "1200 sq.ft",
            parties: [
              { role: "EXECUTANT", name: "A. Kumar" },
              { role: "CLAIMANT", name: "XYZ Bank Ltd" },
            ],
            propertyDescription: `Survey ${survey} subdiv ${req.property.subdivisionNumber ?? "-"}`,
            remarks: null,
            pageRef: "Vol 45 / Pg 210",
          },
        ]
      : [];

    // Demo hook: a survey number containing "CAP" exercises the CAPTCHA
    // human-in-the-loop path end to end (operator clears it, then the job
    // completes normally). Used by the walkthrough recording.
    if (survey.toUpperCase().includes("CAP")) {
      const cap = await ctx.requestHuman({
        kind: "captcha",
        context: { note: "TNREGINET EC search CAPTCHA", imageRef: "mock://captcha.png" },
      });
      ctx.log("mock.captcha.cleared", { requestId: ctx.requestId, byOperator: cap.kind === "captcha" });
    }

    let nilHumanVerified = false;
    if (entries.length === 0 && survey.includes("9") && req.period.from >= "1975-01-01") {
      const ans = await ctx.requestHuman({ kind: "nil_review", context: { rawArtifactRef: "mock://nil.html" } });
      if (ans.kind === "nil_review") nilHumanVerified = ans.confirmedNil;
    }

    const { outcome, encumbrancePresent, caveats } = deriveOutcome({
      entries,
      periodFrom: req.period.from,
      nilHumanVerified,
    });

    return {
      schemaVersion: "1.0",
      search: { type: req.searchType, property: { ...req.property }, period: req.period, performedAt: now },
      outcome,
      encumbrancePresent,
      entryCount: entries.length,
      entries,
      documents: [],
      caveats,
      provenance: {
        source: "mock",
        sourceReference: `MOCK-${ctx.requestId.slice(0, 8)}`,
        certified: false, // the pipeline runs the payment + SRO-signing flow for certified requests
        retrievedAt: now,
        operatorId: nilHumanVerified ? "auto" : null,
        rawArtifactRefs: [],
      },
      disclaimer: EC_DISCLAIMER,
    };
  }
}
