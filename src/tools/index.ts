import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ICamundaApiClient, IToolModule } from "../interfaces/index.js";
import { logger } from "../utils/logger.js";

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

const modules: IToolModule[] = [
  incidentTools,
  processInstanceTools,
  decisionDefinitionTools,
  processDefinitionTools,
  taskTools,
  deploymentTools,
  jobTools,
  executionTools,
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
