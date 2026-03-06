import { z } from "zod";
import { IToolModule } from "../interfaces/index.js";
import { cleanParams } from "../utils/clean-params.js";
import { safeToolHandler } from "../utils/tool-handler.js";
import {
  formatResponse,
  summarizeList,
} from "../utils/response-formatter.js";

export const jobTools: IToolModule = {
  name: "Job tools",

  register(server, client) {
    server.tool(
      "camunda_list_jobs",
      "List jobs (async continuations, timers, failed jobs). Essential for diagnosing incidents caused by failed jobs.",
      {
        jobId: z.string().optional(),
        processInstanceId: z.string().optional(),
        processDefinitionId: z.string().optional(),
        processDefinitionKey: z.string().optional(),
        executionId: z.string().optional(),
        activityId: z.string().optional(),
        withRetriesLeft: z.boolean().optional().describe("Only jobs with retries > 0"),
        noRetriesLeft: z.boolean().optional().describe("Only jobs with 0 retries (failed)"),
        executable: z.boolean().optional().describe("Only executable jobs"),
        withException: z.boolean().optional().describe("Only jobs with an exception/error"),
        exceptionMessage: z.string().optional(),
        jobDefinitionId: z.string().optional(),
        dueDates: z.string().optional(),
        sortBy: z
          .enum(["jobId", "executionId", "processInstanceId", "processDefinitionId",
                 "processDefinitionKey", "jobPriority", "jobRetries", "jobDueDate"])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        firstResult: z.number().optional(),
        maxResults: z.number().optional(),
      },
      safeToolHandler(async (params) => {
        const response = await client.get("/job", {
          params: cleanParams(params),
        });
        const data = response.data as Record<string, unknown>[];
        const summary = summarizeList(data, "jobs", [
          "id",
          "processInstanceId",
          "activityId",
          "retries",
          "exceptionMessage",
        ]);
        return formatResponse(data, summary);
      })
    );
    server.tool(
      "camunda_get_job",
      "Get details of a single job.",
      {
        jobId: z.string().describe("Job ID"),
      },
      safeToolHandler(async ({ jobId }) => {
        const response = await client.get(`/job/${jobId}`);
        return formatResponse(response.data);
      })
    );
    server.tool(
      "camunda_get_job_stacktrace",
      "Get the full exception stacktrace of a failed job. Essential for understanding why an incident occurred.",
      {
        jobId: z.string().describe("Job ID"),
      },
      safeToolHandler(async ({ jobId }) => {
        const response = await client.get(`/job/${jobId}/stacktrace`, {
          headers: { Accept: "text/plain" },
          responseType: "text",
        });
        return formatResponse(response.data, `Stacktrace for job ${jobId}:`);
      })
    );
    server.tool(
      "camunda_set_job_retries",
      `Set the number of retries for a job. This is the PRIMARY way to retry a failed job.
When a job fails and runs out of retries (retries=0), an incident is created.
Setting retries > 0 will allow the engine to re-execute the job, effectively retrying the failed operation.
Typical usage: set retries to 1 to retry once, or 3 for multiple attempts.`,
      {
        jobId: z.string().describe("Job ID"),
        retries: z
          .number()
          .describe("Number of retries to set (typically 1 to retry once, or 3 for multiple)"),
        dueDate: z
          .string()
          .optional()
          .describe("Optional new due date (ISO 8601) — when to execute the retry"),
      },
      safeToolHandler(async ({ jobId, retries, dueDate }) => {
        const body: Record<string, unknown> = { retries };
        if (dueDate) body.dueDate = dueDate;
        await client.put(`/job/${jobId}/retries`, body);
        return formatResponse(
          null,
          `Job ${jobId} retries set to ${retries}. The engine will re-attempt execution.`
        );
      })
    );
    server.tool(
      "camunda_set_jobs_retries_by_process",
      "Set retries for all jobs of a specific process instance. Useful to retry all failed jobs at once.",
      {
        processInstanceId: z.string().describe("Process instance ID"),
        retries: z.number().describe("Number of retries to set"),
      },
      safeToolHandler(async ({ processInstanceId, retries }) => {
        const jobsResponse = await client.get("/job", {
          params: { processInstanceId, noRetriesLeft: true },
        });
        const jobs = jobsResponse.data as Array<{ id: string }>;

        if (jobs.length === 0) {
          return formatResponse(
            null,
            `No failed jobs found for process instance ${processInstanceId}.`
          );
        }

        const results: string[] = [];
        for (const job of jobs) {
          try {
            await client.put(`/job/${job.id}/retries`, { retries });
            results.push(`  Job ${job.id}: retries set to ${retries}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results.push(`  Job ${job.id}: FAILED — ${msg}`);
          }
        }

        return formatResponse(
          null,
          `Retried ${jobs.length} failed job(s) for process instance ${processInstanceId}:\n${results.join("\n")}`
        );
      })
    );
    server.tool(
      "camunda_execute_job",
      "Immediately execute a job (trigger it now regardless of due date).",
      {
        jobId: z.string().describe("Job ID to execute"),
      },
      safeToolHandler(async ({ jobId }) => {
        await client.post(`/job/${jobId}/execute`, {});
        return formatResponse(null, `Job ${jobId} execution triggered.`);
      })
    );
    server.tool(
      "camunda_set_job_duedate",
      "Set or update the due date of a job.",
      {
        jobId: z.string().describe("Job ID"),
        duedate: z
          .string()
          .optional()
          .describe("New due date (ISO 8601). Null to clear."),
      },
      safeToolHandler(async ({ jobId, duedate }) => {
        await client.put(`/job/${jobId}/duedate`, {
          duedate: duedate ?? null,
        });
        return formatResponse(
          null,
          duedate
            ? `Job ${jobId} due date set to ${duedate}.`
            : `Job ${jobId} due date cleared.`
        );
      })
    );
  },
};
