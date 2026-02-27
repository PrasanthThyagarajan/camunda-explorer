/**
 * MCP Resources — exposes Camunda artifacts (BPMN XML, DMN XML) as browsable resources.
 *
 * SOLID — DIP: Depends on ICamundaApiClient, not AxiosInstance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ICamundaApiClient } from "../interfaces/index.js";
import { logger } from "../utils/logger.js";

export function registerAllResources(
  server: McpServer,
  client: ICamundaApiClient
): void {
  logger.info("Registering MCP resources...");

  // ── BPMN XML Resource (by process definition ID) ────────────────────
  server.resource(
    "bpmn-xml",
    "camunda://process-definition/{definitionId}/xml",
    {
      description:
        "BPMN 2.0 XML of a deployed process definition. Use the process definition ID from camunda_list_process_definitions.",
      mimeType: "application/xml",
    },
    async (uri) => {
      const parts = uri.pathname.split("/").filter(Boolean);
      // URI: camunda://process-definition/{definitionId}/xml
      const definitionId = parts[1]; // after "process-definition"
      try {
        const response = await client.get(
          `/process-definition/${definitionId}/xml`
        );
        const data = response.data as { id: string; bpmn20Xml: string };
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/xml",
              text: data.bpmn20Xml,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Error fetching BPMN XML: ${msg}`,
            },
          ],
        };
      }
    }
  );

  // ── DMN XML Resource (by decision definition ID) ────────────────────
  server.resource(
    "dmn-xml",
    "camunda://decision-definition/{definitionId}/xml",
    {
      description:
        "DMN XML of a deployed decision definition. Use the decision definition ID from camunda_list_decision_definitions.",
      mimeType: "application/xml",
    },
    async (uri) => {
      const parts = uri.pathname.split("/").filter(Boolean);
      const definitionId = parts[1];
      try {
        const response = await client.get(
          `/decision-definition/${definitionId}/xml`
        );
        const data = response.data as { id: string; dmnXml: string };
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/xml",
              text: data.dmnXml,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Error fetching DMN XML: ${msg}`,
            },
          ],
        };
      }
    }
  );

  logger.info("  ✓ BPMN XML resource registered");
  logger.info("  ✓ DMN XML resource registered");
}
