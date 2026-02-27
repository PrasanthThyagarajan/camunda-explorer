/**
 * Incident Service — Application layer.
 *
 * Business logic for incident batch operations: modify, resolve, retry, duplicates.
 * SRP: Sole responsibility is incident-related batch operations.
 * OCP: New strategies can be added without modifying existing ones.
 */

import { AxiosInstance } from "axios";
import { parseFirstActivity } from "../parsers/bpmn-parser.js";
import { DEFAULT_BATCH_SIZE, DEFAULT_RETRY_COUNT, MAX_INCIDENTS_FETCH } from "../constants.js";

// ── Result types ────────────────────────────────────────────────────

export interface BatchResult {
  incidentId: string;
  processInstanceId?: string;
  status: "success" | "error";
  message: string;
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchResult[];
}

export interface DuplicateGroup {
  processDefinitionId: string;
  activityId: string;
  incidentType: string;
  total: number;
  keep: unknown;
  duplicates: unknown[];
}

export interface DuplicateScanResult {
  totalIncidents: number;
  totalDuplicates: number;
  groups: DuplicateGroup[];
}

// ── Service ─────────────────────────────────────────────────────────

export class IncidentService {
  /**
   * Batch modify incidents — move each process instance to a target activity.
   * If targetActivityId is not given, auto-detects the first activity from BPMN.
   */
  async batchModifyToStart(
    client: AxiosInstance,
    incidentIds: string[],
    batchSize: number = DEFAULT_BATCH_SIZE,
    targetActivityId?: string
  ): Promise<BatchSummary> {
    const firstActivityCache: Record<string, string | null> = {};
    const results: BatchResult[] = [];

    for (let i = 0; i < incidentIds.length; i += batchSize) {
      const batch = incidentIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((id) =>
          this.modifySingleIncident(client, id, firstActivityCache, targetActivityId)
        )
      );
      results.push(...batchResults);
    }

