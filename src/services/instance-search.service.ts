import type { AxiosInstance } from "axios";
import { BY_ACTIVITY_MAX, MAX_SEARCH_IDS } from "../constants.js";

export interface InstanceSearchInput {
  processInstanceIds?: string[];
  businessKeys?: string[];
  businessKeyLike?: string;
  processDefinitionKey?: string;
  activityIdIn?: string[];
  active?: boolean;
  suspended?: boolean;
  withIncident?: boolean;
  startedAfter?: string;
  startedBefore?: string;
  variableName?: string;
  variableValue?: string;
  maxResults?: number;
}

interface RuntimeInstance {
  id: string;
  definitionId: string;
  businessKey: string | null;
  suspended: boolean;
  [key: string]: unknown;
}

interface HistoricInstance {
  id: string;
}

const MAX_SOURCE_SCAN_ROWS = 50_000;
const HISTORY_ID_CHUNK = 200;

export interface InstanceSearchResult {
  items: RuntimeInstance[];
  totalCount: number;
  matchedIds: string[];
  byActivity: Array<{ activityId: string; count: number }>;
  truncated: boolean;
  definitionIdCount: number;
  processDefinitionId: string | null;
  scoped: boolean;
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * Camunda 7 rejects the ISO "Z" suffix and expects yyyy-MM-dd'T'HH:mm:ss.SSSZ
 * with a numeric offset, so an incoming UTC instant is re-encoded as +0000.
 */
export function toCamundaDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) badRequest(`Invalid date: ${value}`);
  return date.toISOString().replace("Z", "+0000");
}

export function validateInstanceSearch(input: InstanceSearchInput): void {
  const exactKeys = input.businessKeys?.filter(Boolean) || [];
  const hasVariableName = typeof input.variableName === "string" && input.variableName.length > 0;
  const hasVariableValue = typeof input.variableValue === "string";

  if ((exactKeys.length > 0 || input.startedAfter || input.startedBefore || hasVariableName || hasVariableValue)
      && !input.processDefinitionKey) {
    badRequest("A BPMN process is required for exact business keys, dates, or variables");
  }
  if (hasVariableName !== hasVariableValue) {
    badRequest("Variable name and value must be provided together");
  }
  if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 100)) {
    badRequest("maxResults must be an integer between 1 and 100");
  }
  if (input.startedAfter) toCamundaDate(input.startedAfter);
  if (input.startedBefore) toCamundaDate(input.startedBefore);
  if (input.startedAfter && input.startedBefore &&
      new Date(input.startedAfter) > new Date(input.startedBefore)) {
    badRequest("Created From must be earlier than Created To");
  }
}

