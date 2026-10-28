import { createHash } from "node:crypto";
import type { EcRequest } from "../contract.ts";

/** Stable hash of the search parameters (not the callback/reference) for dedupe. */
export function paramHash(req: EcRequest): string {
  const key = {
    searchType: req.searchType,
    certified: req.certified,
    property: {
      zone: req.property.zone.toLowerCase().trim(),
      district: req.property.district.toLowerCase().trim(),
      sroCode: req.property.sroCode.toLowerCase().trim(),
      village: (req.property.village ?? "").toLowerCase().trim(),
      surveyNumber: (req.property.surveyNumber ?? "").toLowerCase().trim(),
      subdivisionNumber: (req.property.subdivisionNumber ?? "").toLowerCase().trim(),
      documentNumber: (req.property.documentNumber ?? "").toLowerCase().trim(),
      registrationYear: req.property.registrationYear ?? null,
    },
    period: req.period,
  };
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}
