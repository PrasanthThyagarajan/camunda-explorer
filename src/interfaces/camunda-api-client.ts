/**
 * Abstraction for the HTTP client used by MCP tools to call the Camunda REST API.
 *
 * SOLID — Dependency Inversion Principle (DIP):
 *   Tool modules depend on this interface (abstraction) rather than
 *   on AxiosInstance (concrete implementation). This allows swapping
 *   the HTTP library without touching any tool code.
 *
 * SOLID — Interface Segregation Principle (ISP):
 *   Only the four HTTP verbs actually used by tools are declared.
 *   Consumers are not forced to depend on dozens of Axios-specific
 *   methods they never call.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ICamundaApiClient {
  /** HTTP GET */
  get(url: string, config?: any): Promise<{ data: any }>;
  /** HTTP POST */
  post(url: string, data?: any, config?: any): Promise<{ data: any }>;
  /** HTTP PUT */
  put(url: string, data?: any, config?: any): Promise<{ data: any }>;
  /** HTTP DELETE */
  delete(url: string, config?: any): Promise<{ data: any }>;
}
