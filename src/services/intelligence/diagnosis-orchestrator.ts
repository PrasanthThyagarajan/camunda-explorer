/**
 * Diagnosis Orchestrator
 *
 * Ties together all intelligence engines to produce a complete
 * diagnosis for a failed process instance. This is the single
 * entry point the API routes call.
 *
 * Flow:
 *   1. Reconstruct execution (Phase 1)   — cached
 *   2. Extract signals (Phase 2)
 *   3. Cluster failures (Phase 3)        — cached
 *   4. Generate recovery suggestions (Phase 4)
 *   5. Validate each suggestion (Phase 8)
 *   6. Assemble IIncidentDiagnosis
 */

import { AxiosInstance } from "axios";
import { logger } from "../../utils/logger.js";
import { reconstructExecution } from "./execution-reconstructor.js";
import { extractSignals } from "./signal-extractor.js";
import { clusterFailures, findMatchingCluster } from "./failure-clusterer.js";
import { generateRecoverySuggestions } from "./recovery-ranker.js";
import { validateRecovery } from "./recovery-validator.js";
import { analyzeStacktrace, analyzeErrorMessageOnly, getRetryModifier } from "./stacktrace-analyzer.js";
import { cacheGet, cacheSet, cacheInvalidate } from "./history-cache.js";
import type {
  IIncidentDiagnosis,
  IReconstructedExecution,
  IFailureContextResult,
  IRecoveryValidation,
  IStacktraceAnalysis,
} from "../../interfaces/intelligence.js";
import type { IBpmnActivity } from "../../interfaces/parsers.js";

// ── Cache key helpers ───────────────────────────────────────────

const EXEC_TTL = 2 * 60 * 1000; // 2 minutes (instance data changes often)
const CLUSTER_TTL = 5 * 60 * 1000; // 5 minutes (aggregate, slower to change)

