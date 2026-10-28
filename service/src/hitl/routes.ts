import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HitlStore } from "./types.ts";

const AnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("captcha"), value: z.string().min(1) }),
  z.object({ kind: z.literal("otp"), value: z.string().min(1) }),
  z.object({ kind: z.literal("nil_review"), confirmedNil: z.boolean(), note: z.string().optional() }),
  z.object({ kind: z.literal("ocr_review"), corrections: z.record(z.string()), note: z.string().optional() }),
  z.object({ kind: z.literal("payment"), approved: z.boolean(), reference: z.string().optional(), note: z.string().optional() }),
]);

/** Operator console API. In production this sits behind SSO + an operator role. */
export function registerHitlRoutes(app: FastifyInstance, store: HitlStore): void {
  app.get("/ops/tasks", async (req) => {
    const status = (req.query as { status?: "open" | "answered" | "expired" }).status;
    return { tasks: await store.list(status ? { status } : undefined) };
  });

  app.get("/ops/tasks/:id", async (req, reply) => {
    const task = await store.get((req.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    return task;
  });

  app.post("/ops/tasks/:id/answer", async (req, reply) => {
    const parsed = AnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation", details: parsed.error.issues });
    }
    const operatorId = (req.headers["x-operator-id"] as string) || "operator";
    try {
      return await store.answer((req.params as { id: string }).id, parsed.data, operatorId);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });
}
