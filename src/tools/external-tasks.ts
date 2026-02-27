/**
 * MCP Tools — External Task Management
 *
 * Camunda 7.16 REST API: /external-task
 */

import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const externalTaskTools: IToolModule = {
  name: "External Task tools",

  register(server, client) {
    // ── List External Tasks ─────────────────────────────────────────────
    server.tool(
      "camunda_list_external_tasks",
      "List external tasks with optional filters.",
      {
        processInstanceId: z.string().optional(),
        processDefinitionId: z.string().optional(),
        activityId: z.string().optional(),
        topicName: z.string().optional(),
        locked: z.boolean().optional(),
        notLocked: z.boolean().optional(),
        withRetriesLeft: z.boolean().optional(),
        noRetriesLeft: z.boolean().optional().describe("Failed external tasks with 0 retries"),
        workerId: z.string().optional(),
        sortBy: z
          .enum(["id", "lockExpirationTime", "processInstanceId",
                 "processDefinitionId", "processDefinitionKey", "taskPriority"])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/external-task", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "external tasks", [
          "id",
          "topicName",
          "processInstanceId",
          "activityId",
          "retries",
          "errorMessage",
        ]);
        return formatResponse(data, summary);
      })
    );

    // ── Get External Task ───────────────────────────────────────────────
    server.tool(
      "camunda_get_external_task",
      "Get a single external task by ID.",
      {
        externalTaskId: z.string().describe("External task ID"),
      },
      safeToolHandler(async ({ externalTaskId }) => {
        const response = await client.get(
          `/external-task/${externalTaskId}`
        );
        return formatResponse(response.data);
      })
    );

    // ── Set External Task Retries ───────────────────────────────────────
    server.tool(
      "camunda_set_external_task_retries",
      "Set retries for a failed external task. Setting retries > 0 allows the worker to pick it up again.",
      {
        externalTaskId: z.string().describe("External task ID"),
        retries: z.number().describe("Number of retries"),
      },
      safeToolHandler(async ({ externalTaskId, retries }) => {
        await client.put(`/external-task/${externalTaskId}/retries`, {
          retries,
        });
        return formatResponse(
          null,
          `External task ${externalTaskId} retries set to ${retries}.`
        );
      })
    );

    // ── Get External Task Error Details ─────────────────────────────────
    server.tool(
      "camunda_get_external_task_error_details",
      "Get the full error details of a failed external task.",
      {
        externalTaskId: z.string().describe("External task ID"),
      },
      safeToolHandler(async ({ externalTaskId }) => {
        const response = await client.get(
          `/external-task/${externalTaskId}/errorDetails`,
          { responseType: "text" }
        );
        return formatResponse(
          response.data,
          `Error details for external task ${externalTaskId}:`
        );
      })
    );
  },
};
