import type { RequestStore } from "./store/types.ts";
import type { ProviderRouter } from "./providers/router.ts";
import type { WebhookDeliverer } from "./webhook/deliver.ts";
import type { HitlStore } from "./hitl/types.ts";
import type { ObjectStore } from "./storage/types.ts";
import { ProviderError } from "./providers/types.ts";
import { MasterDataError, resolveUnit } from "./masterdata/index.ts";
import { renderEcHtml } from "./render/ec-doc.ts";
import type { Config } from "./config.ts";
import type { EcResult } from "./canonical.ts";
import type { DeliverableDoc, FailureCode, RequestStatus, WebhookEventName } from "./contract.ts";

type Logger = (event: string, data?: Record<string, unknown>) => void;

export interface Pipeline {
  run(requestId: string): Promise<void>;
}

export function createPipeline(deps: {
  store: RequestStore;
  router: ProviderRouter;
  webhooks: WebhookDeliverer;
  hitl: HitlStore;
  storage: ObjectStore;
  config: Config;
  log: Logger;
  /** schedule this request to be run() again after `delayMs` (certified sign-check) */
  enqueueDelayed?: (requestId: string, delayMs: number) => Promise<void>;
}): Pipeline {
  const { store, router, webhooks, hitl, storage, config, log, enqueueDelayed } = deps;

  async function makeDocuments(requestId: string, result: EcResult, kind: DeliverableDoc["kind"] = "ec_summary"): Promise<DeliverableDoc[]> {
    try {
      const html = Buffer.from(renderEcHtml(result), "utf8");
      const obj = await storage.put(`ec/${requestId}`, "text/html", html);
      const signed = storage.signedPath(obj.key, 60 * 60_000);
      return [{ kind, url: signed.path, expiresAt: signed.expiresAt, sha256: obj.sha256 }];
    } catch (err) {
      log("pipeline.document_store_failed", { requestId, error: (err as Error).message });
      return [];
    }
  }

  async function emit(event: WebhookEventName, status: RequestStatus, callbackUrl: string): Promise<void> {
    void webhooks.send(event, status, callbackUrl);
  }

  async function fail(requestId: string, code: FailureCode, message: string, retryable: boolean, callbackUrl: string): Promise<void> {
    const rec = await store.update(
      requestId,
      { status: "failed", completedAt: new Date().toISOString(), failure: { code, message, retryable, operatorNote: null } },
      "failed",
      { code, message },
    );
    await emit("ec.failed", rec.status, callbackUrl);
  }

  /** finish an informational request (or the interim result of a certified one) */
  async function finalizeInformational(requestId: string, callbackUrl: string, result: EcResult, provider: string): Promise<void> {
    const partial =
      result.outcome === "NIL_UNCONFIRMED" ||
      result.outcome === "PERIOD_GAP" ||
      result.caveats.some((c) => c.code === "OCR_LOW_CONFIDENCE" || c.code === "PARTIAL_PERIOD_DIGITISED");
    const documents = await makeDocuments(requestId, result);
    const status: RequestStatus["status"] = partial ? "partial" : "completed";
    const rec = await store.update(
      requestId,
      { status, completedAt: new Date().toISOString(), source: provider, result, documents },
      status,
      { provider, outcome: result.outcome, documents: documents.length },
    );
    await emit(partial ? "ec.partial" : "ec.completed", rec.status, callbackUrl);
  }

  return {
    async run(requestId: string): Promise<void> {
      const rec = await store.get(requestId);
      if (!rec) {
        log("pipeline.missing_request", { requestId });
        return;
      }
      const { request: req } = rec;

      // ---- re-entry: a certified EC waiting for the SRO's signature ----
      if (rec.status.status === "awaiting_signature") {
        const interim = rec.status.result;
        if (!interim) return void fail(requestId, "provider_error", "no interim result to certify", false, req.callbackUrl);
        const signed: EcResult = {
          ...interim,
          provenance: { ...interim.provenance, certified: true, retrievedAt: new Date().toISOString() },
          caveats: [
            ...interim.caveats.filter((c) => c.code !== "CERTIFIED_PENDING_SIGNATURE"),
            { code: "CERTIFIED_COPY_SIGNED", message: "Certified copy digitally signed by the Sub-Registrar." },
          ],
        };
        const documents = await makeDocuments(requestId, signed, "ec_pdf");
        const rec2 = await store.update(
          requestId,
          { status: "completed", completedAt: new Date().toISOString(), result: signed, documents },
          "certified_signed",
          { documents: documents.length },
        );
        await emit("ec.completed", rec2.status, req.callbackUrl);
        return;
      }

      // 1. resolve master data
      try {
        const unit = resolveUnit({ zone: req.property.zone, district: req.property.district, sro: req.property.sroCode });
        req.property.zone = unit.zone;
        req.property.district = unit.district;
        req.property.sroCode = unit.sroCode;
      } catch (err) {
        if (err instanceof MasterDataError) return void fail(requestId, "unresolvable", err.message, false, req.callbackUrl);
        throw err;
      }

      // 2. dedupe (informational only)
      if (!req.certified && config.dedupeWindowDays > 0) {
        const since = new Date(Date.now() - config.dedupeWindowDays * 86_400_000);
        const hit = await store.findRecentByParamHash(rec.paramHash, since);
        if (hit?.status.result) {
          const documents = await makeDocuments(requestId, hit.status.result);
          const rec2 = await store.update(
            requestId,
            { status: "completed", completedAt: new Date().toISOString(), source: hit.status.source, result: hit.status.result, documents },
            "dedupe_hit",
            { servedFrom: hit.status.requestId },
          );
          await emit("ec.completed", rec2.status, req.callbackUrl);
          return;
        }
      }

      // 3. in progress
      await store.update(requestId, { status: "in_progress" }, "in_progress");

      // 4. retrieve
      let result: EcResult;
      let provider: string;
      try {
        const out = await router.retrieve(req, {
          requestId,
          log: (e, d) => log(e, { requestId, ...d }),
          requestHuman: async (task) => {
            const opened = await hitl.open({ ...task, requestId, context: task.context ?? {} });
            await store.update(requestId, { status: "needs_human" }, "needs_human", { taskId: opened.id, kind: opened.kind });
            const cur = await store.get(requestId);
            if (cur) await emit("ec.needs_human", cur.status, req.callbackUrl);
            const answer = await hitl.await(opened.id, 15 * 60_000);
            await store.update(requestId, { status: "in_progress" }, "human_answered", { taskId: opened.id });
            return answer;
          },
        });
        result = out.result;
        provider = out.provider;
      } catch (err) {
        const map: Record<string, FailureCode> = {
          unsupported: "unresolvable", portal_unavailable: "portal_unavailable", provider_error: "provider_error",
          no_records_unconfirmed: "no_records_unconfirmed", payment_required: "payment_required", not_digitised: "not_digitised",
          captcha_unrecoverable: "captcha_unrecoverable", timeout: "timeout",
        };
        const code = err instanceof ProviderError ? (map[err.code] ?? "provider_error") : "provider_error";
        const retry = err instanceof ProviderError ? err.retryable : true;
        return void fail(requestId, code, (err as Error).message, retry, req.callbackUrl);
      }

      // 5a. informational request -> done
      if (!req.certified || result.provenance.certified) {
        return finalizeInformational(requestId, req.callbackUrl, result, provider);
      }

      // 5b. certified request -> payment, then wait for the SRO to sign
      const pay = await (async () => {
        const opened = await hitl.open({ kind: "payment", requestId, context: { note: "Certified EC statutory fee", amountInr: 130 } });
        await store.update(requestId, { status: "needs_human" }, "needs_human", { taskId: opened.id, kind: "payment" });
        const cur = await store.get(requestId);
        if (cur) await emit("ec.needs_human", cur.status, req.callbackUrl);
        return hitl.await(opened.id, 60 * 60_000);
      })();
      if (pay.kind !== "payment" || !pay.approved) {
        return void fail(requestId, "payment_required", "certified EC payment not approved", false, req.callbackUrl);
      }

      const interim: EcResult = {
        ...result,
        caveats: [...result.caveats, { code: "CERTIFIED_PENDING_SIGNATURE", message: "Interim result — certified copy pending Sub-Registrar signature (typically 1-10 days)." }],
      };
      const rec3 = await store.update(
        requestId,
        {
          status: "awaiting_signature",
          source: provider,
          result: interim,
          documents: await makeDocuments(requestId, interim),
          estimate: { type: "days", value: 5 },
        },
        "awaiting_signature",
        { provider, paymentRef: pay.reference ?? null },
      );
      await emit("ec.awaiting_signature", rec3.status, req.callbackUrl);
      await enqueueDelayed?.(requestId, config.certifiedSignDelayMs);
    },
  };
}
