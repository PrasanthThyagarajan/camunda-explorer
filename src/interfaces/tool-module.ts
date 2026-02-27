/**
 * Contract for an MCP tool module.
 *
 * SOLID — Open/Closed Principle (OCP):
 *   The tool registry iterates over an array of IToolModule instances.
 *   Adding a new domain (e.g. "signals", "batches") only requires
 *   creating a new module and appending it to the array — the existing
 *   registry code never needs modification.
 *
 * SOLID — Single Responsibility Principle (SRP):
 *   Each IToolModule encapsulates tool registration for one Camunda
 *   domain (incidents, jobs, tasks …). The registry itself only
 *   orchestrates; it doesn't know about individual tool schemas.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ICamundaApiClient } from "./camunda-api-client.js";

export interface IToolModule {
  /** Human-readable name shown in logs (e.g. "Incident tools") */
  readonly name: string;

  /** Register all tools in this module on the MCP server. */
  register(server: McpServer, client: ICamundaApiClient): void;
}
