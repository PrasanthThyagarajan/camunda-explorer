import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const deploymentTools: IToolModule = {
  name: "Deployment tools",

  register(server, client) {    server.tool(
      "camunda_list_deployments",
      "List deployments in the Camunda engine.",
      {
        id: z.string().optional(),
        name: z.string().optional(),
        nameLike: z.string().optional(),
        after: z.string().optional().describe("ISO 8601 date — deployments after"),
        before: z.string().optional().describe("ISO 8601 date — deployments before"),
        tenantIdIn: z.string().optional(),
        withoutTenantId: z.boolean().optional(),
        sortBy: z.enum(["id", "name", "deploymentTime", "tenantId"]).optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/deployment", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "deployments", [
          "id",
          "name",
          "deploymentTime",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_get_deployment",
      "Get a deployment by ID.",
      {
        deploymentId: z.string().describe("Deployment ID"),
      },
      safeToolHandler(async ({ deploymentId }) => {
        const response = await client.get(`/deployment/${deploymentId}`);
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_get_deployment_resources",
      "List all resources (BPMN, DMN, forms, etc.) within a deployment.",
      {
        deploymentId: z.string().describe("Deployment ID"),
      },
      safeToolHandler(async ({ deploymentId }) => {
        const response = await client.get(
          `/deployment/${deploymentId}/resources`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_delete_deployment",
      "Delete a deployment. WARNING: Can also delete running process instances if cascade is true.",
      {
        deploymentId: z.string().describe("Deployment ID"),
        cascade: z
          .boolean()
          .optional()
          .describe("If true, also deletes running instances and history (default: false)"),
        skipCustomListeners: z.boolean().optional(),
        skipIoMappings: z.boolean().optional(),
      },
      safeToolHandler(async ({ deploymentId, cascade, skipCustomListeners, skipIoMappings }) => {
        await client.delete(`/deployment/${deploymentId}`, {
          params: cleanParams({ cascade, skipCustomListeners, skipIoMappings }),
        });
        return formatResponse(null, `Deployment ${deploymentId} deleted.`);
      })
    );
  },
};
