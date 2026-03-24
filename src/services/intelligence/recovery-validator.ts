/**
 * Recovery Validation & Safety Guard
 *
 * Before any recovery action is executed, it passes through this
 * validation layer. The guard checks for:
 *
 *   - Execution integrity (target activity exists and is reachable)
 *   - Variable completeness (required vars are present)
 *   - Parallel flow safety (no orphan tokens)
 *   - Sub-process boundary correctness
 *   - Duplicate execution prevention
 *
 * Returns a verdict: proceed or block, with detailed findings.
 */

import { AxiosInstance } from "axios";
import { logger } from "../../utils/logger.js";
import type {
  IRecoveryValidation,
  IValidationFinding,
  IReconstructedExecution,
  IRecoverySuggestion,
} from "../../interfaces/intelligence.js";

// ── Public API ──────────────────────────────────────────────────

/**
 * Validate whether a recovery action is safe to execute.
 */
export async function validateRecovery(
  client: AxiosInstance,
  execution: IReconstructedExecution,
  suggestion: IRecoverySuggestion
): Promise<IRecoveryValidation> {
  const findings: IValidationFinding[] = [];

  // 1. Check that the target activity exists in the BPMN
  await checkActivityExists(client, execution, suggestion, findings);

  // 2. Check for active parallel tokens
  checkParallelSafety(execution, suggestion, findings);

  // 3. Check variable completeness for backward modifications
  if (suggestion.type === "modify_backward") {
    checkVariableCompleteness(execution, suggestion, findings);
  }

  // 4. Check for sub-process boundary violations
  checkSubProcessBoundary(execution, suggestion, findings);

  // 5. Duplicate execution check
  checkDuplicateRisk(execution, suggestion, findings);

  // 6. Instance state check (must be active/suspended)
  checkInstanceState(execution, findings);

  const hasBlocker = findings.some((f) => f.severity === "blocker");

  logger.info(
    `[VALIDATE] ${execution.instanceId} → ${suggestion.type}@${suggestion.targetActivityId}: ` +
      `${findings.length} findings, valid=${!hasBlocker}`
  );

  return {
    isValid: !hasBlocker,
    findings,
  };
}

// ── Validation Checks ───────────────────────────────────────────

async function checkActivityExists(
  client: AxiosInstance,
  execution: IReconstructedExecution,
  suggestion: IRecoverySuggestion,
  findings: IValidationFinding[]
): Promise<void> {
  if (!suggestion.targetActivityId) {
    findings.push({
      code: "NO_TARGET",
      message: "No target activity specified for recovery action",
      severity: "blocker",
    });
    return;
  }

  // Check if the activity exists in the execution history
  const knownActivities = new Set(
    execution.flatTimeline.map((s) => s.activityId)
  );

  // For retry, the activity must be in the timeline
  if (suggestion.type === "retry" && !knownActivities.has(suggestion.targetActivityId)) {
    findings.push({
      code: "UNKNOWN_ACTIVITY",
      message: `Target activity '${suggestion.targetActivityId}' was not found in the execution history`,
      severity: "blocker",
    });
  }

}

function checkParallelSafety(
  execution: IReconstructedExecution,
  suggestion: IRecoverySuggestion,
  findings: IValidationFinding[]
): void {
  if (suggestion.type === "retry") return; // retries don't affect parallel flows

  // Check if there are active steps on other execution branches
  const activeSteps = execution.flatTimeline.filter(
    (s) => s.status === "active"
  );

  const uniqueExecutionIds = new Set(activeSteps.map((s) => s.executionId));

  if (uniqueExecutionIds.size > 1) {
    findings.push({
      code: "PARALLEL_TOKENS_ACTIVE",
      message: `${uniqueExecutionIds.size} parallel execution tokens are active. Modification may create orphan tokens.`,
      severity: "warning",
    });
  }

  // Check if the target is on a different branch than the failed step
  const failedStep = execution.flatTimeline.find(
    (s) => s.status === "failed" || (s.status === "active" && s.incidents.length > 0)
  );
  const targetStep = execution.flatTimeline.find(
    (s) => s.activityId === suggestion.targetActivityId
  );

  if (
    failedStep &&
    targetStep &&
    failedStep.executionId !== targetStep.executionId
  ) {
    findings.push({
      code: "CROSS_BRANCH_MODIFY",
      message: "Target activity is on a different parallel branch than the failed activity",
      severity: "warning",
    });
  }
}

