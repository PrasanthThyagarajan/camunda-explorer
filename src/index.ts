#!/usr/bin/env node

import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { config } from "./config.js";
import { createCamundaClient } from "./client/camunda-client.js";
import { ICamundaApiClient } from "./interfaces/index.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { logger, setLogLevel } from "./utils/logger.js";

async function main(): Promise<void> {
  setLogLevel(config.logLevel);

  logger.info("╔══════════════════════════════════════════════════════════╗");
  logger.info("║         Camunda Explorer — MCP Server  v1.0.0           ║");
  logger.info("║         Target: Camunda Platform v7.16.0                ║");
  logger.info("╚══════════════════════════════════════════════════════════╝");
  logger.info(`Camunda Base URL : ${config.camundaBaseUrl}`);
  logger.info(`Auth             : ${config.camundaUsername ? "Basic" : config.camundaToken ? "Bearer" : "None"}`);
  logger.info(`Timeout          : ${config.requestTimeout}ms`);
  logger.info(`Log Level        : ${config.logLevel}`);

  const camundaClient: ICamundaApiClient = createCamundaClient(config);

  const server = new McpServer({
    name: "camunda-explorer",
    version: "1.0.0",
  });

  registerAllTools(server, camundaClient);
  registerAllResources(server, camundaClient);
  registerAllPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP Server is running on STDIO transport. Ready for connections.");

  process.on("SIGINT", async () => {
    logger.info("Shutting down...");
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Shutting down...");
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error("Fatal error starting Camunda Explorer:", error);
  process.exit(1);
});
