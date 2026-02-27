/**
 * MCP Tools — Process Instance Management
 *
 * Camunda 7.16 REST API: /process-instance
 * Tools for listing, inspecting, modifying, suspending instances and managing variables.
 */

import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

// ── Shared Zod schemas ────────────────────────────────────────────

const variableValueSchema = z.object({
  value: z.any().describe("Variable value"),
  type: z
    .string()
    .optional()
    .describe(
      "Camunda variable type: String, Integer, Long, Double, Boolean, Date, Json, Xml, Object"
    ),
  valueInfo: z
    .record(z.any())
    .optional()
    .describe("Additional type info (e.g. serializationDataFormat, objectTypeName)"),
});

const modificationInstructionSchema = z.object({
  type: z
    .enum([
      "cancel",
      "startBeforeActivity",
      "startAfterActivity",
      "startTransition",
    ])
    .describe("Instruction type"),
  activityId: z
    .string()
    .optional()
    .describe("Target activity ID (for cancel / startBefore / startAfter)"),
  transitionId: z
    .string()
    .optional()
    .describe("Sequence flow ID (for startTransition)"),
  activityInstanceId: z
    .string()
    .optional()
    .describe("Specific activity instance to cancel"),
  transitionInstanceId: z
    .string()
    .optional()
    .describe("Specific transition instance to cancel"),
  cancelCurrentActiveActivityInstances: z
    .boolean()
    .optional()
    .describe("Cancel all active instances of the given activity"),
  variables: z
    .record(variableValueSchema)
    .optional()
    .describe("Variables to set with this instruction"),
});

