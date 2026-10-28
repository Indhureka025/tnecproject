import { request } from "undici";
import type { EcProvider, RetrieveContext } from "./types.ts";
import { ProviderError } from "./types.ts";
import type { EcRequest } from "../contract.ts";
import { type EcResult, EC_DISCLAIMER, classifyInstrument, deriveOutcome, type EcEntry } from "../canonical.ts";

/**
 * Landeed aggregator adapter — STUB.
 *
 * The request/response mapping below is the *shape* we expect; the actual endpoint
 * path, auth header, field names and async model must be confirmed from Landeed's
 * API docs once a sandbox account exists (see docs/vendor-rfp/). Until `baseUrl`
 * and `apiKey` are set this adapter reports itself unsupported so the router falls
 * through to the next provider.
 *
 * Confirm during onboarding:
 *   - endpoint + method for a TN EC search
 *   - sync vs async (webhook/poll); if async, wire a callback route
 *   - whether structured entries are returned or only a PDF (then we OCR/parse)
 *   - certified-EC ordering + status polling
 *   - error and "no records" representation
 */
export class LandeedProvider implements EcProvider {
  readonly name = "aggregator:landeed";

  constructor(private readonly cfg: { baseUrl: string; apiKey: string }) {}

  supports(req: EcRequest): boolean {
    if (!this.cfg.baseUrl || !this.cfg.apiKey) return false;
    // TODO: district coverage check against Landeed's published coverage list
    return req.searchType === "EC_WISE" || req.searchType === "DOCUMENT_WISE";
  }

  async retrieve(req: EcRequest, ctx: RetrieveContext): Promise<EcResult> {
    ctx.log("landeed.retrieve", { requestId: ctx.requestId });

    // ---- request mapping (CONFIRM) ----
    const body = {
      state: "TN",
      documentType: "EC",
      searchBy: req.searchType === "DOCUMENT_WISE" ? "document" : "survey",
      zone: req.property.zone,
      district: req.property.district,
      sro: req.property.sroCode,
      village: req.property.village ?? undefined,
      surveyNumber: req.property.surveyNumber ?? undefined,
      subdivision: req.property.subdivisionNumber ?? undefined,
      documentNumber: req.property.documentNumber ?? undefined,
      registrationYear: req.property.registrationYear ?? undefined,
      fromDate: req.period.from,
      toDate: req.period.to,
      certified: req.certified,
    };

    let payload: LandeedEcResponse;
    try {
      const res = await request(`${this.cfg.baseUrl.replace(/\/$/, "")}/v1/documents/ec/search`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
      });
      if (res.statusCode === 429) throw new ProviderError("provider_error", "landeed rate limited", true);
      if (res.statusCode >= 500) throw new ProviderError("portal_unavailable", `landeed ${res.statusCode}`, true);
      if (res.statusCode >= 400) throw new ProviderError("provider_error", `landeed ${res.statusCode}`);
      payload = (await res.body.json()) as LandeedEcResponse;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError("portal_unavailable", `landeed request failed: ${(err as Error).message}`, true);
    }

    // ---- response mapping (CONFIRM) ----
    const now = new Date().toISOString();
    const entries: EcEntry[] = (payload.entries ?? []).map((e, i) => ({
      seq: i + 1,
      instrumentType: classifyInstrument(e.natureOfDocument ?? ""),
      rawInstrumentType: e.natureOfDocument ?? "",
      documentNumber: e.documentNumber ?? null,
      sroName: e.sro ?? null,
      executionDate: e.executionDate ?? null,
      registrationDate: e.registrationDate ?? null,
      presentationDate: e.presentationDate ?? null,
      considerationAmount: e.considerationValue != null ? { value: e.considerationValue, currency: "INR" } : null,
      marketValue: e.marketValue != null ? { value: e.marketValue, currency: "INR" } : null,
      extentSurveyed: e.extent ?? null,
      parties: [
        ...(e.executants ?? []).map((n) => ({ role: "EXECUTANT" as const, name: n })),
        ...(e.claimants ?? []).map((n) => ({ role: "CLAIMANT" as const, name: n })),
      ],
      propertyDescription: e.propertyDescription ?? null,
      remarks: e.remarks ?? null,
      pageRef: e.volumePage ?? null,
    }));

    const { outcome, encumbrancePresent, caveats } = deriveOutcome({
      entries,
      periodFrom: req.period.from,
      // Landeed asserts a completed search; treat "no entries" as vendor-confirmed nil
      // ONLY if their contract says so (CONFIRM in RFP Q8). Conservative default: not verified.
      nilHumanVerified: false,
    });

    return {
      schemaVersion: "1.0",
      search: { type: req.searchType, property: { ...req.property }, period: req.period, performedAt: now },
      outcome,
      encumbrancePresent,
      entryCount: entries.length,
      entries,
      documents: payload.pdfUrl
        ? [{ kind: "ec_pdf", sha256: payload.pdfSha256 ?? "", pages: payload.pdfPages ?? null, sourceUrl: payload.pdfUrl, signed: Boolean(payload.certified) }]
        : [],
      caveats,
      provenance: {
        source: this.name,
        sourceReference: payload.referenceId ?? null,
        certified: Boolean(payload.certified),
        retrievedAt: now,
        operatorId: null,
        rawArtifactRefs: [],
      },
      disclaimer: EC_DISCLAIMER,
    };
  }
}

interface LandeedEcEntry {
  natureOfDocument?: string;
  documentNumber?: string;
  sro?: string;
  executionDate?: string;
  registrationDate?: string;
  presentationDate?: string;
  considerationValue?: number;
  marketValue?: number;
  extent?: string;
  executants?: string[];
  claimants?: string[];
  propertyDescription?: string;
  remarks?: string;
  volumePage?: string;
}

interface LandeedEcResponse {
  referenceId?: string;
  certified?: boolean;
  entries?: LandeedEcEntry[];
  pdfUrl?: string;
  pdfSha256?: string;
  pdfPages?: number;
}
