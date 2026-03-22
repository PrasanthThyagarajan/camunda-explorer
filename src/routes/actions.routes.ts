import { Router } from "express";
import { AxiosInstance } from "axios";
import { asyncHandler } from "../middleware/error-handler.js";
import { parseFirstActivity, parseAllActivities, parseStartFormFields, parseDmnInputs, groupDmnInputs, buildSamplePayload } from "../parsers/index.js";
import { IncidentService } from "../services/incident.service.js";
import { buildCamundaClient } from "../services/camunda-client.factory.js";
import type { EnvironmentService } from "../services/environment.service.js";
import { MODIFICATION_REQUEST_TIMEOUT } from "../constants.js";

export function createActionsRoutes(
  envService: EnvironmentService,
  incidentService: IncidentService
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

      // Grab variables from the most recent completed instance as a handy reference
      let historySample: Record<string, unknown> = {};
      try {
        const histRes = await client.get(`/history/process-instance`, {
          params: {
            processDefinitionKey: key,
            sortBy: "startTime",
            sortOrder: "desc",
            maxResults: 1,
            finished: true,
          },
        });
        const instances = histRes.data;
        if (Array.isArray(instances) && instances.length > 0) {
          const instanceId = instances[0].id;
          const varRes = await client.get(`/history/variable-instance`, {
            params: { processInstanceId: instanceId, deserializeValues: false },
          });
          const vars = varRes.data;
          if (Array.isArray(vars)) {
            for (const v of vars) {
              // Skip binary/serialized types — only keep simple, readable values
              if (v.type === "Bytes" || v.type === "File" || v.type === "Object") continue;
              historySample[v.name] = { value: v.value, type: v.type };
            }
          }
        }
      } catch {
        // Not a big deal if history lookup fails — it's just a convenience feature
      }

      res.json({ ...parsed, historySample });
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
      console.log(`[BATCH] Modify complete: ${result.succeeded}/${result.total} succeeded`);
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

  return router;
}
