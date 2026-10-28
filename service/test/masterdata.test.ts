import { describe, expect, it } from "vitest";
import { MasterDataError, coverage, listZones, resolveUnit } from "../src/masterdata/index.ts";

describe("resolveUnit", () => {
  it("resolves an SRO by name within its zone, case/punctuation-insensitively", () => {
    const u = resolveUnit({ zone: "chennai", sro: "thiru vottiyur" });
    expect(u).toMatchObject({ zone: "Chennai", sroCode: "Thiruvottiyur", sroName: "Thiruvottiyur" });
  });

  it("accepts a zone alias (Thanjavur -> Tanjore)", () => {
    const u = resolveUnit({ zone: "Thanjavur", sro: "Kumbakonam Joint I" });
    expect(u.zone).toBe("Tanjore");
  });

  it("echoes the advisory district unchanged", () => {
    const u = resolveUnit({ zone: "Chengalpattu", district: "Kancheepuram", sro: "Thiruporur" });
    expect(u).toMatchObject({ zone: "Chengalpattu", district: "Kancheepuram", sroCode: "Thiruporur" });
  });

  it("throws for an unknown zone", () => {
    expect(() => resolveUnit({ zone: "Atlantis", sro: "X" })).toThrow(MasterDataError);
  });

  it("points to the right zone when the SRO is real but in another zone", () => {
    try {
      resolveUnit({ zone: "Chennai", sro: "Thiruporur" }); // Thiruporur is Chengalpattu
      expect.unreachable();
    } catch (e) {
      expect((e as MasterDataError).field).toBe("sroCode");
      expect((e as Error).message).toContain("Chengalpattu");
    }
  });

  it("throws for an SRO that does not exist anywhere", () => {
    expect(() => resolveUnit({ zone: "Chennai", sro: "Nowhereville" })).toThrow(/unknown SRO/);
  });

  it("covers all 11 zones and 595 SROs", () => {
    const c = coverage();
    expect(c.partial).toBe(false);
    expect(c.zones).toBe(11);
    expect(c.sros).toBe(595);
    expect(listZones()).toContain("Chennai");
  });
});
