/**
 * Public API contract — request + status shapes.
 * Mirrors ../../docs/internal-api-contract.md and ../../docs/openapi.yaml.
 */
import { z } from "zod";
import type { EcResult } from "./canonical.ts";

export const SearchType = z.enum(["EC_WISE", "DOCUMENT_WISE", "PLOT_FLAT_WARD_WISE"]);
export type SearchType = z.infer<typeof SearchType>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a valid calendar date");

export const EcRequestSchema = z
  .object({
    searchType: SearchType,
    certified: z.boolean(),
    property: z.object({
      zone: z.string().min(1),
      district: z.string().min(1),
      sroCode: z.string().min(1),
      village: z.string().min(1).nullish(),
      surveyNumber: z.string().min(1).nullish(),
      subdivisionNumber: z.string().min(1).nullish(),
      documentNumber: z.string().min(1).nullish(),
      registrationYear: z.number().int().gte(1850).lte(2100).nullish(),
    }),
    period: z.object({ from: isoDate, to: isoDate }),
    callbackUrl: z.string().url(),
    reference: z.string().max(120).optional(),
    priority: z.enum(["normal", "high"]).default("normal"),
  })
  .superRefine((v, ctx) => {
    if (v.period.from > v.period.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["period"], message: "from must be <= to" });
    }
    if (v.searchType === "DOCUMENT_WISE") {
      if (!v.property.documentNumber || !v.property.registrationYear) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["property"], message: "documentNumber and registrationYear are required for DOCUMENT_WISE" });
      }
    } else {
      if (!v.property.village || !v.property.surveyNumber) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["property"], message: "village and surveyNumber are required for this search type" });
      }
    }
  });

export type EcRequest = z.infer<typeof EcRequestSchema>;

export type RequestStatusValue =
  | "queued" | "in_progress" | "needs_human" | "awaiting_signature" | "completed" | "partial" | "failed";

export type FailureCode =
  | "validation" | "unresolvable" | "portal_unavailable" | "provider_error"
  | "no_records_unconfirmed" | "payment_required" | "not_digitised"
  | "captcha_unrecoverable" | "timeout";

export interface DeliverableDoc {
  kind: "ec_summary" | "ec_pdf" | "raw_html" | "screenshot";
  // ec_summary = our rendered summary of retrieved data; ec_pdf = the signed certified copy
  url: string;
  expiresAt: string;
  sha256: string;
}

export interface Failure {
  code: FailureCode;
  message: string;
  retryable: boolean;
  operatorNote: string | null;
}

export interface RequestStatus {
  requestId: string;
  reference?: string;
  status: RequestStatusValue;
  certified: boolean;
  source: string | null;
  submittedAt: string;
  completedAt: string | null;
  estimate?: { type: "minutes" | "days"; value: number };
  result: EcResult | null;
  documents: DeliverableDoc[];
  failure: Failure | null;
}

export type WebhookEventName =
  | "ec.received" | "ec.needs_human" | "ec.awaiting_signature" | "ec.completed" | "ec.partial" | "ec.failed";

export interface WebhookEvent {
  eventId: string;
  event: WebhookEventName;
  requestId: string;
  reference?: string;
  occurredAt: string;
  data: RequestStatus;
}
