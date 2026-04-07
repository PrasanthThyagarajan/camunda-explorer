/**
 * Migration Routes
 *
 * Endpoints for detecting old-version process instances and migrating
 * them to the latest (or a selected) BPMN version.
 *
 * Camunda 7 migration flow:
 *   1. Generate a migration plan between source and target definitions
 *   2. Validate the plan against the target instances
 *   3. Execute the migration (sync or async for large batches)
 */

import { Router } from "express";
import { AxiosInstance } from "axios";
import { asyncHandler } from "../middleware/error-handler.js";
import { buildCamundaClient } from "../services/camunda-client.factory.js";
import { logger } from "../utils/logger.js";
import type { EnvironmentService } from "../services/environment.service.js";

// Threshold: instance with no activity update for this long is considered stuck
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function createMigrationRoutes(
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

  // ── Summary: old-version instance count + per-key breakdown ────

  router.get(
    "/old-version/summary",
    asyncHandler(async (_req, res) => {
      const client = getClient();

      // Fetch all definition statistics (all versions)
      const statsRes = await client.get("/process-definition/statistics", {
        params: { failedJobs: true, incidents: true },
      });
      const allStats: DefinitionStat[] = statsRes.data;

      // Build latest-version map per definition key
      const latestByKey = new Map<
        string,
        { version: number; id: string; name: string }
      >();
      for (const s of allStats) {
        const key = s.definition?.key;
        if (!key) continue;
        const ver = s.definition?.version ?? 0;
        const existing = latestByKey.get(key);
        if (!existing || ver > existing.version) {
          latestByKey.set(key, {
            version: ver,
            id: s.definition?.id ?? s.id,
            name: s.definition?.name ?? key,
          });
        }
      }

      // Identify old-version entries that still have running instances
      let totalOldVersion = 0;
      const breakdown: OldVersionBreakdown[] = [];

      for (const s of allStats) {
        const key = s.definition?.key;
        if (!key) continue;
        const ver = s.definition?.version ?? 0;
        const latest = latestByKey.get(key);

        if (latest && ver < latest.version && s.instances > 0) {
          const incidentCount = (s.incidents || []).reduce(
            (a: number, i: { incidentCount?: number }) =>
              a + (i.incidentCount || 0),
            0
          );
          totalOldVersion += s.instances;
          breakdown.push({
            definitionKey: key,
            definitionName: s.definition?.name || key,
            definitionId: s.definition?.id || s.id,
            currentVersion: ver,
            latestVersion: latest.version,
            latestDefinitionId: latest.id,
            instanceCount: s.instances,
            failedJobs: s.failedJobs || 0,
            incidents: incidentCount,
          });
        }
      }

      logger.info(
        `[MIGRATION] Summary: ${totalOldVersion} instances on old versions across ${breakdown.length} definitions`
      );

      res.json({
        totalOldVersionInstances: totalOldVersion,
        definitionsAffected: breakdown.length,
        breakdown: breakdown.sort((a, b) => b.instanceCount - a.instanceCount),
      });
    })
  );

  // ── List: detailed instance list for a specific old definition ──

  router.get(
    "/old-version/instances",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { definitionId } = req.query;

      if (!definitionId || typeof definitionId !== "string") {
        return res
          .status(400)
          .json({ error: "definitionId query param is required" });
      }

      // Fetch running instances for this specific definition
      const instancesRes = await client.get("/process-instance", {
        params: {
          processDefinitionId: definitionId,
          maxResults: 200,
        },
      });
      const instances: ProcessInstance[] = instancesRes.data;

      if (instances.length === 0) {
        return res.json({ instances: [] });
      }

      // Fetch incidents for these instances (batch)
      const piIds = instances.map((i) => i.id);
      let incidents: Incident[] = [];
      try {
        const incRes = await client.post("/incident", {
          processInstanceIdIn: piIds,
          maxResults: 500,
        });
        incidents = incRes.data;
      } catch {
        // Incident lookup is best-effort
      }

      // Fetch history activity instances to detect stalled processes
      const stuckThreshold = new Date(
        Date.now() - STUCK_THRESHOLD_MS
      ).toISOString();
      let historyActivities: HistoryActivity[] = [];
      try {
        const histRes = await client.post("/history/activity-instance", {
          processInstanceIdIn: piIds,
          unfinished: true,
          sortBy: "startTime",
          sortOrder: "desc",
          maxResults: 500,
        });
        historyActivities = histRes.data;
      } catch {
        // History lookup is best-effort
      }

      // Build per-instance incident and activity maps
      const incidentsByPi = new Map<string, Incident[]>();
      for (const inc of incidents) {
        const arr = incidentsByPi.get(inc.processInstanceId) || [];
        arr.push(inc);
        incidentsByPi.set(inc.processInstanceId, arr);
      }

      const activityByPi = new Map<string, HistoryActivity>();
      for (const act of historyActivities) {
        // Keep the most recent unfinished activity per instance
        if (!activityByPi.has(act.processInstanceId)) {
          activityByPi.set(act.processInstanceId, act);
        }
      }

      // Detect stuck instances and build enriched list
      const enriched = instances.map((inst) => {
        const piIncidents = incidentsByPi.get(inst.id) || [];
        const currentActivity = activityByPi.get(inst.id);
        const hasIncident = piIncidents.length > 0;

        // Stuck detection: incident, no activity update > 30 min, or suspended
        const activityStarted = currentActivity?.startTime
          ? new Date(currentActivity.startTime).getTime()
          : 0;
        const isStale =
          activityStarted > 0 &&
          new Date(currentActivity!.startTime).toISOString() < stuckThreshold;

        const isStuck = hasIncident || isStale || inst.suspended;

        return {
          processInstanceId: inst.id,
          businessKey: inst.businessKey || null,
          suspended: inst.suspended,
          activityName: currentActivity?.activityName || "—",
          activityId: currentActivity?.activityId || null,
          status: isStuck ? "stuck" : "running",
          stuckReason: hasIncident
            ? "Active incident"
            : isStale
            ? "No activity for >30 min"
            : inst.suspended
            ? "Suspended"
            : null,
          incidentCount: piIncidents.length,
          incidentMessage: piIncidents[0]?.incidentMessage || null,
        };
      });

      res.json({
        definitionId,
        instanceCount: enriched.length,
        stuckCount: enriched.filter((i) => i.status === "stuck").length,
        instances: enriched,
      });
    })
  );

  // ── Available target versions for a definition key ────────────

  router.get(
    "/versions/:definitionKey",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { definitionKey } = req.params;

      const defsRes = await client.get("/process-definition", {
        params: {
          key: definitionKey,
          sortBy: "version",
          sortOrder: "desc",
          maxResults: 50,
        },
      });

      const versions = (defsRes.data as Definition[]).map((d) => ({
        id: d.id,
        version: d.version,
        name: d.name || d.key,
        deploymentId: d.deploymentId,
      }));

      res.json({ definitionKey, versions });
    })
  );

  // ── Generate + validate migration plan ─────────────────────────

  router.post(
    "/plan",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { sourceDefinitionId, targetDefinitionId } = req.body;

      if (!sourceDefinitionId || !targetDefinitionId) {
        return res.status(400).json({
          error:
            "sourceDefinitionId and targetDefinitionId are required",
        });
      }

      // Generate migration plan
      const planRes = await client.post("/migration/generate", {
        sourceProcessDefinitionId: sourceDefinitionId,
        targetProcessDefinitionId: targetDefinitionId,
        updateEventTriggers: false,
      });

      const plan = planRes.data;
      const instructions = plan.instructions || [];

      logger.info(
        `[MIGRATION] Plan generated: ${sourceDefinitionId} → ${targetDefinitionId}, ` +
          `${instructions.length} activity mappings`
      );

      res.json({
        plan,
        instructionCount: instructions.length,
        unmappedWarning:
          instructions.length === 0
            ? "No activity mappings found — migration may fail if instances are at activities that don't exist in the target."
            : null,
      });
    })
  );

  // ── Execute migration ──────────────────────────────────────────

  router.post(
    "/execute",
    asyncHandler(async (req, res) => {
      const client = getClient(60_000); // 60s timeout for migration
      const {
        sourceDefinitionId,
        targetDefinitionId,
        processInstanceIds,
        skipCustomListeners,
        skipIoMappings,
      } = req.body;

      if (
        !sourceDefinitionId ||
        !targetDefinitionId ||
        !Array.isArray(processInstanceIds) ||
        processInstanceIds.length === 0
      ) {
        return res.status(400).json({
          error:
            "sourceDefinitionId, targetDefinitionId, and processInstanceIds[] are required",
        });
      }

      // Safety limit
      if (processInstanceIds.length > 100) {
        return res.status(400).json({
          error:
            "Too many instances for synchronous migration. Use batch migration for >100 instances.",
        });
      }

      // Step 1: Generate migration plan via Camunda
      logger.info(
        `[MIGRATION] Generating plan: ${sourceDefinitionId} → ${targetDefinitionId}`
      );
      const planRes = await client.post("/migration/generate", {
        sourceProcessDefinitionId: sourceDefinitionId,
        targetProcessDefinitionId: targetDefinitionId,
        updateEventTriggers: false,
      });
      const generatedPlan = planRes.data;
      const instructions = generatedPlan?.instructions || [];

      logger.info(
        `[MIGRATION] Generated plan has ${instructions.length} activity mappings, ` +
          `source=${generatedPlan?.sourceProcessDefinitionId}, target=${generatedPlan?.targetProcessDefinitionId}`
      );

      if (instructions.length === 0) {
        return res.status(422).json({
          success: false,
          error:
            "Migration plan has no activity mappings — cannot safely migrate. " +
            "This usually means the BPMN structure changed significantly between versions.",
        });
      }

      // Build a clean migration plan object with guaranteed IDs.
      // The generate endpoint should return these, but we explicitly set them
      // from our known values to avoid serialization edge cases.
      const migrationPlan = {
        sourceProcessDefinitionId: sourceDefinitionId,
        targetProcessDefinitionId: targetDefinitionId,
        instructions,
      };

      // Step 2: Validate against the specific instances
      logger.info(
        `[MIGRATION] Validating plan against ${processInstanceIds.length} instances`
      );
      try {
        const validateRes = await client.post("/migration/validate", {
          migrationPlan,
          processInstanceIds,
        });

        // Camunda returns 200 with empty body if valid, or
        // 200 with instructionReports containing errors
        const reports = validateRes.data?.instructionReports;
        if (reports && Array.isArray(reports)) {
          const failures = reports.filter(
            (r: { failures?: string[] }) =>
              r.failures && r.failures.length > 0
          );
          if (failures.length > 0) {
            return res.status(422).json({
              success: false,
              error: "Migration validation failed",
              details: failures.map(
                (f: { failures: string[] }, i: number) => ({
                  instruction: i,
                  failures: f.failures,
                })
              ),
            });
          }
        }
      } catch (valErr: unknown) {
        const err = valErr as {
          response?: { status: number; data: unknown };
          message: string;
        };
        // Validation endpoint may fail on some Camunda versions (e.g. returning
        // 400 "Source process definition id is null" even though the plan is
        // correct).  Log the warning but proceed to execute — execute itself
        // will reject genuinely invalid plans.
        logger.warn(
          `[MIGRATION] Validation returned error (proceeding to execute anyway): ` +
            `${err.response?.status} ${JSON.stringify(err.response?.data)}`
        );
      }

      // Step 3: Execute migration
      logger.info(
        `[MIGRATION] Executing migration for ${processInstanceIds.length} instances`
      );
      try {
        await client.post("/migration/execute", {
          migrationPlan,
          processInstanceIds,
          skipCustomListeners: skipCustomListeners || false,
          skipIoMappings: skipIoMappings || false,
        });

        const auditLog = {
          event: "MIGRATION_EXECUTED",
          sourceDefinitionId,
          targetDefinitionId,
          instanceCount: processInstanceIds.length,
          processInstanceIds,
          timestamp: new Date().toISOString(),
        };
        logger.info(JSON.stringify(auditLog));

        res.json({
          success: true,
          message: `Successfully migrated ${processInstanceIds.length} instance(s)`,
          migratedCount: processInstanceIds.length,
          sourceDefinitionId,
          targetDefinitionId,
        });
      } catch (execErr: unknown) {
        const err = execErr as {
          response?: { status: number; data: unknown };
          message: string;
        };
        const errData = err.response?.data as {
          type?: string;
          message?: string;
          validationReport?: {
            processInstanceId?: string;
            activityInstanceValidationReports?: Array<{
              sourceScopeId?: string;
              failures?: string[];
            }>;
          };
        } | undefined;

        // If the batch failed because some instances have tokens at
        // activities that don't exist in the target BPMN, fall back to
        // migrating each instance individually so the ones that CAN
        // migrate will succeed.
        if (
          errData?.type === "MigratingProcessInstanceValidationException"
        ) {
          if (processInstanceIds.length === 1) {
            const actReport = errData.validationReport?.activityInstanceValidationReports?.[0];
            const activityId = actReport?.sourceScopeId || "unknown";
            const reason = actReport?.failures?.[0] || errData.message || "Unknown validation error";
            logger.warn(
              `[MIGRATION] Instance ${processInstanceIds[0]} cannot be migrated: activity ${activityId} — ${reason}`
            );
            res.status(422).json({
              success: false,
              error: "Instance cannot be migrated",
              message: `Instance has a token at activity "${activityId}" which does not exist in the target BPMN version. Move the token first (Process Instance Modification), then retry migration.`,
              skippedInstances: [{ id: processInstanceIds[0], success: false, error: reason }],
              migratedCount: 0,
              skippedCount: 1,
            });
            return;
          }

          logger.warn(
            `[MIGRATION] Batch failed with validation error — retrying ${processInstanceIds.length} instances individually`
          );

          const results: Array<{
            id: string;
            success: boolean;
            error?: string;
          }> = [];
          let okCount = 0;
          let failCount = 0;

          for (const piId of processInstanceIds) {
            try {
              await client.post("/migration/execute", {
                migrationPlan,
                processInstanceIds: [piId],
                skipCustomListeners: skipCustomListeners || false,
                skipIoMappings: skipIoMappings || false,
              });
              results.push({ id: piId, success: true });
              okCount++;
            } catch (innerErr: unknown) {
              const iErr = innerErr as {
                response?: { data: { message?: string } };
                message: string;
              };
              const msg =
                iErr.response?.data?.message || iErr.message;
              results.push({ id: piId, success: false, error: msg });
              failCount++;
            }
          }

          logger.info(
            JSON.stringify({
              event: "MIGRATION_PARTIAL",
              sourceDefinitionId,
              targetDefinitionId,
              migrated: okCount,
              skipped: failCount,
              timestamp: new Date().toISOString(),
            })
          );

          const statusCode = okCount > 0 ? 200 : 500;
          res.status(statusCode).json({
            success: okCount > 0,
            message:
              failCount === 0
                ? `Successfully migrated ${okCount} instance(s)`
                : `Migrated ${okCount} instance(s), ${failCount} could not be migrated (tokens at activities removed in target BPMN — modify their position first)`,
            migratedCount: okCount,
            skippedCount: failCount,
            sourceDefinitionId,
            targetDefinitionId,
            skippedInstances: results.filter((r) => !r.success),
          });
          return;
        }

        logger.error(
          `[MIGRATION] Execution failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`
        );
        res.status(500).json({
          success: false,
          error: "Migration execution failed",
          details: err.response?.data || err.message,
        });
      }
    })
  );

  // ── Batch migration (async) for large sets ─────────────────────

  router.post(
    "/execute-async",
    asyncHandler(async (req, res) => {
      const client = getClient(30_000);
      const {
        sourceDefinitionId,
        targetDefinitionId,
        processInstanceIds,
        skipCustomListeners,
        skipIoMappings,
      } = req.body;

      if (
        !sourceDefinitionId ||
        !targetDefinitionId ||
        !Array.isArray(processInstanceIds) ||
        processInstanceIds.length === 0
      ) {
        return res.status(400).json({
          error:
            "sourceDefinitionId, targetDefinitionId, and processInstanceIds[] are required",
        });
      }

      // Generate migration plan
      const planRes = await client.post("/migration/generate", {
        sourceProcessDefinitionId: sourceDefinitionId,
        targetProcessDefinitionId: targetDefinitionId,
        updateEventTriggers: false,
      });
      const generatedPlan = planRes.data;
      const instructions = generatedPlan?.instructions || [];

      if (instructions.length === 0) {
        return res.status(422).json({
          success: false,
          error: "Migration plan has no activity mappings",
        });
      }

      // Build clean plan with guaranteed IDs
      const migrationPlan = {
        sourceProcessDefinitionId: sourceDefinitionId,
        targetProcessDefinitionId: targetDefinitionId,
        instructions,
      };

      // Execute async — returns a batch object
      const batchRes = await client.post("/migration/executeAsync", {
        migrationPlan,
        processInstanceIds,
        skipCustomListeners: skipCustomListeners || false,
        skipIoMappings: skipIoMappings || false,
      });

      logger.info(
        JSON.stringify({
          event: "MIGRATION_BATCH_STARTED",
          batchId: batchRes.data?.id,
          sourceDefinitionId,
          targetDefinitionId,
          instanceCount: processInstanceIds.length,
          timestamp: new Date().toISOString(),
        })
      );

      res.json({
        success: true,
        message: `Batch migration started for ${processInstanceIds.length} instance(s)`,
        batch: batchRes.data,
      });
    })
  );

  // ── Delete old-version instances ──────────────────────────────────

  router.post(
    "/delete",
    asyncHandler(async (req, res) => {
      const client = getClient(60_000);
      const { processInstanceIds, skipCustomListeners, skipIoMappings } =
        req.body;

      if (
        !Array.isArray(processInstanceIds) ||
        processInstanceIds.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "processInstanceIds[] is required" });
      }

      if (processInstanceIds.length > 100) {
        return res.status(400).json({
          error:
            "Too many instances for single delete request. Limit is 100.",
        });
      }

      const results: Array<{
        id: string;
        success: boolean;
        error?: string;
      }> = [];
      let successCount = 0;
      let failCount = 0;

      for (const piId of processInstanceIds) {
        try {
          await client.delete(`/process-instance/${piId}`, {
            params: {
              skipCustomListeners: skipCustomListeners ?? true,
              skipIoMappings: skipIoMappings ?? true,
            },
          });
          results.push({ id: piId, success: true });
          successCount++;
        } catch (err: unknown) {
          const axErr = err as {
            response?: { status: number; data: unknown };
            message: string;
          };
          const msg =
            (axErr.response?.data as { message?: string })?.message ||
            axErr.message;
          results.push({ id: piId, success: false, error: msg });
          failCount++;
        }
      }

      logger.info(
        JSON.stringify({
          event: "INSTANCES_DELETED",
          requested: processInstanceIds.length,
          succeeded: successCount,
          failed: failCount,
          timestamp: new Date().toISOString(),
        })
      );

      res.json({
        success: failCount === 0,
        message:
          failCount === 0
            ? `Deleted ${successCount} instance(s)`
            : `Deleted ${successCount}, failed ${failCount}`,
        successCount,
        failCount,
        results,
      });
    })
  );

  return router;
}

// ── Type definitions ──────────────────────────────────────────────

interface DefinitionStat {
  id: string;
  instances: number;
  failedJobs: number;
  incidents: Array<{ incidentType: string; incidentCount: number }>;
  definition?: {
    id: string;
    key: string;
    name: string;
    version: number;
  };
}

interface OldVersionBreakdown {
  definitionKey: string;
  definitionName: string;
  definitionId: string;
  currentVersion: number;
  latestVersion: number;
  latestDefinitionId: string;
  instanceCount: number;
  failedJobs: number;
  incidents: number;
}

interface ProcessInstance {
  id: string;
  businessKey: string | null;
  processDefinitionId: string;
  suspended: boolean;
}

interface Incident {
  id: string;
  processInstanceId: string;
  incidentMessage: string;
  activityId: string;
}

interface HistoryActivity {
  activityId: string;
  activityName: string;
  processInstanceId: string;
  startTime: string;
  endTime: string | null;
}

interface Definition {
  id: string;
  key: string;
  name: string;
  version: number;
  deploymentId: string;
}
