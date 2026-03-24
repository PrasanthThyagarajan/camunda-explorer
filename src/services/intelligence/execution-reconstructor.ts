/**
 * Execution Reconstruction Engine
 *
 * Rebuilds the complete execution history of a process instance from
 * Camunda's history tables. Produces a flat chronological timeline
 * that preserves activity ordering and parallel token information.
 *
 * This is the foundation layer — every other intelligence engine
 * depends on its output.
 */

import { AxiosInstance } from "axios";
import { logger } from "../../utils/logger.js";
import { computePathSignature } from "../../utils/path-signature.js";
import type {
  IReconstructedExecution,
  IReconstructedStep,
  IExecutionBranch,
  IStepIncident,
  IVariableEntry,
  IDurationBreakdown,
} from "../../interfaces/intelligence.js";

// ── Internal Raw Types ──────────────────────────────────────────

type RawActivity = Record<string, unknown>;
type RawIncident = Record<string, unknown>;
type RawVariable = Record<string, unknown>;

// ── Public API ──────────────────────────────────────────────────

/**
 * Reconstruct the full execution of a process instance.
 *
 * Fetches historic activity instances, incidents, and variables,
 * then assembles them into a structured execution model with:
 *   - flat timeline (chronological)
 *   - variable snapshots per step
 *   - path signature for cross-instance comparison
 *   - duration breakdown (interval-merge for parallel flows)
 */
export async function reconstructExecution(
  client: AxiosInstance,
  instanceId: string
): Promise<IReconstructedExecution> {
  // All history queries are safe reads — run in parallel
  const [histInstanceRes, activitiesRes, incidentsRes, varsRes] =
    await Promise.all([
      client.get(`/history/process-instance/${instanceId}`),
      client.get(`/history/activity-instance`, {
        params: {
          processInstanceId: instanceId,
          sortBy: "startTime",
          sortOrder: "asc",
        },
      }),
      client.get(`/history/incident`, {
        params: {
          processInstanceId: instanceId,
          sortBy: "createTime",
          sortOrder: "asc",
        },
      }),
      client.get(`/history/variable-instance`, {
        params: { processInstanceId: instanceId },
      }),
    ]);

  const histInstance = histInstanceRes.data as Record<string, unknown>;
  const rawActivities = (activitiesRes.data || []) as RawActivity[];
  let rawIncidents = (incidentsRes.data || []) as RawIncident[];
  const rawVariables = (varsRes.data || []) as RawVariable[];

  // Fallback: when history incident tracking is unavailable, use runtime incidents
  if (rawIncidents.length === 0) {
    try {
      const runtimeIncRes = await client.get(`/incident`, {
        params: { processInstanceId: instanceId },
      });
      rawIncidents = (runtimeIncRes.data || []) as RawIncident[];
      if (rawIncidents.length > 0) {
        logger.info(
          `[RECONSTRUCT] History incidents empty, using ${rawIncidents.length} runtime incidents for ${instanceId}`
        );
      }
    } catch {
      // Runtime incident fetch is best-effort
    }
  }

  // Index incidents by activityId for quick lookup
  const incidentsByActivity = groupBy(rawIncidents, "activityId");

  // Index variables by activityInstanceId — process-scoped vars
  // (where activityInstanceId is null) are grouped under "__process__"
  const varsByActivityInstance = groupBy(rawVariables, "activityInstanceId");

  // Build the flat variable list (latest value per name)
  const allVars = buildVariableList(rawVariables);

  // Collect process-scoped variables once (shared across first step)
  const processVars = (varsByActivityInstance.get("__process__") || []).map(
    (v): IVariableEntry => ({
      name: v.name as string,
      type: (v.type as string) || "Unknown",
      value: v.value,
      activityInstanceId: null,
    })
  );

  // Build reconstructed steps from historic activity instances
  const flatTimeline = rawActivities.map(
    (act, idx): IReconstructedStep => {
      const activityId = act.activityId as string;
      const endTime = act.endTime as string | null;
      const canceled = act.canceled as boolean;
      const actIncidents = incidentsByActivity.get(activityId) || [];
      const stepVars = varsByActivityInstance.get(act.id as string) || [];

      let status: IReconstructedStep["status"];
      if (canceled) {
        status = "canceled";
      } else if (endTime) {
        status = actIncidents.some((i) => !i.endTime) ? "failed" : "completed";
      } else {
        status = actIncidents.some((i) => !i.endTime) ? "failed" : "active";
      }

      // For the first step, include process-scoped variables
      const snapshot: IVariableEntry[] = stepVars.map(
        (v): IVariableEntry => ({
          name: v.name as string,
          type: (v.type as string) || "Unknown",
          value: v.value,
          activityInstanceId: (v.activityInstanceId as string) || null,
        })
      );
      if (idx === 0 && processVars.length > 0) {
        const names = new Set(snapshot.map((v) => v.name));
        for (const pv of processVars) {
          if (!names.has(pv.name)) snapshot.push(pv);
        }
      }

      return {
        activityInstanceId: act.id as string,
        activityId,
        activityName: (act.activityName as string) || activityId,
        activityType: act.activityType as string,
        executionId: (act.executionId as string) || "",
        status,
        startTime: act.startTime as string,
        endTime: endTime || null,
        durationMs: (act.durationInMillis as number) ?? null,
        calledProcessInstanceId:
          (act.calledProcessInstanceId as string) || null,
        taskId: (act.taskId as string) || null,
        incidents: actIncidents.map(
          (inc): IStepIncident => ({
            id: inc.id as string,
            type: inc.incidentType as string,
            message: (inc.incidentMessage as string) || "",
            // Runtime /incident uses `incidentTimestamp`; history uses `createTime`
            createTime:
              (inc.createTime as string) ||
              (inc.incidentTimestamp as string) ||
              "",
            endTime: (inc.endTime as string) || null,
            resolved: !!inc.endTime,
          })
        ),
        variableSnapshot: snapshot,
      };
    }
  );

  // Compute path signature using the shared utility
  const pathSignature = computePathSignature(
    flatTimeline.map((s) => ({
      activityId: s.activityId,
      activityType: s.activityType,
    }))
  );

  // Compute duration breakdown with interval-merge for parallel flows
  const durationBreakdown = computeDurationBreakdown(
    flatTimeline,
    histInstance
  );

  logger.info(
    `[RECONSTRUCT] ${instanceId}: ${flatTimeline.length} steps, ` +
      `path=${pathSignature.substring(0, 12)}`
  );

  return {
    instanceId,
    definitionId: histInstance.processDefinitionId as string,
    definitionKey: (histInstance.processDefinitionKey as string) || "",
    definitionName:
      (histInstance.processDefinitionName as string) || null,
    businessKey: (histInstance.businessKey as string) || null,
    state: histInstance.state as string,
    startTime: histInstance.startTime as string,
    endTime: (histInstance.endTime as string) || null,
    flatTimeline,
    // Execution tree kept as empty array for forward compatibility;
    // the tree builder was removed as no consumer uses it today.
    executionTree: [],
    variables: allVars,
    pathSignature,
    durationBreakdown,
  };
}

