import { Router } from "express";
import { AxiosInstance } from "axios";
import { asyncHandler } from "../middleware/error-handler.js";
import { parseFirstActivity, parseAllActivities, parseStartFormFields, parseDmnInputs, groupDmnInputs, buildSamplePayload } from "../parsers/index.js";
import { IncidentService } from "../services/incident.service.js";
import { ProcessInstanceService } from "../services/process-instance.service.js";
import { buildCamundaClient } from "../services/camunda-client.factory.js";
import type { EnvironmentService } from "../services/environment.service.js";
import { MODIFICATION_REQUEST_TIMEOUT } from "../constants.js";
import { logger } from "../utils/logger.js";

const VALID_INSTRUCTION_TYPES = new Set(["startBeforeActivity", "startAfterActivity"]);

export function createActionsRoutes(
  envService: EnvironmentService,
  incidentService: IncidentService,
  processInstanceService: ProcessInstanceService
): Router {
  const router = Router();

  function getClient(timeoutOverride?: number): AxiosInstance {
    const env = envService.getActive();
    if (!env) throw Object.assign(new Error("No active environment"), { statusCode: 503 });
    return buildCamundaClient(env, timeoutOverride);
  }

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

  router.get(
    "/start-form/:processDefinitionKey",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const key = req.params.processDefinitionKey;

      const xmlRes = await client.get(`/process-definition/key/${key}/xml`);
      const bpmnXml = xmlRes.data.bpmn20Xml;
      if (!bpmnXml) {
        return res.status(422).json({ error: "No BPMN XML returned" });
      }

      const parsed = parseStartFormFields(bpmnXml);

      let apiFormVars: Record<string, unknown> = {};
      try {
        const formVarRes = await client.get(`/process-definition/key/${key}/form-variables`);
        apiFormVars = formVarRes.data || {};
      } catch {
        // form-variables not available — that's fine
      }

      if (!parsed.hasFormFields && Object.keys(apiFormVars).length > 0) {
        for (const [varName, varDef] of Object.entries(apiFormVars)) {
          const def = varDef as { type?: string; value?: unknown };
          const type = (def.type || "String").toLowerCase();
          parsed.formFields.push({
            id: varName,
            label: varName,
            type,
            defaultValue: def.value != null ? String(def.value) : "",
            enumValues: [],
          });

          let sampleValue: unknown;
          let camundaType: string;
          switch (type) {
            case "integer": sampleValue = 0; camundaType = "Integer"; break;
            case "long": sampleValue = 0; camundaType = "Long"; break;
            case "double": sampleValue = 0.0; camundaType = "Double"; break;
            case "boolean": sampleValue = false; camundaType = "Boolean"; break;
            default: sampleValue = ""; camundaType = "String"; break;
          }
          parsed.samplePayload[varName] = { value: def.value ?? sampleValue, type: camundaType };
        }
        parsed.hasFormFields = true;
      }

      res.json(parsed);
    })
  );

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

  router.post(
    "/test-dmn-evaluate/:decisionKey",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const decisionKey = req.params.decisionKey;
      const body = req.body;

      logger.info(`[DMN-TEST] POST /decision-definition/key/${decisionKey}/evaluate`);
      logger.debug(`[DMN-TEST] Body`, body);

      try {
        const response = await client.post(
          `/decision-definition/key/${decisionKey}/evaluate`,
          body,
          { headers: { "Content-Type": "application/json" } }
        );
        res.json({ success: true, status: response.status, data: response.data });
      } catch (error: unknown) {
        const err = error as { response?: { status?: number; data?: unknown }; message?: string };
        logger.error(`[DMN-TEST] Error: ${err.response?.status}`, err.response?.data);
        res.status(err.response?.status || 500).json({
          success: false,
          status: err.response?.status,
          error: err.response?.data || err.message,
          sentBody: body,
        });
      }
    })
  );

  router.post(
    "/batch-modify-to-start",
    asyncHandler(async (req, res) => {
      const client = getClient(MODIFICATION_REQUEST_TIMEOUT);
      const { incidentIds, batchSize, targetActivityId } = req.body;
      if (!incidentIds || !Array.isArray(incidentIds) || incidentIds.length === 0) {
        return res.status(400).json({ error: "incidentIds array is required" });
      }
      const result = await incidentService.batchModifyToStart(
        client, incidentIds, batchSize, targetActivityId
      );
      logger.info(`[BATCH] Modify complete: ${result.succeeded}/${result.total} succeeded`);
      res.json(result);
    })
  );

  router.post(
    "/batch-resolve",
    asyncHandler(async (req, res) => {
      const client = getClient(MODIFICATION_REQUEST_TIMEOUT);
      const { incidentIds, batchSize, strategy } = req.body;
      if (!incidentIds || !Array.isArray(incidentIds) || incidentIds.length === 0) {
        return res.status(400).json({ error: "incidentIds array is required" });
      }
      const result = await incidentService.batchResolve(client, incidentIds, batchSize, strategy);
      res.json(result);
    })
  );

  router.post(
    "/batch-retry",
    asyncHandler(async (req, res) => {
      const client = getClient(MODIFICATION_REQUEST_TIMEOUT);
      const { incidentIds, batchSize, retries } = req.body;
      if (!incidentIds || !Array.isArray(incidentIds) || incidentIds.length === 0) {
        return res.status(400).json({ error: "incidentIds array is required" });
      }
      const result = await incidentService.batchRetry(client, incidentIds, batchSize, retries);
      res.json(result);
    })
  );

  router.get(
    "/find-duplicates",
    asyncHandler(async (_req, res) => {
      const client = getClient();
      const result = await incidentService.findDuplicates(client);
      res.json(result);
    })
  );

  // ── History Track route ──────────────────────────────────────────

  router.get(
    "/history-track/:instanceId",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const track = await processInstanceService.getHistoryTrack(
        client, req.params.instanceId
      );
      res.json(track);
    })
  );

  // ── Process Instance Modify routes ──────────────────────────────

  router.get(
    "/instance-context/:instanceId",
    asyncHandler(async (req, res) => {
      const client = getClient();
      const context = await processInstanceService.getInstanceContext(
        client, req.params.instanceId
      );
      res.json(context);
    })
  );

  router.post(
    "/instance-modify",
    asyncHandler(async (req, res) => {
      const client = getClient(MODIFICATION_REQUEST_TIMEOUT);
      const {
        instanceId,
        cancelActivityIds,
        targetActivityId,
        instructionType,
        skipCustomListeners,
        skipIoMappings,
        annotation,
      } = req.body;

      if (!instanceId || typeof instanceId !== "string") {
        return res.status(400).json({ error: "instanceId (string) is required" });
      }
      if (!targetActivityId || typeof targetActivityId !== "string") {
        return res.status(400).json({ error: "targetActivityId (string) is required" });
      }
      if (!Array.isArray(cancelActivityIds) || cancelActivityIds.length === 0) {
        return res.status(400).json({ error: "cancelActivityIds must be a non-empty array of strings" });
      }
      if (instructionType && !VALID_INSTRUCTION_TYPES.has(instructionType)) {
        return res.status(400).json({ error: `Invalid instructionType. Must be one of: ${[...VALID_INSTRUCTION_TYPES].join(", ")}` });
      }

      const result = await processInstanceService.modifyInstance(
        client,
        instanceId,
        cancelActivityIds,
        targetActivityId,
        {
          instructionType: instructionType || "startBeforeActivity",
          skipCustomListeners: !!skipCustomListeners,
          skipIoMappings: !!skipIoMappings,
          annotation: typeof annotation === "string" ? annotation : undefined,
        }
      );

      logger.info(`[INSTANCE-MODIFY] ${instanceId}: ${result.status} — ${result.message}`);
      res.json(result);
    })
  );

  router.post(
    "/batch-instance-modify",
    asyncHandler(async (req, res) => {
      const client = getClient(MODIFICATION_REQUEST_TIMEOUT);
      const {
        instanceIds,
        targetActivityId,
        batchSize,
        instructionType,
        skipCustomListeners,
        skipIoMappings,
        annotation,
      } = req.body;

      if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
        return res.status(400).json({ error: "instanceIds must be a non-empty array" });
      }
      if (!targetActivityId || typeof targetActivityId !== "string") {
        return res.status(400).json({ error: "targetActivityId (string) is required" });
      }
      if (instructionType && !VALID_INSTRUCTION_TYPES.has(instructionType)) {
        return res.status(400).json({ error: `Invalid instructionType. Must be one of: ${[...VALID_INSTRUCTION_TYPES].join(", ")}` });
      }

      const safeBatchSize = typeof batchSize === "number" && batchSize > 0 ? batchSize : undefined;

      const result = await processInstanceService.batchModifyInstances(
        client,
        instanceIds,
        targetActivityId,
        safeBatchSize,
        {
          instructionType: instructionType || "startBeforeActivity",
          skipCustomListeners: !!skipCustomListeners,
          skipIoMappings: !!skipIoMappings,
          annotation: typeof annotation === "string" ? annotation : undefined,
        }
      );

      logger.info(`[BATCH-INSTANCE-MODIFY] ${result.succeeded}/${result.total} succeeded`);
      res.json(result);
    })
  );

  return router;
}
