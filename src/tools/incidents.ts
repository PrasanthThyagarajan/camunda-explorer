import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const incidentTools: IToolModule = {
  name: "Incident tools",

  register(server, client) {
    server.tool(
      "camunda_list_incidents",
      "List active incidents from Camunda engine with optional filters. Use this first to analyse what incidents exist.",
      {
        incidentType: z
          .string()
          .optional()
          .describe("Filter by type: failedJob, failedExternalTask"),
        processDefinitionId: z.string().optional().describe("Filter by process definition ID"),
        processDefinitionKeyIn: z
          .string()
          .optional()
          .describe("Comma-separated process definition keys to filter"),
        processInstanceId: z.string().optional().describe("Filter by process instance ID"),
        executionId: z.string().optional().describe("Filter by execution ID"),
        activityId: z.string().optional().describe("Filter by activity ID"),
        failedActivityId: z.string().optional().describe("Filter by the ID of the activity the incident is associated with"),
        causeIncidentId: z.string().optional().describe("Filter by cause incident ID"),
        rootCauseIncidentId: z.string().optional().describe("Filter by root cause incident ID"),
        incidentMessage: z.string().optional().describe("Filter by message substring"),
        incidentMessageLike: z.string().optional().describe("Filter by message LIKE pattern"),
        jobDefinitionIdIn: z.string().optional().describe("Comma-separated job definition IDs"),
        sortBy: z
          .enum([
            "incidentId",
            "incidentMessage",
            "incidentTimestamp",
            "incidentType",
            "executionId",
            "activityId",
            "processInstanceId",
            "processDefinitionId",
            "causeIncidentId",
            "rootCauseIncidentId",
            "configuration",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional().describe("Pagination offset (0-based)"),
        maxResults: z.number().optional().describe("Maximum number of results"),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/incident", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "incidents", [
          "id",
          "incidentType",
          "incidentMessage",
          "processInstanceId",
          "activityId",
          "incidentTimestamp",
        ]);
        return formatResponse(data, summary);
      })
    );

    server.tool(
      "camunda_get_incident",
      "Get full details of a single incident by its ID.",
      {
        incidentId: z.string().describe("The incident ID"),
      },
      safeToolHandler(async ({ incidentId }) => {
        const response = await client.get(`/incident/${incidentId}`);
        return formatResponse(response.data);
      })
    );

    server.tool(
      "camunda_count_incidents",
      "Get count of incidents matching the given filters.",
      {
        incidentType: z.string().optional().describe("Filter by type"),
        processDefinitionId: z.string().optional(),
        processDefinitionKeyIn: z.string().optional(),
        processInstanceId: z.string().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/incident/count", {
          params: cleanParams(params),
        });
        return formatResponse(
          response.data,
          `Incident count: ${(response.data as { count: number }).count}`
        );
      })
    );

    server.tool(
      "camunda_resolve_incident",
      "Resolve an incident by deleting it. WARNING: This is a destructive action. The incident will be permanently removed.",
      {
        incidentId: z.string().describe("The incident ID to resolve/delete"),
      },
      safeToolHandler(async ({ incidentId }) => {
        await client.delete(`/incident/${incidentId}`);
        return formatResponse(
          null,
          `Incident ${incidentId} has been resolved (deleted).`
        );
      })
    );

    server.tool(
      "camunda_annotate_incident",
      "Set an annotation/note on an incident for documentation purposes.",
      {
        incidentId: z.string().describe("The incident ID"),
        annotation: z.string().describe("Annotation text to attach"),
      },
      safeToolHandler(async ({ incidentId, annotation }) => {
        await client.put(`/incident/${incidentId}/annotation`, { annotation });
        return formatResponse(
          null,
          `Annotation set on incident ${incidentId}.`
        );
      })
    );

    server.tool(
      "camunda_clear_incident_annotation",
      "Remove the annotation from an incident.",
      {
        incidentId: z.string().describe("The incident ID"),
      },
      safeToolHandler(async ({ incidentId }) => {
        await client.delete(`/incident/${incidentId}/annotation`);
        return formatResponse(
          null,
          `Annotation cleared from incident ${incidentId}.`
        );
      })
    );
  },
};
