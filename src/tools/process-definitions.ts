import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const processDefinitionTools: IToolModule = {
  name: "Process Definition tools",

  register(server, client) {    server.tool(
      "camunda_list_process_definitions",
      "List deployed process definitions with optional filters.",
      {
        key: z.string().optional().describe("Filter by process definition key"),
        keyLike: z.string().optional(),
        name: z.string().optional(),
        nameLike: z.string().optional(),
        deploymentId: z.string().optional(),
        category: z.string().optional(),
        categoryLike: z.string().optional(),
        version: z.number().optional(),
        latestVersion: z.boolean().optional().describe("Only latest versions"),
        active: z.boolean().optional(),
        suspended: z.boolean().optional(),
        incidentType: z.string().optional(),
        tenantIdIn: z.string().optional(),
        withoutTenantId: z.boolean().optional(),
        startableInTasklist: z.boolean().optional(),
        notStartableInTasklist: z.boolean().optional(),
        startablePermissionCheck: z.boolean().optional(),
        sortBy: z
          .enum([
            "category",
            "key",
            "id",
            "name",
            "version",
            "deploymentId",
            "deployTime",
            "tenantId",
            "versionTag",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/process-definition", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "process definitions", [
          "id",
          "key",
          "name",
          "version",
          "suspended",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_get_process_definition",
      "Get a process definition by its deployment ID.",
      {
        processDefinitionId: z.string().describe("Process definition ID"),
      },
      safeToolHandler(async ({ processDefinitionId }) => {
        const response = await client.get(
          `/process-definition/${processDefinitionId}`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_process_definition_by_key",
      "Get the latest version of a process definition by its key.",
      {
        processDefinitionKey: z.string().describe("Process definition key"),
      },
      safeToolHandler(async ({ processDefinitionKey }) => {
        const response = await client.get(
          `/process-definition/key/${processDefinitionKey}`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_start_process_instance",
      "Start a new process instance from a process definition key. Optionally pass initial variables and a business key.",
      {
        processDefinitionKey: z
          .string()
          .describe("Process definition key to start"),
        variables: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .optional()
          .describe("Initial variables keyed by name"),
        businessKey: z.string().optional().describe("Business key for the instance"),
        withVariablesInReturn: z
          .boolean()
          .optional()
          .describe("Return variables in the response (default: false)"),
      },
      safeToolHandler(async ({
        processDefinitionKey,
        variables,
        businessKey,
        withVariablesInReturn,
      }) => {
        const body: Record<string, unknown> = {};
        if (variables) body.variables = variables;
        if (businessKey) body.businessKey = businessKey;
        if (withVariablesInReturn !== undefined)
          body.withVariablesInReturn = withVariablesInReturn;

        const response = await client.post(
          `/process-definition/key/${processDefinitionKey}/start`,
          body
        );
        return formatResponse(
          response.data,
          `Process instance started from definition '${processDefinitionKey}'. Instance ID: ${(response.data as Record<string, unknown>).id}`
        );
      })
    );    server.tool(
      "camunda_start_process_instance_by_id",
      "Start a new process instance from a specific process definition ID.",
      {
        processDefinitionId: z.string().describe("Process definition ID"),
        variables: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .optional(),
        businessKey: z.string().optional(),
        withVariablesInReturn: z.boolean().optional(),
      },
      safeToolHandler(async ({
        processDefinitionId,
        variables,
        businessKey,
        withVariablesInReturn,
      }) => {
        const body: Record<string, unknown> = {};
        if (variables) body.variables = variables;
        if (businessKey) body.businessKey = businessKey;
        if (withVariablesInReturn !== undefined)
          body.withVariablesInReturn = withVariablesInReturn;

        const response = await client.post(
          `/process-definition/${processDefinitionId}/start`,
          body
        );
        return formatResponse(
          response.data,
          `Process instance started. ID: ${(response.data as Record<string, unknown>).id}`
        );
      })
    );    server.tool(
      "camunda_get_process_xml",
      "Get the BPMN 2.0 XML of a process definition. Useful for understanding the process flow and available activity IDs.",
      {
        processDefinitionId: z.string().describe("Process definition ID"),
      },
      safeToolHandler(async ({ processDefinitionId }) => {
        const response = await client.get(
          `/process-definition/${processDefinitionId}/xml`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_process_xml_by_key",
      "Get BPMN 2.0 XML of the latest process definition version by key.",
      {
        processDefinitionKey: z.string().describe("Process definition key"),
      },
      safeToolHandler(async ({ processDefinitionKey }) => {
        const response = await client.get(
          `/process-definition/key/${processDefinitionKey}/xml`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_process_statistics",
      "Get runtime statistics for all process definitions (instance counts, incidents, failed jobs). Great for an overview of engine health.",
      {
        failedJobs: z
          .boolean()
          .optional()
          .describe("Include failed job counts (default: false)"),
        incidents: z
          .boolean()
          .optional()
          .describe("Include incident counts (default: false)"),
        incidentsForType: z
          .string()
          .optional()
          .describe("Only count incidents of a specific type"),
        rootIncidents: z.boolean().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/process-definition/statistics", {
          params: cleanParams(params),
        });
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_activity_statistics",
      "Get runtime statistics per activity for a specific process definition. Shows how many instances are at each activity.",
      {
        processDefinitionId: z.string().describe("Process definition ID"),
        failedJobs: z.boolean().optional(),
        incidents: z.boolean().optional(),
        incidentsForType: z.string().optional(),
      },
      safeToolHandler(async ({ processDefinitionId, ...params }) => {
        const response = await client.get(
          `/process-definition/${processDefinitionId}/statistics`,
          { params: cleanParams(params) }
        );
        return formatResponse(response.data);
      })
    );
  },
};
