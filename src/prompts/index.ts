import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logger } from "../utils/logger.js";

export function registerAllPrompts(server: McpServer): void {
  logger.info("Registering MCP prompts...");  server.prompt(
    "analyse-incidents",
    "Analyse all current incidents in Camunda, group them by type and process, and suggest resolutions.",
    {
      processDefinitionKey: z
        .string()
        .optional()
        .describe("Optional: limit analysis to a specific process definition key"),
      incidentType: z
        .string()
        .optional()
        .describe("Optional: filter by incident type (failedJob, failedExternalTask)"),
    },
    async ({ processDefinitionKey, incidentType }) => {
      const filters: string[] = [];
      if (processDefinitionKey)
        filters.push(
          `processDefinitionKeyIn="${processDefinitionKey}"`
        );
      if (incidentType) filters.push(`incidentType="${incidentType}"`);
      const filterStr =
        filters.length > 0
          ? ` with filters: ${filters.join(", ")}`
          : "";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please perform a thorough analysis of all incidents in our Camunda Platform v7.16.0 engine${filterStr}.

Follow these steps:

1. **Discovery**: Call camunda_list_incidents${filterStr ? ` ${filterStr}` : ""} to get all active incidents.

2. **Categorize**: Group incidents by:
   - incidentType (failedJob vs failedExternalTask)
   - processDefinitionId / processDefinitionKey
   - activityId where they occur
   - Common patterns in incidentMessage

3. **Deep Dive** (for each unique incident pattern):
   a. Use camunda_get_activity_instances on an affected processInstanceId to see where the instance is stuck
   b. Use camunda_list_jobs with the processInstanceId + noRetriesLeft=true to find the failed job
   c. Use camunda_get_job_stacktrace on the failed job to understand the root cause
   d. Use camunda_get_instance_variables to check if there are problematic variable values

4. **Resolution Recommendations** for each incident group:
   - If it's a transient error (timeout, connection issue): recommend retrying via camunda_set_job_retries
   - If it's a data issue: recommend fixing variables via camunda_set_instance_variable then retrying
   - If it's a stuck process: recommend modifying via camunda_modify_process_instance to move back to the initial/previous activity
   - If it's unfixable: recommend resolving the incident via camunda_resolve_incident

5. **Summary Table**: Present a structured summary with counts, categories, severity, and recommended actions.

Be systematic and thorough. For each recommendation, provide the exact tool call parameters needed.`,
            },
          },
        ],
      };
    }
  );  server.prompt(
    "retry-failed-instance",
    "Retry a failed process instance — analyse the failure, fix if possible, and retry the failed job or move the token back.",
    {
      processInstanceId: z
        .string()
        .describe("The process instance ID to retry"),
    },
    async ({ processInstanceId }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `I need to retry the failed process instance: ${processInstanceId}

Please follow this systematic approach:

1. **Inspect the Instance**:
   - camunda_get_process_instance("${processInstanceId}") — check if it still exists & is active
   - camunda_get_activity_instances("${processInstanceId}") — see where the token is currently stuck
   - camunda_get_instance_variables("${processInstanceId}") — check variable values

2. **Find the Failure**:
   - camunda_list_incidents(processInstanceId="${processInstanceId}") — get associated incidents
   - camunda_list_jobs(processInstanceId="${processInstanceId}", noRetriesLeft=true) — find failed jobs
   - For each failed job: camunda_get_job_stacktrace(jobId) — understand the error

3. **Determine Resolution Strategy**:

   **Option A — Simple Retry** (if the error is transient):
   → camunda_set_job_retries(jobId, retries=1) to give the job another attempt

   **Option B — Fix and Retry** (if variables need correction):
   → camunda_set_instance_variable to fix the data
   → Then camunda_set_job_retries(jobId, retries=1)

   **Option C — Move to Initial Block** (if the activity itself is problematic):
   → camunda_get_process_xml_by_key or camunda_get_process_xml to get the BPMN and identify the first activity
   → camunda_modify_process_instance with instructions:
     - { type: "cancel", activityId: "<current_stuck_activity>" }
     - { type: "startBeforeActivity", activityId: "<first_activity_or_target>" }
   
   **Option D — Batch Retry All Jobs**:
   → camunda_set_jobs_retries_by_process(processInstanceId, retries=1)

4. **Verify**: After the action, re-check the instance state.

Please analyse and execute the most appropriate option.`,
            },
          },
        ],
      };
    }
  );  server.prompt(
    "move-to-initial-block",
    "Move a stuck process instance back to its initial/starting activity.",
    {
      processInstanceId: z
        .string()
        .describe("Process instance ID to move back"),
    },
    async ({ processInstanceId }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Move process instance ${processInstanceId} back to its initial/first activity block.

Steps:

1. **Get current state**: camunda_get_activity_instances("${processInstanceId}")
   → Note the currently active activityId(s) and activityInstanceId(s)

2. **Get process definition**: camunda_get_process_instance("${processInstanceId}")
   → Extract the processDefinitionId

3. **Get BPMN XML**: camunda_get_process_xml(processDefinitionId)
   → Identify the first activity after the start event (look for the first serviceTask, userTask, etc.)

4. **Execute modification**: camunda_modify_process_instance with:
   - processInstanceId: "${processInstanceId}"
   - instructions:
     - { type: "cancel", activityId: "<current_stuck_activity>", cancelCurrentActiveActivityInstances: true }
     - { type: "startBeforeActivity", activityId: "<first_activity_id>" }
   - annotation: "Moved back to initial block via MCP agent"

5. **Verify**: camunda_get_activity_instances("${processInstanceId}") to confirm the move succeeded.

6. **Handle incidents**: If there are related incidents, resolve them with camunda_resolve_incident.

Please execute this plan.`,
            },
          },
        ],
      };
    }
  );  server.prompt(
    "evaluate-dmn-guide",
    "Step-by-step guide to discover and evaluate a DMN decision table.",
    {
      decisionKey: z
        .string()
        .optional()
        .describe("Optional: the key of the decision to evaluate"),
    },
    async ({ decisionKey }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `I need to evaluate a DMN decision table${decisionKey ? ` (key: "${decisionKey}")` : ""}.

Steps:
1. ${decisionKey ? `Get decision definition: camunda_get_decision_definition_by_key("${decisionKey}")` : "List all decisions: camunda_list_decision_definitions(latestVersion=true)"}
2. Get the DMN XML: ${decisionKey ? `camunda_get_decision_xml_by_key("${decisionKey}")` : "camunda_get_decision_xml(decisionDefinitionId)"}
3. Parse the XML to identify:
   - All required INPUT variables (name, type, allowed values)
   - All OUTPUT variables
   - The hit policy (UNIQUE, FIRST, COLLECT, etc.)
4. Help me construct the variables object for evaluation
5. Execute: camunda_evaluate_decision_by_key(decisionKey, variables)
6. Explain the result: which rules matched and what outputs were produced

Please guide me through this.`,
            },
          },
        ],
      };
    }
  );  server.prompt(
    "engine-health-check",
    "Comprehensive health check of the Camunda engine — deployments, running instances, incidents, failed jobs.",
    {},
    async () => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please perform a comprehensive health check of our Camunda Platform v7.16.0 engine.

Gather the following data:

1. **Process Statistics**: camunda_get_process_statistics(failedJobs=true, incidents=true)
   → Shows instance counts, failed jobs, and incidents per process definition

2. **Active Incidents**: camunda_count_incidents() and camunda_list_incidents(maxResults=20, sortBy="incidentTimestamp", sortOrder="desc")
   → Overview of current incidents

3. **Deployments**: camunda_list_deployments(sortBy="deploymentTime", sortOrder="desc", maxResults=10)
   → Recent deployments

4. **Running Instances**: camunda_list_process_instances(maxResults=5)
   → Quick sample of running instances

5. **Failed Jobs**: camunda_list_jobs(noRetriesLeft=true, maxResults=20)
   → Jobs that need attention

6. **Failed External Tasks**: camunda_list_external_tasks(noRetriesLeft=true, maxResults=20)
   → External tasks that need attention

Compile this into a health dashboard summary with:
- Total running instances
- Total incidents (by type)
- Total failed jobs
- Top affected process definitions
- Recommended immediate actions`,
            },
          },
        ],
      };
    }
  );

  logger.info("  ✓ All prompts registered");
}
