/**
 * Cross-Instance BPMN Learning Engine
 *
 * Aggregates execution data across ALL instances of a BPMN definition
 * to produce a process-level intelligence dataset:
 *
 *   - Per-node metrics (failure rate, avg duration, P95, retry patterns)
 *   - Common execution paths and their risk profiles
 *   - Hotspot detection (nodes that consistently fail or bottleneck)
 *
 * This data powers the BPMN heatmap visualization and feeds the
 * Recovery Engine with cross-instance success rates.
 */

import { AxiosInstance } from "axios";
import { logger } from "../../utils/logger.js";
import { computePathSignature } from "../../utils/path-signature.js";
import { cacheGet, cacheSet } from "./history-cache.js";
import type {
  IBpmnIntelligence,
  INodeMetrics,
  IPathAnalysis,
} from "../../interfaces/intelligence.js";

// ── Configuration ───────────────────────────────────────────────

const INSTANCE_SAMPLE_SIZE = 200;
const ACTIVITY_BATCH_SIZE = 15;
const HOT_SPOT_FAILURE_THRESHOLD = 0.15; // >15% failure = hotspot
const HIGH_RISK_PATH_THRESHOLD = 0.2; // >20% failure rate for a path

// ── Public API ──────────────────────────────────────────────────

/**
 * Build intelligence for a BPMN definition by aggregating data
 * from its recent instances.
 */
const BPMN_INTEL_TTL = 5 * 60 * 1000; // 5 minutes

