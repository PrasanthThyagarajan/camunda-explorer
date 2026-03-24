import type { IBpmnActivity } from "./parsers.js";

/** A single active execution token in a process instance */
export interface IActiveToken {
  activityId: string;
  activityName: string;
  activityType: string;
  activityInstanceId: string;
  hasIncident: boolean;
  incidentMessage?: string;
}

/** Activity enriched with runtime execution status */
export interface IEnrichedActivity extends IBpmnActivity {
  status: "completed" | "active" | "failed" | "not_reached";
  startTime?: string;
  endTime?: string;
  duration?: number;
  incidentMessage?: string;
}

/** Full context for a process instance — used by the modify dialog */
export interface IInstanceContext {
  instance: {
    id: string;
    definitionId: string;
    businessKey: string | null;
    suspended: boolean;
  };
  activeTokens: IActiveToken[];
  activities: IEnrichedActivity[];
  incidents: Array<{
    id: string;
    activityId: string;
    incidentType: string;
    incidentMessage: string;
    configuration: string | null;
  }>;
  variableCount: number;
  hasSubProcesses: boolean;
  firstActivityId: string | null;
}

/** Result from a single instance modification */
export interface IModifyResult {
  instanceId: string;
  status: "success" | "error";
  message: string;
  previousPositions?: string[];
  newPositions?: string[];
  incidentsCleaned?: number;
}

/** Summary for batch instance modifications */
export interface IInstanceBatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: IModifyResult[];
}

// ── History Track types ──────────────────────────────────────────

/** A single step in the process execution track */
export interface IHistoryStep {
  activityInstanceId: string;
  activityId: string;
  activityName: string;
  activityType: string;
  status: "completed" | "active" | "failed" | "canceled";
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  calledProcessInstanceId: string | null;
  taskId: string | null;
  incidents: Array<{
    id: string;
    type: string;
    message: string;
    createTime: string;
    endTime: string | null;
    resolved: boolean;
  }>;
}

/** Full process execution track for any instance (running or completed) */
export interface IHistoryTrack {
  instance: {
    id: string;
    definitionId: string;
    definitionKey: string;
    definitionName: string | null;
    businessKey: string | null;
    state: string;
    startTime: string;
    endTime: string | null;
    durationMs: number | null;
  };
  steps: IHistoryStep[];
  variables: Array<{
    name: string;
    type: string;
    value: unknown;
    activityInstanceId: string | null;
  }>;
  userOperations: Array<{
    id: string;
    operationType: string;
    property: string | null;
    orgValue: string | null;
    newValue: string | null;
    userId: string | null;
    timestamp: string;
  }>;
  summary: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    activeSteps: number;
    totalIncidents: number;
    resolvedIncidents: number;
  };
}
