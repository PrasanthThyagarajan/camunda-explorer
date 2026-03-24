/**
 * Intelligence Layer — Canonical Domain Models
 *
 * These interfaces form the foundation for the History-Driven Process
 * Intelligence system. Every engine (reconstruction, signal extraction,
 * failure clustering, recovery ranking, cross-instance learning) consumes
 * and produces data through these types.
 */

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Execution Reconstruction
// ═══════════════════════════════════════════════════════════════════

/** A single step in the reconstructed execution timeline */
export interface IReconstructedStep {
  activityInstanceId: string;
  activityId: string;
  activityName: string;
  activityType: string;
  executionId: string;
  status: "completed" | "active" | "failed" | "canceled";
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  calledProcessInstanceId: string | null;
  taskId: string | null;
  incidents: IStepIncident[];
  /** Variables that were created or last modified during this step */
  variableSnapshot: IVariableEntry[];
}

/** Incident data attached to a reconstruction step */
export interface IStepIncident {
  id: string;
  type: string;
  message: string;
  createTime: string;
  endTime: string | null;
  resolved: boolean;
}

/** A single variable at a point in time */
export interface IVariableEntry {
  name: string;
  type: string;
  value: unknown;
  activityInstanceId: string | null;
}

/** A branch in the execution tree (parallel token path) */
export interface IExecutionBranch {
  executionId: string;
  parentExecutionId: string | null;
  steps: IReconstructedStep[];
  childBranches: IExecutionBranch[];
}

/** Duration breakdown for an instance */
export interface IDurationBreakdown {
  totalMs: number;
  activeMs: number;
  waitMs: number;
  perActivity: Record<string, number>;
}

