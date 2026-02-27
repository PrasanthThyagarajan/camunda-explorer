/**
 * Tool Registry — registers all Camunda MCP tools on the server.
 *
 * SOLID — Open/Closed Principle (OCP):
 *   Adding a new tool domain only requires:
 *     1. Creating a new IToolModule implementation
 *     2. Appending it to the `modules` array below
 *   No existing code is modified.
 *
 * SOLID — Dependency Inversion Principle (DIP):
 *   All modules depend on ICamundaApiClient (abstraction),
 *   not on AxiosInstance (concrete).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ICamundaApiClient, IToolModule } from "../interfaces/index.js";
import { logger } from "../utils/logger.js";

// ── Import tool modules ─────────────────────────────────────────────
import { incidentTools } from "./incidents.js";
import { processInstanceTools } from "./process-instances.js";
import { decisionDefinitionTools } from "./decision-definitions.js";
import { processDefinitionTools } from "./process-definitions.js";
import { taskTools } from "./tasks.js";
import { deploymentTools } from "./deployments.js";
import { jobTools } from "./jobs.js";
import { executionTools } from "./executions.js";
import { historyTools } from "./history.js";
import { externalTaskTools } from "./external-tasks.js";

/**
 * Ordered list of tool modules.
 * To add a new domain, create an IToolModule and append here.
 */
const modules: IToolModule[] = [
  // Priority 1 — Core
  incidentTools,
  processInstanceTools,
  decisionDefinitionTools,

  // Priority 2 — Extended
  processDefinitionTools,
  taskTools,
  deploymentTools,
  jobTools,
  executionTools,

  // Priority 3 — History & External Tasks
  historyTools,
  externalTaskTools,
];

export function registerAllTools(
  server: McpServer,
  client: ICamundaApiClient
): void {
  logger.info("Registering MCP tools...");

  for (const mod of modules) {
    mod.register(server, client);
    logger.info(`  ✓ ${mod.name} registered`);
  }

  logger.info(`All MCP tools registered successfully (${modules.length} modules).`);
}
