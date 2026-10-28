import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEcHtml, parseDocumentMatchTable } from "../src/parse/ec-html.ts";
import { deriveOutcome } from "../src/canonical.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(path.join(dir, "..", "src", "parse", "__fixtures__", name), "utf8");

describe("parseEcHtml", () => {
  it("parses a results table with entries", () => {
    const entries = parseEcHtml(fx("ec-with-entries.html"));
    expect(entries).toHaveLength(3);

    const mortgage = entries[1]!;
    expect(mortgage.instrumentType).toBe("MORTGAGE");
    expect(mortgage.rawInstrumentType).toBe("Simple Mortgage");
    expect(mortgage.documentNumber).toBe("2231/2019");
    expect(mortgage.registrationDate).toBe("2019-07-09");
    expect(mortgage.considerationAmount).toEqual({ value: 3_500_000, currency: "INR" });
    expect(mortgage.parties).toEqual([
      { role: "EXECUTANT", name: "A. Kumar" },
      { role: "CLAIMANT", name: "XYZ Bank Ltd" },
    ]);

    expect(entries[0]!.instrumentType).toBe("SALE");
    expect(entries[2]!.instrumentType).toBe("RELEASE");
    expect(entries[2]!.considerationAmount).toBeNull(); // 0 -> null
  });

  it("returns [] for a nil results table", () => {
    expect(parseEcHtml(fx("ec-nil.html"))).toEqual([]);
  });

  it("deriveOutcome flags an unverified nil", () => {
    const d = deriveOutcome({ entries: [], periodFrom: "2004-01-01", nilHumanVerified: false });
    expect(d.outcome).toBe("NIL_UNCONFIRMED");
    expect(d.encumbrancePresent).toBeNull();
    expect(d.caveats.some((c) => c.code === "NIL_NOT_HUMAN_VERIFIED")).toBe(true);
  });

  it("deriveOutcome accepts a verified nil", () => {
    const d = deriveOutcome({ entries: [], periodFrom: "2004-01-01", nilHumanVerified: true });
    expect(d.outcome).toBe("NIL_CONFIRMED");
    expect(d.encumbrancePresent).toBe(false);
  });

  it("deriveOutcome returns PERIOD_GAP for pre-1975 periods", () => {
    const d = deriveOutcome({ entries: [], periodFrom: "1970-01-01", nilHumanVerified: true });
    expect(d.outcome).toBe("PERIOD_GAP");
    expect(d.caveats.some((c) => c.code === "ONLINE_DATA_FROM_1975")).toBe(true);
  });
});

describe("parseDocumentMatchTable", () => {
  // Fixture transcribed verbatim from a real, logged-in portal result (12 Sep 2026) -
  // not reconstructed from documentation like the other fixtures.
  it("parses the real document-index result by header text", () => {
    const { matches, unmappedHeaders } = parseDocumentMatchTable(fx("ec-document-match.html"));
    expect(unmappedHeaders).toEqual([]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      documentNumber: "R/ஓமலூர்/புத்தகம் 1/275/2026",
      sroName: "Omalur",
      registrationDistrict: "Salem West",
      registrationVillage: "Kullamanaickenpatti",
      surveySubDivisionNumbers: ["11/1A1", "11/41A1A1A1", "11/47A1A1A1A", "11/4A1A1", "12/1A1A1A1A", "12/2G1A1A1A"],
      propertyType: "Plot",
    });
  });

  it("flags an unrecognised header instead of guessing which field it is", () => {
    const html = `<table><thead><tr><th>Document No.</th><th>Some New Column</th></tr></thead>
      <tbody><tr><td>DOC/1</td><td>mystery value</td></tr></tbody></table>`;
    const { matches, unmappedHeaders } = parseDocumentMatchTable(html);
    expect(unmappedHeaders).toEqual(["Some New Column"]);
    expect(matches[0]!.documentNumber).toBe("DOC/1");
    // the unrecognised column's value is dropped, never silently placed in some other field
    expect(Object.values(matches[0]!)).not.toContain("mystery value");
  });

  it("returns no matches for an empty table", () => {
    const { matches } = parseDocumentMatchTable(fx("ec-nil.html"));
    expect(matches).toEqual([]);
  });
});
