/**
 * TN registration master data — resolves and validates zone + Sub-Registrar Office.
 *
 * Backed by the full list of 595 SROs across the 11 registration zones
 * (tn-sros.json). The registration-DISTRICT level and village-level jurisdiction
 * are not in the dataset (they need the TNREGINET "Know Your Jurisdiction" data,
 * which is only reachable from an India IP), so `district` is accepted but
 * advisory — it is echoed back, not validated.
 */
import data from "./tn-sros.json" with { type: "json" };

export interface ResolvedUnit {
  zone: string;
  district: string;
  sroCode: string; // canonical SRO name (there is no separate numeric code in the public data)
  sroName: string;
}

const zoneAliases: Record<string, string> = (data as { zoneAliases: Record<string, string> }).zoneAliases;
const zones: Record<string, string[]> = (data as { zones: Record<string, string[]> }).zones;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s._\-()]+/g, "");
const zoneNorm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// pre-index SROs per zone by normalised name
const sroIndex = new Map<string, Map<string, string>>();
for (const [zone, list] of Object.entries(zones)) {
  const m = new Map<string, string>();
  for (const sro of list) m.set(norm(sro), sro);
  sroIndex.set(zone, m);
}
const zoneCanonical = new Map<string, string>();
for (const z of Object.keys(zones)) zoneCanonical.set(zoneNorm(z), z);

export class MasterDataError extends Error {
  constructor(readonly field: "zone" | "district" | "sroCode", message: string) {
    super(message);
    this.name = "MasterDataError";
  }
}

function resolveZone(input: string): string {
  const key = zoneNorm(input);
  const direct = zoneCanonical.get(key);
  if (direct) return direct;
  const alias = zoneAliases[key];
  if (alias && zones[alias]) return alias;
  throw new MasterDataError("zone", `unknown registration zone "${input}". Known zones: ${Object.keys(zones).join(", ")}`);
}

/**
 * Resolve a (zone, district, sro) triple. `district` is advisory. `sro` matches
 * an SRO name in the resolved zone, case- and punctuation-insensitively. If the
 * SRO is not in that zone but exists in another, the error names the right zone.
 */
export function resolveUnit(input: { zone: string; district?: string; sro: string }): ResolvedUnit {
  const zone = resolveZone(input.zone);
  const hit = sroIndex.get(zone)?.get(norm(input.sro));
  if (hit) {
    return { zone, district: (input.district ?? "").trim(), sroCode: hit, sroName: hit };
  }
  // helpful cross-zone hint
  for (const [z, m] of sroIndex) {
    const elsewhere = m.get(norm(input.sro));
    if (elsewhere) {
      throw new MasterDataError("sroCode", `SRO "${input.sro}" is in the ${z} zone, not ${zone}. Set zone="${z}".`);
    }
  }
  const sample = [...(sroIndex.get(zone)?.values() ?? [])].slice(0, 8).join(", ");
  throw new MasterDataError("sroCode", `unknown SRO "${input.sro}" in the ${zone} zone. Examples in ${zone}: ${sample}, ...`);
}

export function listZones(): string[] {
  return Object.keys(zones);
}

export function coverage(): { zones: number; sros: number; partial: boolean; districtLevel: boolean } {
  return {
    zones: Object.keys(zones).length,
    sros: Object.values(zones).reduce((n, l) => n + l.length, 0),
    partial: false,
    districtLevel: false,
  };
}