function execKey(id: string): string {
  return `exec::${id}`;
}
function clusterKey(defKey: string): string {
  return `cluster::${defKey}`;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Run full diagnosis on a process instance.
 *
 * @param incidentId - The incident that triggered the diagnosis (optional)
 * @param errorMessage - The error message from the incident
 * @param bpmnActivities - Parsed BPMN activities for the definition
 */
export async function diagnoseInstance(
  client: AxiosInstance,
  instanceId: string,
  incidentId: string,
  errorMessage: string,
  bpmnActivities: IBpmnActivity[]
): Promise<IIncidentDiagnosis> {
  const startMs = Date.now();

  // Phase 1: Reconstruct execution (with cache)
  let execution = cacheGet<IReconstructedExecution>(execKey(instanceId));
  if (!execution) {
    execution = await reconstructExecution(client, instanceId);
    cacheSet(execKey(instanceId), execution, EXEC_TTL);
  }

  // Phase 2: Extract signals
  const signalProfile = await extractSignals(client, execution);

  // Phase 3: Get failure clusters (with cache)
  let clusterResult = cacheGet<IFailureContextResult>(
    clusterKey(execution.definitionKey)
  );
  if (!clusterResult) {
    clusterResult = await clusterFailures(client, execution.definitionKey);
    cacheSet(
      clusterKey(execution.definitionKey),
      clusterResult,
      CLUSTER_TTL
    );
  }

  // Find matching cluster for this specific failure
  const failedStep = execution.flatTimeline.find(
    (s) =>
      s.status === "failed" ||
      (s.status === "active" && s.incidents.length > 0)
  );
  const matchingCluster = findMatchingCluster(
    clusterResult.clusters,
    failedStep?.activityId || "",
    errorMessage
  );

  // Phase 4: Generate recovery suggestions
  const recovery = generateRecoverySuggestions(
    execution,
    matchingCluster,
    bpmnActivities
  );

  // Phase: Stacktrace Analysis — fetch and analyze the trace for deeper insight
  let stacktraceAnalysis: IStacktraceAnalysis | undefined;
  try {
    const rawTrace = await fetchStacktrace(client, instanceId);
    if (rawTrace) {
      const fullAnalysis = analyzeStacktrace(rawTrace, errorMessage);
      if (fullAnalysis.frames.length > 0) {
        stacktraceAnalysis = fullAnalysis;
      }
    }

    // Fallback: analyze just the error message for basic classification
    const msgForAnalysis = errorMessage
      || failedStep?.incidents?.[0]?.message
      || "";
    if (!stacktraceAnalysis && msgForAnalysis) {
      const msgAnalysis = analyzeErrorMessageOnly(msgForAnalysis);
      if (msgAnalysis) stacktraceAnalysis = msgAnalysis;
    }

    // Adjust recovery confidence based on stacktrace insight
    if (stacktraceAnalysis) {
      const retryMod = getRetryModifier(stacktraceAnalysis);
      if (retryMod < 1.0) {
        for (const suggestion of recovery.suggestions) {
          if (suggestion.type === "retry") {
            const oldConf = suggestion.confidence;
            suggestion.confidence = Math.max(5, Math.round(suggestion.confidence * retryMod));
            if (retryMod < 0.5) {
              suggestion.riskFactors.push(
                `Stacktrace analysis: ${stacktraceAnalysis.failureLayer.replace("_", " ")} error in ${stacktraceAnalysis.failureComponent} — retry unlikely to help`
              );
            }
            logger.debug(
              `[DIAGNOSIS] Retry confidence adjusted ${oldConf} → ${suggestion.confidence} (modifier=${retryMod}, layer=${stacktraceAnalysis.failureLayer})`
            );
          }
        }

        // Re-sort by adjusted confidence
        recovery.suggestions.sort((a, b) => b.confidence - a.confidence);
      }
    }
  } catch (stErr) {
    logger.debug(`[DIAGNOSIS] Stacktrace fetch/analysis failed: ${stErr}`);
  }

  // Phase 8: Validate each suggestion
  const validation: Record<string, IRecoveryValidation> = {};
  for (const suggestion of recovery.suggestions) {
    const key = `${suggestion.type}::${suggestion.targetActivityId}`;
    validation[key] = await validateRecovery(client, execution, suggestion);
  }

  const totalMs = Date.now() - startMs;
  logger.info(
    `[DIAGNOSIS] ${instanceId}: completed in ${totalMs}ms — ` +
      `${signalProfile.signals.length} signals, ` +
      `${recovery.suggestions.length} suggestions, ` +
      `risk=${signalProfile.riskScore}` +
      (stacktraceAnalysis ? `, trace_layer=${stacktraceAnalysis.failureLayer}` : "")
  );

  return {
    instanceId,
    definitionKey: execution.definitionKey,
    incidentId,
    failedActivity: {
      id: failedStep?.activityId || "",
      name: failedStep?.activityName || "",
      type: failedStep?.activityType || "",
    },
    errorMessage,
    signals: signalProfile.signals,
    riskScore: signalProfile.riskScore,
    matchingCluster,
    suggestions: recovery.suggestions,
    validation,
    stacktraceAnalysis,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Get just the reconstructed execution (lightweight — no full diagnosis).
 */
export async function getExecution(
  client: AxiosInstance,
  instanceId: string
): Promise<IReconstructedExecution> {
  let execution = cacheGet<IReconstructedExecution>(execKey(instanceId));
  if (!execution) {
    execution = await reconstructExecution(client, instanceId);
    cacheSet(execKey(instanceId), execution, EXEC_TTL);
  }
  return execution;
}

/**
 * Invalidate cache for an instance after a recovery action.
 * Called after execute-recovery so the next diagnosis picks up fresh data.
 */
export function invalidateInstanceCache(instanceId: string): void {
  cacheInvalidate(execKey(instanceId));
}

// ── Stacktrace Fetching ─────────────────────────────────────────

/**
 * Fetch the stacktrace for a process instance's failed incident.
 * Tries the runtime incident API to find the configuration (job/task ID),
 * then fetches the actual stacktrace.
 */
async function fetchStacktrace(
  client: AxiosInstance,
  instanceId: string
): Promise<string | null> {
  // Find active incidents for this instance
  const incRes = await client.get(`/incident`, {
    params: { processInstanceId: instanceId },
  });
  const incidents = (incRes.data || []) as Array<Record<string, unknown>>;
  if (incidents.length === 0) return null;

  // Try the first incident with a configuration
  for (const inc of incidents.slice(0, 3)) {
    const configId = inc.configuration as string;
    const incidentType = inc.incidentType as string;
    if (!configId) continue;

    try {
      // For external tasks, fetch errorDetails
      if (incidentType === "failedExternalTask") {
        const etRes = await client.get(`/external-task/${configId}`);
        const details =
          (etRes.data?.errorDetails as string) ||
          (etRes.data?.errorMessage as string) ||
          "";
        if (details) return details;
      }

      // For jobs, fetch the stacktrace endpoint
      const stRes = await client.get(`/job/${configId}/stacktrace`, {
        responseType: "text",
        transformResponse: [(data: string) => data],
      });
      if (stRes.data) return stRes.data as string;
    } catch {
      // Try next incident
    }
  }

  return null;
}
