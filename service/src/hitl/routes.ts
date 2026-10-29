import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { HitlStore } from "./types.ts";

const AnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("captcha"), value: z.string().min(1) }),
  z.object({ kind: z.literal("otp"), value: z.string().min(1) }),
  z.object({ kind: z.literal("nil_review"), confirmedNil: z.boolean(), note: z.string().optional() }),
  z.object({ kind: z.literal("ocr_review"), corrections: z.record(z.string()), note: z.string().optional() }),
  z.object({ kind: z.literal("payment"), approved: z.boolean(), reference: z.string().optional(), note: z.string().optional() }),
]);

const BridgeCaptchaSchema = z.object({
  requestId: z.string().min(1).max(128),
  context: z.object({
    note: z.string().max(500),
    imageBase64: z.string()
      .max(900_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  }).strict(),
}).strict();

/** Operator console API. In production this sits behind SSO + an operator role. */
export function registerHitlRoutes(
  app: FastifyInstance,
  store: HitlStore,
  bridgeToken: string,
  consoleMode: boolean,
): void {
  function authorizeBridge(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!bridgeToken) {
      void reply.code(503).send({ error: "operator_bridge_disabled" });
      return false;
    }
    const provided = req.headers["x-operator-bridge-token"];
    if (typeof provided !== "string") {
      void reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    const expectedBytes = Buffer.from(bridgeToken);
    const providedBytes = Buffer.from(provided);
    if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
      void reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  }

  app.post("/ops/bridge/tasks", async (req, reply) => {
    if (!authorizeBridge(req, reply)) return;
    if (!consoleMode) return reply.code(503).send({ error: "operator_console_mode_required" });
    const parsed = BridgeCaptchaSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation", details: parsed.error.issues });
    }
    const task = await store.open({
      requestId: parsed.data.requestId,
      kind: "captcha",
      context: parsed.data.context,
    });
    void store.await(task.id, 15 * 60_000).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== `HITL task ${task.id} timed out after 900000ms`) {
        app.log.error({ event: "operator_bridge.wait_failed", taskId: task.id, error });
      }
    });
    return reply.code(201).send({ taskId: task.id });
  });

  app.get("/ops/bridge/tasks/:id", async (req, reply) => {
    if (!authorizeBridge(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const task = await store.get(id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    return { status: task.status, answer: task.answer };
  });

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
