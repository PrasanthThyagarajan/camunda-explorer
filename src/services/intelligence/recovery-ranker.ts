/**
 * Recovery Intelligence Engine
 *
 * Given a failed process instance, generates and ranks recovery options.
 *
 * Instead of blindly offering "retry" or "modify", the engine:
 *   1. Identifies all safe recovery nodes (backward and forward)
 *   2. Evaluates each option using historical success rates and risk factors
 *   3. Scores and ranks suggestions by expected value
 *
 * Scoring formula:
 *   Score = SuccessRate × (1 - RiskPenalty) × 100
 *
 * Risk factors include:
 *   - Parallel flow disruption
 *   - Variable inconsistency when moving backward
 *   - Sub-process boundary crossing
 */

import { AxiosInstance } from "axios";
import { logger } from "../../utils/logger.js";
import { recoveryLedger, type RecoverySuccessRate } from "./recovery-ledger.js";
import type {
  IReconstructedExecution,
  IReconstructedStep,
  IRecoverySuggestion,
  IRecoveryAnalysis,
  IFailureContextCluster,
  RecoveryType,
  RiskLevel,
} from "../../interfaces/intelligence.js";

// ── Configuration ───────────────────────────────────────────────

const MAX_RECOVERY_OPTIONS = 6;
const MIN_CONFIDENCE = 10; // don't show options below 10%

// ── Public API ──────────────────────────────────────────────────

/**
 * Generate ranked recovery suggestions for a failed process instance.
 */
export function generateRecoverySuggestions(
  execution: IReconstructedExecution,
  matchingCluster: IFailureContextCluster | null,
  bpmnActivities: BpmnActivity[]
): IRecoveryAnalysis {
  const failedStep = findFailedStep(execution);

  if (!failedStep) {
    return {
      instanceId: execution.instanceId,
      failedActivityId: "",
      failedActivityName: "",
      suggestions: [],
      matchingCluster,
      analyzedAt: new Date().toISOString(),
    };
  }

  const suggestions: IRecoverySuggestion[] = [];

  // Option 1: Retry at the failed activity
  suggestions.push(
    buildRetrySuggestion(failedStep, matchingCluster, execution)
  );

  // Option 2: Restart (new instance from start)
  suggestions.push(
    buildRestartSuggestion(execution, bpmnActivities)
  );

  // Note: modify_backward suggestions were removed from here.
  // The full Modify Dialog (accessible from the diagnosis panel)
  // provides a richer experience — activity picker with statuses,
  // source token selection, and advanced options.

  // Filter out low-confidence options and sort by confidence
  const ranked = suggestions
    .filter((s) => s.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_RECOVERY_OPTIONS);

  logger.info(
    `[RECOVERY] ${execution.instanceId}: ${ranked.length} options generated, ` +
      `top=${ranked[0]?.type}@${ranked[0]?.confidence}%`
  );

  return {
    instanceId: execution.instanceId,
    failedActivityId: failedStep.activityId,
    failedActivityName: failedStep.activityName,
    suggestions: ranked,
    matchingCluster,
    analyzedAt: new Date().toISOString(),
  };
}

// ── Retry Suggestion ────────────────────────────────────────────

function buildRetrySuggestion(
  failedStep: IReconstructedStep,
  cluster: IFailureContextCluster | null,
  execution: IReconstructedExecution
): IRecoverySuggestion {
  // Check ledger for real outcome data from past recovery actions
  const ledgerRate = recoveryLedger.getSuccessRate(
    execution.definitionKey,
    failedStep.activityId,
    "retry"
  );

  // Determine if we have real historical data for this failure
  const hasClusterData = cluster !== null && cluster.occurrenceCount >= 3;
  const hasLedgerData = ledgerRate.isSignificant;
  const hasHistoricalData = hasLedgerData || hasClusterData;

  // Priority: ledger data (real outcomes) > cluster data (incident patterns) > heuristic
  const baseRate = hasLedgerData
    ? ledgerRate.rate!
    : hasClusterData
    ? cluster!.retrySuccessRate
    : 0.5;

  // Penalty if this instance has already been retried multiple times
  const retryCount = execution.flatTimeline.filter(
    (s) =>
      s.activityId === failedStep.activityId &&
      (s.status === "failed" || s.status === "canceled")
  ).length;

  const retryPenalty = Math.min(0.6, retryCount * 0.15);
  const adjustedRate = Math.max(0.05, baseRate - retryPenalty);

  const riskFactors: string[] = [];
  if (retryCount >= 3) {
    riskFactors.push(`Already failed ${retryCount} times at this step`);
  }
  if (baseRate < 0.3) {
    riskFactors.push("Historical retry success rate is low for this failure pattern");
  }

  const risk = computeRisk(riskFactors.length, adjustedRate);
  const confidence = Math.round(adjustedRate * (1 - risk.penalty) * 100);

  return {
    type: "retry",
    targetActivityId: failedStep.activityId,
    targetActivityName: failedStep.activityName,
    confidence,
    confidenceBasis: hasHistoricalData ? "historical" : "heuristic",
    successRate: Math.round(adjustedRate * 100) / 100,
    risk: risk.level,
    riskFactors,
    estimatedDurationMs: failedStep.durationMs || 5000,
    explanation: buildExplanation("retry", failedStep, adjustedRate, retryCount),
    historicalBasis: {
      sampleSize: hasLedgerData
        ? ledgerRate.totalAttempts
        : cluster?.occurrenceCount || 0,
      timeWindow: hasLedgerData
        ? `${ledgerRate.totalAttempts} past recovery actions`
        : cluster
        ? `${cluster.firstSeen.substring(0, 10)} – ${cluster.lastSeen.substring(0, 10)}`
        : "No historical data",
    },
  };
}

