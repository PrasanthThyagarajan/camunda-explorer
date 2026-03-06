import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const decisionDefinitionTools: IToolModule = {
  name: "Decision Definition (DMN) tools",

  register(server, client) {    server.tool(
      "camunda_list_decision_definitions",
      "List all deployed DMN decision definitions. Use this to discover available DMN tables before evaluation.",
      {
        key: z.string().optional().describe("Filter by decision definition key"),
        keyLike: z.string().optional().describe("Filter by key LIKE pattern"),
        name: z.string().optional().describe("Filter by name"),
        nameLike: z.string().optional().describe("Filter by name LIKE pattern"),
        deploymentId: z.string().optional(),
        decisionRequirementsDefinitionId: z.string().optional(),
        decisionRequirementsDefinitionKey: z.string().optional(),
        category: z.string().optional(),
        categoryLike: z.string().optional(),
        version: z.number().optional().describe("Filter by specific version"),
        latestVersion: z.boolean().optional().describe("Only return latest versions"),
        resourceName: z.string().optional(),
        resourceNameLike: z.string().optional(),
        tenantIdIn: z.string().optional(),
        withoutTenantId: z.boolean().optional(),
        includeDecisionDefinitionsWithoutTenantId: z.boolean().optional(),
        versionTag: z.string().optional(),
        versionTagLike: z.string().optional(),
        sortBy: z
          .enum([
            "category",
            "decisionRequirementsDefinitionKey",
            "key",
            "id",
            "name",
            "version",
            "deploymentId",
            "tenantId",
            "versionTag",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/decision-definition", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "decision definitions", [
          "id",
          "key",
          "name",
          "version",
          "deploymentId",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_get_decision_definition",
      "Get a decision definition by its deployment ID.",
      {
        decisionDefinitionId: z.string().describe("Decision definition ID"),
      },
      safeToolHandler(async ({ decisionDefinitionId }) => {
        const response = await client.get(
          `/decision-definition/${decisionDefinitionId}`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_decision_definition_by_key",
      "Get the latest version of a decision definition by its key.",
      {
        decisionKey: z.string().describe("Decision definition key"),
      },
      safeToolHandler(async ({ decisionKey }) => {
        const response = await client.get(
          `/decision-definition/key/${decisionKey}`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_evaluate_decision_by_key",
      `Evaluate a DMN decision table by its key with input variables.
The variables object should be keyed by variable name, each with { value, type }.
Supported types: String, Integer, Long, Double, Boolean, Date, Json, Xml, Object.
Returns an array of result objects (one per matched rule).
Example input: { "amount": { "value": 600, "type": "Double" }, "category": { "value": "Misc", "type": "String" } }`,
      {
        decisionKey: z.string().describe("Decision definition key (from DMN model)"),
        variables: z
          .record(
            z.object({
              value: z.any().describe("The variable value"),
              type: z
                .string()
                .optional()
                .describe("Camunda type (String, Integer, Double, Boolean, etc.)"),
            })
          )
          .describe("Input variables keyed by name"),
      },
      safeToolHandler(async ({ decisionKey, variables }) => {
        const response = await client.post(
          `/decision-definition/key/${decisionKey}/evaluate`,
          { variables }
        );
        const results = response.data;
        return formatResponse(
          results,
          `DMN '${decisionKey}' evaluated — ${Array.isArray(results) ? results.length : 0} rule(s) matched.`
        );
      })
    );    server.tool(
      "camunda_evaluate_decision_by_id",
      "Evaluate a DMN decision table by its deployment ID. Use when you need a specific version rather than the latest.",
      {
        decisionDefinitionId: z.string().describe("Decision definition ID"),
        variables: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .describe("Input variables keyed by name"),
      },
      safeToolHandler(async ({ decisionDefinitionId, variables }) => {
        const response = await client.post(
          `/decision-definition/${decisionDefinitionId}/evaluate`,
          { variables }
        );
        return formatResponse(
          response.data,
          `DMN evaluated — ${Array.isArray(response.data) ? response.data.length : 0} rule(s) matched.`
        );
      })
    );    server.tool(
      "camunda_evaluate_decision_by_key_tenant",
      "Evaluate a DMN decision table by key and tenant ID (for multi-tenant setups).",
      {
        decisionKey: z.string().describe("Decision definition key"),
        tenantId: z.string().describe("Tenant ID"),
        variables: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .describe("Input variables keyed by name"),
      },
      safeToolHandler(async ({ decisionKey, tenantId, variables }) => {
        const response = await client.post(
          `/decision-definition/key/${decisionKey}/tenant-id/${tenantId}/evaluate`,
          { variables }
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_decision_xml",
      "Get the DMN XML of a decision definition by ID. Useful for understanding inputs/outputs before evaluation.",
      {
        decisionDefinitionId: z.string().describe("Decision definition ID"),
      },
      safeToolHandler(async ({ decisionDefinitionId }) => {
        const response = await client.get(
          `/decision-definition/${decisionDefinitionId}/xml`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_decision_xml_by_key",
      "Get the DMN XML of the latest version of a decision definition by its key.",
      {
        decisionKey: z.string().describe("Decision definition key"),
      },
      safeToolHandler(async ({ decisionKey }) => {
        const response = await client.get(
          `/decision-definition/key/${decisionKey}/xml`
        );
        return formatResponse(response.data);
      })
    );
  },
};
