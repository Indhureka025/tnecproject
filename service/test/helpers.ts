import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { WebhookDeliverer } from "../src/webhook/deliver.ts";
import type { RequestStatus, WebhookEventName } from "../src/contract.ts";

export interface CapturedEvent {
  event: WebhookEventName;
  status: RequestStatus;
  callbackUrl: string;
}

export class FakeWebhooks implements WebhookDeliverer {
  events: CapturedEvent[] = [];
  async send(event: WebhookEventName, status: RequestStatus, callbackUrl: string): Promise<void> {
    this.events.push({ event, status: structuredClone(status), callbackUrl });
  }
  byName(name: WebhookEventName): CapturedEvent[] {
    return this.events.filter((e) => e.event === name);
  }
}

const TEST_ENV = {
  PORT: "0",
  LOG_LEVEL: "silent",
  BACKEND: "memory",
  WEBHOOK_SIGNING_SECRET: "test-secret",
  TENANT_KEYS: '{"erp-test":"test-key"}',
  HITL_MODE: "auto",
  PROVIDER_ORDER: "mock",
  DEDUPE_WINDOW_DAYS: "0",
};

export async function makeApp(over: Partial<Record<string, string>> = {}): Promise<{ app: FastifyInstance; webhooks: FakeWebhooks }> {
  Object.assign(process.env, TEST_ENV, over);
  const webhooks = new FakeWebhooks();
  const app = await buildApp({ webhooks });
  return { app, webhooks };
}

export const AUTH = { authorization: "Bearer test-key" };

export function sampleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    searchType: "EC_WISE",
    certified: false,
    property: {
      zone: "Chennai",
      district: "Chennai",
      sroCode: "Thiruvottiyur",
      village: "Thiruvottiyur",
      surveyNumber: "123/4",
      subdivisionNumber: "1",
    },
    period: { from: "2004-01-01", to: "2024-12-31" },
    callbackUrl: "https://erp.example.internal/hooks/ec",
    reference: "ERP-DEAL-1",
    ...overrides,
  };
}

/** Poll GET until the request reaches a terminal state or times out. */
export async function waitForTerminal(app: FastifyInstance, requestId: string, timeoutMs = 4000): Promise<RequestStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.inject({ method: "GET", url: `/v1/ec-requests/${requestId}`, headers: AUTH });
    const body = res.json() as RequestStatus;
    if (["completed", "partial", "failed"].includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`request ${requestId} did not finish within ${timeoutMs}ms`);
}
