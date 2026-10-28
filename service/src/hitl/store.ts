import { randomUUID } from "node:crypto";
import type { HitlAnswer, HitlStore, HitlTask } from "./types.ts";

type Waiter = { resolve: (a: HitlAnswer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class MemoryHitlStore implements HitlStore {
  private tasks = new Map<string, HitlTask>();
  private waiters = new Map<string, Waiter[]>();

  /** auto = phase-0: resolve tasks immediately with a canned answer, no console. */
  constructor(private readonly mode: "auto" | "console" = "console") {}

  async open(t: Omit<HitlTask, "id" | "createdAt" | "status">): Promise<HitlTask> {
    const task: HitlTask = { ...t, id: randomUUID(), createdAt: new Date().toISOString(), status: "open" };
    this.tasks.set(task.id, task);
    if (this.mode === "auto") {
      setImmediate(() => void this.answer(task.id, autoAnswer(task), "auto"));
    }
    return task;
  }

  async get(id: string): Promise<HitlTask | undefined> {
    return this.tasks.get(id);
  }

  async list(filter?: { status?: HitlTask["status"] }): Promise<HitlTask[]> {
    const all = [...this.tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return filter?.status ? all.filter((t) => t.status === filter.status) : all;
  }

  async answer(id: string, answer: HitlAnswer, operatorId: string): Promise<HitlTask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`no such task ${id}`);
    if (task.status === "answered") return task;
    task.status = "answered";
    task.answer = answer;
    task.answeredAt = new Date().toISOString();
    task.operatorId = operatorId;
    for (const w of this.waiters.get(id) ?? []) {
      clearTimeout(w.timer);
      w.resolve(answer);
    }
    this.waiters.delete(id);
    return task;
  }

  async await(id: string, timeoutMs: number): Promise<HitlAnswer> {
    const task = this.tasks.get(id);
    if (task?.status === "answered" && task.answer) return task.answer;
    return new Promise<HitlAnswer>((resolve, reject) => {
      const timer = setTimeout(() => {
        const t = this.tasks.get(id);
        if (t && t.status === "open") t.status = "expired";
        reject(new Error(`HITL task ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      const list = this.waiters.get(id) ?? [];
      list.push({ resolve, reject, timer });
      this.waiters.set(id, list);
    });
  }
}

function autoAnswer(task: HitlTask): HitlAnswer {
  // The mock portal exposes the correct answer so unattended tests can proceed;
  // the real portal never does, so a real operator answers.
  const mock = (task.context as { _mockAnswer?: string })?._mockAnswer;
  switch (task.kind) {
    case "captcha": return { kind: "captcha", value: mock || "DEMO" };
    case "otp": return { kind: "otp", value: mock || "000000" };
    case "nil_review": return { kind: "nil_review", confirmedNil: false, note: "auto (phase-0)" };
    case "ocr_review": return { kind: "ocr_review", corrections: {}, note: "auto (phase-0)" };
    case "payment": return { kind: "payment", approved: true, reference: "AUTO-PAY", note: "auto (phase-0)" };
  }
}
