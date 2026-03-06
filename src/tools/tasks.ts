import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const taskTools: IToolModule = {
  name: "Task tools",

  register(server, client) {    server.tool(
      "camunda_list_tasks",
      "List user tasks with optional filters.",
      {
        processInstanceId: z.string().optional(),
        processDefinitionId: z.string().optional(),
        processDefinitionKey: z.string().optional(),
        processDefinitionKeyIn: z.string().optional(),
        assignee: z.string().optional().describe("Filter by assignee user ID"),
        assigneeLike: z.string().optional(),
        candidateGroup: z.string().optional(),
        candidateUser: z.string().optional(),
        unassigned: z.boolean().optional().describe("Only unassigned tasks"),
        active: z.boolean().optional(),
        suspended: z.boolean().optional(),
        taskDefinitionKey: z.string().optional(),
        taskDefinitionKeyIn: z.string().optional(),
        name: z.string().optional(),
        nameLike: z.string().optional(),
        priority: z.number().optional(),
        createdBefore: z.string().optional().describe("ISO 8601 date"),
        createdAfter: z.string().optional().describe("ISO 8601 date"),
        dueBefore: z.string().optional(),
        dueAfter: z.string().optional(),
        withoutDueDate: z.boolean().optional(),
        followUpBefore: z.string().optional(),
        followUpAfter: z.string().optional(),
        sortBy: z
          .enum([
            "instanceId",
            "dueDate",
            "executionId",
            "assignee",
            "created",
            "description",
            "id",
            "name",
            "nameCaseInsensitive",
            "priority",
            "processVariable",
            "taskVariable",
          ])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/task", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "tasks", [
          "id",
          "name",
          "assignee",
          "processInstanceId",
          "taskDefinitionKey",
          "created",
        ]);
        return formatResponse(data, summary);
      })
    );    server.tool(
      "camunda_get_task",
      "Get details of a single task.",
      {
        taskId: z.string().describe("Task ID"),
      },
      safeToolHandler(async ({ taskId }) => {
        const response = await client.get(`/task/${taskId}`);
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_complete_task",
      "Complete a user task, optionally setting output variables.",
      {
        taskId: z.string().describe("Task ID to complete"),
        variables: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .optional()
          .describe("Variables to set upon completion"),
        withVariablesInReturn: z.boolean().optional(),
      },
      safeToolHandler(async ({ taskId, variables, withVariablesInReturn }) => {
        const body: Record<string, unknown> = {};
        if (variables) body.variables = variables;
        if (withVariablesInReturn !== undefined)
          body.withVariablesInReturn = withVariablesInReturn;

        const response = await client.post(`/task/${taskId}/complete`, body);
        return formatResponse(
          response.data || null,
          `Task ${taskId} completed.`
        );
      })
    );    server.tool(
      "camunda_claim_task",
      "Claim a task for a user.",
      {
        taskId: z.string().describe("Task ID"),
        userId: z.string().describe("User ID to claim the task for"),
      },
      safeToolHandler(async ({ taskId, userId }) => {
        await client.post(`/task/${taskId}/claim`, { userId });
        return formatResponse(null, `Task ${taskId} claimed by ${userId}.`);
      })
    );    server.tool(
      "camunda_unclaim_task",
      "Unclaim a previously claimed task.",
      {
        taskId: z.string().describe("Task ID"),
      },
      safeToolHandler(async ({ taskId }) => {
        await client.post(`/task/${taskId}/unclaim`, {});
        return formatResponse(null, `Task ${taskId} unclaimed.`);
      })
    );    server.tool(
      "camunda_assign_task",
      "Assign a task to a specific user.",
      {
        taskId: z.string().describe("Task ID"),
        userId: z.string().describe("User ID to assign"),
      },
      safeToolHandler(async ({ taskId, userId }) => {
        await client.post(`/task/${taskId}/assignee`, { userId });
        return formatResponse(null, `Task ${taskId} assigned to ${userId}.`);
      })
    );    server.tool(
      "camunda_delegate_task",
      "Delegate a task to another user.",
      {
        taskId: z.string().describe("Task ID"),
        userId: z.string().describe("User ID to delegate to"),
      },
      safeToolHandler(async ({ taskId, userId }) => {
        await client.post(`/task/${taskId}/delegate`, { userId });
        return formatResponse(null, `Task ${taskId} delegated to ${userId}.`);
      })
    );    server.tool(
      "camunda_get_task_variables",
      "Get all variables visible in the scope of a task.",
      {
        taskId: z.string().describe("Task ID"),
        deserializeValues: z.boolean().optional(),
      },
      safeToolHandler(async ({ taskId, deserializeValues }) => {
        const response = await client.get(`/task/${taskId}/variables`, {
          params: cleanParams({ deserializeValues }),
        });
        return formatResponse(response.data);
      })
    );    server.tool(
      "camunda_set_task_variable",
      "Set or update a single variable on a task.",
      {
        taskId: z.string().describe("Task ID"),
        variableName: z.string().describe("Variable name"),
        value: z.any().describe("Variable value"),
        type: z.string().optional().describe("Variable type"),
      },
      safeToolHandler(async ({ taskId, variableName, value, type }) => {
        await client.put(`/task/${taskId}/variables/${variableName}`, {
          value,
          type: type ?? "String",
        });
        return formatResponse(
          null,
          `Variable '${variableName}' set on task ${taskId}.`
        );
      })
    );
  },
};
