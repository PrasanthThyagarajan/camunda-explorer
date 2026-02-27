/**
 * MCP Tools — Execution & Message Correlation
 *
 * Camunda 7.16 REST API: /execution, /message
 */

import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const executionTools: IToolModule = {
  name: "Execution & Message tools",

  register(server, client) {
    // ── List Executions ─────────────────────────────────────────────────
    server.tool(
      "camunda_list_executions",
      "List executions (tokens) with optional filters.",
      {
        processInstanceId: z.string().optional(),
        processDefinitionId: z.string().optional(),
        processDefinitionKey: z.string().optional(),
        activityId: z.string().optional(),
        active: z.boolean().optional(),
        suspended: z.boolean().optional(),
        sortBy: z.enum(["instanceId", "definitionKey", "definitionId"]).optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/execution", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "executions", [
          "id",
          "processInstanceId",
          "ended",
        ]);
        return formatResponse(data, summary);
      })
    );

    // ── Get Execution ───────────────────────────────────────────────────
    server.tool(
      "camunda_get_execution",
      "Get an execution by ID.",
      {
        executionId: z.string().describe("Execution ID"),
      },
      safeToolHandler(async ({ executionId }) => {
        const response = await client.get(`/execution/${executionId}`);
        return formatResponse(response.data);
      })
    );

    // ── Signal Execution ────────────────────────────────────────────────
    server.tool(
      "camunda_signal_execution",
      "Signal an execution that is waiting at a signal/receive event, causing it to continue.",
      {
        executionId: z.string().describe("Execution ID"),
        variables: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .optional()
          .describe("Variables to set when signalling"),
      },
      safeToolHandler(async ({ executionId, variables }) => {
        const body: Record<string, unknown> = {};
        if (variables) body.variables = variables;
        await client.post(`/execution/${executionId}/signal`, body);
        return formatResponse(null, `Execution ${executionId} signalled.`);
      })
    );

    // ── Deliver Message ─────────────────────────────────────────────────
    server.tool(
      "camunda_deliver_message",
      "Correlate a message to a waiting process instance or start a new instance via message start event.",
      {
        messageName: z.string().describe("The message name as defined in the BPMN model"),
        businessKey: z
          .string()
          .optional()
          .describe("Business key to correlate (match to a specific instance)"),
        processInstanceId: z
          .string()
          .optional()
          .describe("Specific process instance to deliver to"),
        correlationKeys: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .optional()
          .describe("Correlation keys (process variables) to match the right instance"),
        processVariables: z
          .record(
            z.object({
              value: z.any(),
              type: z.string().optional(),
            })
          )
          .optional()
          .describe("Variables to set on the matched process instance"),
        resultEnabled: z
          .boolean()
          .optional()
          .describe("Return the result of the message correlation"),
        variablesInResultEnabled: z.boolean().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.post("/message", params);
        return formatResponse(
          response.data,
          `Message '${params.messageName}' delivered.`
        );
      })
    );
  },
};
