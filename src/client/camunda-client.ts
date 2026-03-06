import axios, { AxiosInstance, AxiosError } from "axios";
import { AppConfig } from "../config.js";
import { logger } from "../utils/logger.js";

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

export function createCamundaClient(config: AppConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.camundaBaseUrl,
    timeout: config.requestTimeout,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (config.camundaUsername && config.camundaPassword) {
    client.defaults.auth = {
      username: config.camundaUsername,
      password: config.camundaPassword,
    };
    logger.info(
      `Camunda client configured with Basic Auth (user: ${config.camundaUsername})`
    );
  }
  else if (config.camundaToken) {
    client.defaults.headers.common["Authorization"] =
      `Bearer ${config.camundaToken}`;
    logger.info("Camunda client configured with Bearer Token auth");
  } else {
    logger.warn("Camunda client configured WITHOUT authentication");
  }
  client.interceptors.request.use((req) => {
    logger.debug(`→ ${req.method?.toUpperCase()} ${req.baseURL}${req.url}`, {
      params: req.params,
    });
    return req;
  });
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
      logger.error(`Camunda network error: ${error.message}`);
      throw error;
    }
  );

  logger.info(`Camunda client ready → ${config.camundaBaseUrl}`);
  return client;
}

export { cleanParams } from "../utils/clean-params.js";