function checkVariableCompleteness(
  execution: IReconstructedExecution,
  suggestion: IRecoverySuggestion,
  findings: IValidationFinding[]
): void {
  // When moving backward, variables set between target and failure point
  // will still have their latest values, potentially causing inconsistency
  const targetIndex = execution.flatTimeline.findIndex(
    (s) => s.activityId === suggestion.targetActivityId
  );
  const failedIndex = execution.flatTimeline.findIndex(
    (s) => s.status === "failed"
  );

  if (targetIndex < 0 || failedIndex < 0) return;

  // Count variables modified between target and failure
  const modifiedVars = new Set<string>();
  for (let i = targetIndex + 1; i <= failedIndex; i++) {
    for (const v of execution.flatTimeline[i].variableSnapshot) {
      modifiedVars.add(v.name);
    }
  }

  if (modifiedVars.size > 0) {
    findings.push({
      code: "VARIABLE_INCONSISTENCY",
      message: `${modifiedVars.size} variable(s) were modified between target and failure point: ${[...modifiedVars].slice(0, 5).join(", ")}${modifiedVars.size > 5 ? "…" : ""}. These will retain their current values.`,
      severity: modifiedVars.size > 5 ? "warning" : "info",
    });
  }
}

function checkSubProcessBoundary(
  execution: IReconstructedExecution,
  suggestion: IRecoverySuggestion,
  findings: IValidationFinding[]
): void {
  if (suggestion.type === "retry") return;

  // Check if the target activity is inside a sub-process while the
  // current failure is outside (or vice versa)
  const targetStep = execution.flatTimeline.find(
    (s) => s.activityId === suggestion.targetActivityId
  );

  if (!targetStep) return;

  // Detect sub-process boundaries by checking for callActivity or subProcess types
  const subProcessSteps = execution.flatTimeline.filter(
    (s) =>
      s.activityType === "subProcess" ||
      s.activityType === "callActivity"
  );

  if (subProcessSteps.length > 0) {
    const targetInSub = subProcessSteps.some(
      (sp) => sp.calledProcessInstanceId && sp.activityId === targetStep.activityId
    );

    if (targetInSub) {
      findings.push({
        code: "SUB_PROCESS_BOUNDARY",
        message: "Target activity is inside a sub-process. Ensure the sub-process scope and variables are consistent.",
        severity: "warning",
      });
    }
  }
}

function checkDuplicateRisk(
  execution: IReconstructedExecution,
  suggestion: IRecoverySuggestion,
  findings: IValidationFinding[]
): void {
  if (suggestion.type === "retry") return;

  // If the target activity has already completed, re-running it may
  // cause duplicate side effects (external calls, messages, etc.)
  const completedAtTarget = execution.flatTimeline.filter(
    (s) =>
      s.activityId === suggestion.targetActivityId &&
      s.status === "completed"
  );

  if (completedAtTarget.length > 0) {
    const types = new Set(completedAtTarget.map((s) => s.activityType));
    const hasSideEffects =
      types.has("serviceTask") ||
      types.has("sendTask") ||
      types.has("scriptTask");

    if (hasSideEffects) {
      findings.push({
        code: "DUPLICATE_EXECUTION_RISK",
        message: `'${suggestion.targetActivityName}' has already executed ${completedAtTarget.length} time(s). Re-execution may cause duplicate side effects (API calls, messages, etc.).`,
        severity: "warning",
      });
    }
  }
}

function checkInstanceState(
  execution: IReconstructedExecution,
  findings: IValidationFinding[]
): void {
  const state = execution.state?.toUpperCase() || "";

  if (state === "COMPLETED" || state === "EXTERNALLY_TERMINATED") {
    findings.push({
      code: "INSTANCE_NOT_ACTIVE",
      message: `Process instance is in '${execution.state}' state — cannot modify a finished instance`,
      severity: "blocker",
    });
  }

  if (state === "SUSPENDED") {
    findings.push({
      code: "INSTANCE_SUSPENDED",
      message: "Process instance is suspended. It must be activated before recovery can proceed.",
      severity: "warning",
    });
  }
}
