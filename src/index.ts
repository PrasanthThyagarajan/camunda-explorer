#!/usr/bin/env node

/**
 * Camunda MCP Server — Entry Point
 *
 * An MCP (Model Context Protocol) server that exposes Camunda Platform v7.16.0
 * REST API operations as discoverable tools for AI agents.
 *
 * Capabilities:
 *   • Analyse & manage incidents (list, resolve, annotate)
 *   • Modify process instances (retry, move to initial block, cancel/start activities)
 *   • Evaluate DMN decision tables with arbitrary inputs
 *   • Full process lifecycle: definitions, instances, tasks, jobs, deployments, history
 *
 * Transport: STDIO (for Cursor / Claude Desktop integration)
 *
 * Usage:
 *   CAMUNDA_BASE_URL=http://localhost:8080/engine-rest node dist/index.js
 */

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
  // ── Configure logging ────────────────────────────────────────────
  setLogLevel(config.logLevel);

  logger.info("╔══════════════════════════════════════════════════════════╗");
  logger.info("║         Camunda MCP Server  v1.0.0                      ║");
  logger.info("║         Target: Camunda Platform v7.16.0                ║");
  logger.info("╚══════════════════════════════════════════════════════════╝");
  logger.info(`Camunda Base URL : ${config.camundaBaseUrl}`);
  logger.info(`Auth             : ${config.camundaUsername ? "Basic" : config.camundaToken ? "Bearer" : "None"}`);
  logger.info(`Timeout          : ${config.requestTimeout}ms`);
  logger.info(`Log Level        : ${config.logLevel}`);

  // ── Create Camunda HTTP client (implements ICamundaApiClient) ────
  const camundaClient: ICamundaApiClient = createCamundaClient(config);

  // ── Create MCP Server ────────────────────────────────────────────
  const server = new McpServer({
    name: "camunda-mcp-server",
    version: "1.0.0",
  });

  // ── Register all capabilities ────────────────────────────────────
  registerAllTools(server, camundaClient);
  registerAllResources(server, camundaClient);
  registerAllPrompts(server);

  // ── Start STDIO transport ────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP Server is running on STDIO transport. Ready for connections.");

  // ── Graceful shutdown ────────────────────────────────────────────
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
  logger.error("Fatal error starting Camunda MCP Server:", error);
  process.exit(1);
});