/** Full reconstructed execution for a process instance */
export interface IReconstructedExecution {
  instanceId: string;
  definitionId: string;
  definitionKey: string;
  definitionName: string | null;
  businessKey: string | null;
  state: string;
  startTime: string;
  endTime: string | null;
  /** Flat timeline in chronological order */
  flatTimeline: IReconstructedStep[];
  /** Tree structure preserving parallel branches */
  executionTree: IExecutionBranch[];
  /** Variables grouped by step */
  variables: IVariableEntry[];
  /** Ordered activity IDs forming the path fingerprint */
  pathSignature: string;
  durationBreakdown: IDurationBreakdown;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Signal & Anomaly Extraction
// ═══════════════════════════════════════════════════════════════════

export type SignalType =
  | "abnormal_duration"
  | "delay_spike"
  | "degrading_performance"
  | "rare_path"
  | "uncommon_branch"
  | "unusual_variable"
  | "missing_variable"
  | "multiple_attempts"
  | "low_retry_success"
  | "retry_degradation";

export type SignalSeverity = "low" | "medium" | "high";

/** A single detected anomaly signal */
export interface ISignal {
  type: SignalType;
  severity: SignalSeverity;
  activityId: string;
  activityName: string;
  description: string;
  evidence: {
    expected: string;
    actual: string;
    sampleSize: number;
  };
}

/** Complete signal profile for a process instance */
export interface ISignalProfile {
  instanceId: string;
  definitionKey: string;
  signals: ISignal[];
  riskScore: number; // 0-100
  analyzedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Failure Context Engine
// ═══════════════════════════════════════════════════════════════════

/** A variable condition that correlates with failure */
export interface IFailureCondition {
  variable: string;
  value: string;
  frequency: number; // 0.0 - 1.0
}

/** A cluster of similar failures */
export interface IFailureContextCluster {
  clusterId: string;
  activityId: string;
  activityName: string;
  normalizedError: string;
  /** Original unmodified error message from the first incident in the cluster */
  rawErrorSample: string;
  occurrenceCount: number;
  /** How many distinct process instances are affected */
  affectedInstanceCount: number;
  /** Up to 10 affected process instance IDs for drill-down */
  affectedInstanceIds: string[];
  firstSeen: string;
  lastSeen: string;
  conditions: IFailureCondition[];
  retrySuccessRate: number;
  modifySuccessRate: number;
  suggestedRecovery: "retry" | "modify" | "escalate";
  /** Parsed stacktrace analysis from a sample incident (if available) */
  stacktraceAnalysis?: IStacktraceAnalysis;
  /** Raw stacktrace text from a representative incident (truncated to ~5 KB) */
  rawStacktraceSample?: string;
}

/** Results from failure context analysis for a BPMN */
export interface IFailureContextResult {
  definitionKey: string;
  totalIncidentsAnalyzed: number;
  clusters: IFailureContextCluster[];
  analyzedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Recovery Intelligence Engine
// ═══════════════════════════════════════════════════════════════════

export type RecoveryType =
  | "retry"
  | "modify_backward"
  | "restart";

export type RiskLevel = "low" | "medium" | "high";

/** Indicates whether a confidence score is backed by real data or a heuristic guess */
export type ConfidenceBasis = "historical" | "heuristic";

/** A single recovery option with scoring */
export interface IRecoverySuggestion {
  type: RecoveryType;
  targetActivityId: string;
  targetActivityName: string;
  confidence: number; // 0-100
  confidenceBasis: ConfidenceBasis;
  successRate: number; // 0.0 - 1.0
  risk: RiskLevel;
  riskFactors: string[];
  estimatedDurationMs: number;
  explanation: string;
  historicalBasis: {
    sampleSize: number;
    timeWindow: string;
  };
}

/** Full recovery analysis for an incident / failed instance */
export interface IRecoveryAnalysis {
  instanceId: string;
  failedActivityId: string;
  failedActivityName: string;
  suggestions: IRecoverySuggestion[];
  matchingCluster: IFailureContextCluster | null;
  analyzedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 5: Cross-Instance BPMN Learning
// ═══════════════════════════════════════════════════════════════════

/** Metrics for a single BPMN node across all instances */
export interface INodeMetrics {
  activityId: string;
  activityName: string;
  activityType: string;
  executionCount: number;
  completionRate: number;
  failureRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  retryRate: number;
  retrySuccessRate: number;
  topErrors: Array<{ message: string; count: number }>;
  isHotspot: boolean;
}

/** An execution path taken through the BPMN */
export interface IPathAnalysis {
  pathSignature: string;
  pathDescription: string[];
  frequency: number;
  failureRate: number;
  avgDurationMs: number;
  isHighRisk: boolean;
}

/** Aggregated intelligence for an entire BPMN definition */
export interface IBpmnIntelligence {
  definitionKey: string;
  sampleWindow: string;
  sampleSize: number;
  nodeMetrics: INodeMetrics[];
  commonPaths: IPathAnalysis[];
  overallFailureRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  analyzedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 8: Safety & Validation
// ═══════════════════════════════════════════════════════════════════

export type ValidationSeverity = "info" | "warning" | "blocker";

/** A single validation finding */
export interface IValidationFinding {
  code: string;
  message: string;
  severity: ValidationSeverity;
}

/** Complete validation result for a recovery action */
export interface IRecoveryValidation {
  isValid: boolean;
  findings: IValidationFinding[];
}

// ═══════════════════════════════════════════════════════════════════
// Stacktrace Analysis
// ═══════════════════════════════════════════════════════════════════

/** Software layer where the failure originates */
export type FailureLayer =
  | "data_access"
  | "external_service"
  | "business_logic"
  | "worker"
  | "infrastructure"
  | "configuration"
  | "unknown";

/** A single parsed stack frame */
export interface IStackFrame {
  method: string;
  className: string;
  namespace: string;
  fullMethod: string;
  file: string;
  line: number | null;
  params: string;
  /** True if this frame belongs to a framework/runtime, not application code */
  isFramework: boolean;
}

/** Full stacktrace analysis result */
export interface IStacktraceAnalysis {
  frames: IStackFrame[];
  /** The deepest application-level frame where the error originated */
  rootCauseFrame: IStackFrame | null;
  /** Which software layer the failure comes from */
  failureLayer: FailureLayer;
  /** The specific class/component that failed */
  failureComponent: string;
  /** Whether this looks like a transient error that may resolve on retry */
  isTransient: boolean;
  /** Actionable fix suggestions derived from the trace */
  fixHints: string[];
  /** Condensed call chain in execution order (entry → root cause) */
  callChain: string[];
  /** Human-readable one-line diagnosis */
  summary: string;
}

// ═══════════════════════════════════════════════════════════════════
// Combined Diagnosis Output (Phases 2-5 merged for the UI)
// ═══════════════════════════════════════════════════════════════════

/** The complete diagnosis for an incident — consumed by the Guided Fix Panel */
export interface IIncidentDiagnosis {
  instanceId: string;
  /** Process definition key — needed for ledger lookups and cross-instance learning */
  definitionKey: string;
  incidentId: string;
  failedActivity: {
    id: string;
    name: string;
    type: string;
  };
  errorMessage: string;
  signals: ISignal[];
  riskScore: number;
  matchingCluster: IFailureContextCluster | null;
  suggestions: IRecoverySuggestion[];
  validation: Record<string, IRecoveryValidation>;
  /** Parsed stacktrace analysis for the failed incident (if available) */
  stacktraceAnalysis?: IStacktraceAnalysis;
  analyzedAt: string;
}
