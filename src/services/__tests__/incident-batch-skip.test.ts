import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import { IncidentService } from "../incident.service.js";

const gone = () => Object.assign(new Error("not found"), { response: { status: 404 } });
const boom = () => Object.assign(new Error("server error"), { response: { status: 500, data: { message: "engine exploded" } } });

interface Scenario {
  /** Incident payloads by id; an Error value makes the incident read throw. */
  incidents: Record<string, Record<string, unknown> | Error>;
  /** Error thrown by the modification POST for a given process instance. */
  modifyErrors?: Record<string, unknown>;
  /** Historic state per instance, for the liveness lookup. */
  history?: Record<string, { state: string; endTime?: string | null }>;
}

function mockClient(scenario: Scenario) {
  const get = vi.fn(async (url: string) => {
    const incident = url.match(/^\/incident\/(.+)$/);
    if (incident) {
      const found = scenario.incidents[incident[1]];
      if (found instanceof Error) throw found;
      if (!found) throw gone();
      return { data: found };
    }
    const runtime = url.match(/^\/process-instance\/([^/]+)$/);
    if (runtime) throw gone();
    const historic = url.match(/^\/history\/process-instance\/([^/]+)$/);
    if (historic) {
      const row = scenario.history?.[historic[1]];
      if (!row) throw gone();
      return { data: { id: historic[1], state: row.state, endTime: row.endTime ?? null } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });

  const post = vi.fn(async (url: string) => {
    const match = url.match(/^\/process-instance\/([^/]+)\/modification$/);
    if (match) {
      const failure = scenario.modifyErrors?.[match[1]];
      if (failure) throw failure;
      return { data: {} };
    }
    throw new Error(`Unexpected POST ${url}`);
  });

  const put = vi.fn(async () => ({ data: {} }));
  const del = vi.fn(async () => ({ data: {} }));
  return {
    client: { get, post, put, delete: del } as unknown as AxiosInstance,
    get, post, put,
  };
}

describe("IncidentService — already-processed handling", () => {
  it("skips a vanished incident instead of counting it as a failure", async () => {
    const mock = mockClient({ incidents: { i1: gone() } });
    const result = await new IncidentService().batchModifyToStart(
      mock.client, ["i1"], 10, "Target"
    );
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.results[0].status).toBe("skipped");
    expect(result.results[0].message).toContain("already resolved or instance finished");
  });

  it("names the end state when the instance finishes mid-modification", async () => {
    const mock = mockClient({
      incidents: { i1: { processInstanceId: "p1", processDefinitionId: "d1", activityId: "A" } },
      modifyErrors: { p1: gone() },
      history: { p1: { state: "COMPLETED", endTime: "2026-01-01T10:00:00Z" } },
    });
    const result = await new IncidentService().batchModifyToStart(
      mock.client, ["i1"], 10, "Target"
    );
    expect(result.skipped).toBe(1);
    expect(result.results[0].message).toContain("COMPLETED");
    expect(result.results[0].processInstanceId).toBe("p1");
  });

  it("still reports a genuine engine failure as failed", async () => {
    const mock = mockClient({
      incidents: { i1: { processInstanceId: "p1", processDefinitionId: "d1", activityId: "A" } },
      modifyErrors: { p1: boom() },
    });
    const result = await new IncidentService().batchModifyToStart(
      mock.client, ["i1"], 10, "Target"
    );
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.results[0].message).toContain("engine exploded");
  });

  it("keeps processing the rest of the batch around a skip", async () => {
    const mock = mockClient({
      incidents: {
        i1: gone(),
        i2: { processInstanceId: "p2", processDefinitionId: "d1", activityId: "A" },
        i3: { processInstanceId: "p3", processDefinitionId: "d1", activityId: "A" },
        i4: gone(),
      },
      modifyErrors: { p3: boom() },
    });
    const result = await new IncidentService().batchModifyToStart(
      mock.client, ["i1", "i2", "i3", "i4"], 2, "Target"
    );
    expect(result.total).toBe(4);
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.succeeded + result.skipped + result.failed).toBe(result.total);
  });

  it("skips an already-resolved incident on retry", async () => {
    const mock = mockClient({ incidents: { i1: gone() } });
    const result = await new IncidentService().batchRetry(mock.client, ["i1"], 10, 1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("skips an already-resolved incident on resolve", async () => {
    const mock = mockClient({ incidents: { i1: gone() } });
    const result = await new IncidentService().batchResolve(mock.client, ["i1"], 10, "retry");
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });
});