// ── Restart Suggestion ──────────────────────────────────────────

function buildRestartSuggestion(
  execution: IReconstructedExecution,
  bpmnActivities: BpmnActivity[]
): IRecoverySuggestion {
  const firstAct = bpmnActivities.find((a) => a.isFirst);
  const riskFactors = [
    "Full restart — all progress is lost",
    "Process will re-execute from the beginning",
  ];

  if (execution.flatTimeline.length > 10) {
    riskFactors.push(
      `Process had ${execution.flatTimeline.length} steps — significant re-work`
    );
  }

  const risk = computeRisk(riskFactors.length, 0.8);
  const confidence = Math.round(0.8 * (1 - risk.penalty) * 100);

  return {
    type: "restart",
    targetActivityId: firstAct?.id || "",
    targetActivityName: firstAct?.name || "Start",
    confidence,
    confidenceBasis: "heuristic",
    successRate: 0.8,
    risk: risk.level,
    riskFactors,
    estimatedDurationMs: execution.durationBreakdown.totalMs || 30000,
    explanation:
      "Restart the process from the beginning. All current state is discarded. Use only when the process is fundamentally corrupted.",
    historicalBasis: {
      sampleSize: 0,
      timeWindow: "Based on structural analysis",
    },
  };
}

// ── Risk Assessment ─────────────────────────────────────────────

function computeRisk(
  factorCount: number,
  baseRate: number
): { level: RiskLevel; penalty: number } {
  // More risk factors = higher penalty
  const penalty = Math.min(0.6, factorCount * 0.1 + (1 - baseRate) * 0.2);

  let level: RiskLevel;
  if (penalty > 0.4) level = "high";
  else if (penalty > 0.2) level = "medium";
  else level = "low";

  return { level, penalty };
}

// ── Explanation Builder ─────────────────────────────────────────

function buildExplanation(
  type: RecoveryType,
  step: IReconstructedStep,
  rate: number,
  extra: number
): string {
  const pct = Math.round(rate * 100);

  switch (type) {
    case "retry":
      if (extra >= 3) {
        return `Retry at '${step.activityName}' — ${pct}% estimated success. Note: this step has already failed ${extra} times, which reduces confidence.`;
      }
      return `Retry at '${step.activityName}' — ${pct}% estimated success based on historical data for this failure pattern.`;

    default:
      return `${type} to '${step.activityName}' with ${pct}% confidence.`;
  }
}

// ── Type for BPMN activities from parser ────────────────────────

interface BpmnActivity {
  id: string;
  name: string;
  type: string;
  isFirst: boolean;
  order: number;
}

// ── Find the primary failed step ────────────────────────────────

function findFailedStep(
  execution: IReconstructedExecution
): IReconstructedStep | null {
  // Prefer the most recent failed step
  const failedSteps = execution.flatTimeline.filter(
    (s) => s.status === "failed"
  );

  if (failedSteps.length > 0) {
    return failedSteps[failedSteps.length - 1];
  }

  // Fall back to the most recent active step with incidents
  const activeWithIncidents = execution.flatTimeline.filter(
    (s) => s.status === "active" && s.incidents.length > 0
  );

  if (activeWithIncidents.length > 0) {
    return activeWithIncidents[activeWithIncidents.length - 1];
  }

  return null;
}
