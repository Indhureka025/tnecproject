/**
 * OCR for scanned Encumbrance Certificates.
 *
 * TNREGINET serves pre-~1987 ECs as scanned images rather than an HTML table.
 * The automation worker detects that case (an <img> where the results table
 * should be), downloads the image, and runs it through here. The output is
 * ALWAYS low-confidence: it attaches an OCR_LOW_CONFIDENCE caveat and opens an
 * `ocr_review` HITL task so an operator confirms/corrects before the ERP is told
 * anything definitive.
 *
 * tesseract.js is loaded lazily (it fetches a WASM core + English model on first
 * use) so the service starts fast and BACKEND=memory needs nothing.
 */
import type { EcEntry } from "../canonical.ts";

export interface OcrResult {
  text: string;
  confidence: number; // 0-100
  entries: EcEntry[]; // best-effort, low confidence
}

export async function ocrEcImage(image: Buffer): Promise<OcrResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text ?? "", confidence: data.confidence ?? 0, entries: roughEntries(data.text ?? "") };
  } finally {
    await worker.terminate();
  }
}

const INSTRUMENT_HINTS = /(sale deed|mortgage|gift|release|partition|settlement|lease|agreement|power of attorney|attachment|court)/i;
const DATE_RE = /\b(\d{2})[.\/-](\d{2})[.\/-](\d{4})\b/;
const DOCNO_RE = /\b(\d{1,5})\s*[\/of]{1,3}\s*(\d{4})\b/i;

/**
 * Very rough line-based extraction from OCR text. Deliberately conservative —
 * every entry here is unverified and the caller flags the whole result.
 */
export function roughEntries(text: string): EcEntry[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 8);
  const out: EcEntry[] = [];
  for (const line of lines) {
    const inst = line.match(INSTRUMENT_HINTS);
    if (!inst) continue;
    const doc = line.match(DOCNO_RE);
    const date = line.match(DATE_RE);
    out.push({
      seq: out.length + 1,
      instrumentType: "OTHER",
      rawInstrumentType: inst[0],
      documentNumber: doc ? `${doc[1]}/${doc[2]}` : null,
      sroName: null,
      executionDate: null,
      registrationDate: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
      presentationDate: null,
      considerationAmount: null,
      marketValue: null,
      extentSurveyed: null,
      parties: [],
      propertyDescription: line,
      remarks: "extracted by OCR — unverified",
      pageRef: null,
    });
  }
  return out;
}
