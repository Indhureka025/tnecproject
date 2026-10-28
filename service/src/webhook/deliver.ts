import { request } from "undici";
import { randomUUID } from "node:crypto";
import { signPayload } from "./sign.ts";
import type { WebhookEvent, WebhookEventName, RequestStatus } from "../contract.ts";

export interface WebhookDeliverer {
  send(event: WebhookEventName, status: RequestStatus, callbackUrl: string): Promise<void>;
}

type Sink = (url: string, headers: Record<string, string>, body: string) => Promise<{ statusCode: number }>;

const httpSink: Sink = async (url, headers, body) => {
  const res = await request(url, { method: "POST", headers, body });
  // drain
  await res.body.text().catch(() => undefined);
  return { statusCode: res.statusCode };
};

/**
 * Fire-and-forget delivery with exponential backoff. Retries on network error or
 * non-2xx for `attempts` tries. A real deployment persists undelivered events and
 * retries across restarts; here retries live in-process.
 */
export class HttpWebhookDeliverer implements WebhookDeliverer {
  constructor(
    private readonly secret: string,
    private readonly retry: { attempts: number; baseDelayMs: number },
    private readonly log: (event: string, data?: Record<string, unknown>) => void,
    private readonly sink: Sink = httpSink,
  ) {}

  async send(event: WebhookEventName, status: RequestStatus, callbackUrl: string): Promise<void> {
    const payload: WebhookEvent = {
      eventId: `evt_${randomUUID()}`,
      event,
      requestId: status.requestId,
      reference: status.reference,
      occurredAt: new Date().toISOString(),
      data: status,
    };
    const body = JSON.stringify(payload);

    for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
      const ts = new Date().toISOString();
      const headers = {
        "content-type": "application/json",
        "x-ec-timestamp": ts,
        "x-ec-signature": signPayload(this.secret, body, ts),
        "x-ec-event": event,
        "x-ec-delivery-attempt": String(attempt),
      };
      try {
        const { statusCode } = await this.sink(callbackUrl, headers, body);
        if (statusCode >= 200 && statusCode < 300) {
          this.log("webhook.delivered", { event, requestId: status.requestId, attempt });
          return;
        }
        this.log("webhook.non_2xx", { event, requestId: status.requestId, attempt, statusCode });
      } catch (err) {
        this.log("webhook.error", { event, requestId: status.requestId, attempt, error: (err as Error).message });
      }
      if (attempt < this.retry.attempts) {
        await sleep(this.retry.baseDelayMs * 2 ** (attempt - 1));
      }
    }
    this.log("webhook.gave_up", { event, requestId: status.requestId });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref?.());
