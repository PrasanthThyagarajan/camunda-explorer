/**
 * Actions Routes — Presentation layer (thin controller).
 *
 * Handles BPMN analysis, DMN input parsing, batch operations, and duplicate detection.
 * SRP: Maps HTTP requests to domain services and parsers.
 */

import { Router } from "express";
import { AxiosInstance } from "axios";
import { asyncHandler } from "../middleware/error-handler.js";
import { parseFirstActivity, parseAllActivities, parseDmnInputs, groupDmnInputs, buildSamplePayload } from "../parsers/index.js";
import { IncidentService } from "../services/incident.service.js";
import { buildCamundaClient } from "../services/camunda-client.factory.js";
import type { EnvironmentService } from "../services/environment.service.js";

export function createActionsRoutes(
  envService: EnvironmentService,
  incidentService: IncidentService
): Router {
  const router = Router();

  /** Get an authenticated Camunda client for the active environment */
  function getClient(): AxiosInstance {
    const env = envService.getActive();
    if (!env) throw Object.assign(new Error("No active environment"), { statusCode: 503 });
    return buildCamundaClient(env);
  }

  // ── BPMN Analysis ─────────────────────────────────────────────────

  // Get first activity of a process definition
  router.get(
    "/first-activity/:processDefinitionId",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const xmlRes = await client.get(`/process-definition/${req.params.processDefinitionId}/xml`);
      const result = parseFirstActivity(xmlRes.data.bpmn20Xml);
      if (!result) {
        return res.status(422).json({ error: "Could not parse BPMN to find first activity" });
      }
      res.json(result);
    })
  );

  // Get all BPMN activities in flow order
  router.get(
    "/bpmn-activities/:processDefinitionId",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const xmlRes = await client.get(`/process-definition/${req.params.processDefinitionId}/xml`);
      const bpmnXml = xmlRes.data.bpmn20Xml;
      const activities = parseAllActivities(bpmnXml);
      const first = parseFirstActivity(bpmnXml);
      res.json({
        processDefinitionId: req.params.processDefinitionId,
        startEventId: first?.startEventId || null,
        firstActivityId: first?.firstActivityId || null,
        activities,
      });
    })
  );

  // ── DMN Analysis ──────────────────────────────────────────────────

  // Parse DMN inputs for a decision key
  router.get(
    "/dmn-inputs/:decisionKey",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const xmlRes = await client.get(`/decision-definition/key/${req.params.decisionKey}/xml`);
      const dmnXml = xmlRes.data.dmnXml;
      if (!dmnXml) {
        return res.status(422).json({ error: "No DMN XML returned" });
      }

      const parsed = parseDmnInputs(dmnXml);
      const grouped = groupDmnInputs(parsed.inputs);
      const samplePayload = buildSamplePayload(grouped);

      res.json({
        decisionKey: req.params.decisionKey,
        decisionName: parsed.decisionName,
        hitPolicy: parsed.hitPolicy,
        inputs: parsed.inputs,
        outputs: parsed.outputs,
        samplePayload,
        groupedVariables: grouped,
      });
    })
  );

  // Test DMN evaluation directly (bypass proxy for debugging)
  router.post(
    "/test-dmn-evaluate/:decisionKey",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const decisionKey = req.params.decisionKey;
      const body = req.body;

      console.log(`[DMN-TEST] POST /decision-definition/key/${decisionKey}/evaluate`);
      console.log(`[DMN-TEST] Body: ${JSON.stringify(body, null, 2)}`);

      try {
        const response = await client.post(
          `/decision-definition/key/${decisionKey}/evaluate`,
          body,
          { headers: { "Content-Type": "application/json" } }
        );
        res.json({ success: true, status: response.status, data: response.data });
      } catch (error: unknown) {
        const err = error as { response?: { status?: number; data?: unknown }; message?: string };
        console.error(`[DMN-TEST] Error: ${err.response?.status} ${JSON.stringify(err.response?.data)}`);
        res.status(err.response?.status || 500).json({
          success: false,
          status: err.response?.status,
          error: err.response?.data || err.message,
          sentBody: body,
        });
      }
    })
  );

  // ── Batch Operations ──────────────────────────────────────────────

  // Batch modify incidents → move to target activity
  router.post(
    "/batch-modify-to-start",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { incidentIds, batchSize, targetActivityId } = req.body;
      if (!incidentIds || !Array.isArray(incidentIds) || incidentIds.length === 0) {
        return res.status(400).json({ error: "incidentIds array is required" });
      }
      const result = await incidentService.batchModifyToStart(
        client, incidentIds, batchSize, targetActivityId
      );
      console.log(`[BATCH] Modify complete: ${result.succeeded}/${result.total} succeeded`);
      res.json(result);
    })
  );

  // Batch resolve incidents
  router.post(
    "/batch-resolve",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { incidentIds, batchSize, strategy } = req.body;
      if (!incidentIds || !Array.isArray(incidentIds) || incidentIds.length === 0) {
        return res.status(400).json({ error: "incidentIds array is required" });
      }
      const result = await incidentService.batchResolve(client, incidentIds, batchSize, strategy);
      res.json(result);
    })
  );

  // Batch retry incidents
  router.post(
    "/batch-retry",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const { incidentIds, batchSize, retries } = req.body;
      if (!incidentIds || !Array.isArray(incidentIds) || incidentIds.length === 0) {
        return res.status(400).json({ error: "incidentIds array is required" });
      }
      const result = await incidentService.batchRetry(client, incidentIds, batchSize, retries);
      res.json(result);
    })
  );

  // Find duplicate incidents
  router.get(
    "/find-duplicates",
    asyncHandler(async (_req, res) => {
      const client = getClient();
      const result = await incidentService.findDuplicates(client);
      res.json(result);
    })
  );

  return router;
}
