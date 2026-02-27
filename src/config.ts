/**
 * Configuration module — reads environment variables for Camunda connection and server settings.
 * Copy `env.example` to `.env` and fill in your values.
 */

export interface AppConfig {
  /** Camunda REST API base URL, e.g. http://localhost:8080/engine-rest */
  camundaBaseUrl: string;
  /** Basic auth username (optional) */
  camundaUsername?: string;
  /** Basic auth password (optional) */
  camundaPassword?: string;
  /** Bearer token auth (optional — alternative to basic auth) */
  camundaToken?: string;
  /** HTTP request timeout in ms */
  requestTimeout: number;
  /** Default max results for list queries */
  maxResultsDefault: number;
  /** Log level */
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