export const processInstanceTools: IToolModule = {
  name: "Process Instance tools",

  register(server, client) {
    // ── List Process Instances ──────────────────────────────────────────
    server.tool(
      "camunda_list_process_instances",
      "List running process instances with optional filters.",
      {
        processDefinitionId: z.string().optional(),
        processDefinitionKey: z.string().optional(),
        processDefinitionKeyIn: z.string().optional().describe("Comma-separated keys"),
        businessKey: z.string().optional(),
        businessKeyLike: z.string().optional(),
        suspended: z.boolean().optional().describe("Filter by suspended state"),
        withIncident: z.boolean().optional().describe("Only instances with incidents"),
        incidentType: z.string().optional(),
        active: z.boolean().optional().describe("Only active instances"),
        activityIdIn: z.string().optional().describe("Comma-separated activity IDs that must be active"),
        sortBy: z
          .enum(["instanceId", "definitionKey", "definitionId", "businessKey"])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/process-instance", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "process instances", [
          "id",
          "definitionId",
          "businessKey",
          "suspended",
        ]);
        return formatResponse(data, summary);
      })
    );

    // ── Get Process Instance ────────────────────────────────────────────
    server.tool(
      "camunda_get_process_instance",
      "Get details of a single process instance.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
      },
      safeToolHandler(async ({ processInstanceId }) => {
        const response = await client.get(
          `/process-instance/${processInstanceId}`
        );
        return formatResponse(response.data);
      })
    );

    // ── Get Activity Instance Tree ──────────────────────────────────────
    server.tool(
      "camunda_get_activity_instances",
      "Get the activity instance tree of a running process instance. Shows current execution positions — essential for understanding where a process is stuck or to plan modifications.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
      },
      safeToolHandler(async ({ processInstanceId }) => {
        const response = await client.get(
          `/process-instance/${processInstanceId}/activity-instances`
        );
        return formatResponse(response.data);
      })
    );

    // ── Modify Process Instance (CORE — retry / move to initial) ───────
    server.tool(
      "camunda_modify_process_instance",
      `Modify a running process instance by cancelling and/or starting activity instances.
USE CASES:
  • Retry from an earlier activity: cancel current + startBeforeActivity on the target
  • Move to initial block: cancel current activity + startBeforeActivity on the first task
  • Skip an activity: startAfterActivity
  • Start at a specific transition: startTransition
IMPORTANT: Use camunda_get_activity_instances first to find current activity IDs and instance IDs.`,
      {
        processInstanceId: z.string().describe("The process instance ID to modify"),
        instructions: z
          .array(modificationInstructionSchema)
          .min(1)
          .describe("Array of modification instructions (cancel/start)"),
        skipCustomListeners: z
          .boolean()
          .optional()
          .describe("Skip custom execution listeners (default: false)"),
        skipIoMappings: z
          .boolean()
          .optional()
          .describe("Skip I/O mappings (default: false)"),
        annotation: z
          .string()
          .optional()
          .describe("Annotation for the modification (shows in history)"),
      },
      safeToolHandler(async ({
        processInstanceId,
        instructions,
        skipCustomListeners,
        skipIoMappings,
        annotation,
      }) => {
        await client.post(
          `/process-instance/${processInstanceId}/modification`,
          {
            skipCustomListeners: skipCustomListeners ?? false,
            skipIoMappings: skipIoMappings ?? false,
            instructions,
            annotation: annotation ?? "Modified via Camunda MCP Server",
          }
        );
        return formatResponse(
          null,
          `Process instance ${processInstanceId} modified successfully.\nInstructions executed: ${instructions.length}`
        );
      })
    );

    // ── Suspend Process Instance ────────────────────────────────────────
    server.tool(
      "camunda_suspend_process_instance",
      "Suspend a running process instance. Suspended instances will not execute any further.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
      },
      safeToolHandler(async ({ processInstanceId }) => {
        await client.put(
          `/process-instance/${processInstanceId}/suspended`,
          { suspended: true }
        );
        return formatResponse(
          null,
          `Process instance ${processInstanceId} suspended.`
        );
      })
    );

    // ── Activate Process Instance ───────────────────────────────────────
    server.tool(
      "camunda_activate_process_instance",
      "Activate a previously suspended process instance.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
      },
      safeToolHandler(async ({ processInstanceId }) => {
        await client.put(
          `/process-instance/${processInstanceId}/suspended`,
          { suspended: false }
        );
        return formatResponse(
          null,
          `Process instance ${processInstanceId} activated.`
        );
      })
    );

    // ── Delete Process Instance ─────────────────────────────────────────
    server.tool(
      "camunda_delete_process_instance",
      "Delete a process instance. WARNING: Destructive and irreversible.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
        skipCustomListeners: z.boolean().optional(),
        skipIoMappings: z.boolean().optional(),
        skipSubprocesses: z.boolean().optional(),
        failIfNotExists: z.boolean().optional(),
      },
      safeToolHandler(async ({
        processInstanceId,
        skipCustomListeners,
        skipIoMappings,
        skipSubprocesses,
        failIfNotExists,
      }) => {
        await client.delete(`/process-instance/${processInstanceId}`, {
          params: cleanParams({
            skipCustomListeners,
            skipIoMappings,
            skipSubprocesses,
            failIfNotExists,
          }),
        });
        return formatResponse(
          null,
          `Process instance ${processInstanceId} deleted.`
        );
      })
    );

    // ── Get Variables ────────────────────────────────────────────────────
    server.tool(
      "camunda_get_instance_variables",
      "Get all variables of a process instance.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
        deserializeValues: z
          .boolean()
          .optional()
          .describe("Deserialize serialized variable values (default true)"),
      },
      safeToolHandler(async ({ processInstanceId, deserializeValues }) => {
        const response = await client.get(
          `/process-instance/${processInstanceId}/variables`,
          {
            params: cleanParams({
              deserializeValues: deserializeValues ?? true,
            }),
          }
        );
        return formatResponse(response.data);
      })
    );

    // ── Set / Update a Single Variable ──────────────────────────────────
    server.tool(
      "camunda_set_instance_variable",
      "Set or update a single variable on a process instance.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
        variableName: z.string().describe("Name of the variable"),
        value: z.any().describe("Value to set"),
        type: z
          .string()
          .optional()
          .describe("Variable type (String, Integer, Boolean, Json, etc.)"),
      },
      safeToolHandler(async ({ processInstanceId, variableName, value, type }) => {
        await client.put(
          `/process-instance/${processInstanceId}/variables/${variableName}`,
          { value, type: type ?? "String" }
        );
        return formatResponse(
          null,
          `Variable '${variableName}' set on process instance ${processInstanceId}.`
        );
      })
    );

    // ── Modify Variables (batch update/delete) ──────────────────────────
    server.tool(
      "camunda_modify_instance_variables",
      "Batch update and/or delete multiple variables on a process instance.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
        modifications: z
          .record(variableValueSchema)
          .optional()
          .describe("Variables to set/update — object keyed by variable name"),
        deletions: z
          .array(z.string())
          .optional()
          .describe("Variable names to delete"),
      },
      safeToolHandler(async ({ processInstanceId, modifications, deletions }) => {
        await client.post(
          `/process-instance/${processInstanceId}/variables`,
          { modifications, deletions }
        );
        return formatResponse(
          null,
          `Variables modified on process instance ${processInstanceId}.`
        );
      })
    );

    // ── Delete Variable ─────────────────────────────────────────────────
    server.tool(
      "camunda_delete_instance_variable",
      "Delete a single variable from a process instance.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
        variableName: z.string().describe("Variable name to delete"),
      },
      safeToolHandler(async ({ processInstanceId, variableName }) => {
        await client.delete(
          `/process-instance/${processInstanceId}/variables/${variableName}`
        );
        return formatResponse(
          null,
          `Variable '${variableName}' deleted from process instance ${processInstanceId}.`
        );
      })
    );
  },
};
