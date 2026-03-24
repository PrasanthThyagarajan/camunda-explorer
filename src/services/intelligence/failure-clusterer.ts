/**
 * Failure Context Clustering Engine
 *
 * Analyzes all incidents for a BPMN definition and groups them into
 * meaningful clusters based on shared characteristics:
 *   - Activity where failure occurred
 *   - Normalized error message
 *   - Variable conditions at time of failure
 *   - Execution path taken
 *
 * Each cluster gets a natural-language description and historical
 * recovery success rates, enabling the Recovery Engine to make
 * data-driven suggestions.
 */

import { AxiosInstance } from "axios";
import { createHash } from "crypto";
import { logger } from "../../utils/logger.js";
import { analyzeStacktrace, analyzeErrorMessageOnly } from "./stacktrace-analyzer.js";
import type {
  IFailureContextCluster,
  IFailureContextResult,
  IFailureCondition,
  IStacktraceAnalysis,
} from "../../interfaces/intelligence.js";

// ── Configuration ───────────────────────────────────────────────

const MAX_INCIDENTS_TO_ANALYZE = 500;
const MIN_CLUSTER_SIZE = 1;
const MAX_CONDITIONS_PER_CLUSTER = 5;
const CONDITION_MIN_FREQUENCY = 0.5; // variable must appear in 50%+ of cluster

// ── Public API ──────────────────────────────────────────────────

/**
 * Analyze all recent incidents for a BPMN definition and produce
 * failure context clusters.
 */
