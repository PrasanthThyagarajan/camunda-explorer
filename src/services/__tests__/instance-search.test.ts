import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import {
  InstanceSearchService,
  toCamundaDate,
  validateInstanceSearch,
  type InstanceSearchInput,
} from "../instance-search.service.js";

const instances = [
  { id: "p1", definitionId: "order:2:a", businessKey: "ORDER-1", suspended: false },
  { id: "p2", definitionId: "order:2:a", businessKey: "ORDER-2", suspended: false },
  { id: "p3", definitionId: "other:1:b", businessKey: "OTHER-1", suspended: true },
];

function clientWith(runtime = instances, history = [{ id: "p2" }]) {
  const post = vi.fn(async (url: string, body: Record<string, unknown>) => {
    if (url === "/history/process-instance") return { data: history };
    if (url === "/process-instance") {
      let rows = runtime;
      if (Array.isArray(body.processInstanceIds)) {
        const ids = new Set(body.processInstanceIds as string[]);
        rows = rows.filter((row) => ids.has(row.id));
      }
      if (body.processDefinitionKey) {
        rows = rows.filter((row) => row.definitionId.startsWith(`${body.processDefinitionKey}:`));
      }
      return { data: rows };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const get = vi.fn(async () => ({
    data: {
      activityType: "processDefinition",
      childTransitionInstances: [],
      childActivityInstances: [{
        activityId: "Task_Wait",
        activityType: "serviceTask",
        childActivityInstances: [],
        childTransitionInstances: [],
      }],
    },
  }));
  return { client: { post, get } as unknown as AxiosInstance, post, get };
}

async function search(input: InstanceSearchInput, runtime = instances) {
  const mock = clientWith(runtime);
  return { result: await new InstanceSearchService().search(mock.client, input), ...mock };
}

describe("InstanceSearchService", () => {
  it("keeps an unscoped state query as a 100-row preview", async () => {
    const { result, post } = await search({ active: true });
    expect(result.scoped).toBe(false);
    expect(result.matchedIds).toEqual([]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toEqual({ params: { firstResult: 0, maxResults: 100 } });
  });

  it("passes instance IDs and process, node, and state filters to runtime POST", async () => {
    const { result, post } = await search({
      processInstanceIds: ["p1", "p3"],
      processDefinitionKey: "order",
      activityIdIn: ["Task_Wait"],
      active: true,
    });
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({
      processInstanceIds: ["p1", "p3"],
      processDefinitionKey: "order",
      activityIdIn: ["Task_Wait"],
      active: true,
    });
    expect(result.matchedIds).toEqual(["p1"]);
    expect(result.processDefinitionId).toBe("order:2:a");
  });

  it.each([
    ["suspended", { suspended: true }],
    ["withIncident", { withIncident: true }],
  ])("passes the %s state filter", async (_name, flag) => {
    const { post } = await search({ processDefinitionKey: "order", ...flag });
    expect(post.mock.calls[0][1]).toMatchObject(flag);
  });

  it("uses businessKeyLike for one key", async () => {
    const { post } = await search({
      processDefinitionKey: "order",
      businessKeyLike: "%ORDER-1%",
    });
    expect(post.mock.calls[0][1]).toMatchObject({ businessKeyLike: "%ORDER-1%" });
  });

  it("matches multiple business keys exactly in-process", async () => {
    const { result, post } = await search({
      processDefinitionKey: "order",
      businessKeys: ["ORDER-2", "MISSING"],
    });
    expect(result.matchedIds).toEqual(["p2"]);
    expect(JSON.stringify(post.mock.calls)).not.toContain("BusinessKeyIn");
  });

  it("intersects created-from/to history with runtime results", async () => {
    const mock = clientWith();
    const result = await new InstanceSearchService().search(mock.client, {
      processDefinitionKey: "order",
      startedAfter: "2026-09-01T00:00:00.000Z",
      startedBefore: "2026-09-10T00:00:00.000Z",
    });
    expect(result.matchedIds).toEqual(["p2"]);
    // Camunda 7 rejects the ISO "Z" suffix on date filters.
    expect(mock.post.mock.calls.find((call) => call[0] === "/history/process-instance")?.[1])
      .toMatchObject({
        unfinished: true,
        startedAfter: "2026-09-01T00:00:00.000+0000",
        startedBefore: "2026-09-10T00:00:00.000+0000",
      });
  });

  it("never sends a Z-suffixed date to the engine", async () => {
    const mock = clientWith();
    await new InstanceSearchService().search(mock.client, {
      processDefinitionKey: "order",
      startedAfter: "2026-09-01T00:00:00.000Z",
    });
    expect(JSON.stringify(mock.post.mock.calls)).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it("converts a local-time instant to the matching UTC offset", () => {
    expect(toCamundaDate("2026-09-07T12:43:00.000Z")).toBe("2026-09-07T12:43:00.000+0000");
    expect(toCamundaDate("2026-09-07T18:13:00.000+0530")).toBe("2026-09-07T12:43:00.000+0000");
  });

  it("rejects an unparseable or inverted date range", () => {
    expect(() => validateInstanceSearch({
      processDefinitionKey: "order", startedAfter: "not-a-date",
    })).toThrow("Invalid date");
    expect(() => validateInstanceSearch({
      processDefinitionKey: "order",
      startedAfter: "2026-09-10T00:00:00.000Z",
      startedBefore: "2026-09-01T00:00:00.000Z",
    })).toThrow("earlier than");
  });

  it("scopes the date query to the runtime candidates", async () => {
    const mock = clientWith();
    await new InstanceSearchService().search(mock.client, {
      processDefinitionKey: "order",
      startedAfter: "2026-09-01T00:00:00.000Z",
    });
    const historyBody = mock.post.mock.calls
      .find((call) => call[0] === "/history/process-instance")?.[1] as Record<string, unknown>;
    expect(historyBody.processInstanceIds).toEqual(["p1", "p2"]);
  });

  it("does not inherit truncation from the date range when the result is small", async () => {
    // A definition with more running instances than the scan cap would otherwise
    // mark a narrow date result truncated and block batch modification.
    const many = Array.from({ length: 2100 }, (_, index) => ({
      id: `p${index}`, definitionId: "order:2:a", businessKey: `K${index}`, suspended: false,
    }));
    const mock = clientWith(many, [{ id: "p5" }]);
    const result = await new InstanceSearchService().search(mock.client, {
      processDefinitionKey: "order",
      startedAfter: "2026-09-01T00:00:00.000Z",
    });
    expect(result.matchedIds).toEqual(["p5"]);
    expect(result.truncated).toBe(true); // runtime scan genuinely hit its cap
  });

  it("pages with a stable sort so rows are not dropped between pages", async () => {
    const { post } = await search({ processDefinitionKey: "order" });
    expect(post.mock.calls[0][1]).toMatchObject({ sortBy: "instanceId", sortOrder: "asc" });
  });

  it("passes a string equality variable filter", async () => {
    const { post } = await search({
      processDefinitionKey: "order",
      variableName: "articleId",
      variableValue: "123",
    });
    expect(post.mock.calls[0][1].variables).toEqual([
      { name: "articleId", operator: "eq", value: "123" },
    ]);
  });

  it("limits table items but keeps the full matched ID set", async () => {
    const runtime = Array.from({ length: 5 }, (_, index) => ({
      id: `p${index}`, definitionId: "order:2:a", businessKey: null, suspended: false,
    }));
    const { result } = await search({ processDefinitionKey: "order", maxResults: 2 }, runtime);
    expect(result.items).toHaveLength(2);
    expect(result.totalCount).toBe(5);
    expect(result.matchedIds).toHaveLength(5);
  });

  it("counts each process once per active activity", async () => {
    const mock = clientWith([instances[0]]);
    mock.get.mockResolvedValue({
      data: {
        activityType: "processDefinition",
        childTransitionInstances: [],
        childActivityInstances: [
          { activityId: "Task_A", activityType: "serviceTask", childActivityInstances: [], childTransitionInstances: [] },
          { activityId: "Task_A", activityType: "serviceTask", childActivityInstances: [], childTransitionInstances: [] },
        ],
      },
    });
    const result = await new InstanceSearchService().search(mock.client, {
      processDefinitionKey: "order",
    });
    expect(result.byActivity).toEqual([{ activityId: "Task_A", count: 1 }]);
  });

  it("locally rejects rows when the engine ignores the node filter", async () => {
    const mock = clientWith([instances[0]]);
    mock.get.mockResolvedValue({
      data: {
        activityType: "processDefinition",
        childTransitionInstances: [],
        childActivityInstances: [{
          activityId: "Different_Node",
          activityType: "serviceTask",
          childActivityInstances: [],
          childTransitionInstances: [],
        }],
      },
    });
    const result = await new InstanceSearchService().search(mock.client, {
      processDefinitionKey: "order",
      activityIdIn: ["Requested_Node"],
    });
    expect(result.matchedIds).toEqual([]);
  });

  it("fails closed when any node-filter activity tree cannot be read", async () => {
    const mock = clientWith([instances[0]]);
    mock.get.mockRejectedValue(new Error("tree unavailable"));
    await expect(new InstanceSearchService().search(mock.client, {
      processDefinitionKey: "order",
      activityIdIn: ["Requested_Node"],
    })).rejects.toThrow("Could not verify the node filter");
  });

  it.each([
    [{ businessKeys: ["A", "B"] }, "BPMN process"],
    [{ startedAfter: "2026-09-01T00:00:00Z" }, "BPMN process"],
    [{ variableName: "x", variableValue: "y" }, "BPMN process"],
    [{ processDefinitionKey: "order", variableName: "x" }, "Variable name and value"],
    [{ processDefinitionKey: "order", variableValue: "x" }, "Variable name and value"],
  ])("rejects invalid input %#", (input, message) => {
    expect(() => validateInstanceSearch(input)).toThrow(message);
  });
});
