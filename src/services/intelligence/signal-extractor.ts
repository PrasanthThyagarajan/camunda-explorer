/**
 * Signal & Anomaly Extraction Engine
 *
 * Analyzes a reconstructed execution against the population of instances
 * for the same BPMN definition. Detects four signal categories:
 *
 *   1. Temporal — abnormal durations, delay spikes
 *   2. Path — rare execution paths, uncommon branches
 *   3. Variable — unusual or missing variable values
 *   4. Retry — repeated attempts, degrading success
 *
 * All detection is pure statistical comparison — no ML required.
 * Percentile thresholds drive the classification.
 */

import { AxiosInstance } from "axios";
import { logger } from "../../utils/logger.js";
import { fmtMs } from "../../utils/format.js";
import { computePathSignature } from "../../utils/path-signature.js";
import { cacheGet, cacheSet } from "./history-cache.js";
import type {
  IReconstructedExecution,
  IReconstructedStep,
  ISignal,
  ISignalProfile,
  SignalSeverity,
} from "../../interfaces/intelligence.js";

// ── Configuration ───────────────────────────────────────────────

const POPULATION_SAMPLE_SIZE = 200;
const P95_MULTIPLIER = 3; // duration > P95 * this = abnormal
const RARE_PATH_THRESHOLD = 0.05; // paths below 5% frequency = rare
const RETRY_WARN_THRESHOLD = 3;

// ── Public API ──────────────────────────────────────────────────

/**
 * Extract anomaly signals from a reconstructed execution.
 * Compares the instance against recent peers from the same BPMN.
 */
export async function extractSignals(
  client: AxiosInstance,
  execution: IReconstructedExecution
): Promise<ISignalProfile> {
  const signals: ISignal[] = [];
  const defKey = execution.definitionKey;

  if (!defKey) {
    return buildProfile(execution.instanceId, defKey, signals);
  }

  // Fetch population data for comparison (recent finished instances)
  const populationActivities = await fetchPopulationActivities(
    client,
    defKey,
    execution.instanceId
  );

  // 1. Temporal signals — per step duration vs population
  signals.push(
    ...detectTemporalSignals(execution.flatTimeline, populationActivities)
  );

  // 2. Path signals — this instance's path vs common paths
  signals.push(
    ...detectPathSignals(execution, populationActivities)
  );

  // 3. Variable signals — detect missing or unusual values at failure points
  signals.push(
    ...detectVariableSignals(execution, populationActivities)
  );

  // 4. Retry signals — repeated execution of same activity
  signals.push(...detectRetrySignals(execution.flatTimeline));

  logger.info(
    `[SIGNALS] ${execution.instanceId}: ${signals.length} signals detected ` +
      `(${signals.filter((s) => s.severity === "high").length} high)`
  );

  return buildProfile(execution.instanceId, defKey, signals);
}

// ── Temporal Signal Detection ───────────────────────────────────

function detectTemporalSignals(
  steps: IReconstructedStep[],
  population: PopulationData
): ISignal[] {
  const signals: ISignal[] = [];

  for (const step of steps) {
    if (step.durationMs === null || step.durationMs === 0) continue;

    const stats = population.durationStats.get(step.activityId);
    if (!stats || stats.count < 5) continue;

    // Abnormal duration: significantly above P95
    if (step.durationMs > stats.p95 * P95_MULTIPLIER && stats.p95 > 0) {
      signals.push({
        type: "abnormal_duration",
        severity: step.durationMs > stats.p95 * 10 ? "high" : "medium",
        activityId: step.activityId,
        activityName: step.activityName,
        description: `Duration ${fmtMs(step.durationMs)} is ${Math.round(step.durationMs / stats.avg)}× the average`,
        evidence: {
          expected: `avg=${fmtMs(stats.avg)}, P95=${fmtMs(stats.p95)}`,
          actual: fmtMs(step.durationMs),
          sampleSize: stats.count,
        },
      });
    }
  }

  // Check for delay spikes between consecutive steps
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];
    if (!prev.endTime || !curr.startTime) continue;

    const gap =
      new Date(curr.startTime).getTime() -
      new Date(prev.endTime).getTime();

    if (gap > 30000) {
      // >30s gap between steps
      signals.push({
        type: "delay_spike",
        severity: gap > 300000 ? "high" : gap > 60000 ? "medium" : "low",
        activityId: curr.activityId,
        activityName: curr.activityName,
        description: `${fmtMs(gap)} gap before this step started (after ${prev.activityName})`,
        evidence: {
          expected: "< 30s between steps",
          actual: fmtMs(gap),
          sampleSize: 0,
        },
      });
    }
  }

  return signals;
}