export async function clusterFailures(
  client: AxiosInstance,
  definitionKey: string
): Promise<IFailureContextResult> {
  // Fetch recent incidents (both open and resolved).
  // Try /history/incident first; if empty, fall back to runtime /incident.
  const incidentsRes = await client.get(`/history/incident`, {
    params: {
      processDefinitionKey: definitionKey,
      sortBy: "createTime",
      sortOrder: "desc",
      maxResults: MAX_INCIDENTS_TO_ANALYZE,
    },
  });

  let rawIncidents = (incidentsRes.data || []) as RawIncident[];

  // Fallback: when history incident tracking is unavailable, use runtime incidents
  if (rawIncidents.length === 0) {
    try {
      const runtimeRes = await client.get(`/incident`, {
        params: { maxResults: MAX_INCIDENTS_TO_ANALYZE },
      });
      const allRuntime = (runtimeRes.data || []) as RawIncident[];
      // Runtime /incident returns all definitions — filter by matching definition key.
      // Process definition IDs follow the pattern "KEY:VERSION:HASH", so we check
      // that the ID starts with "KEY:" to capture all versions.
      const prefix = definitionKey + ":";
      rawIncidents = allRuntime.filter(
        (inc) => {
          const defId = inc.processDefinitionId as string;
          return defId && defId.startsWith(prefix);
        }
      );
      logger.info(
        `[CLUSTER] History incidents empty, using ${rawIncidents.length} runtime incidents for ${definitionKey}`
      );
    } catch (rtErr) {
      logger.warn(`[CLUSTER] Failed to fetch runtime incidents: ${rtErr}`);
    }
  }

  if (rawIncidents.length === 0) {
    return {
      definitionKey,
      totalIncidentsAnalyzed: 0,
      clusters: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  // Enrich incidents with variable context (for a sample)
  const enriched = await enrichIncidents(client, rawIncidents);

  // Group by (activityId, normalizedError) — the primary clustering key
  const groups = new Map<string, EnrichedIncident[]>();

  for (const inc of enriched) {
    const normErr = normalizeError(inc.message);
    const key = `${inc.activityId}::${normErr}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(inc);
  }

  // Build clusters from groups that meet minimum size
  const clusters: IFailureContextCluster[] = [];

  for (const [key, group] of groups) {
    if (group.length < MIN_CLUSTER_SIZE) continue;

    const [activityId, normErr] = key.split("::");
    const activityName = group[0].activityName;

    // Find variable conditions that correlate with this failure
    const conditions = findCorrelatedConditions(group);

    // Compute recovery rates from resolved incidents
    const resolved = group.filter((i) => i.resolved);
    const retried = group.filter((i) => i.retried);
    const modified = group.filter((i) => i.modified);

    const retrySuccessRate =
      retried.length > 0
        ? retried.filter((i) => i.resolved).length / retried.length
        : 0;
    const modifySuccessRate =
      modified.length > 0
        ? modified.filter((i) => i.resolved).length / modified.length
        : 0;

    // Suggest recovery based on historical success
    let suggestedRecovery: "retry" | "modify" | "escalate" = "escalate";
    if (retrySuccessRate > 0.7 && retried.length >= 3) {
      suggestedRecovery = "retry";
    } else if (modifySuccessRate > 0.5 && modified.length >= 2) {
      suggestedRecovery = "modify";
    }

    const timestamps = group.map((i) => i.createTime).sort();

    // Collect unique affected instance IDs (capped at 10 for the payload)
    const uniqueInstanceIds = [
      ...new Set(group.map((i) => i.instanceId).filter(Boolean)),
    ];

    clusters.push({
      clusterId: createHash("sha256")
        .update(key)
        .digest("hex")
        .substring(0, 12),
      activityId,
      activityName: activityName || activityId,
      normalizedError: normErr,
      rawErrorSample: group[0].message || normErr,
      occurrenceCount: group.length,
      affectedInstanceCount: uniqueInstanceIds.length,
      affectedInstanceIds: uniqueInstanceIds.slice(0, 10),
      firstSeen: timestamps[0],
      lastSeen: timestamps[timestamps.length - 1],
      conditions,
      retrySuccessRate: Math.round(retrySuccessRate * 100) / 100,
      modifySuccessRate: Math.round(modifySuccessRate * 100) / 100,
      suggestedRecovery,
    });
  }

  // Sort clusters by occurrence count (most frequent first)
  clusters.sort((a, b) => b.occurrenceCount - a.occurrenceCount);

  // Enrich each cluster with stacktrace analysis (sample from first incident)
  await enrichClustersWithStacktrace(client, clusters, rawIncidents);

  logger.info(
    `[CLUSTER] ${definitionKey}: ${rawIncidents.length} incidents → ${clusters.length} clusters`
  );

  return {
    definitionKey,
    totalIncidentsAnalyzed: rawIncidents.length,
    clusters,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Find the cluster that best matches a given incident.
 */
export function findMatchingCluster(
  clusters: IFailureContextCluster[],
  activityId: string,
  errorMessage: string
): IFailureContextCluster | null {
  const normErr = normalizeError(errorMessage);

  // Direct match by activity + normalized error
  const directMatch = clusters.find(
    (c) => c.activityId === activityId && c.normalizedError === normErr
  );
  if (directMatch) return directMatch;

  // Partial match by activity only
  const activityMatch = clusters.find((c) => c.activityId === activityId);
  if (activityMatch) return activityMatch;

  // Partial match by error pattern
  const errorMatch = clusters.find((c) => c.normalizedError === normErr);
  if (errorMatch) return errorMatch;

  return null;
}

// ── Incident Enrichment ─────────────────────────────────────────

interface EnrichedIncident {
  id: string;
  activityId: string;
  activityName: string;
  instanceId: string;
  message: string;
  createTime: string;
  resolved: boolean;
  retried: boolean;
  modified: boolean;
  variables: Record<string, string>;
}

type RawIncident = Record<string, unknown>;

async function enrichIncidents(
  client: AxiosInstance,
  rawIncidents: RawIncident[]
): Promise<EnrichedIncident[]> {
  const enriched: EnrichedIncident[] = [];

  // Collect unique process instance IDs for variable fetching
  const instanceIds = [
    ...new Set(
      rawIncidents.map((i) => i.processInstanceId as string).filter(Boolean)
    ),
  ];

  // Fetch variables for a sample of instances (up to 30)
  const varMap = new Map<string, Record<string, string>>();
  const sampleInstanceIds = instanceIds.slice(0, 30);

  for (let i = 0; i < sampleInstanceIds.length; i += 10) {
    const batch = sampleInstanceIds.slice(i, i + 10);
    const results = await Promise.all(
      batch.map((id) =>
        client
          .get(`/history/variable-instance`, {
            params: { processInstanceId: id },
          })
          .catch(() => ({ data: [] }))
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const vars: Record<string, string> = {};
      const rawVars = (results[j].data || []) as Array<
        Record<string, unknown>
      >;
      for (const v of rawVars) {
        vars[v.name as string] = String(v.value ?? "");
      }
      varMap.set(batch[j], vars);
    }
  }

  // Check user operation logs to determine if incidents were retried or modified
  const operationMap = new Map<
    string,
    { retried: boolean; modified: boolean }
  >();

  for (let i = 0; i < sampleInstanceIds.length; i += 10) {
    const batch = sampleInstanceIds.slice(i, i + 10);
    const results = await Promise.all(
      batch.map((id) =>
        client
          .get(`/history/user-operation`, {
            params: {
              processInstanceId: id,
              maxResults: 50,
            },
          })
          .catch(() => ({ data: [] }))
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const ops = (results[j].data || []) as Array<Record<string, unknown>>;
      const retried = ops.some(
        (op) => (op.operationType as string) === "SetJobRetries"
      );
      const modified = ops.some(
        (op) =>
          (op.operationType as string) === "ModifyProcessInstance"
      );
      operationMap.set(batch[j], { retried, modified });
    }
  }

  for (const raw of rawIncidents) {
    const instanceId = raw.processInstanceId as string;
    const ops = operationMap.get(instanceId) || {
      retried: false,
      modified: false,
    };

    // Runtime /incident uses `incidentTimestamp` while /history/incident uses `createTime`
    const createTime =
      (raw.createTime as string) || (raw.incidentTimestamp as string) || "";

    enriched.push({
      id: raw.id as string,
      activityId: (raw.activityId as string) || "",
      activityName: (raw.activityId as string) || "",
      instanceId,
      message: (raw.incidentMessage as string) || "",
      createTime,
      resolved: !!raw.endTime,
      retried: ops.retried,
      modified: ops.modified,
      variables: varMap.get(instanceId) || {},
    });
  }

  return enriched;
}

// ── Correlated Condition Finding ────────────────────────────────

/**
 * Find variable conditions that consistently appear in the failure cluster.
 * A condition is "correlated" if a specific variable value appears in >50%
 * of the cluster's incidents.
 */
function findCorrelatedConditions(
  group: EnrichedIncident[]
): IFailureCondition[] {
  if (group.length === 0) return [];

  // Count variable value frequencies across the cluster
  const valueCounts = new Map<string, Map<string, number>>();

  for (const inc of group) {
    for (const [varName, varVal] of Object.entries(inc.variables)) {
      if (!valueCounts.has(varName)) valueCounts.set(varName, new Map());
      const vc = valueCounts.get(varName)!;
      vc.set(varVal, (vc.get(varVal) || 0) + 1);
    }
  }

  const conditions: IFailureCondition[] = [];

  for (const [varName, valMap] of valueCounts) {
    for (const [val, count] of valMap) {
      const freq = count / group.length;
      if (freq >= CONDITION_MIN_FREQUENCY && count >= MIN_CLUSTER_SIZE) {
        conditions.push({
          variable: varName,
          value: val.length > 50 ? val.substring(0, 50) + "…" : val,
          frequency: Math.round(freq * 100) / 100,
        });
      }
    }
  }

  // Sort by frequency (most common first) and limit
  conditions.sort((a, b) => b.frequency - a.frequency);
  return conditions.slice(0, MAX_CONDITIONS_PER_CLUSTER);
}

// ── Stacktrace Enrichment ───────────────────────────────────────

/**
 * For each cluster, fetch a stacktrace from one of its incidents and run
 * the stacktrace analyzer. This gives each cluster:
 *   - Root cause identification (which code component failed)
 *   - Failure layer classification (data access, service, worker, etc.)
 *   - Actionable fix hints
 *   - Transient vs persistent error classification
 *
 * Only fetches one stacktrace per cluster (they share the same error
 * pattern, so one sample is representative).
 */
async function enrichClustersWithStacktrace(
  client: AxiosInstance,
  clusters: IFailureContextCluster[],
  rawIncidents: RawIncident[]
): Promise<void> {
  // Build a quick lookup: activityId → incidents with their configuration
  const incidentsByActivity = new Map<string, RawIncident[]>();
  for (const inc of rawIncidents) {
    const actId = (inc.activityId as string) || "";
    if (!incidentsByActivity.has(actId)) incidentsByActivity.set(actId, []);
    incidentsByActivity.get(actId)!.push(inc);
  }

  // Process clusters in parallel (capped at 5 to avoid hammering the API)
  const tasks = clusters.slice(0, 10).map(async (cluster) => {
    try {
      // Find an incident for this cluster that has a configuration (job/task ID)
      const clusterIncidents = incidentsByActivity.get(cluster.activityId) || [];
      const sampleIncident = clusterIncidents.find(
        (inc) => (inc.configuration as string)
      );

      if (!sampleIncident) return;

      const configId = sampleIncident.configuration as string;
      const incidentType = (sampleIncident.incidentType as string) || "";
      const errorMessage = (sampleIncident.incidentMessage as string) || cluster.rawErrorSample;

      let rawStacktrace = "";

      logger.info(
        `[CLUSTER-ST] Fetching stacktrace for cluster ${cluster.clusterId}, ` +
        `configId=${configId}, incidentType=${incidentType}`
      );

      // Fetch stacktrace based on incident type
      if (incidentType === "failedExternalTask") {
        // Use the dedicated /errorDetails endpoint (returns plain text).
        // Must override Accept header — the client defaults to application/json
        // but this endpoint returns text/plain.
        try {
          const detailRes = await client.get(
            `/external-task/${configId}/errorDetails`,
            {
              responseType: "text",
              transformResponse: [(data: string) => data],
              headers: { Accept: "text/plain, */*" },
            }
          );
          rawStacktrace = (typeof detailRes.data === "string" ? detailRes.data : "") || "";
          logger.info(
            `[CLUSTER-ST] /errorDetails returned ${rawStacktrace.length} chars`
          );
        } catch (edErr: unknown) {
          const msg = edErr instanceof Error ? edErr.message : String(edErr);
          logger.info(`[CLUSTER-ST] /errorDetails FAILED: ${msg}`);
        }

        // Fallback: get errorMessage from the external task object
        if (!rawStacktrace) {
          try {
            const etRes = await client.get(`/external-task/${configId}`);
            rawStacktrace = (etRes.data?.errorMessage as string) || "";
            logger.info(
              `[CLUSTER-ST] fallback errorMessage: ${rawStacktrace.substring(0, 80)}`
            );
          } catch {
            // External task may have been completed/removed
          }
        }
      }

      // Try job stacktrace (works for failedJob, also valid fallback)
      if (!rawStacktrace) {
        try {
          const stRes = await client.get(`/job/${configId}/stacktrace`, {
            responseType: "text",
            transformResponse: [(data: string) => data],
            headers: { Accept: "text/plain, */*" },
          });
          rawStacktrace = (typeof stRes.data === "string" ? stRes.data : "") || "";
        } catch {
          // Job may have been completed/removed
        }
      }

      // Try full stacktrace analysis first, then fall back to error-message-only analysis
      let analysis: import("../../interfaces/intelligence.js").IStacktraceAnalysis | null = null;

      if (rawStacktrace) {
        const fullAnalysis = analyzeStacktrace(rawStacktrace, errorMessage);
        if (fullAnalysis.frames.length > 0) {
          analysis = fullAnalysis;
        }
      }

      // Fallback: analyze just the error message for basic classification
      const msgToAnalyze = errorMessage || cluster.rawErrorSample || cluster.normalizedError;
      if (!analysis && msgToAnalyze) {
        analysis = analyzeErrorMessageOnly(msgToAnalyze);
      }

      // Persist raw stacktrace on the cluster (truncated to ~5 KB)
      if (rawStacktrace) {
        cluster.rawStacktraceSample = rawStacktrace.length > 5000
          ? rawStacktrace.substring(0, 5000) + "\n… (truncated)"
          : rawStacktrace;
      }

      if (analysis) {
        cluster.stacktraceAnalysis = analysis;

        // If the analysis shows this is NOT transient and retry
        // is currently suggested, consider upgrading to "modify" or "escalate"
        if (!analysis.isTransient && cluster.suggestedRecovery === "retry") {
          if (analysis.failureLayer === "data_access" || analysis.failureLayer === "business_logic") {
            cluster.suggestedRecovery = "escalate";
          }
        }
      }
    } catch (err) {
      logger.debug(
        `[CLUSTER] Stacktrace enrichment failed for cluster ${cluster.clusterId}: ${err}`
      );
    }
  });

  await Promise.all(tasks);
}

// ── Error Normalization ─────────────────────────────────────────

/**
 * Normalize error messages by stripping instance-specific values:
 *   - UUIDs
 *   - Timestamps
 *   - Numbers / IDs
 *   - Stack trace line numbers
 *
 * This ensures "Cannot find entity with id abc123" and
 * "Cannot find entity with id xyz789" map to the same cluster.
 */
function normalizeError(message: string): string {
  if (!message) return "UNKNOWN_ERROR";

  let normalized = message
    // Remove UUIDs
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<ID>"
    )
    // Remove long hex strings (process instance IDs)
    .replace(/[0-9a-f]{16,}/gi, "<ID>")
    // Remove numeric IDs in common patterns
    .replace(/\bid\s*[:=]\s*\d+/gi, "id=<ID>")
    // Remove timestamps
    .replace(
      /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ]*/g,
      "<TIMESTAMP>"
    )
    // Remove line numbers in stack traces
    .replace(/:\d+:\d+/g, ":<LINE>")
    // Remove large numbers (likely IDs)
    .replace(/\b\d{6,}\b/g, "<NUM>")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  // Truncate very long messages
  if (normalized.length > 200) {
    normalized = normalized.substring(0, 200);
  }

  return normalized;
}
