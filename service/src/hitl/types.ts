/** Human-in-the-loop task model. Operators clear these from the console. */

export type HitlTaskKind = "captcha" | "otp" | "nil_review" | "ocr_review" | "payment";

export interface HitlTask {
  id: string;
  requestId: string;
  kind: HitlTaskKind;
  createdAt: string;
  /** free-form context for the operator (e.g. captcha image URL, mailbox hint) */
  context: Record<string, unknown>;
  status: "open" | "answered" | "expired";
  answer?: HitlAnswer;
  answeredAt?: string;
  operatorId?: string;
}

export type HitlAnswer =
  | { kind: "captcha"; value: string }
  | { kind: "otp"; value: string }
  | { kind: "nil_review"; confirmedNil: boolean; note?: string }
  | { kind: "ocr_review"; corrections: Record<string, string>; note?: string }
  | { kind: "payment"; approved: boolean; reference?: string; note?: string };

export interface HitlStore {
  open(task: Omit<HitlTask, "id" | "createdAt" | "status">): Promise<HitlTask>;
  get(id: string): Promise<HitlTask | undefined>;
  list(filter?: { status?: HitlTask["status"] }): Promise<HitlTask[]>;
  answer(id: string, answer: HitlAnswer, operatorId: string): Promise<HitlTask>;
  /** resolves when the task is answered (or rejects on timeout) */
  await(id: string, timeoutMs: number): Promise<HitlAnswer>;
}
