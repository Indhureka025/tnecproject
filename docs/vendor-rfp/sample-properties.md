# Sample properties for the vendor sandbox test

When a vendor gives you sandbox access (or on a demo call), you run a few real EC
searches to see (a) whether they cover the area, (b) what their response actually
looks like, (c) how "no records" is returned. This is the list to use.

---

## Option A — your own / a known property (best)

If you, family, or a friend own land in Tamil Nadu, that's the ideal test case:
you already know what *should* be on the EC, so you can judge the vendor's output.
Collect these fields (from the patta / sale deed / earlier EC):

| Field | Example |
|---|---|
| Registration zone | Chennai |
| Registration district | South Chennai |
| Sub-Registrar Office (SRO) | Sholinganallur |
| Village | Perumbakkam |
| Survey number | 123/4 |
| Subdivision | 1 |
| Period to search | 2000-01-01 to today |
| (or) Document number + year | 4567 / 2015 |

---

## Option B — publicly documented properties

These survey numbers, villages and document numbers appear verbatim in **reported
Madras High Court judgments** (public records). Real registered transactions exist
against them, so an EC search should return entries — good for seeing the vendor's
structured output. Confirm the exact SRO with the TNREGINET tool (see bottom).

### B1 — Thaiyur (OMR / Chengalpattu) — likely has multiple entries
| Field | Value |
|---|---|
| Village | Thaiyur |
| Locality | Plot 168, Maha Pallava Nagar |
| Survey number | 1194/3 |
| Taluk / district | Chengalpattu Taluk, (old) Kancheepuram / now Chengalpattu district |
| Likely SRO | Thiruporur |
| Known document | Sale Deed **Doc No. 1224 / 2003**, dated 16-05-2003 |
| Suggested search | EC-wise, 1998-01-01 → today; **or** document-wise 1224/2003 |
| Source | *Selvi E. Rajan v. Inspector General of Registration*, Madras HC |

### B2 — Pallikaranai (South Chennai)
| Field | Value |
|---|---|
| Village | Pallikaranai |
| Survey number | 725/1A1 |
| District | Chennai (South) |
| Likely SRO | Pallikaranai (or Medavakkam / Sholinganallur) |
| Suggested search | EC-wise, 1990-01-01 → today |
| Source | *T.K. Lalitha v. Asst. Commissioner, Urban Land Tax, Alandur*, Madras HC (EC was checked before purchase) |

### B3 — Padur — older transaction (tests pre-2000 data)
| Field | Value |
|---|---|
| Village | Padur |
| Survey number | 294/1 |
| Taluk / district | Thiruvallur Taluk, (old) Kancheepuram district |
| Likely SRO | Poonamallee / Manavala Nagar (confirm — there is also a Padur on OMR under Thiruporur) |
| Known document | Sale Deed **Doc No. 1721 / 1990**, dated 13-07-1990 |
| Suggested search | document-wise 1721/1990; **or** EC-wise 1985-01-01 → today |
| Source | *Suseela Mariappan v. State of Tamil Nadu*, Madras HC |

---

## Option C — a "no records" test

Pick a **plausible but obscure** combination and a **narrow, recent** window — e.g.
a high subdivision number in a rural village for a 1-year period:

| Field | Value |
|---|---|
| Zone / district | Coimbatore / Coimbatore |
| SRO | Thondamuthur |
| Village | (a small revenue village in that SRO) |
| Survey number | 401/2B |
| Period | 2024-01-01 → 2024-12-31 |

Purpose: confirm the vendor returns a clean, explicit "no encumbrance" response
(and ideally says whether that's a verified nil or just an empty result).

---

## What to hand the vendor

For **each** test property give them: **zone, district, SRO, village, survey number,
subdivision, and the date range** (EC-wise) — or **SRO + document number + year**
(document-wise). Then compare their response against our result model
(`docs/canonical-ec-result.md`): do they return the entry list, parties, instrument
type, dates, amounts — or only a PDF?

## Confirm the SRO for any village

TNREGINET → **"Know Your Jurisdiction"** (`tnreginet.gov.in`, needs an India
connection) — enter village + street, it returns the exact SRO and registration
district. Or `proquiro.com/sro-directory/tamil-nadu`. The vendor may also resolve
village → SRO automatically; ask.

---

*Provenance: B1–B3 are from reported Madras High Court judgments located via public
case-law search. Survey numbers, villages and document numbers are quoted from those
judgments; SRO names are best-guess from the village location and must be confirmed.*