// ── Path Signal Detection ───────────────────────────────────────

function detectPathSignals(
  execution: IReconstructedExecution,
  population: PopulationData
): ISignal[] {
  const signals: ISignal[] = [];

  if (population.pathFrequencies.size === 0) return signals;

  const myPathFreq =
    population.pathFrequencies.get(execution.pathSignature) || 0;
  const totalPaths = [...population.pathFrequencies.values()].reduce(
    (a, b) => a + b,
    0
  );

  if (totalPaths === 0) return signals;

  const pathRatio = myPathFreq / totalPaths;

  if (pathRatio < RARE_PATH_THRESHOLD) {
    const failedStep = execution.flatTimeline.find(
      (s) => s.status === "failed"
    );

    signals.push({
      type: "rare_path",
      severity: pathRatio === 0 ? "high" : "medium",
      activityId: failedStep?.activityId || execution.flatTimeline[0]?.activityId || "",
      activityName: failedStep?.activityName || "Process",
      description:
        pathRatio === 0
          ? "This execution path has never been seen before"
          : `This path was taken by only ${(pathRatio * 100).toFixed(1)}% of instances`,
      evidence: {
        expected: "Common paths occur in >5% of instances",
        actual: `${(pathRatio * 100).toFixed(1)}% frequency`,
        sampleSize: totalPaths,
      },
    });
  }

  return signals;
}

// ── Variable Signal Detection ───────────────────────────────────

function detectVariableSignals(
  execution: IReconstructedExecution,
  population: PopulationData
): ISignal[] {
  const signals: ISignal[] = [];

  // Focus on steps that failed
  const failedSteps = execution.flatTimeline.filter(
    (s) => s.status === "failed"
  );

  for (const step of failedSteps) {
    // Check each variable at this step against population
    for (const varEntry of step.variableSnapshot) {
      const popValues =
        population.variableDistributions.get(
          `${step.activityId}::${varEntry.name}`
        ) || [];

      if (popValues.length < 5) continue;

      const myValStr = String(varEntry.value ?? "");
      const matchCount = popValues.filter((v) => v === myValStr).length;
      const matchRate = matchCount / popValues.length;

      if (matchRate < 0.1 && popValues.length >= 10) {
        signals.push({
          type: "unusual_variable",
          severity: matchRate === 0 ? "high" : "medium",
          activityId: step.activityId,
          activityName: step.activityName,
          description: `Variable '${varEntry.name}' has value '${truncate(myValStr, 40)}' which appeared in only ${(matchRate * 100).toFixed(0)}% of successful executions`,
          evidence: {
            expected: `Common values seen in ${popValues.length} instances`,
            actual: myValStr,
            sampleSize: popValues.length,
          },
        });
      }
    }

    // Check for missing variables (present in population but absent here)
    const stepVarNames = new Set(step.variableSnapshot.map((v) => v.name));
    for (const [key, vals] of population.variableDistributions) {
      if (!key.startsWith(step.activityId + "::")) continue;
      const varName = key.split("::")[1];
      if (!stepVarNames.has(varName) && vals.length >= 10) {
        signals.push({
          type: "missing_variable",
          severity: "medium",
          activityId: step.activityId,
          activityName: step.activityName,
          description: `Variable '${varName}' is typically present at this activity but is missing in this instance`,
          evidence: {
            expected: `Present in ${vals.length} instances`,
            actual: "Missing",
            sampleSize: vals.length,
          },
        });
      }
    }
  }

  return signals;
}

