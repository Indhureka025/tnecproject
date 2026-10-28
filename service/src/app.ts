import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

import { loadConfig, type Config } from "./config.ts";
import { EcRequestSchema, type RequestStatus } from "./contract.ts";
import { openDb, type Db } from "./db/pg.ts";
import { MemoryRequestStore } from "./store/memory.ts";
import { PostgresRequestStore } from "./store/postgres.ts";
import type { RequestStore, StoredRequest } from "./store/types.ts";
import { MemoryQueue } from "./queue/memory.ts";
import { PostgresQueue } from "./queue/postgres.ts";
import type { Queue } from "./queue/types.ts";
import { MemoryHitlStore } from "./hitl/store.ts";
import type { HitlStore } from "./hitl/types.ts";
import { registerHitlRoutes } from "./hitl/routes.ts";
import { MemoryObjectStore, LocalObjectStore } from "./storage/index.ts";
import type { ObjectStore } from "./storage/types.ts";
import { ProviderRouter } from "./providers/router.ts";
import type { EcProvider } from "./providers/types.ts";
import { MockProvider } from "./providers/mock.ts";
import { LandeedProvider } from "./providers/landeed.ts";
import { SurepassProvider } from "./providers/surepass.ts";
import { AutomationProvider } from "./providers/automation.ts";
import { HttpWebhookDeliverer, type WebhookDeliverer } from "./webhook/deliver.ts";
import { createPipeline, type Pipeline } from "./pipeline.ts";
import { paramHash } from "./util/hash.ts";
import { coverage } from "./masterdata/index.ts";
import { metrics } from "./metrics.ts";

declare module "fastify" {
  interface FastifyInstance {
    _internals: {
      store: RequestStore;
      hitl: HitlStore;
      queue: Queue<{ requestId: string }>;
      pipeline: Pipeline;
      storage: ObjectStore;
      config: Config;
      db?: Db;
    };
  }
  interface FastifyRequest {
    tenant?: string;
  }
}

