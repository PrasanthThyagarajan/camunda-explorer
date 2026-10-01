import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import { ProcessInstanceService } from "../process-instance.service.js";

const bpmn = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="order">
    <bpmn:startEvent id="Start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="Target" />
    <bpmn:serviceTask id="Target" />
    <bpmn:serviceTask id="WaitA" />
    <bpmn:serviceTask id="WaitB" />
  </bpmn:process>
</bpmn:definitions>`;

const gone = () => Object.assign(new Error("not found"), { response: { status: 404 } });

function activityTree(activityIds: string[]) {
  return {
    activityType: "processDefinition",
    childTransitionInstances: [],
    childActivityInstances: activityIds.map((activityId) => ({
      id: `${activityId}:instance`,
      activityId,
      activityName: activityId,
      activityType: "serviceTask",
      childActivityInstances: [],
      childTransitionInstances: [],
    })),
  };
}

interface MockOptions {
  /** Historic state per instance, keyed by ID. */
  history?: Record<string, { state: string; endTime?: string | null }>;
  /** Makes the history endpoint unavailable, as on an engine without history. */
  historyFails?: boolean;
  /** Error thrown by the activity-instances fetch for a given instance. */
  treeErrors?: Record<string, unknown>;
}

function mockClient(
  definitions: Record<string, string>,
  waits: Record<string, string[]>,
  options: MockOptions = {}
) {
  const history = options.history || {};
  let batchNumber = 0;
  const post = vi.fn(async (url: string, body: Record<string, unknown>) => {
    if (url === "/process-instance") {
      const ids = body.processInstanceIds as string[];
      return {
        data: ids.filter((id) => definitions[id]).map((id) => ({
          id, definitionId: definitions[id], businessKey: id, suspended: false,
        })),
      };
    }
    if (url === "/history/process-instance") {
      if (options.historyFails) throw new Error("history is disabled");
      const ids = body.processInstanceIds as string[];
      return {
        data: ids.filter((id) => history[id]).map((id) => ({
          id, state: history[id].state, endTime: history[id].endTime ?? null,
        })),
      };
    }
    if (url === "/modification/executeAsync") {
      return { data: { id: `batch-${++batchNumber}` } };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const get = vi.fn(async (url: string) => {
    if (url.startsWith("/process-definition/")) return { data: { bpmn20Xml: bpmn } };
    const match = url.match(/^\/process-instance\/([^/]+)\/activity-instances$/);
    if (match) {
      const failure = options.treeErrors?.[match[1]];
      if (failure) throw failure;
      return { data: activityTree(waits[match[1]] || []) };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
  return { client: { post, get } as unknown as AxiosInstance, post, get };
}

/** Every requested instance must land in exactly one outcome bucket. */
function expectFullyAccounted(result: Awaited<
  ReturnType<ProcessInstanceService["batchModifyInstances"]>
>) {
  const accounted =
    result.submittedInstances +
    result.alreadyProcessed.length +
    result.notFound.length +
    result.failedGroups.reduce((sum, group) => sum + group.instanceCount, 0);
  expect(accounted).toBe(result.totalInstances);
}

describe("ProcessInstanceService.batchModifyInstances", () => {
  it("submits one async batch for the same definition and wait set", async () => {
    const mock = mockClient({ p1: "order:2:a", p2: "order:2:a" }, {
      p1: ["WaitA"], p2: ["WaitA"],
    });
    const result = await new ProcessInstanceService().batchModifyInstances(
      mock.client, ["p1", "p2"], "Target"
    );
    expect(result.batches).toHaveLength(1);
    expect(result.submittedInstances).toBe(2);
    const call = mock.post.mock.calls.find((entry) => entry[0] === "/modification/executeAsync");
    expect(call?.[1]).toMatchObject({
      processDefinitionId: "order:2:a",
      processInstanceIds: ["p1", "p2"],
    });
    expect((call?.[1].instructions as Array<Record<string, unknown>>)).toContainEqual(
      expect.objectContaining({
        type: "cancel", activityId: "WaitA", cancelCurrentActiveActivityInstances: true,
      })
    );
    expectFullyAccounted(result);
  });

  it("does not query history when every instance is still running", async () => {
    const mock = mockClient({ p1: "order:2:a" }, { p1: ["WaitA"] });
    await new ProcessInstanceService().batchModifyInstances(mock.client, ["p1"], "Target");
    expect(mock.post.mock.calls.some((entry) => entry[0] === "/history/process-instance")).toBe(false);
  });

  it("uses one definition batch for mixed waits and cancels every valid node first", async () => {
    const mock = mockClient({ p1: "order:2:a", p2: "order:2:a" }, {
      p1: ["WaitA"], p2: ["WaitB"],
    });
    const result = await new ProcessInstanceService().batchModifyInstances(
      mock.client, ["p1", "p2"], "Target"
    );
    expect(result.batches).toHaveLength(1);
    const asyncCalls = mock.post.mock.calls.filter((entry) => entry[0] === "/modification/executeAsync");
    const instructions = asyncCalls[0][1].instructions as Array<Record<string, unknown>>;
    const cancelIds = instructions.filter((item) => item.type === "cancel").map((item) => item.activityId);
    expect(cancelIds).toEqual(expect.arrayContaining(["Target", "WaitA", "WaitB"]));
    expect(instructions.at(-1)).toMatchObject({ type: "startBeforeActivity", activityId: "Target" });
  });

  it("rejects mixed process definition versions before submitting", async () => {
    const mock = mockClient({ p1: "order:1:a", p2: "order:2:b" }, {
      p1: ["WaitA"], p2: ["WaitA"],
    });
    await expect(new ProcessInstanceService().batchModifyInstances(
      mock.client, ["p1", "p2"], "Target"
    )).rejects.toThrow("one process definition version");
    expect(mock.post.mock.calls.some((entry) => entry[0] === "/modification/executeAsync")).toBe(false);
  });

  it("aborts the whole operation for empty-wait instances", async () => {
    const mock = mockClient({ p1: "order:2:a" }, { p1: [] });
    await expect(new ProcessInstanceService().batchModifyInstances(
      mock.client, ["p1"], "Target"
    )).rejects.toThrow("no batch was submitted");
    expect(mock.post.mock.calls.some((entry) => entry[0] === "/modification/executeAsync")).toBe(false);
  });

  it("rejects more than 2000 IDs", async () => {
    const mock = mockClient({}, {});
    await expect(new ProcessInstanceService().batchModifyInstances(
      mock.client,
      Array.from({ length: 2001 }, (_, index) => `p${index}`),
      "Target"
    )).rejects.toThrow("between 1 and 2000");
  });

  it("reports an unknown outcome instead of encouraging retry after a transport loss", async () => {
    const mock = mockClient({ p1: "order:2:a" }, { p1: ["WaitA"] });
    const implementation = mock.post.getMockImplementation()!;
    mock.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url === "/modification/executeAsync") {
        throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
      }
      return implementation(url, body);
    });
    await expect(new ProcessInstanceService().batchModifyInstances(
      mock.client, ["p1"], "Target"
    )).rejects.toThrow("outcome is unknown");
  });

  describe("batch size", () => {
    const fourRunning = {
      definitions: { p1: "order:2:a", p2: "order:2:a", p3: "order:2:a", p4: "order:2:a" },
      waits: { p1: ["WaitA"], p2: ["WaitA"], p3: ["WaitA"], p4: ["WaitA"] },
    };

    it("splits one definition group into batches of the requested size", async () => {
      const mock = mockClient(fourRunning.definitions, fourRunning.waits);
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "p2", "p3", "p4"], "Target", { batchSize: 2 }
      );
      expect(result.batches).toHaveLength(2);
      expect(result.batches.map((batch) => batch.instanceCount)).toEqual([2, 2]);
      expect(result.submittedInstances).toBe(4);
      const submitted = mock.post.mock.calls
        .filter((entry) => entry[0] === "/modification/executeAsync")
        .map((entry) => entry[1].processInstanceIds);
      expect(submitted).toEqual([["p1", "p2"], ["p3", "p4"]]);
      expectFullyAccounted(result);
    });

    it("leaves a partial final batch when the size does not divide evenly", async () => {
      const mock = mockClient(fourRunning.definitions, fourRunning.waits);
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "p2", "p3", "p4"], "Target", { batchSize: 3 }
      );
      expect(result.batches.map((batch) => batch.instanceCount)).toEqual([3, 1]);
      expectFullyAccounted(result);
    });

    it("counts only the still-running instances towards the batch size", async () => {
      const mock = mockClient({ p1: "order:2:a", p2: "order:2:a" }, {
        p1: ["WaitA"], p2: ["WaitA"],
      }, { history: { done1: { state: "COMPLETED" } } });
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "done1", "p2"], "Target", { batchSize: 2 }
      );
      expect(result.batches).toHaveLength(1);
      expect(result.batches[0].instanceCount).toBe(2);
      expect(result.alreadyProcessed).toHaveLength(1);
      expectFullyAccounted(result);
    });

    it("falls back to the default instead of looping forever on a zero size", async () => {
      const mock = mockClient(fourRunning.definitions, fourRunning.waits);
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "p2", "p3", "p4"], "Target", { batchSize: 0 }
      );
      expect(result.batches).toHaveLength(1);
      expect(result.submittedInstances).toBe(4);
    });

    it("names the batches already submitted when a later chunk loses transport", async () => {
      const mock = mockClient(fourRunning.definitions, fourRunning.waits);
      const implementation = mock.post.getMockImplementation()!;
      let submissions = 0;
      mock.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url === "/modification/executeAsync" && ++submissions === 2) {
          throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
        }
        return implementation(url, body);
      });
      await expect(new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "p2", "p3", "p4"], "Target", { batchSize: 2 }
      )).rejects.toThrow("already submitted: batch-1");
    });
  });

  describe("already-processed instances", () => {
    it("skips finished instances and submits the rest", async () => {
      const mock = mockClient({ p1: "order:2:a" }, { p1: ["WaitA"] }, {
        history: { done1: { state: "COMPLETED", endTime: "2026-01-01T10:00:00Z" } },
      });
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "done1"], "Target"
      );
      expect(result.submittedInstances).toBe(1);
      expect(result.batches[0].instanceCount).toBe(1);
      expect(result.alreadyProcessed).toEqual([
        expect.objectContaining({ instanceId: "done1", endState: "COMPLETED" }),
      ]);
      expect(result.notFound).toEqual([]);
      expectFullyAccounted(result);
    });

    it("separates finished instances from IDs the engine has never seen", async () => {
      const mock = mockClient({ p1: "order:2:a" }, { p1: ["WaitA"] }, {
        history: { done1: { state: "EXTERNALLY_TERMINATED" } },
      });
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "done1", "ghost"], "Target"
      );
      expect(result.alreadyProcessed.map((item) => item.instanceId)).toEqual(["done1"]);
      expect(result.notFound).toEqual(["ghost"]);
      expect(result.submittedInstances).toBe(1);
      expectFullyAccounted(result);
    });

    it("returns no batch when every selected instance already finished", async () => {
      const mock = mockClient({}, {}, {
        history: { d1: { state: "COMPLETED" }, d2: { state: "INTERNALLY_TERMINATED" } },
      });
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["d1", "d2"], "Target"
      );
      expect(result.batches).toEqual([]);
      expect(result.submittedInstances).toBe(0);
      expect(result.alreadyProcessed).toHaveLength(2);
      expect(mock.post.mock.calls.some((entry) => entry[0] === "/modification/executeAsync")).toBe(false);
      expectFullyAccounted(result);
    });

    it("applies the single-version guard only to instances that survive the skip", async () => {
      const mock = mockClient({ p2: "order:2:a" }, { p2: ["WaitA"] }, {
        history: { p1: { state: "COMPLETED" } },
      });
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "p2"], "Target"
      );
      expect(result.batches).toHaveLength(1);
      expect(result.submittedInstances).toBe(1);
    });

    it("skips an instance that ends between the runtime query and the tree fetch", async () => {
      const mock = mockClient({ p1: "order:2:a", p2: "order:2:a" }, { p1: ["WaitA"] }, {
        history: { p2: { state: "COMPLETED" } },
        treeErrors: { p2: gone() },
      });
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "p2"], "Target"
      );
      expect(result.submittedInstances).toBe(1);
      expect(result.alreadyProcessed.map((item) => item.instanceId)).toEqual(["p2"]);
      expectFullyAccounted(result);
    });

    it("collapses into one unconfirmed bucket when engine history is unavailable", async () => {
      const mock = mockClient({ p1: "order:2:a" }, { p1: ["WaitA"] }, { historyFails: true });
      const result = await new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "vanished"], "Target"
      );
      expect(result.alreadyProcessed).toEqual([
        expect.objectContaining({ instanceId: "vanished", endState: "NOT_RUNNING" }),
      ]);
      expect(result.notFound).toEqual([]);
      expect(result.submittedInstances).toBe(1);
      expectFullyAccounted(result);
    });

    it("aborts when history still reports a missing instance as active", async () => {
      const mock = mockClient({ p1: "order:2:a" }, { p1: ["WaitA"] }, {
        history: { weird: { state: "ACTIVE" } },
      });
      await expect(new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1", "weird"], "Target"
      )).rejects.toThrow("could not be verified");
      expect(mock.post.mock.calls.some((entry) => entry[0] === "/modification/executeAsync")).toBe(false);
    });

    it("aborts when a preflight fails for a reason other than the instance ending", async () => {
      const mock = mockClient({ p1: "order:2:a" }, { p1: ["WaitA"] }, {
        treeErrors: { p1: new Error("ECONNRESET") },
      });
      await expect(new ProcessInstanceService().batchModifyInstances(
        mock.client, ["p1"], "Target"
      )).rejects.toThrow("could not be preflighted");
      expect(mock.post.mock.calls.some((entry) => entry[0] === "/modification/executeAsync")).toBe(false);
    });
  });
});

describe("ProcessInstanceService.modifyInstance", () => {
  it("reports a finished instance as already processed rather than a raw engine error", async () => {
    const get = vi.fn(async (url: string) => {
      if (url === "/process-instance/p1/activity-instances") throw gone();
      if (url === "/process-instance/p1") throw gone();
      if (url === "/history/process-instance/p1") {
        return { data: { id: "p1", state: "COMPLETED", endTime: "2026-01-01T10:00:00Z" } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const client = { get, post: vi.fn() } as unknown as AxiosInstance;

    const result = await new ProcessInstanceService().modifyInstance(
      client, "p1", ["WaitA"], "Target"
    );
    expect(result.status).toBe("already_processed");
    expect(result.message).toContain("COMPLETED");
  });

  it("still reports a genuine failure as an error", async () => {
    const get = vi.fn(async (url: string) => {
      if (url === "/process-instance/p1/activity-instances") throw new Error("ECONNRESET");
      throw new Error(`Unexpected GET ${url}`);
    });
    const client = { get, post: vi.fn() } as unknown as AxiosInstance;

    const result = await new ProcessInstanceService().modifyInstance(
      client, "p1", ["WaitA"], "Target"
    );
    expect(result.status).toBe("error");
  });
});