export async function buildBpmnIntelligence(
  client: AxiosInstance,
  definitionKey: string
): Promise<IBpmnIntelligence> {
  // Check cache first
  const cacheKey = `bpmn-intel::${definitionKey}`;
  const cached = cacheGet<IBpmnIntelligence>(cacheKey);
  if (cached) return cached;

  // 1. Fetch recent instances (both finished and running)
  //    Use shared cache keys so signal-extractor can reuse the finished list.
  const finishedCacheKey = `hist-instances-finished::${definitionKey}`;
  let finishedInstances = cacheGet<RawInstance[]>(finishedCacheKey);

  if (!finishedInstances) {
    const finishedRes = await client.get(`/history/process-instance`, {
      params: {
        processDefinitionKey: definitionKey,
        finished: "true",
        sortBy: "startTime",
        sortOrder: "desc",
        maxResults: INSTANCE_SAMPLE_SIZE,
      },
    });
    finishedInstances = (finishedRes.data || []) as RawInstance[];
    cacheSet(finishedCacheKey, finishedInstances, 2 * 60 * 1000);
  }

  const runningRes = await client.get(`/history/process-instance`, {
    params: {
      processDefinitionKey: definitionKey,
      unfinished: "true",
      sortBy: "startTime",
      sortOrder: "desc",
      maxResults: 50,
    },
  });

  const allInstances = [
    ...finishedInstances,
    ...((runningRes.data || []) as RawInstance[]),
  ];

  if (allInstances.length === 0) {
    return emptyIntelligence(definitionKey);
  }

  // 2. Fetch historic activity instances for a sample
  const sampleIds = allInstances
    .slice(0, INSTANCE_SAMPLE_SIZE)
    .map((i) => i.id as string);

  const nodeMap = new Map<string, NodeAccumulator>();
  const pathCounts = new Map<string, PathAccumulator>();
  const durations: number[] = [];

  for (let i = 0; i < sampleIds.length; i += ACTIVITY_BATCH_SIZE) {
    const batch = sampleIds.slice(i, i + ACTIVITY_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((id) => {
        // Use shared cache key so signal-extractor can reuse these results
        const actCacheKey = `hist-activities::${id}`;
        const cachedAct = cacheGet<{ data: RawActivity[] }>(actCacheKey);
        if (cachedAct) return Promise.resolve(cachedAct);

        return client
          .get(`/history/activity-instance`, {
            params: {
              processInstanceId: id,
              sortBy: "startTime",
              sortOrder: "asc",
            },
          })
          .then((res) => {
            const result = { data: (res.data || []) as RawActivity[] };
            cacheSet(actCacheKey, result, 2 * 60 * 1000);
            return result;
          })
          .catch(() => ({ data: [] as RawActivity[] }));
      })
    );

    for (let j = 0; j < batch.length; j++) {
      const activities = (batchResults[j].data || []) as RawActivity[];
      const instance = allInstances.find(
        (inst) => inst.id === batch[j]
      );
      const instanceFailed =
        instance?.state === "EXTERNALLY_TERMINATED" ||
        instance?.state === "INTERNALLY_TERMINATED";

      // Track instance duration
      if (instance?.durationInMillis) {
        durations.push(instance.durationInMillis as number);
      }

      // Build path signature using the shared utility
      const pathSig = computePathSignature(
        activities.map((a) => ({
          activityId: a.activityId as string,
          activityType: a.activityType as string,
        }))
      );
      // Extract deduped path for the description
      const dedupedPath: string[] = [];
      for (const a of activities) {
        const aid = a.activityId as string;
        const atype = a.activityType as string;
        if (atype === "multiInstanceBody" || atype === "processDefinition") continue;
        if (dedupedPath[dedupedPath.length - 1] !== aid) dedupedPath.push(aid);
      }

      if (!pathCounts.has(pathSig)) {
        pathCounts.set(pathSig, {
          pathSignature: pathSig,
          pathDescription: dedupedPath,
          total: 0,
          failed: 0,
          durations: [],
        });
      }
      const pathAcc = pathCounts.get(pathSig)!;
      pathAcc.total++;
      if (instanceFailed) pathAcc.failed++;
      if (instance?.durationInMillis) {
        pathAcc.durations.push(instance.durationInMillis as number);
      }

      // Accumulate per-node metrics
      for (const act of activities) {
        const actId = act.activityId as string;

        if (!nodeMap.has(actId)) {
          nodeMap.set(actId, {
            activityId: actId,
            activityName: (act.activityName as string) || actId,
            activityType: act.activityType as string,
            executions: 0,
            completions: 0,
            failures: 0,
            cancellations: 0,
            durations: [],
            errors: new Map(),
            retryCount: 0,
          });
        }

        const acc = nodeMap.get(actId)!;
        acc.executions++;

        const dur = act.durationInMillis as number | null;
        if (dur !== null && dur !== undefined) {
          acc.durations.push(dur);
        }

        if (act.canceled) {
          acc.cancellations++;
        } else if (act.endTime) {
          acc.completions++;
        }
        // Failures are counted from incident data below to avoid
        // misinterpreting the canceled flag (Camunda sets endTime
        // on canceled activities too, making canceled && !endTime
        // almost never true).
      }
    }
  }

  // 3. Fetch incident data to enrich failure counts
  //    Try /history/incident first; if empty, fall back to runtime /incident.
  //    Many Camunda deployments don't track incidents in history tables,
  //    but the runtime API always shows active (unresolved) incidents.
  try {
    const incidentRes = await client.get(`/history/incident`, {
      params: {
        processDefinitionKey: definitionKey,
        sortBy: "createTime",
        sortOrder: "desc",
        maxResults: 500,
      },
    });

    let incidents = (incidentRes.data || []) as RawIncident[];

    // Fallback: if history has no incidents, fetch active runtime incidents
    if (incidents.length === 0) {
      try {
        const runtimeRes = await client.get(`/incident`, {
          params: { maxResults: 500 },
        });
        // Runtime /incident doesn't support processDefinitionKey filter directly.
        // Process definition IDs follow the pattern "KEY:VERSION:HASH", so we
        // check that the ID starts with "KEY:" to capture all versions.
        const prefix = definitionKey + ":";
        const runtimeIncidents = (runtimeRes.data || []) as RawIncident[];
        incidents = runtimeIncidents.filter((inc) => {
          const defId = inc.processDefinitionId as string;
          return defId && defId.startsWith(prefix);
        });
        logger.info(
          `[BPMN-INTEL] History incidents empty, using ${incidents.length} runtime incidents for ${definitionKey}`
        );
      } catch (rtErr) {
        logger.warn(`[BPMN-INTEL] Failed to fetch runtime incidents: ${rtErr}`);
      }
    }

    // Deduplicate by processInstanceId + activityId to avoid
    // counting multiple incidents at the same activity in the
    // same instance more than once.
    const countedFailures = new Set<string>();
    for (const inc of incidents) {
      const actId = inc.activityId as string;
      if (!actId) continue;

      const acc = nodeMap.get(actId);
      if (acc) {
        const dedupeKey = `${inc.processInstanceId as string}::${actId}`;
        if (!countedFailures.has(dedupeKey)) {
          acc.failures++;
          countedFailures.add(dedupeKey);
        }

        // Track error messages (all occurrences, not deduplicated)
        const msg = (inc.incidentMessage as string) || "Unknown";
        const short =
          msg.length > 80 ? msg.substring(0, 80) + "…" : msg;
        acc.errors.set(short, (acc.errors.get(short) || 0) + 1);
      }
    }
  } catch (err) {
    logger.warn(`[BPMN-INTEL] Failed to fetch incidents: ${err}`);
  }

  // 4. Compute final metrics
  const nodeMetrics: INodeMetrics[] = [];

  for (const acc of nodeMap.values()) {
    // Skip internal types
    if (["processDefinition", "multiInstanceBody"].includes(acc.activityType)) {
      continue;
    }

    const sorted = acc.durations.sort((a, b) => a - b);
    const avgDur =
      sorted.length > 0
        ? sorted.reduce((a, b) => a + b, 0) / sorted.length
        : 0;
    const p95Idx = Math.floor(sorted.length * 0.95);
    const p95Dur = sorted[p95Idx] || sorted[sorted.length - 1] || 0;

    const failureRate =
      acc.executions > 0
        ? Math.min(1, acc.failures / acc.executions)
        : 0;
    const completionRate =
      acc.executions > 0 ? acc.completions / acc.executions : 0;

    const topErrors = [...acc.errors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([message, count]) => ({ message, count }));

    nodeMetrics.push({
      activityId: acc.activityId,
      activityName: acc.activityName,
      activityType: acc.activityType,
      executionCount: acc.executions,
      completionRate: Math.round(completionRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      avgDurationMs: Math.round(avgDur),
      p95DurationMs: Math.round(p95Dur),
      retryRate: 0, // enriched later if needed
      retrySuccessRate: 0,
      topErrors,
      isHotspot: failureRate >= HOT_SPOT_FAILURE_THRESHOLD,
    });
  }

  // Sort by failure rate (hotspots first)
  nodeMetrics.sort((a, b) => b.failureRate - a.failureRate);

  // 5. Compute path analysis
  const totalPathInstances = [...pathCounts.values()].reduce(
    (sum, p) => sum + p.total,
    0
  );
  const commonPaths: IPathAnalysis[] = [...pathCounts.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((p) => {
      const sortedDurations = p.durations.sort((a, b) => a - b);
      return {
        pathSignature: p.pathSignature,
        pathDescription: p.pathDescription,
        frequency:
          totalPathInstances > 0
            ? Math.round((p.total / totalPathInstances) * 100) / 100
            : 0,
        failureRate:
          p.total > 0 ? Math.round((p.failed / p.total) * 100) / 100 : 0,
        avgDurationMs:
          sortedDurations.length > 0
            ? Math.round(
                sortedDurations.reduce((a, b) => a + b, 0) /
                  sortedDurations.length
              )
            : 0,
        isHighRisk:
          p.total > 0 ? p.failed / p.total >= HIGH_RISK_PATH_THRESHOLD : false,
      };
    });

  // 6. Overall metrics
  const sortedDurations = durations.sort((a, b) => a - b);
  const avgDuration =
    sortedDurations.length > 0
      ? Math.round(
          sortedDurations.reduce((a, b) => a + b, 0) /
            sortedDurations.length
        )
      : 0;
  const p95Duration =
    sortedDurations[Math.floor(sortedDurations.length * 0.95)] || 0;
  const failedCount = allInstances.filter(
    (i) =>
      (i.state as string) === "EXTERNALLY_TERMINATED" ||
      (i.state as string) === "INTERNALLY_TERMINATED"
  ).length;

  const result: IBpmnIntelligence = {
    definitionKey,
    sampleWindow: `${allInstances[allInstances.length - 1]?.startTime || ""} – ${allInstances[0]?.startTime || ""}`,
    sampleSize: allInstances.length,
    nodeMetrics,
    commonPaths,
    overallFailureRate:
      allInstances.length > 0
        ? Math.round((failedCount / allInstances.length) * 100) / 100
        : 0,
    avgDurationMs: avgDuration,
    p95DurationMs: Math.round(p95Duration),
    analyzedAt: new Date().toISOString(),
  };

  logger.info(
    `[BPMN-INTEL] ${definitionKey}: ${allInstances.length} instances, ` +
      `${nodeMetrics.length} nodes, ${nodeMetrics.filter((n) => n.isHotspot).length} hotspots`
  );

  // Cache the result for future calls
  cacheSet(cacheKey, result, BPMN_INTEL_TTL);

  return result;
}

// ── Types ───────────────────────────────────────────────────────

type RawInstance = Record<string, unknown>;
type RawActivity = Record<string, unknown>;
type RawIncident = Record<string, unknown>;

interface NodeAccumulator {
  activityId: string;
  activityName: string;
  activityType: string;
  executions: number;
  completions: number;
  failures: number;
  cancellations: number;
  durations: number[];
  errors: Map<string, number>;
  retryCount: number;
}

interface PathAccumulator {
  pathSignature: string;
  pathDescription: string[];
  total: number;
  failed: number;
  durations: number[];
}

// ── Empty result ────────────────────────────────────────────────

function emptyIntelligence(definitionKey: string): IBpmnIntelligence {
  return {
    definitionKey,
    sampleWindow: "",
    sampleSize: 0,
    nodeMetrics: [],
    commonPaths: [],
    overallFailureRate: 0,
    avgDurationMs: 0,
    p95DurationMs: 0,
    analyzedAt: new Date().toISOString(),
  };
}
