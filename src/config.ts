export interface AppConfig {
  camundaBaseUrl: string;
  camundaUsername?: string;
  camundaPassword?: string;
  camundaToken?: string;
  requestTimeout: number;
  maxResultsDefault: number;
  logLevel: string;
}

export function loadConfig(): AppConfig {
  return {
    camundaBaseUrl:
      process.env.CAMUNDA_BASE_URL || "http://localhost:8080/engine-rest",
    camundaUsername: process.env.CAMUNDA_USERNAME || undefined,
    camundaPassword: process.env.CAMUNDA_PASSWORD || undefined,
    camundaToken: process.env.CAMUNDA_TOKEN || undefined,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || "30000", 10),
    maxResultsDefault: parseInt(
      process.env.MAX_RESULTS_DEFAULT || "100",
      10
    ),
    logLevel: process.env.LOG_LEVEL || "info",
  };
}

export const config = loadConfig();
