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

export interface IBpmnFormField {
  id: string;
  label: string;
  type: string;
  defaultValue: string;
  enumValues: Array<{ id: string; name: string }>;
}

export interface IBpmnStartFormResult {
  processDefinitionKey: string;
  processDefinitionName: string;
  hasFormFields: boolean;
  formFields: IBpmnFormField[];
  samplePayload: Record<string, unknown>;
}
