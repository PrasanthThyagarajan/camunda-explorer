export const DEFAULT_DASHBOARD_PORT = 3333;
export const JSON_BODY_LIMIT = "10mb";

export const DEFAULT_BASE_URL = "http://localhost:8080/engine-rest";
export const DEFAULT_REQUEST_TIMEOUT = 30000;
export const MODIFICATION_REQUEST_TIMEOUT = 120000;
export const CONNECTION_TEST_TIMEOUT = 10000;
export const DEFAULT_MAX_RESULTS = 100;

export const DEFAULT_BATCH_SIZE = 10;
export const MAX_INCIDENTS_FETCH = 2000;
export const DEFAULT_RETRY_COUNT = 1;

export const MAX_GATEWAY_TRAVERSAL_HOPS = 10;
export const BPMN_ACTIVITY_TYPES = [
  "serviceTask",
  "userTask",
  "sendTask",
  "receiveTask",
  "scriptTask",
  "businessRuleTask",
  "manualTask",
  "task",
  "subProcess",
  "callActivity",
  "intermediateCatchEvent",
  "intermediateThrowEvent",
] as const;

export const BPMN_GATEWAY_TYPES = [
  "exclusiveGateway",
  "parallelGateway",
  "inclusiveGateway",
  "eventBasedGateway",
  "complexGateway",
] as const;

export const BPMN_EVENT_TYPES = ["startEvent", "endEvent"] as const;

export const DMN_TYPE_MAP: Record<string, { camundaType: string; sampleValue: unknown }> = {
  string:  { camundaType: "String",  sampleValue: "" },
  integer: { camundaType: "Integer", sampleValue: 0 },
  long:    { camundaType: "Long",    sampleValue: 0 },
  double:  { camundaType: "Double",  sampleValue: 0.0 },
  boolean: { camundaType: "Boolean", sampleValue: false },
  date:    { camundaType: "Date",    sampleValue: "2026-01-01T00:00:00.000+0000" },
};

export const DEFAULT_ENV_COLOR = "#3b82f6";
export const PASSWORD_MASK = "••••••••";
export const ENV_FILE_NAME = "environments.json";
