/**
 * Interfaces for BPMN and DMN parser results.
 * Pure domain models — framework-independent.
 */

// ── BPMN ────────────────────────────────────────────────────────────

export interface IBpmnFirstActivity {
  startEventId: string;
  firstActivityId: string;
  firstActivityName: string;
}

export interface IBpmnActivity {
  id: string;
  name: string;
  type: string;
  isFirst: boolean;
  order: number;
}

export interface IBpmnActivitiesResult {
  processDefinitionId: string;
  startEventId: string | null;
  firstActivityId: string | null;
  activities: IBpmnActivity[];
}

// ── DMN ─────────────────────────────────────────────────────────────

export interface IDmnInput {
  id: string;
  label: string;
  expression: string;
  typeRef: string;
  camundaType: string;
  sampleValue: unknown;
}

export interface IDmnOutput {
  id: string;
  label: string;
  name: string;
  typeRef: string;
}

export interface IDmnParseResult {
  inputs: IDmnInput[];
  outputs: IDmnOutput[];
  hitPolicy: string;
  decisionName: string;
}

export interface IDmnGroupedField {
  path: string;
  expression: string;
  typeRef: string;
  camundaType: string;
  sampleValue: unknown;
}

export interface IDmnGroupedVariable {
  fields: IDmnGroupedField[];
  isNested: boolean;
}

export interface IDmnInputsResponse {
  decisionKey: string;
  decisionName: string;
  hitPolicy: string;
  inputs: IDmnInput[];
  outputs: IDmnOutput[];
  samplePayload: Record<string, unknown>;
  groupedVariables: Record<string, IDmnGroupedVariable>;
}