    return this.summarize(results);
  }

  /**
   * Batch resolve incidents using type-appropriate strategies.
   */
  async batchResolve(
    client: AxiosInstance,
    incidentIds: string[],
    batchSize: number = DEFAULT_BATCH_SIZE,
    strategy: "retry" | "delete" = "retry"
  ): Promise<BatchSummary> {
    const results: BatchResult[] = [];

    for (let i = 0; i < incidentIds.length; i += batchSize) {
      const batch = incidentIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((id) => this.resolveSingleIncident(client, id, strategy))
      );
      results.push(...batchResults);
    }

    return this.summarize(results);
  }

  /**
   * Batch retry incidents — set job retries.
   */
  async batchRetry(
    client: AxiosInstance,
    incidentIds: string[],
    batchSize: number = DEFAULT_BATCH_SIZE,
    retries: number = DEFAULT_RETRY_COUNT
  ): Promise<BatchSummary> {
    const results: BatchResult[] = [];

    for (let i = 0; i < incidentIds.length; i += batchSize) {
      const batch = incidentIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (incidentId) => {
          try {
            const incRes = await client.get(`/incident/${incidentId}`);
            const jobId = incRes.data.configuration;
            if (!jobId) {
              return { incidentId, status: "error" as const, message: "No associated job" };
            }
            await client.put(`/job/${jobId}/retries`, { retries });
            return { incidentId, status: "success" as const, message: `Retries set to ${retries}` };
          } catch (error: unknown) {
            return { incidentId, status: "error" as const, message: this.extractErrorMessage(error) };
          }
        })
      );
      results.push(...batchResults);
    }

    return this.summarize(results);
  }

  /**
   * Find duplicate incidents (same processDefinitionId + activityId + incidentType).
   */
  async findDuplicates(client: AxiosInstance): Promise<DuplicateScanResult> {
    const incRes = await client.get("/incident", { params: { maxResults: MAX_INCIDENTS_FETCH } });
    const incidents: Array<Record<string, unknown>> = incRes.data;

    const groups: Record<string, Array<Record<string, unknown>>> = {};
    for (const inc of incidents) {
      const key = `${inc.processDefinitionId}::${inc.activityId}::${inc.incidentType}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(inc);
    }

    const duplicateGroups = Object.entries(groups)
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => {
        const [processDefinitionId, activityId, incidentType] = key.split("::");
        list.sort(
          (a, b) =>
            new Date(b.incidentTimestamp as string).getTime() -
            new Date(a.incidentTimestamp as string).getTime()
        );
        return {
          processDefinitionId,
          activityId,
          incidentType,
          total: list.length,
          keep: list[0],
          duplicates: list.slice(1),
        };
      })
      .sort((a, b) => b.total - a.total);

    const totalDuplicates = duplicateGroups.reduce((s, g) => s + g.duplicates.length, 0);
    return { totalIncidents: incidents.length, totalDuplicates, groups: duplicateGroups };
  }

  // ── Private: single incident operations ───────────────────────────

  private async modifySingleIncident(
    client: AxiosInstance,
    incidentId: string,
    firstActivityCache: Record<string, string | null>,
    targetActivityId?: string
  ): Promise<BatchResult> {
    try {
      const incRes = await client.get(`/incident/${incidentId}`);
      const incident = incRes.data;
      const { processInstanceId, processDefinitionId, activityId } = incident;

      if (!processInstanceId || !processDefinitionId) {
        return { incidentId, status: "error", message: "Missing processInstanceId or processDefinitionId" };
      }

      // Determine target activity
      let moveToId = targetActivityId || null;
      if (!moveToId) {
        if (!(processDefinitionId in firstActivityCache)) {
          try {
            const xmlRes = await client.get(`/process-definition/${processDefinitionId}/xml`);
            const parsed = parseFirstActivity(xmlRes.data.bpmn20Xml);
            firstActivityCache[processDefinitionId] = parsed?.firstActivityId || null;
          } catch {
            firstActivityCache[processDefinitionId] = null;
          }
        }
        moveToId = firstActivityCache[processDefinitionId];
      }

      if (!moveToId) {
        return { incidentId, processInstanceId, status: "error", message: "Could not determine target activity" };
      }

      if (activityId === moveToId) {
        return { incidentId, processInstanceId, status: "error", message: `Already at target activity (${moveToId})` };
      }

      // Execute modification
      await client.post(`/process-instance/${processInstanceId}/modification`, {
        skipCustomListeners: false,
        skipIoMappings: false,
        instructions: [
          { type: "cancel", activityId, cancelCurrentActiveActivityInstances: true },
          { type: "startBeforeActivity", activityId: moveToId },
        ],
        annotation: `Batch modified via Camunda Dashboard: moved from ${activityId} → ${moveToId}`,
      });

      // Cleanup incident
      await this.cleanupIncidentAfterModify(client, incidentId, incident);

      return {
        incidentId,
        processInstanceId,
        status: "success",
        message: `Moved ${activityId} → ${moveToId}`,
      };
    } catch (error: unknown) {
      return { incidentId, status: "error", message: this.extractErrorMessage(error) };
    }
  }

  private async cleanupIncidentAfterModify(
    client: AxiosInstance,
    incidentId: string,
    incident: Record<string, unknown>
  ): Promise<void> {
    try {
      // Check if incident still exists
      await client.get(`/incident/${incidentId}`);

      // Still exists — try cleanup based on type
      if (incident.incidentType === "failedExternalTask" && incident.configuration) {
        try {
          await client.put(`/external-task/${incident.configuration}/retries`, { retries: 1 });
          return;
        } catch { /* fall through */ }
      }

      if (incident.incidentType === "failedJob" && incident.configuration) {
        try {
          await client.put(`/job/${incident.configuration}/retries`, { retries: 1 });
          return;
        } catch { /* fall through */ }
      }

      // Last resort: try DELETE
      try { await client.delete(`/incident/${incidentId}`); } catch { /* ignored */ }
    } catch {
      // 404 = incident already gone (auto-resolved) — perfect
    }
  }

  private async resolveSingleIncident(
    client: AxiosInstance,
    incidentId: string,
    strategy: "retry" | "delete"
  ): Promise<BatchResult> {
    try {
      const incRes = await client.get(`/incident/${incidentId}`);
      const inc = incRes.data;
      const { incidentType, processInstanceId, configuration } = inc;

      // Strategy: delete process instance (destructive)
      if (strategy === "delete" && processInstanceId) {
        await client.delete(`/process-instance/${processInstanceId}`, {
          params: { skipCustomListeners: true, skipIoMappings: true },
        });
        return { incidentId, status: "success", message: `Process instance ${processInstanceId} deleted` };
      }

      // Strategy: retry
      if (incidentType === "failedExternalTask" && configuration) {
        await client.put(`/external-task/${configuration}/retries`, { retries: 1 });
        return { incidentId, status: "success", message: "External task retries set to 1" };
      }

      if (incidentType === "failedJob" && configuration) {
        if (processInstanceId) {
          await client.put(`/job/${configuration}/retries`, { retries: 1 });
          return { incidentId, status: "success", message: "Job retries set to 1" };
        } else {
          try {
            await client.delete(`/job/${configuration}`);
            return { incidentId, status: "success", message: "Orphaned job deleted" };
          } catch (jobErr: unknown) {
            try {
              await client.delete(`/incident/${incidentId}`);
              return { incidentId, status: "success", message: "Incident resolved via DELETE" };
            } catch {
              return { incidentId, status: "error", message: `Orphaned: ${this.extractErrorMessage(jobErr)}` };
            }
          }
        }
      }

      // Unknown type — try DELETE as fallback
      try {
        await client.delete(`/incident/${incidentId}`);
        return { incidentId, status: "success", message: "Resolved via DELETE" };
      } catch (delErr: unknown) {
        return {
          incidentId,
          status: "error",
          message: `Unsupported type (${incidentType}): ${this.extractErrorMessage(delErr)}`,
        };
      }
    } catch (error: unknown) {
      return { incidentId, status: "error", message: this.extractErrorMessage(error) };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  private summarize(results: BatchResult[]): BatchSummary {
    return {
      total: results.length,
      succeeded: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    };
  }

  private extractErrorMessage(error: unknown): string {
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    return err.response?.data?.message || err.message || "Unknown error";
  }
}