// ── Duration Breakdown (interval-merge for parallel flows) ──────

/**
 * Compute duration breakdown using interval-merge so that overlapping
 * parallel steps don't inflate activeMs beyond totalMs.
 */
function computeDurationBreakdown(
  steps: IReconstructedStep[],
  histInstance: Record<string, unknown>
): IDurationBreakdown {
  const totalMs = (histInstance.durationInMillis as number) ?? 0;
  const perActivity: Record<string, number> = {};

  // Collect [start, end] intervals from each step
  const intervals: Array<[number, number]> = [];

  for (const step of steps) {
    const dur = step.durationMs || 0;
    perActivity[step.activityId] =
      (perActivity[step.activityId] || 0) + dur;

    if (step.startTime) {
      const start = new Date(step.startTime).getTime();
      const end = step.endTime
        ? new Date(step.endTime).getTime()
        : start + dur;
      if (end > start) {
        intervals.push([start, end]);
      }
    }
  }

  // Merge overlapping intervals to compute true active time
  let activeMs = 0;
  if (intervals.length > 0) {
    intervals.sort((a, b) => a[0] - b[0]);
    let [curStart, curEnd] = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
      const [s, e] = intervals[i];
      if (s <= curEnd) {
        curEnd = Math.max(curEnd, e);
      } else {
        activeMs += curEnd - curStart;
        curStart = s;
        curEnd = e;
      }
    }
    activeMs += curEnd - curStart;
  }

  const waitMs = Math.max(0, totalMs - activeMs);

  return { totalMs, activeMs, waitMs, perActivity };
}

// ── Variable List Builder ───────────────────────────────────────

function buildVariableList(rawVars: RawVariable[]): IVariableEntry[] {
  // Keep latest value per variable name
  const map = new Map<string, IVariableEntry>();
  for (const v of rawVars) {
    const name = v.name as string;
    map.set(name, {
      name,
      type: (v.type as string) || "Unknown",
      value: v.value,
      activityInstanceId: (v.activityInstanceId as string) || null,
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Utility ─────────────────────────────────────────────────────

/**
 * Group items by a key. Items where the key is null/undefined are
 * stored under the "__process__" bucket (important for process-scoped
 * variables that have no activityInstanceId).
 */
function groupBy(
  items: Array<Record<string, unknown>>,
  key: string
): Map<string, Array<Record<string, unknown>>> {
  const map = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const k = (item[key] as string) || "__process__";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}
