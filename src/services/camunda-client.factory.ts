/**
 * Camunda HTTP Client Factory — Infrastructure layer.
 *
 * Creates axios instances configured for a specific Camunda environment.
 * Used by both the dashboard proxy and the action services.
 *
 * SRP: Sole responsibility is HTTP client instantiation.
 */

import axios, { AxiosInstance } from "axios";
import type { ICamundaEnvironment } from "../interfaces/environment.js";
import { DEFAULT_REQUEST_TIMEOUT, CONNECTION_TEST_TIMEOUT } from "../constants.js";

/**
 * Build an authenticated axios client for a Camunda environment.
 */
export function buildCamundaClient(env: ICamundaEnvironment): AxiosInstance {
  return axios.create({
    baseURL: env.baseUrl,
    timeout: DEFAULT_REQUEST_TIMEOUT,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    auth:
      env.username && env.password
        ? { username: env.username, password: env.password }
        : undefined,
  });
}

/**
 * Build a lightweight client for connection testing.
 */
export function buildTestClient(
  baseUrl: string,
  username?: string,
  password?: string
): AxiosInstance {
  return axios.create({
    baseURL: baseUrl,
    timeout: CONNECTION_TEST_TIMEOUT,
    auth: username && password ? { username, password } : undefined,
  });
}
