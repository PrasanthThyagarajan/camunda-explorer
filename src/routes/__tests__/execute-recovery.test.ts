import type { Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const buildCamundaClient = vi.fn();
const record = vi.fn();
const invalidateInstanceCache = vi.fn();

vi.mock("../../services/camunda-client.factory.js", () => ({
  buildCamundaClient: (...args: unknown[]) => buildCamundaClient(...args),
}));
vi.mock("../../services/intelligence/recovery-ledger.js", () => ({
  recoveryLedger: { record: (...args: unknown[]) => record(...args) },
}));
vi.mock("../../services/intelligence/diagnosis-orchestrator.js", () => ({
  diagnoseInstance: vi.fn(),
  getExecution: vi.fn(),
  invalidateInstanceCache: (...args: unknown[]) => invalidateInstanceCache(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createIntelligenceRoutes } = await import("../intelligence.routes.js");

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

/** Pulls the real POST /execute-recovery handler out of the built router. */
function recoveryHandler() {
  const router = createIntelligenceRoutes({
    getActive: () => ({ id: "test", name: "Test", baseUrl: "http://localhost:8080/engine-rest" }),
  } as unknown as Parameters<typeof createIntelligenceRoutes>[0]) as Router;

  const layer = (router as unknown as { stack: Array<Record<string, any>> }).stack.find(
    (l) => l.route?.path === "/execute-recovery"
  );
  if (!layer) throw new Error("/execute-recovery is not registered");
  return layer.route.stack[0].handle as (req: unknown, res: unknown, next: unknown) => void;
}

/** asyncHandler does not return its promise, so settle on the first response. */
function invoke(body: Record<string, unknown>) {
  const handler = recoveryHandler();
  return new Promise<{ status: number; body: any; error?: unknown }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("handler never responded")), 3000);
    const res = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) {
        clearTimeout(timer);
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };
    const next = (err: unknown) => {
      clearTimeout(timer);
      resolve({ status: 500, body: null, error: err });
    };
    handler({ body }, res, next);
  });
}

beforeEach(() => {
  buildCamundaClient.mockReset();
  record.mockReset();
  invalidateInstanceCache.mockReset();
});

function useClient(client: Record<string, unknown>) {
  buildCamundaClient.mockReturnValue(client);
}

describe("POST /execute-recovery — already-processed handling", () => {
  it("returns 409 skipped when a retry target has already finished", async () => {
    useClient({
      get: vi.fn(async (url: string) => {
        if (url === "/job") return { data: [] };
        if (url === "/process-instance/p1") throw httpError(404);
        if (url === "/history/process-instance/p1") {
          return { data: { id: "p1", state: "COMPLETED", endTime: "2026-05-05T07:00:00Z" } };
        }
        throw new Error(`Unexpected GET ${url}`);
      }),
      put: vi.fn(),
      post: vi.fn(),
    });

    const res = await invoke({ instanceId: "p1", type: "retry" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, skipped: true });
    expect(res.body.message).toContain("COMPLETED");
  });

  it("does not write a skipped instance to the recovery ledger", async () => {
    useClient({
      get: vi.fn(async (url: string) => {
        if (url === "/job") return { data: [] };
        if (url === "/process-instance/p1") throw httpError(404);
        return { data: { id: "p1", state: "COMPLETED", endTime: null } };
      }),
      put: vi.fn(),
      post: vi.fn(),
    });

    await invoke({ instanceId: "p1", type: "retry" });

    // The ledger trains the suggestion ranker; a skip is not an outcome.
    expect(record).not.toHaveBeenCalled();
    expect(invalidateInstanceCache).not.toHaveBeenCalled();
  });

  it("still reports a genuinely stuck instance as 404, not skipped", async () => {
    useClient({
      get: vi.fn(async (url: string) => {
        if (url === "/job") return { data: [] };
        if (url === "/process-instance/p1") return { data: { id: "p1" } };
        throw new Error(`Unexpected GET ${url}`);
      }),
      put: vi.fn(),
      post: vi.fn(),
    });

    const res = await invoke({ instanceId: "p1", type: "retry" });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No failed job found");
    expect(res.body.skipped).toBeUndefined();
  });

  it("returns 409 skipped when restart finds the instance already finished", async () => {
    useClient({
      get: vi.fn(async (url: string) => {
        if (url.endsWith("/activity-instances")) throw httpError(404);
        if (url === "/process-instance/p1") throw httpError(404);
        return { data: { id: "p1", state: "EXTERNALLY_TERMINATED", endTime: null } };
      }),
      put: vi.fn(),
      post: vi.fn(),
    });

    const res = await invoke({ instanceId: "p1", type: "restart", targetActivityId: "Task_A" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ skipped: true });
    expect(res.body.message).toContain("EXTERNALLY_TERMINATED");
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses to restart an instance that has no active tokens", async () => {
    useClient({
      get: vi.fn(async () => ({ data: { id: "root", activityInstances: [], childActivityInstances: [] } })),
      put: vi.fn(),
      post: vi.fn(),
    });

    const res = await invoke({ instanceId: "p1", type: "restart", targetActivityId: "Task_A" });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("no active tokens");
    // Nothing was modified, so nothing may be recorded.
    expect(record).not.toHaveBeenCalled();
  });
});

describe("POST /execute-recovery — normal paths still work", () => {
  it("records a successful retry in the ledger and invalidates the cache", async () => {
    const put = vi.fn(async () => ({ data: {} }));
    useClient({
      get: vi.fn(async (url: string) => {
        if (url === "/job") return { data: [{ id: "job-1" }] };
        throw new Error(`Unexpected GET ${url}`);
      }),
      put,
      post: vi.fn(),
    });

    const res = await invoke({ instanceId: "p1", type: "retry" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(put).toHaveBeenCalledWith("/job/job-1/retries", { retries: 1 });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ instanceId: "p1", executionSuccess: true });
    expect(invalidateInstanceCache).toHaveBeenCalledWith("p1");
  });

  it("validates the request body before touching the engine", async () => {
    useClient({ get: vi.fn(), put: vi.fn(), post: vi.fn() });

    await expect(invoke({ type: "retry" })).resolves.toMatchObject({ status: 400 });
    await expect(invoke({ instanceId: "p1" })).resolves.toMatchObject({ status: 400 });
    await expect(invoke({ instanceId: "p1", type: "restart" })).resolves.toMatchObject({ status: 400 });
    await expect(invoke({ instanceId: "p1", type: "nonsense" })).resolves.toMatchObject({ status: 400 });
  });
});