export interface BuildOptions {
  config?: Partial<Config>;
  store?: RequestStore;
  hitl?: HitlStore;
  providers?: EcProvider[];
  webhooks?: WebhookDeliverer;
  queue?: Queue<{ requestId: string }>;
  storage?: ObjectStore;
}

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const OPEN_PREFIXES = ["/healthz", "/metrics", "/ops", "/public", "/dashboard", "/demo", "/v1/documents"];

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config: Config = { ...loadConfig(), ...opts.config };
  const app = Fastify({ logger: { level: config.logLevel } });
  const log = (event: string, data?: Record<string, unknown>) => app.log.info({ event, ...data });

  // ---- backend wiring ----
  let db: Db | undefined;
  let store: RequestStore;
  let queue: Queue<{ requestId: string }>;

  if (opts.store && opts.queue) {
    store = opts.store;
    queue = opts.queue;
  } else if (config.backend === "postgres") {
    db = await openDb(config.databaseUrl);
    store = opts.store ?? new PostgresRequestStore(db);
    queue = opts.queue ?? new PostgresQueue<{ requestId: string }>(db, "ec");
  } else {
    store = opts.store ?? new MemoryRequestStore();
    queue =
      opts.queue ??
      new MemoryQueue<{ requestId: string }>({ maxAttempts: 5, baseDelayMs: 1000, onDlq: (job, err) => app.log.error({ event: "dlq", job: job.id, err: String(err) }) });
  }

  const storage: ObjectStore =
    opts.storage ??
    (config.storage.startsWith("local:")
      ? new LocalObjectStore(config.webhookSigningSecret, config.storage.slice("local:".length))
      : new MemoryObjectStore(config.webhookSigningSecret));

  const hitl = opts.hitl ?? new MemoryHitlStore(config.hitlMode);
  const webhooks =
    opts.webhooks ??
    new HttpWebhookDeliverer(config.webhookSigningSecret, config.webhookRetry, (e, d) => app.log.info({ event: e, ...d }));

  const providers = opts.providers ?? buildProviders(config);
  const router = new ProviderRouter(orderProviders(providers, config.providerOrder));
  const pipeline = createPipeline({
    store, router, webhooks, hitl, storage, config, log,
    enqueueDelayed: (id, ms) => queue.add({ requestId: id }, { delayMs: ms }).then(() => undefined),
  });

  queue.process(async (job) => {
    const t = metrics.timer("pipeline_run");
    try {
      await pipeline.run(job.payload.requestId);
    } finally {
      t();
    }
  });

  // ---- auth + rate limit ----
  const buckets = new Map<string, { count: number; resetAt: number }>();
  app.addHook("onRequest", async (req, reply) => {
    metrics.inc("http_requests_total");
    if (OPEN_PREFIXES.some((p) => req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?")) || req.url === "/") return;

    const key = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const tenant = Object.entries(config.tenantKeys).find(([, v]) => v === key)?.[0];
    if (!tenant) {
      metrics.inc("auth_rejected_total");
      return reply.code(401).send({ error: "unauthorized" });
    }
    req.tenant = tenant;

    const now = Date.now();
    const b = buckets.get(tenant);
    if (!b || b.resetAt < now) {
      buckets.set(tenant, { count: 1, resetAt: now + config.rateLimit.windowMs });
    } else if (b.count >= config.rateLimit.max) {
      metrics.inc("rate_limited_total");
      reply.header("retry-after", Math.ceil((b.resetAt - now) / 1000));
      return reply.code(429).send({ error: "rate_limited" });
    } else {
      b.count += 1;
    }
  });

  // ---- API ----
  app.post("/v1/ec-requests", async (req, reply) => {
    const idem = req.headers["idempotency-key"];
    if (typeof idem !== "string" || idem.length < 8) {
      return reply.code(400).send({ error: "validation", details: [{ field: "Idempotency-Key", message: "header required (min 8 chars)" }] });
    }
    const parsed = EcRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }

    const existing = await store.findByIdempotencyKey(idem);
    if (existing) {
      if (existing.paramHash !== paramHash(parsed.data)) return reply.code(409).send({ error: "idempotency_conflict" });
      return reply.code(200).send(existing.status);
    }

    const requestId = randomUUID();
    const now = new Date().toISOString();
    const status: RequestStatus = {
      requestId,
      reference: parsed.data.reference,
      status: "queued",
      certified: parsed.data.certified,
      source: null,
      submittedAt: now,
      completedAt: null,
      estimate: parsed.data.certified ? { type: "days", value: 5 } : { type: "minutes", value: 5 },
      result: null,
      documents: [],
      failure: null,
    };
    const rec: StoredRequest = {
      status,
      request: parsed.data,
      idempotencyKey: idem,
      paramHash: paramHash(parsed.data),
      createdAt: now,
      updatedAt: now,
      audit: [{ at: now, event: "received", detail: { tenant: req.tenant } }],
    };
    await store.create(rec);
    metrics.inc("ec_requests_total");
    void webhooks.send("ec.received", status, parsed.data.callbackUrl);
    await queue.add({ requestId });

    return reply.code(202).send(status);
  });

  app.get("/v1/ec-requests/:id", async (req, reply) => {
    const rec = await store.get((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: "not_found" });
    return rec.status;
  });

  // ---- documents (signed, no bearer needed) ----
  app.get("/v1/documents/*", async (req, reply) => {
    const key = decodeURIComponent((req.params as Record<string, string>)["*"] ?? "");
    const { exp, token } = req.query as { exp?: string; token?: string };
    if (!storage.verify(key, exp ?? "", token ?? "")) return reply.code(403).send({ error: "bad_or_expired_token" });
    const obj = await storage.get(key);
    if (!obj) return reply.code(404).send({ error: "not_found" });
    metrics.inc("documents_served_total");
    return reply.type(obj.contentType).send(obj.data);
  });

  // ---- ops / HITL ----
  registerHitlRoutes(app, hitl);
  app.get("/ops/coverage", async () => coverage());

  // ---- observability ----
  app.get("/metrics", async (_req, reply) => reply.type("text/plain").send(metrics.prometheus()));
  app.get("/healthz", async () => ({
    ok: true,
    backend: config.backend,
    storage: config.storage.startsWith("local:") ? "local" : "memory",
    providers: providers.map((p) => p.name),
    db: db ? "connected" : "n/a",
  }));

  // ---- static ----
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/public/" });
  app.get("/", async (_req, reply) => reply.redirect("/public/console.html"));
  app.get("/dashboard", async (_req, reply) => reply.redirect("/public/dashboard.html"));
  app.get("/demo", async (_req, reply) => reply.redirect("/public/demo.html"));

  app.addHook("onClose", async () => {
    await queue.close();
    if (db) await db.close();
  });

  app.decorate("_internals", { store, hitl, queue, pipeline, storage, config, db });
  return app;
}

function buildProviders(config: Config): EcProvider[] {
  return [
    new MockProvider(),
    new LandeedProvider(config.aggregators.landeed),
    new SurepassProvider(config.aggregators.surepass),
    new AutomationProvider(
      config.automation.portalUrl
        ? {
            portalUrl: config.automation.portalUrl,
            username: config.automation.username,
            password: config.automation.password,
            headless: config.automation.headless,
            recordVideoDir: config.automation.recordVideoDir || undefined,
          }
        : {},
    ),
  ];
}

function orderProviders(providers: EcProvider[], order: string[]): EcProvider[] {
  const byName = new Map(providers.map((p) => [p.name, p]));
  const ordered = order.map((n) => byName.get(n)).filter((p): p is EcProvider => Boolean(p));
  return ordered.length ? ordered : providers;
}
