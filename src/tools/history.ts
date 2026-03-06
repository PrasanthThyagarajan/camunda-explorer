import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const historyTools: IToolModule = {
  name: "History tools",

  register(server, client) {    server.tool(
      "camunda_list_historic_process_instances",
      "List historic process instances (completed, cancelled, or still running).",
      {
        processDefinitionId: z.string().optional(),
        processDefinitionKey: z.string().optional(),
        processDefinitionKeyIn: z.string().optional(),
        processInstanceId: z.string().optional(),
        processInstanceIds: z.string().optional().describe("Comma-separated IDs"),
        businessKey: z.string().optional(),
        businessKeyLike: z.string().optional(),
        finished: z.boolean().optional().describe("Only finished instances"),
        unfinished: z.boolean().optional().describe("Only still-running instances"),
        withIncidents: z.boolean().optional(),
        incidentStatus: z.enum(["open", "resolved"]).optional(),
        startedBefore: z.string().optional().describe("ISO 8601"),
        startedAfter: z.string().optional().describe("ISO 8601"),
        finishedBefore: z.string().optional(),
        finishedAfter: z.string().optional(),
        superProcessInstanceId: z.string().optional(),
        rootProcessInstances: z.boolean().optional(),
        sortBy: z
          .enum([
            "instanceId",
            "definitionId",
            "definitionKey",
            "definitionName",
            "definitionVersion",
            "businessKey",
            "startTime",
            "endTime",
            "duration",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/history/process-instance", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "historic process instances", [
          "id",
          "processDefinitionKey",
          "state",
          "startTime",
          "endTime",
          "durationInMillis",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_get_historic_process_instance",
      "Get a historic process instance by ID with all details.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
      },
      safeToolHandler(async ({ processInstanceId }) => {
        const response = await client.get(
          `/history/process-instance/${processInstanceId}`
        );
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_list_historic_activities",
      "List historic activity instances for audit trail. Shows which activities were executed and when.",
      {
        processInstanceId: z.string().optional(),
        processDefinitionId: z.string().optional(),
        activityId: z.string().optional(),
        activityName: z.string().optional(),
        activityType: z.string().optional().describe("e.g. serviceTask, userTask, startEvent, endEvent"),
        finished: z.boolean().optional(),
        unfinished: z.boolean().optional(),
        canceled: z.boolean().optional(),
        sortBy: z
          .enum([
            "activityInstanceId",
            "instanceId",
            "executionId",
            "activityId",
            "activityName",
            "activityType",
            "startTime",
            "endTime",
            "duration",
            "definitionId",
            "occurrence",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/history/activity-instance", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "historic activities", [
          "activityId",
          "activityName",
          "activityType",
          "startTime",
          "endTime",
          "canceled",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_list_historic_variables",
      "List historic variable instances. Useful for understanding what data flowed through a process.",
      {
        processInstanceId: z.string().optional(),
        processInstanceIdIn: z.string().optional(),
        processDefinitionId: z.string().optional(),
        processDefinitionKey: z.string().optional(),
        variableName: z.string().optional(),
        variableNameLike: z.string().optional(),
        variableValue: z.any().optional(),
        activityInstanceIdIn: z.string().optional(),
        sortBy: z.enum(["instanceId", "variableName"]).optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/history/variable-instance", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "historic variables", [
          "name",
          "type",
          "value",
          "processInstanceId",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_list_historic_incidents",
      "List historic incidents (both open and resolved). For full incident audit trail.",
      {
        processInstanceId: z.string().optional(),
        processDefinitionId: z.string().optional(),
        processDefinitionKey: z.string().optional(),
        processDefinitionKeyIn: z.string().optional(),
        incidentType: z.string().optional(),
        open: z.boolean().optional().describe("Only open incidents"),
        resolved: z.boolean().optional().describe("Only resolved incidents"),
        deleted: z.boolean().optional(),
        activityId: z.string().optional(),
        failedActivityId: z.string().optional(),
        sortBy: z
          .enum([
            "incidentId",
            "incidentMessage",
            "createTime",
            "endTime",
            "incidentType",
            "executionId",
            "activityId",
            "processInstanceId",
            "processDefinitionId",
            "processDefinitionKey",
            "causeIncidentId",
            "rootCauseIncidentId",
            "configuration",
            "tenantId",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/history/incident", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "historic incidents", [
          "id",
          "incidentType",
          "incidentMessage",
          "activityId",
          "createTime",
          "endTime",
          "open",
          "resolved",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_delete_historic_process_instance",
      "Delete a historic process instance and all related history data. WARNING: Irreversible.",
      {
        processInstanceId: z.string().describe("Historic process instance ID"),
        failIfNotExists: z.boolean().optional(),
      },
      safeToolHandler(async ({ processInstanceId, failIfNotExists }) => {
        await client.delete(
          `/history/process-instance/${processInstanceId}`,
          {
            params: cleanParams({ failIfNotExists }),
          }
        );
        return formatResponse(
          null,
          `Historic process instance ${processInstanceId} deleted.`
        );
      })
    );
  },
};
