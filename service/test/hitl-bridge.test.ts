import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers.ts";

describe("operator CAPTCHA bridge", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("requires the configured bridge token before creating a task", async () => {
    ({ app } = await makeApp({ OPERATOR_BRIDGE_TOKEN: "bridge-test-token", HITL_MODE: "console" }));
    const res = await app.inject({
      method: "POST",
      url: "/ops/bridge/tasks",
      payload: {
        requestId: "poc-test",
        context: { note: "test CAPTCHA", imageBase64: "data:image/png;base64,aGVsbG8=" },
      },
    });

    expect(res.statusCode).toBe(401);
    expect(await app._internals.hitl.list({ status: "open" })).toHaveLength(0);
  });

  it("shows a CAPTCHA task to the console and returns the operator's answer to the runner", async () => {
    ({ app } = await makeApp({ OPERATOR_BRIDGE_TOKEN: "bridge-test-token", HITL_MODE: "console" }));
    const headers = { "x-operator-bridge-token": "bridge-test-token" };
    const created = await app.inject({
      method: "POST",
      url: "/ops/bridge/tasks",
      headers,
      payload: {
        requestId: "poc-test",
        context: { note: "test CAPTCHA", imageBase64: "data:image/png;base64,aGVsbG8=" },
      },
    });

    expect(created.statusCode).toBe(201);
    const { taskId } = created.json() as { taskId: string };
    const pending = await app.inject({
      method: "GET",
      url: `/ops/bridge/tasks/${taskId}`,
      headers,
    });
    expect(pending.json()).toEqual({ status: "open" });

    const listed = await app.inject({ method: "GET", url: "/ops/tasks?status=open" });
    expect(listed.json().tasks).toContainEqual(expect.objectContaining({
      id: taskId,
      kind: "captcha",
      context: { note: "test CAPTCHA", imageBase64: "data:image/png;base64,aGVsbG8=" },
    }));

    const answered = await app.inject({
      method: "POST",
      url: `/ops/tasks/${taskId}/answer`,
      headers: { "content-type": "application/json", "x-operator-id": "test-operator" },
      payload: { kind: "captcha", value: "A7B9" },
    });
    expect(answered.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: `/ops/bridge/tasks/${taskId}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "answered",
      answer: { kind: "captcha", value: "A7B9" },
    });
  });

  it("does not allow auto-answer mode to bypass the operator", async () => {
    ({ app } = await makeApp({ OPERATOR_BRIDGE_TOKEN: "bridge-test-token", HITL_MODE: "auto" }));
    const res = await app.inject({
      method: "POST",
      url: "/ops/bridge/tasks",
      headers: { "x-operator-bridge-token": "bridge-test-token" },
      payload: {
        requestId: "poc-test",
        context: { note: "test CAPTCHA", imageBase64: "data:image/png;base64,aGVsbG8=" },
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "operator_console_mode_required" });
    expect(await app._internals.hitl.list({ status: "open" })).toHaveLength(0);
  });
});
