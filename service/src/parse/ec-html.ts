/**
 * Parse a TNREGINET "Search & View EC" results table into canonical EC entries.
 *
 * IMPLEMENTATION NOTE: this uses regex row/cell extraction to avoid a DOM-parser
 * dependency while the exact live HTML is unknown (portal is geo-restricted from CI).
 * Once the real markup is captured from an India IP, switch to a proper parser
 * (linkedom / cheerio) and map by column header rather than positional index.
 * The fixture in __fixtures__/ec-with-entries.html defines the column order assumed here.
 */
import { classifyInstrument, type DocumentMatch, type EcEntry, type Party } from "../canonical.ts";

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

function toIsoDate(dmy: string): string | null {
  const m = dmy.trim().match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function toMoney(s: string): { value: number; currency: "INR" } | null {
  const n = Number(s.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return { value: n, currency: "INR" };
}

function names(s: string): string[] {
  return stripTags(s)
    .split(/\s*[,;/]\s*|\s+and\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Extract `<tbody>` `<tr>` rows; returns [] when the results table is empty. */
export function parseEcHtml(html: string): EcEntry[] {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1] ?? "");

  const entries: EcEntry[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1] ?? ""));
    if (cells.length < 6) continue; // header stragglers / malformed

    const [
      sno, nature, docYear, sro, execDate, regDate,
      consideration, marketValue, executants, claimants, extent, volPage, remarks,
    ] = cells;

    const parties: Party[] = [
      ...names(executants ?? "").map((n) => ({ role: "EXECUTANT" as const, name: n })),
      ...names(claimants ?? "").map((n) => ({ role: "CLAIMANT" as const, name: n })),
    ];

    entries.push({
      seq: Number(sno) || entries.length + 1,
      instrumentType: classifyInstrument(nature ?? ""),
      rawInstrumentType: nature ?? "",
      documentNumber: docYear || null,
      sroName: sro || null,
      executionDate: toIsoDate(execDate ?? ""),
      registrationDate: toIsoDate(regDate ?? ""),
      presentationDate: null,
      considerationAmount: toMoney(consideration ?? ""),
      marketValue: toMoney(marketValue ?? ""),
      extentSurveyed: extent || null,
      parties,
      propertyDescription: null,
      remarks: remarks || null,
      pageRef: volPage || null,
    });
  }
  return entries;
}

/**
 * Parse the "document index" result table — what a property/document search
 * resolves to before the actual EC entry details (see canonical.ts DocumentMatch
 * for why this is a distinct shape from parseEcHtml's entries).
 *
 * Maps by HEADER TEXT rather than column position or element id, on purpose:
 * this is the resilient pattern flagged as needed everywhere else in this
 * project — a real page that adds/reorders/renames-slightly a column still
 * parses correctly as long as the header wording is recognisable, instead of
 * silently misreading columns into the wrong fields. An unrecognised header is
 * dropped, not guessed into a slot — see the "unmapped" collection below, which
 * a caller can surface to a human rather than pretending nothing changed.
 */
const HEADER_ALIASES: Record<string, keyof DocumentMatch | "skip"> = {
  "document no.": "documentNumber",
  "document no": "documentNumber",
  "sub registrar office": "sroName",
  "registration district": "registrationDistrict",
  "registration village": "registrationVillage",
  "survey/sub div no": "surveySubDivisionNumbers",
  "survey / sub div no": "surveySubDivisionNumbers",
  "property type": "propertyType",
};

export interface DocumentMatchParseResult {
  matches: DocumentMatch[];
  /** header text found in the table but not in HEADER_ALIASES — a layout change to review */
  unmappedHeaders: string[];
}

export function parseDocumentMatchTable(html: string): DocumentMatchParseResult {
  const table = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  const headerRow = table.match(/<thead[^>]*>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i)?.[1] ?? "";
  const headers = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1] ?? ""));

  const unmappedHeaders: string[] = [];
  const fields = headers.map((h) => {
    const key = HEADER_ALIASES[h.trim().toLowerCase()];
    if (!key) unmappedHeaders.push(h);
    return key ?? "skip";
  });

  const tbody = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1] ?? "");

  const matches: DocumentMatch[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1] ?? ""));
    if (!cells.length) continue;

    const rec: Partial<DocumentMatch> = {};
    fields.forEach((field, i) => {
      const value = cells[i];
      if (field === "skip" || value === undefined) return;
      if (field === "surveySubDivisionNumbers") {
        rec.surveySubDivisionNumbers = value.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        (rec as Record<string, string | null>)[field] = value || null;
      }
    });

    if (rec.documentNumber) {
      matches.push({
        documentNumber: rec.documentNumber,
        sroName: rec.sroName ?? null,
        registrationDistrict: rec.registrationDistrict ?? null,
        registrationVillage: rec.registrationVillage ?? null,
        surveySubDivisionNumbers: rec.surveySubDivisionNumbers ?? [],
        propertyType: rec.propertyType ?? null,
      });
    }
  }
  return { matches, unmappedHeaders };
}
