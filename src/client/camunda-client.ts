/**
 * Camunda REST API HTTP client.
 * Wraps axios with auth, timeout, and structured error handling.
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import { AppConfig } from "../config.js";
import { logger } from "../utils/logger.js";

// ── Custom error class for Camunda API errors ──────────────────────

export class CamundaApiError extends Error {
  public statusCode: number;
  public responseBody: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    responseBody: Record<string, unknown>
  ) {
    super(message);
    this.name = "CamundaApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ── Client factory ─────────────────────────────────────────────────

export function createCamundaClient(config: AppConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.camundaBaseUrl,
    timeout: config.requestTimeout,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  // Basic Auth
  if (config.camundaUsername && config.camundaPassword) {
    client.defaults.auth = {
      username: config.camundaUsername,
      password: config.camundaPassword,
    };
    logger.info(
      `Camunda client configured with Basic Auth (user: ${config.camundaUsername})`
    );
  }
  // Bearer Token Auth
  else if (config.camundaToken) {
    client.defaults.headers.common["Authorization"] =
      `Bearer ${config.camundaToken}`;
    logger.info("Camunda client configured with Bearer Token auth");
  } else {
    logger.warn("Camunda client configured WITHOUT authentication");
  }

  // ── Request interceptor (logging) ────────────────────────────────
  client.interceptors.request.use((req) => {
    logger.debug(`→ ${req.method?.toUpperCase()} ${req.baseURL}${req.url}`, {
      params: req.params,
    });
    return req;
  });

  // ── Response interceptor (error mapping) ─────────────────────────
  client.interceptors.response.use(
    (response) => {
      logger.debug(
        `← ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`
      );
      return response;
    },
    (error: AxiosError) => {
      if (error.response) {
        const { status, data } = error.response;
        const body =
          typeof data === "object" && data !== null
            ? (data as Record<string, unknown>)
            : { message: String(data) };
        logger.error(`Camunda API error ${status}`, body);
        throw new CamundaApiError(
          `Camunda API error ${status}: ${body.message ?? JSON.stringify(body)}`,
          status,
          body
        );
      }
      // Network / timeout errors
      logger.error(`Camunda network error: ${error.message}`);
      throw error;
    }
  );

  logger.info(`Camunda client ready → ${config.camundaBaseUrl}`);
  return client;
}

// ── Re-export cleanParams from its new home in utils ────────────────
// Kept here for backward compatibility; prefer importing from utils/clean-params.
export { cleanParams } from "../utils/clean-params.js";
