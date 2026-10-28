# Canonical EC result model

One normalised shape for an EC, whatever the source (Landeed, SurePass, or our own
automation). Adapters map into this; the ERP only ever sees this.

Machine-readable schema: [`schemas/ec-result.schema.json`](schemas/ec-result.schema.json)

```jsonc
{
  "schemaVersion": "1.0",

  "search": {
    "type": "EC_WISE",
    "property": {
      "zone": "CHENNAI",
      "district": "CENTRAL CHENNAI",
      "sroCode": "TVL",
      "sroName": "Thiruvottiyur",
      "village": "THIRUVOTTIYUR",
      "surveyNumber": "123/4",
      "subdivisionNumber": "1"
    },
    "period": { "from": "2004-01-01", "to": "2024-12-31" },
    "performedAt": "2026-09-10T09:03:50Z"
  },

  "outcome": "ENTRIES_FOUND",        // ENTRIES_FOUND | NIL_CONFIRMED | NIL_UNCONFIRMED | PERIOD_GAP
  "encumbrancePresent": true,        // null when outcome != ENTRIES_FOUND
  "entryCount": 3,

  "entries": [
    {
      "seq": 1,
      "instrumentType": "MORTGAGE",   // SALE | MORTGAGE | GIFT | RELEASE | PARTITION | SETTLEMENT |
                                      // LEASE | AGREEMENT | POWER_OF_ATTORNEY | ATTACHMENT |
                                      // COURT_ORDER | CORRECTION | OTHER  (+ rawInstrumentType)
      "rawInstrumentType": "Simple Mortgage",
      "documentNumber": "TVL/2231/2019",
      "sroName": "Thiruvottiyur",
      "executionDate": "2019-07-04",
      "registrationDate": "2019-07-09",
      "presentationDate": "2019-07-04",
      "considerationAmount": { "value": 3500000, "currency": "INR" },
      "marketValue": { "value": 4200000, "currency": "INR" },
      "extentSurveyed": "1200 sq.ft",
      "parties": [
        { "role": "EXECUTANT", "name": "A. Kumar" },       // EXECUTANT (transferor/borrower)
        { "role": "CLAIMANT", "name": "XYZ Bank Ltd" }      // CLAIMANT (transferee/lender)
      ],
      "propertyDescription": "Plot 12, ... Survey 123/4, subdiv 1",
      "remarks": null,
      "pageRef": "Vol 45 / Pg 210"
    }
  ],

  "documents": [
    { "kind": "ec_pdf", "sha256": "…", "pages": 4, "sourceUrl": "internal://blobstore/…", "signed": false }
  ],

  "caveats": [
    // machine-checkable flags the ERP MUST surface to a human reviewer
    { "code": "ONLINE_DATA_FROM_1975", "message": "Online EC covers registrations from ~1975 only." }
    // other codes: PARTIAL_PERIOD_DIGITISED, OCR_LOW_CONFIDENCE, TRANSLITERATION_AMBIGUITY,
    //   VILLAGE_NAME_FUZZY_MATCH, MULTIPLE_SUBDIVISIONS_PRESENT, NIL_NOT_HUMAN_VERIFIED
  ],

  "provenance": {
    "source": "aggregator:landeed",   // aggregator:<name> | automation
    "sourceReference": "LD-9912831",
    "certified": false,
    "retrievedAt": "2026-09-10T09:03:50Z",
    "operatorId": null,               // set if a HITL operator touched this result
    "rawArtifactRefs": ["internal://blobstore/raw/…html", "internal://blobstore/screens/…png"]
  },

  "disclaimer": "An EC lists registered instruments for the period and keys searched. It is not proof of ownership or clear title; absence of entries does not prove the property is unencumbered or unoccupied."
}
```

## Field rules

- **`outcome`**
  - `ENTRIES_FOUND` — one or more entries; `encumbrancePresent` = true.
  - `NIL_CONFIRMED` — no entries **and** a human (or the aggregator's stated process)
    confirmed the search keys/period were correct. `encumbrancePresent` = false.
  - `NIL_UNCONFIRMED` — no entries, not yet human-verified. `encumbrancePresent` = null.
    ERP must not treat as clean. Corresponds to failure code `no_records_unconfirmed`.
  - `PERIOD_GAP` — requested period partly/wholly predates digitisation. `encumbrancePresent`
    = null; `caveats` explains; ERP raises a manual-SRO task.
- **`instrumentType`** is a normalised enum; always keep `rawInstrumentType` verbatim
  for audit and for types the enum doesn't cover (`OTHER`).
- **`parties[].role`** normalised to `EXECUTANT` / `CLAIMANT` / `OTHER`; keep raw label
  if the source gives one.
- **Amounts** always `{ value, currency }`, integers in the minor-unit-free rupee
  (no paise) unless the source provides paise.
- **`caveats`** is the contract between the system and the human reviewer. Any
  ambiguity the parser/adapter detects goes here rather than being silently resolved.
- **`disclaimer`** string is constant and always present.

## Why normalise

- The ERP integrates once, not once per vendor.
- Switching or adding a provider is an adapter change, invisible to the ERP.
- The audit trail is uniform regardless of how the EC was obtained.
