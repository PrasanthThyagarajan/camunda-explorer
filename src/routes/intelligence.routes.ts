/**
 * Intelligence API Routes
 *
 * Exposes the intelligence layer to the frontend.
 * All routes are read-only except for executing recovery actions.
 */

import { Router } from "express";
import { AxiosInstance } from "axios";
import { asyncHandler } from "../middleware/error-handler.js";
import { buildCamundaClient } from "../services/camunda-client.factory.js";
import { parseAllActivities } from "../parsers/index.js";
import { logger } from "../utils/logger.js";
import type { EnvironmentService } from "../services/environment.service.js";

import { diagnoseInstance, getExecution, invalidateInstanceCache } from "../services/intelligence/diagnosis-orchestrator.js";
import { buildBpmnIntelligence } from "../services/intelligence/bpmn-intelligence.js";
import { clusterFailures } from "../services/intelligence/failure-clusterer.js";
import { recoveryLedger } from "../services/intelligence/recovery-ledger.js";
import { MODIFICATION_REQUEST_TIMEOUT } from "../constants.js";

export function createIntelligenceRoutes(
  envService: EnvironmentService
): Router {
  const router = Router();

  function getClient(timeoutOverride?: number): AxiosInstance {
    const env = envService.getActive();
    if (!env) {
      throw Object.assign(new Error("No active environment"), {
        statusCode: 503,
      });
    }
    return buildCamundaClient(env, timeoutOverride);
  }

  // ── Full Diagnosis (the big one) ────────────────────────────

  /**
   * POST /intelligence/diagnose
   * Body: { instanceId, incidentId?, errorMessage? }
   *
   * Runs the complete diagnosis pipeline:
   *   Reconstruction → Signals → Clusters → Recovery → Validation
   */
  router.post(
    "/diagnose",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { instanceId, incidentId, errorMessage } = req.body;

      if (!instanceId || typeof instanceId !== "string") {
        return res
          .status(400)
          .json({ error: "instanceId (string) is required" });
      }

      // Fetch BPMN activities for the instance's definition
      let bpmnActivities: Array<{
        id: string;
        name: string;
        type: string;
        isFirst: boolean;
        order: number;
      }> = [];

      try {
        const piRes = await client.get(`/process-instance/${instanceId}`);
        const defId = piRes.data?.definitionId;
        if (defId) {
          const xmlRes = await client.get(
            `/process-definition/${defId}/xml`
          );
          bpmnActivities = parseAllActivities(xmlRes.data.bpmn20Xml);
        }
      } catch (err) {
        logger.warn(
          `[INTEL-ROUTE] Could not fetch BPMN for ${instanceId}: ${err}`
        );
        // Try via history if runtime fails
        try {
          const histRes = await client.get(
            `/history/process-instance/${instanceId}`
          );
          const defId = histRes.data?.processDefinitionId;
          if (defId) {
            const xmlRes = await client.get(
              `/process-definition/${defId}/xml`
            );
            bpmnActivities = parseAllActivities(xmlRes.data.bpmn20Xml);
          }
        } catch {
          // proceed without BPMN activities
        }
      }

      const diagnosis = await diagnoseInstance(
        client,
        instanceId,
        incidentId || "",
        errorMessage || "",
        bpmnActivities
      );

      res.json(diagnosis);
    })
  );

  // ── Execution Reconstruction Only ─────────────────────────────

  /**
   * GET /intelligence/execution/:instanceId
   *
   * Returns the reconstructed execution without full diagnosis.
   * Lighter-weight — useful for the execution tree view.
   */
  router.get(
    "/execution/:instanceId",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const execution = await getExecution(
        client,
        req.params.instanceId
      );
      res.json(execution);
    })
  );

  // ── BPMN Intelligence (Cross-Instance) ────────────────────────

  /**
   * GET /intelligence/bpmn/:definitionKey
   *
   * Aggregated intelligence for a BPMN definition:
   * node metrics, path analysis, hotspots.
   */
  router.get(
    "/bpmn/:definitionKey",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const intel = await buildBpmnIntelligence(
        client,
        req.params.definitionKey
      );
      res.json(intel);
    })
  );

  // ── Failure Clusters ──────────────────────────────────────────

  /**
   * GET /intelligence/clusters/:definitionKey
   *
   * Failure context clusters for a BPMN definition.
   */
  router.get(
    "/clusters/:definitionKey",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const result = await clusterFailures(
        client,
        req.params.definitionKey
      );
      res.json(result);
    })
  );

  // ── Stacktrace for an Instance's Incidents ──────────────────

  /**
   * GET /intelligence/stacktrace/:instanceId
   *
   * Resolves stacktrace details for a process instance by:
   *   1. Fetching its active incidents
   *   2. Looking up the configuration (job / external task ID)
   *   3. Fetching the actual stacktrace (errorDetails or job stacktrace)
   *
   * Returns { instanceId, traces: [{ incidentId, activityId, incidentType, stacktrace }] }
   */
  router.get(
    "/stacktrace/:instanceId",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { instanceId } = req.params;

      // Fetch incidents for this instance (runtime)
      const incRes = await client.get(`/incident`, {
        params: { processInstanceId: instanceId },
      });
      const incidents = (incRes.data || []) as Array<Record<string, unknown>>;

      if (incidents.length === 0) {
        return res.json({ instanceId, traces: [] });
      }

      // Resolve stacktraces for each incident (up to 5 to avoid slowness)
      const traces: Array<{
        incidentId: string;
        activityId: string;
        incidentType: string;
        message: string;
        stacktrace: string;
      }> = [];

      for (const inc of incidents.slice(0, 5)) {
        const configId = inc.configuration as string;
        const incidentType = inc.incidentType as string;
        const activityId = (inc.activityId as string) || "";
        const message = (inc.incidentMessage as string) || "";

        if (!configId) {
          traces.push({
            incidentId: inc.id as string,
            activityId,
            incidentType,
            message,
            stacktrace: "",
          });
          continue;
        }

        let stacktrace = "";
        try {
          if (incidentType === "failedExternalTask") {
            // Use the dedicated /errorDetails endpoint (returns plain text).
            // Must set Accept: text/plain — client defaults to application/json.
            try {
              const detailRes = await client.get(
                `/external-task/${configId}/errorDetails`,
                {
                  responseType: "text",
                  transformResponse: [(data: string) => data],
                  headers: { Accept: "text/plain, */*" },
                }
              );
              stacktrace = (typeof detailRes.data === "string" ? detailRes.data : "") || "";
            } catch (edErr: unknown) {
              const msg = edErr instanceof Error ? (edErr as Error).message : String(edErr);
              logger.debug(`[STACKTRACE] /errorDetails failed for ${configId}: ${msg}`);
            }

            if (!stacktrace) {
              try {
                const etRes = await client.get(`/external-task/${configId}`);
                stacktrace = (etRes.data?.errorMessage as string) || "";
              } catch {
                // External task may have been completed/removed
              }
            }
          }

          if (!stacktrace) {
            // Try job stacktrace (works for failedJob, also a valid fallback)
            const stRes = await client.get(`/job/${configId}/stacktrace`, {
              responseType: "text",
              transformResponse: [(data: string) => data],
              headers: { Accept: "text/plain, */*" },
            });
            stacktrace = (typeof stRes.data === "string" ? stRes.data : "") || "";
          }
        } catch (err) {
          logger.debug(
            `[STACKTRACE] Could not fetch stacktrace for config ${configId}: ${err}`
          );
        }

        traces.push({
          incidentId: inc.id as string,
          activityId,
          incidentType,
          message,
          stacktrace,
        });
      }

      res.json({ instanceId, traces });
    })
  );

  // ── Verify Pending Recovery Outcomes ─────────────────────────

  /**
   * POST /intelligence/verify-outcomes
   *
   * Background task: checks pending recovery records and updates their
   * outcomes based on the current state of the process instances.
   * Called periodically by the frontend (e.g. every 60s).
   */
  router.post(
    "/verify-outcomes",
    asyncHandler(async (_req, res) => {
      const client = getClient();
      const pending = recoveryLedger.getPending();
      let updated = 0;

      for (const record of pending.slice(0, 20)) {
        // Only verify records that are at least 30 seconds old
        const age = Date.now() - new Date(record.timestamp).getTime();
        if (age < 30000) continue;

        try {
          const histRes = await client.get(
            `/history/process-instance/${record.instanceId}`
          );
          const state = histRes.data?.state as string;

          if (state === "COMPLETED") {
            recoveryLedger.updateOutcome(record.id, "success");
            updated++;
          } else if (
            state === "EXTERNALLY_TERMINATED" ||
            state === "INTERNALLY_TERMINATED"
          ) {
            recoveryLedger.updateOutcome(record.id, "failed");
            updated++;
          }
          // still ACTIVE → leave as pending, check again later
        } catch {
          // Instance might not exist in history yet — skip
        }
      }

      res.json({
        checked: Math.min(pending.length, 20),
        updated,
        remainingPending: pending.length - updated,
      });
    })
  );

  // ── Execute Recovery Action ───────────────────────────────────

  /**
   * POST /intelligence/execute-recovery
   * Body: { instanceId, type, targetActivityId }
   *
   * Executes a recovery action (retry or modify).
   */
  router.post(
    "/execute-recovery",
    asyncHandler(async (req, res) => {
      const client = getClient(MODIFICATION_REQUEST_TIMEOUT);
      const { instanceId, type, targetActivityId } = req.body;

      if (!instanceId || typeof instanceId !== "string") {
        return res
          .status(400)
          .json({ error: "instanceId (string) is required" });
      }
      if (!type || typeof type !== "string") {
        return res
          .status(400)
          .json({ error: "type (string) is required" });
      }

      let result: { success: boolean; message: string };

      switch (type) {
        case "retry": {
          // Find the failed job and set retries to 1
          const jobsRes = await client.get(`/job`, {
            params: {
              processInstanceId: instanceId,
              noRetriesLeft: "true",
            },
          });
          const jobs = jobsRes.data || [];
          if (jobs.length === 0) {
            return res.status(404).json({
              error: "No failed job found for this instance",
            });
          }
          const jobId = jobs[0].id;
          await client.put(`/job/${jobId}/retries`, { retries: 1 });
          result = {
            success: true,
            message: `Retry set for job ${jobId}`,
          };
          break;
        }

        // modify_backward is handled by the dedicated Modify Dialog,
        // not through this endpoint.

        case "restart": {
          // Restart = cancel all active activities + start from beginning
          if (
            !targetActivityId ||
            typeof targetActivityId !== "string"
          ) {
            return res.status(400).json({
              error: "targetActivityId is required for restart",
            });
          }

          const tree2Res = await client.get(
            `/process-instance/${instanceId}/activity-instances`
          );
          // Restart intentionally cancels everything
          const cancelIds2 = extractAllActiveIds(tree2Res.data);

          const instructions2 = [
            ...cancelIds2.map((id: string) => ({
              type: "cancel",
              activityInstanceId: id,
            })),
            {
              type: "startBeforeActivity",
              activityId: targetActivityId,
            },
          ];

          await client.post(
            `/process-instance/${instanceId}/modification`,
            { instructions: instructions2, skipCustomListeners: false, skipIoMappings: false }
          );

          result = {
            success: true,
            message: `Restarted from ${targetActivityId}`,
          };
          break;
        }

        default:
          return res
            .status(400)
            .json({ error: `Unknown recovery type: ${type}` });
      }

      // Invalidate cache so next diagnosis picks up fresh state
      invalidateInstanceCache(instanceId);

      // Persist the recovery action to the ledger for learning
      try {
        recoveryLedger.record({
          definitionKey: req.body.definitionKey || "",
          failedActivityId: req.body.failedActivityId || "",
          errorPattern: (req.body.errorMessage || "").substring(0, 100),
          recoveryType: type,
          targetActivityId: targetActivityId || "",
          instanceId,
          executionSuccess: result.success,
        });
      } catch (ledgerErr) {
        logger.warn(`[LEDGER] Failed to record recovery: ${ledgerErr}`);
      }

      // Structured audit log — captures who did what, when, and why
      logger.info(
        JSON.stringify({
          event: "RECOVERY_EXECUTED",
          instanceId,
          type,
          targetActivityId: targetActivityId || null,
          failedActivityId: req.body.failedActivityId || null,
          success: result.success,
          message: result.message,
          timestamp: new Date().toISOString(),
        })
      );
      res.json(result);
    })
  );

  return router;
}

// ── Activity tree helpers ────────────────────────────────────────

type TreeNode = Record<string, unknown>;

/**
 * Collect ALL leaf activity instance IDs (the old "nuke everything" behaviour).
 * Used only for restart where cancelling everything is intended.
 */
function extractAllActiveIds(tree: TreeNode): string[] {
  const ids: string[] = [];
  function walk(node: TreeNode) {
    const children = (node.childActivityInstances || []) as TreeNode[];
    const transitions = (node.childTransitionInstances || []) as TreeNode[];

    for (const child of children) {
      const grandChildren = (child.childActivityInstances || []) as TreeNode[];
      if (grandChildren.length === 0) {
        ids.push(child.id as string);
      } else {
        walk(child);
      }
    }
    for (const trans of transitions) {
      ids.push(trans.id as string);
    }
  }
  walk(tree);
  return ids;
}