// ── Retry Signal Detection ──────────────────────────────────────

function detectRetrySignals(steps: IReconstructedStep[]): ISignal[] {
  const signals: ISignal[] = [];

  // Count how many times each activityId appears (multiple = retry/loop)
  const activityCounts = new Map<string, number>();
  const activitySteps = new Map<string, IReconstructedStep[]>();

  for (const step of steps) {
    activityCounts.set(
      step.activityId,
      (activityCounts.get(step.activityId) || 0) + 1
    );
    if (!activitySteps.has(step.activityId)) {
      activitySteps.set(step.activityId, []);
    }
    activitySteps.get(step.activityId)!.push(step);
  }

  for (const [actId, count] of activityCounts) {
    if (count < 2) continue;

    const stepList = activitySteps.get(actId)!;
    const failedCount = stepList.filter(
      (s) => s.status === "failed" || s.status === "canceled"
    ).length;

    if (count >= RETRY_WARN_THRESHOLD) {
      signals.push({
        type: "multiple_attempts",
        severity: count >= 5 ? "high" : "medium",
        activityId: actId,
        activityName: stepList[0].activityName,
        description: `This activity was executed ${count} times (${failedCount} failed)`,
        evidence: {
          expected: "Single execution",
          actual: `${count} attempts, ${failedCount} failures`,
          sampleSize: 0,
        },
      });
    }

    // Check for degrading performance across retries
    const durations = stepList
      .map((s) => s.durationMs)
      .filter((d): d is number => d !== null);
    if (durations.length >= 2) {
      const increasing = durations.every(
        (d, i) => i === 0 || d >= durations[i - 1]
      );
      if (increasing && durations[durations.length - 1] > durations[0] * 2) {
        signals.push({
          type: "retry_degradation",
          severity: "medium",
          activityId: actId,
          activityName: stepList[0].activityName,
          description: `Duration is increasing across retries: ${durations.map(fmtMs).join(" → ")}`,
          evidence: {
            expected: "Consistent duration",
            actual: `${fmtMs(durations[0])} → ${fmtMs(durations[durations.length - 1])}`,
            sampleSize: durations.length,
          },
        });
      }
    }
  }

  return signals;
}

// ── Population Data Fetching ────────────────────────────────────

interface DurationStats {
  avg: number;
  p95: number;
  count: number;
}

interface PopulationData {
  durationStats: Map<string, DurationStats>;
  pathFrequencies: Map<string, number>;
  variableDistributions: Map<string, string[]>;
}

/**
 * Fetch aggregated data from recent instances of the same BPMN definition.
 * This is the "population" against which we compare the target instance.
 *
 * Uses shared HistoryCache so that overlapping requests from
 * bpmn-intelligence and signal-extractor reuse the same data.
 */
const POPULATION_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