async function pagePost<T>(
  client: AxiosInstance,
  url: string,
  body: Record<string, unknown>,
  limit: number
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  const pageSize = Math.min(1000, limit + 1);

  // Paging without an explicit sort has undefined order, which would make the
  // page boundaries drop or repeat rows across requests.
  const sortedBody = { ...body, sortBy: "instanceId", sortOrder: "asc" };

  for (let firstResult = 0; rows.length <= limit; firstResult += pageSize) {
    const response = await client.post(url, sortedBody, {
      params: { firstResult, maxResults: pageSize },
    });
    const page = (response.data || []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

function collectLeafActivityIds(node: Record<string, unknown>): string[] {
  const children = (node.childActivityInstances || []) as Array<Record<string, unknown>>;
  const transitions = (node.childTransitionInstances || []) as Array<Record<string, unknown>>;
  if (children.length === 0 && transitions.length === 0) {
    return node.activityType === "processDefinition" || !node.activityId
      ? []
      : [String(node.activityId)];
  }
  return [
    ...children.flatMap(collectLeafActivityIds),
    ...transitions.map((transition) => String(transition.activityId || "")).filter(Boolean),
  ];
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return result;
}

export class InstanceSearchService {
  async search(client: AxiosInstance, input: InstanceSearchInput): Promise<InstanceSearchResult> {
    validateInstanceSearch(input);
    const maxResults = input.maxResults ?? 100;
    const exactKeys = new Set((input.businessKeys || []).filter(Boolean));
    const scoped = Boolean(
      input.processInstanceIds?.length || exactKeys.size || input.businessKeyLike ||
      input.startedAfter || input.startedBefore || input.variableName || input.processDefinitionKey
    );

    const runtimeBody: Record<string, unknown> = {};
    if (input.processInstanceIds?.length) runtimeBody.processInstanceIds = input.processInstanceIds;
    if (input.processDefinitionKey) runtimeBody.processDefinitionKey = input.processDefinitionKey;
    if (input.activityIdIn?.length) runtimeBody.activityIdIn = input.activityIdIn;
    if (input.businessKeyLike) runtimeBody.businessKeyLike = input.businessKeyLike;
    if (input.active) runtimeBody.active = true;
    if (input.suspended) runtimeBody.suspended = true;
    if (input.withIncident) runtimeBody.withIncident = true;
    if (input.variableName !== undefined && input.variableValue !== undefined) {
      runtimeBody.variables = [{ name: input.variableName, operator: "eq", value: input.variableValue }];
    }

    if (!scoped) {
      const response = await client.post("/process-instance", runtimeBody, {
        params: { firstResult: 0, maxResults },
      });
      const items = (response.data || []) as RuntimeInstance[];
      return {
        items,
        totalCount: items.length,
        matchedIds: [],
        byActivity: [],
        truncated: items.length === maxResults,
        definitionIdCount: new Set(items.map((item) => item.definitionId)).size,
        processDefinitionId: null,
        scoped: false,
      };
    }

    // Exact-key matching happens locally because this engine ignores its list
    // parameter. Scan farther than the result cap so sparse requested keys are
    // not missed merely because they occur after the first 2,000 rows.
    const runtimeScanLimit = exactKeys.size > 0 ? MAX_SOURCE_SCAN_ROWS : MAX_SEARCH_IDS + 1;
    const runtime = await pagePost<RuntimeInstance>(
      client, "/process-instance", runtimeBody, runtimeScanLimit
    );
    let instances = runtime.rows;
    let truncated = runtime.truncated;

    if (exactKeys.size > 0) {
      instances = instances.filter((instance) =>
        instance.businessKey !== null && exactKeys.has(instance.businessKey)
      );
    }

    if (input.startedAfter || input.startedBefore) {
      // The date range is applied to the runtime candidates rather than queried
      // on its own. An unbounded range query scans every unfinished instance of
      // the definition, so a narrow result would inherit that scan's truncation
      // and stay ineligible for modification.
      const chunks: string[][] = [];
      for (let index = 0; index < instances.length; index += HISTORY_ID_CHUNK) {
        chunks.push(instances.slice(index, index + HISTORY_ID_CHUNK).map((row) => row.id));
      }
      const pages = await mapWithConcurrency(chunks, 5, async (ids) => {
        const historyBody: Record<string, unknown> = {
          unfinished: true,
          processInstanceIds: ids,
        };
        if (input.processDefinitionKey) historyBody.processDefinitionKey = input.processDefinitionKey;
        if (input.startedAfter) historyBody.startedAfter = toCamundaDate(input.startedAfter);
        if (input.startedBefore) historyBody.startedBefore = toCamundaDate(input.startedBefore);
        return pagePost<HistoricInstance>(client, "/history/process-instance", historyBody, ids.length);
      });
      const historicIds = new Set(pages.flatMap((page) => page.rows.map((row) => row.id)));
      instances = instances.filter((instance) => historicIds.has(instance.id));
    }

    let verifiedActivities: Map<string, Set<string>> | null = null;
    if (input.activityIdIn?.length) {
      const requestedActivities = new Set(input.activityIdIn);
      const activitySets = await mapWithConcurrency(instances, 10, async (instance) => {
        try {
          const response = await client.get(`/process-instance/${instance.id}/activity-instances`);
          return new Set(collectLeafActivityIds(response.data));
        } catch {
          return null;
        }
      });
      if (activitySets.some((activities) => activities === null)) {
        throw Object.assign(
          new Error("Could not verify the node filter for every matched instance"),
          { statusCode: 502 }
        );
      }
      verifiedActivities = new Map(
        instances.map((instance, index) => [instance.id, activitySets[index]!])
      );
      // Do not trust the remote node predicate blindly. Local activity-tree
      // verification prevents an ignored filter from arming a broad modify.
      instances = instances.filter((instance) =>
        [...(verifiedActivities!.get(instance.id) || [])]
          .some((activityId) => requestedActivities.has(activityId))
      );
    }

    if (instances.length > MAX_SEARCH_IDS) {
      instances = instances.slice(0, MAX_SEARCH_IDS);
      truncated = true;
    }

    const matchedIds = instances.map((instance) => instance.id);
    let byActivity: Array<{ activityId: string; count: number }> = [];
    if (input.activityIdIn?.length === 1) {
      byActivity = [{ activityId: input.activityIdIn[0], count: instances.length }];
    } else if (instances.length > 0 && instances.length <= BY_ACTIVITY_MAX) {
      const activitySets = verifiedActivities
        ? instances.map((instance) => verifiedActivities!.get(instance.id) || new Set<string>())
        : await mapWithConcurrency(instances, 10, async (instance) => {
            try {
              const response = await client.get(`/process-instance/${instance.id}/activity-instances`);
              return new Set(collectLeafActivityIds(response.data));
            } catch {
              return new Set<string>();
            }
          });
      const counts = new Map<string, number>();
      for (const activities of activitySets) {
        for (const activityId of activities) {
          counts.set(activityId, (counts.get(activityId) || 0) + 1);
        }
      }
      byActivity = [...counts.entries()]
        .map(([activityId, count]) => ({ activityId, count }))
        .sort((a, b) => b.count - a.count);
    }

    return {
      items: instances.slice(0, maxResults),
      totalCount: instances.length,
      matchedIds,
      byActivity,
      truncated,
      definitionIdCount: new Set(instances.map((instance) => instance.definitionId)).size,
      processDefinitionId: new Set(instances.map((instance) => instance.definitionId)).size === 1
        ? instances[0]?.definitionId || null
        : null,
      scoped: true,
    };
  }
}
