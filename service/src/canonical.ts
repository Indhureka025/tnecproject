/**
 * Canonical EC result model — one normalised shape for an EC regardless of source.
 * Mirrors ../../docs/canonical-ec-result.md and ../../docs/schemas/ec-result.schema.json.
 */

export type Outcome = "ENTRIES_FOUND" | "NIL_CONFIRMED" | "NIL_UNCONFIRMED" | "PERIOD_GAP";

export type InstrumentType =
  | "SALE" | "MORTGAGE" | "GIFT" | "RELEASE" | "PARTITION" | "SETTLEMENT" | "LEASE"
  | "AGREEMENT" | "POWER_OF_ATTORNEY" | "ATTACHMENT" | "COURT_ORDER" | "CORRECTION" | "OTHER";

export type CaveatCode =
  | "ONLINE_DATA_FROM_1975" | "PARTIAL_PERIOD_DIGITISED" | "OCR_LOW_CONFIDENCE"
  | "TRANSLITERATION_AMBIGUITY" | "VILLAGE_NAME_FUZZY_MATCH"
  | "MULTIPLE_SUBDIVISIONS_PRESENT" | "NIL_NOT_HUMAN_VERIFIED"
  | "CERTIFIED_PENDING_SIGNATURE" | "CERTIFIED_COPY_SIGNED"
  | "DOCUMENT_INDEX_ONLY";

/**
 * The real portal's property/document search doesn't always land directly on an
 * EC entries table — a search can first resolve to one or more matching *indexed
 * documents* (this shape, confirmed against a live result on 12 Sep 2026), which
 * the citizen then opens individually (or applies for a certified copy of) to see
 * the actual instrument details. This is not an EcEntry: it carries no instrument
 * type, dates, consideration, or parties — just enough to identify which real
 * document(s) matched the search.
 */
export interface DocumentMatch {
  documentNumber: string;
  sroName: string | null;
  registrationDistrict: string | null;
  registrationVillage: string | null;
  /** the portal often lists several sub-divisions against one document, comma-joined */
  surveySubDivisionNumbers: string[];
  propertyType: string | null;
}

export type PartyRole = "EXECUTANT" | "CLAIMANT" | "OTHER";

export interface Money {
  value: number;
  currency: "INR";
}

export interface Party {
  role: PartyRole;
  rawRole?: string | null;
  name: string;
}

export interface EcEntry {
  seq: number;
  instrumentType: InstrumentType;
  rawInstrumentType: string;
  documentNumber: string | null;
  sroName: string | null;
  executionDate: string | null;
  registrationDate: string | null;
  presentationDate: string | null;
  considerationAmount: Money | null;
  marketValue: Money | null;
  extentSurveyed: string | null;
  parties: Party[];
  propertyDescription: string | null;
  remarks: string | null;
  pageRef: string | null;
}

export interface Caveat {
  code: CaveatCode;
  message: string;
}

export interface EcDocument {
  kind: "ec_pdf" | "raw_html" | "screenshot";
  sha256: string;
  pages: number | null;
  sourceUrl: string;
  signed: boolean;
}

export interface EcResult {
  schemaVersion: "1.0";
  search: {
    type: "EC_WISE" | "DOCUMENT_WISE" | "PLOT_FLAT_WARD_WISE";
    property: Record<string, string | number | null | undefined>;
    period: { from: string; to: string };
    performedAt: string;
  };
  outcome: Outcome;
  encumbrancePresent: boolean | null;
  entryCount: number;
  entries: EcEntry[];
  documents: EcDocument[];
  caveats: Caveat[];
  provenance: {
    source: string; // "aggregator:<name>" | "automation"
    sourceReference: string | null;
    certified: boolean;
    retrievedAt: string;
    operatorId: string | null;
    rawArtifactRefs: string[];
  };
  disclaimer: string;
}

export const EC_DISCLAIMER =
  "An EC lists registered instruments for the period and keys searched. It is not proof " +
  "of ownership or clear title; absence of entries does not prove the property is " +
  "unencumbered or unoccupied.";

const RAW_TO_INSTRUMENT: Array<[RegExp, InstrumentType]> = [
  [/mortgage|otti|hypothec/i, "MORTGAGE"],
  [/sale|conveyance|absolute sale/i, "SALE"],
  [/gift|settlement.*love|dhana/i, "GIFT"],
  [/release|relinquish/i, "RELEASE"],
  [/partition/i, "PARTITION"],
  [/settlement/i, "SETTLEMENT"],
  [/lease/i, "LEASE"],
  [/agreement|sale agreement/i, "AGREEMENT"],
  [/power of attorney|gpa|spa/i, "POWER_OF_ATTORNEY"],
  [/attachment/i, "ATTACHMENT"],
  [/court|decree|order/i, "COURT_ORDER"],
  [/rectification|correction|amend/i, "CORRECTION"],
];

/** Normalise a free-text TNREGINET instrument label into the canonical enum. */
export function classifyInstrument(raw: string): InstrumentType {
  for (const [re, t] of RAW_TO_INSTRUMENT) if (re.test(raw)) return t;
  return "OTHER";
}

/** Build the caveats + outcome that always apply given the search + entries. */
export function deriveOutcome(args: {
  entries: EcEntry[];
  periodFrom: string;
  nilHumanVerified: boolean;
  extraCaveats?: Caveat[];
}): { outcome: Outcome; encumbrancePresent: boolean | null; caveats: Caveat[] } {
  const caveats: Caveat[] = [...(args.extraCaveats ?? [])];

  if (args.periodFrom < "1975-01-01") {
    caveats.push({
      code: "ONLINE_DATA_FROM_1975",
      message: "Requested period predates ~1975; online EC data does not cover it. Manual SRO search required for the earlier span.",
    });
  }

  if (args.entries.length > 0) {
    return { outcome: "ENTRIES_FOUND", encumbrancePresent: true, caveats };
  }

  if (args.periodFrom < "1975-01-01") {
    return { outcome: "PERIOD_GAP", encumbrancePresent: null, caveats };
  }

  if (args.nilHumanVerified) {
    return { outcome: "NIL_CONFIRMED", encumbrancePresent: false, caveats };
  }

  caveats.push({
    code: "NIL_NOT_HUMAN_VERIFIED",
    message: "No entries returned and not yet confirmed by an operator. Do not treat as a clean EC.",
  });
  return { outcome: "NIL_UNCONFIRMED", encumbrancePresent: null, caveats };
}