async function fetchPopulationActivities(
  client: AxiosInstance,
  definitionKey: string,
  excludeInstanceId: string
): Promise<PopulationData> {
  // Check if full population data is already cached
  const popCacheKey = `population::${definitionKey}`;
  const cached = cacheGet<PopulationData>(popCacheKey);
  if (cached) return cached;

  const durationStats = new Map<string, DurationStats>();
  const pathFrequencies = new Map<string, number>();
  const variableDistributions = new Map<string, string[]>();

  try {
    // Fetch recent finished instances — use shared cache key so
    // bpmn-intelligence can reuse the same response if it runs soon.
    const instancesCacheKey = `hist-instances-finished::${definitionKey}`;
    let instances = cacheGet<Array<Record<string, unknown>>>(instancesCacheKey);

    if (!instances) {
      const instancesRes = await client.get(`/history/process-instance`, {
        params: {
          processDefinitionKey: definitionKey,
          finished: "true",
          sortBy: "startTime",
          sortOrder: "desc",
          maxResults: POPULATION_SAMPLE_SIZE,
        },
      });
      instances = (instancesRes.data || []) as Array<Record<string, unknown>>;
      cacheSet(instancesCacheKey, instances, POPULATION_CACHE_TTL);
    }

    if (instances.length === 0) {
      return { durationStats, pathFrequencies, variableDistributions };
    }

    // Collect activity durations from a sample of instances
    // (fetch activities for up to 50 instances to keep it fast)
    const sampleIds = instances
      .filter((inst) => inst.id !== excludeInstanceId)
      .slice(0, 50)
      .map((inst) => inst.id as string);

    // Aggregate durations per activityId
    const allDurations = new Map<string, number[]>();

    // Fetch activities in batches of 10 — cache each per-instance result
    for (let i = 0; i < sampleIds.length; i += 10) {
      const batch = sampleIds.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map((id) => {
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
              cacheSet(actCacheKey, result, POPULATION_CACHE_TTL);
              return result;
            })
            .catch(() => ({ data: [] as RawActivity[] }));
        })
      );

      for (const res of batchResults) {
        const activities = (res.data || []) as RawActivity[];
        for (const act of activities) {
          const aid = act.activityId as string;
          const dur = act.durationInMillis as number | null;
          if (dur !== null && dur !== undefined) {
            if (!allDurations.has(aid)) allDurations.set(aid, []);
            allDurations.get(aid)!.push(dur);
          }
        }

        // Compute path signature using the shared utility
        const sig = computePathSignature(
          activities
            .filter(
              (a) =>
                (a.activityType as string) !== "multiInstanceBody" &&
                (a.activityType as string) !== "processDefinition"
            )
            .map((a) => ({
              activityId: a.activityId as string,
              activityType: a.activityType as string,
            }))
        );
        pathFrequencies.set(sig, (pathFrequencies.get(sig) || 0) + 1);
      }
    }

    // Compute stats per activity
    for (const [aid, durations] of allDurations) {
      const sorted = durations.sort((a, b) => a - b);
      const avg =
        sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const p95Idx = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Idx] || sorted[sorted.length - 1];

      durationStats.set(aid, { avg, p95, count: sorted.length });
    }

    // Fetch variable distributions for failed steps (from successful instances)
    // Limited scope: only fetch for the first 20 instances
    const varSample = sampleIds.slice(0, 20);
    for (let i = 0; i < varSample.length; i += 5) {
      const batch = varSample.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map((id) =>
          client
            .get(`/history/variable-instance`, {
              params: { processInstanceId: id },
            })
            .catch(() => ({ data: [] }))
        )
      );

      for (const res of batchResults) {
        const vars = (res.data || []) as RawVariable[];
        for (const v of vars) {
          const key = `${(v.activityInstanceId as string) || "global"}::${v.name as string}`;
          if (!variableDistributions.has(key)) {
            variableDistributions.set(key, []);
          }
          variableDistributions
            .get(key)!
            .push(String(v.value ?? ""));
        }
      }
    }
  } catch (err) {
    logger.warn(`[SIGNALS] Failed to fetch population data: ${err}`);
  }

  const result: PopulationData = { durationStats, pathFrequencies, variableDistributions };
  cacheSet(popCacheKey, result, POPULATION_CACHE_TTL);
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────

type RawActivity = Record<string, unknown>;
type RawVariable = Record<string, unknown>;

function buildProfile(
  instanceId: string,
  defKey: string,
  signals: ISignal[]
): ISignalProfile {
  // Risk level derived from signal severity counts
  const highCount = signals.filter((s) => s.severity === "high").length;
  const medCount = signals.filter((s) => s.severity === "medium").length;
  const raw = highCount * 30 + medCount * 15 + (signals.length - highCount - medCount) * 5;
  const riskScore = Math.min(100, raw);

  return {
    instanceId,
    definitionKey: defKey,
    signals,
    riskScore,
    analyzedAt: new Date().toISOString(),
  };
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.substring(0, len - 1) + "…" : str;
}
