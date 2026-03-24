import { AxiosInstance } from "axios";
import { parseFirstActivity, parseAllActivities } from "../parsers/bpmn-parser.js";
import { cleanupIncidentAfterModify, extractErrorMessage } from "../utils/incident-cleanup.js";
import { DEFAULT_BATCH_SIZE } from "../constants.js";
import { logger } from "../utils/logger.js";
import type {
  IActiveToken,
  IEnrichedActivity,
  IInstanceContext,
  IModifyResult,
  IInstanceBatchSummary,
  IHistoryStep,
  IHistoryTrack,
} from "../interfaces/process-instance.js";

/**
 * Walks the activity instance tree recursively to extract active leaf tokens.
 * Leaf tokens are the deepest active execution positions — the actual places
 * where the process engine is currently "sitting".
 */
function extractActiveTokens(
  node: Record<string, unknown>,
  incidents: Array<Record<string, unknown>>
): IActiveToken[] {
  const tokens: IActiveToken[] = [];
  const children = (node.childActivityInstances || []) as Array<Record<string, unknown>>;
  const transitions = (node.childTransitionInstances || []) as Array<Record<string, unknown>>;

  // if this node has no children and no transitions, it's a leaf
  if (children.length === 0 && transitions.length === 0) {
    const activityId = node.activityId as string;
    const activityType = node.activityType as string;

    // skip the root processDefinition node — that's not a real token
    if (activityType !== "processDefinition") {
      const matchingIncident = incidents.find((inc) => inc.activityId === activityId);
      tokens.push({
        activityId,
        activityName: (node.activityName as string) || activityId,
        activityType,
        activityInstanceId: node.id as string,
        hasIncident: !!matchingIncident,
        incidentMessage: matchingIncident
          ? (matchingIncident.incidentMessage as string) || undefined
          : undefined,
      });
    }
  }

  // recurse into children
  for (const child of children) {
    tokens.push(...extractActiveTokens(child, incidents));
  }

  // transition instances represent tokens "in flight" between activities
  for (const trans of transitions) {
    const activityId = trans.activityId as string;
    tokens.push({
      activityId,
      activityName: (trans.activityName as string) || activityId,
      activityType: "transition",
      activityInstanceId: trans.id as string,
      hasIncident: false,
    });
  }

  return tokens;
}

/**
 * Detects whether the activity tree contains sub-process scopes.
 */
function hasSubProcessScopes(node: Record<string, unknown>): boolean {
  const activityType = node.activityType as string;
  if (activityType === "subProcess" || activityType === "callActivity") {
    return true;
  }
  const children = (node.childActivityInstances || []) as Array<Record<string, unknown>>;
  return children.some((child) => hasSubProcessScopes(child));
}

export class ProcessInstanceService {
  /**
   * Build a full enriched context for a process instance.
   * This powers the modify dialog by providing:
   *   - active token positions (from activity instance tree)
   *   - BPMN activity list in flow order (from parser)
   *   - per-activity execution status (merged from history)
   *   - incident details
   */
  async getInstanceContext(
    client: AxiosInstance,
    instanceId: string
  ): Promise<IInstanceContext> {
    // fetch everything in parallel — all safe read operations
    const [instRes, activityTreeRes, incidentsRes, historyRes] = await Promise.all([
      client.get(`/process-instance/${instanceId}`),
      client.get(`/process-instance/${instanceId}/activity-instances`),
      client.get(`/incident`, { params: { processInstanceId: instanceId } }),
      client.get(`/history/activity-instance`, {
        params: { processInstanceId: instanceId, sortBy: "startTime", sortOrder: "asc" },
      }),
    ]);

    const instance = instRes.data;
    const activityTree = activityTreeRes.data;
    const incidents: Array<Record<string, unknown>> = incidentsRes.data || [];
    const historyActivities: Array<Record<string, unknown>> = historyRes.data || [];

    // count variables (lightweight — just the count, not full data)
    let variableCount = 0;
    try {
      const varsRes = await client.get(`/process-instance/${instanceId}/variables`);
      variableCount = Object.keys(varsRes.data || {}).length;
    } catch {
      // variables not accessible — that's okay
    }

    // extract active tokens from the live activity tree
    const activeTokens = extractActiveTokens(activityTree, incidents);

    // parse the BPMN to get activities in flow order
    const definitionId = instance.definitionId as string;
    const xmlRes = await client.get(`/process-definition/${definitionId}/xml`);
    const bpmnXml = xmlRes.data.bpmn20Xml as string;
    const bpmnActivities = parseAllActivities(bpmnXml);
    const firstActivity = parseFirstActivity(bpmnXml);

    // build lookup maps for enrichment
    const activeSet = new Set(activeTokens.map((t) => t.activityId));
    const incidentMap = new Map(
      incidents.map((inc) => [inc.activityId as string, inc.incidentMessage as string])
    );

    // build history lookup: activityId → latest history entry
    const historyMap = new Map<string, Record<string, unknown>>();
    for (const entry of historyActivities) {
      const aid = entry.activityId as string;
      // keep the latest entry per activity (history is sorted asc, so last wins)
      historyMap.set(aid, entry);
    }

    // enrich each BPMN activity with execution status
    const enrichedActivities: IEnrichedActivity[] = bpmnActivities.map((act) => {
      const histEntry = historyMap.get(act.id);
      const isActive = activeSet.has(act.id);
      const hasIncident = incidentMap.has(act.id);

      let status: IEnrichedActivity["status"];
      if (isActive && hasIncident) {
        status = "failed";
      } else if (isActive) {
        status = "active";
      } else if (histEntry && histEntry.endTime) {
        const canceled = histEntry.canceled as boolean;
        status = canceled ? "failed" : "completed";
      } else if (histEntry) {
        // started but no endTime and not in active set — unusual, treat as active
        status = "active";
      } else {
        status = "not_reached";
      }

      return {
        ...act,
        status,
        startTime: histEntry ? (histEntry.startTime as string) : undefined,
        endTime: histEntry ? (histEntry.endTime as string) || undefined : undefined,
        duration: histEntry ? (histEntry.durationInMillis as number) || undefined : undefined,
        incidentMessage: hasIncident ? incidentMap.get(act.id) : undefined,
      };
    });

    // compact incident list for the response
    const compactIncidents = incidents.map((inc) => ({
      id: inc.id as string,
      activityId: inc.activityId as string,
      incidentType: inc.incidentType as string,
      incidentMessage: (inc.incidentMessage as string) || "",
      configuration: (inc.configuration as string) || null,
    }));

    return {
      instance: {
        id: instance.id,
        definitionId,
        businessKey: instance.businessKey || null,
        suspended: !!instance.suspended,
      },
      activeTokens,
      activities: enrichedActivities,
      incidents: compactIncidents,
      variableCount,
      hasSubProcesses: hasSubProcessScopes(activityTree),
      firstActivityId: firstActivity?.firstActivityId || null,
    };
  }

  /**
   * Modify a single process instance: cancel selected source tokens
   * and start execution at a target activity.
   *
   * Includes pre-flight validation, execution, post-modify cleanup, and verification.
   */
  async modifyInstance(
    client: AxiosInstance,
    instanceId: string,
    cancelActivityIds: string[],
    targetActivityId: string,
    options: {
      instructionType?: "startBeforeActivity" | "startAfterActivity";
      skipCustomListeners?: boolean;
      skipIoMappings?: boolean;
      annotation?: string;
    } = {}
  ): Promise<IModifyResult> {
    const {
      instructionType = "startBeforeActivity",
      skipCustomListeners = false,
      skipIoMappings = false,
      annotation,
    } = options;

    try {
      // --- Pre-flight: verify instance is alive and sources are active ---
      const treeRes = await client.get(
        `/process-instance/${instanceId}/activity-instances`
      );
      const incidentsRes = await client.get(`/incident`, {
        params: { processInstanceId: instanceId },
      });
      const currentIncidents: Array<Record<string, unknown>> = incidentsRes.data || [];
      const activeTokens = extractActiveTokens(treeRes.data, currentIncidents);

      if (activeTokens.length === 0) {
        return {
          instanceId,
          status: "error",
          message: "Instance has no active tokens — it may have already completed.",
        };
      }

      const activeIds = new Set(activeTokens.map((t) => t.activityId));
      const invalidSources = cancelActivityIds.filter((id) => !activeIds.has(id));
      if (invalidSources.length > 0) {
        return {
          instanceId,
          status: "error",
          message: `Activities not currently active: ${invalidSources.join(", ")}. Refresh and try again.`,
        };
      }

      // --- Build instructions ---
      const instructions: Array<Record<string, unknown>> = [];

      for (const cancelId of cancelActivityIds) {
        instructions.push({
          type: "cancel",
          activityId: cancelId,
          cancelCurrentActiveActivityInstances: true,
        });
      }

      instructions.push({
        type: instructionType,
        activityId: targetActivityId,
      });

      // build a human-readable annotation
      const sourceNames = cancelActivityIds.join(", ");
      const defaultAnnotation = `Modified via Camunda Explorer: ${sourceNames} → ${targetActivityId}`;

      // --- Execute modification ---
      await client.post(`/process-instance/${instanceId}/modification`, {
        skipCustomListeners,
        skipIoMappings,
        instructions,
        annotation: annotation || defaultAnnotation,
      });

      // --- Post-modify: clean up incidents at cancelled activities ---
      let incidentsCleaned = 0;
      for (const inc of currentIncidents) {
        const incActivityId = inc.activityId as string;
        if (cancelActivityIds.includes(incActivityId)) {
          const cleaned = await cleanupIncidentAfterModify(
            client, inc.id as string, inc
          );
          if (cleaned) incidentsCleaned++;
        }
      }

      // --- Verify: check new token positions ---
      let newPositions: string[] = [];
      try {
        const verifyRes = await client.get(
          `/process-instance/${instanceId}/activity-instances`
        );
        const verifyIncidents = await client.get(`/incident`, {
          params: { processInstanceId: instanceId },
        }).then((r) => r.data).catch(() => []);
        const newTokens = extractActiveTokens(verifyRes.data, verifyIncidents);
        newPositions = newTokens.map((t) => t.activityId);
      } catch {
        // instance may have completed after modification — that's fine
        newPositions = [];
      }

      return {
        instanceId,
        status: "success",
        message: `Moved ${sourceNames} → ${targetActivityId}`,
        previousPositions: cancelActivityIds,
        newPositions,
        incidentsCleaned,
      };
    } catch (error: unknown) {
      return {
        instanceId,
        status: "error",
        message: extractErrorMessage(error),
      };
    }
  }

  /**
   * Modify multiple process instances in batches.
   * All instances are moved to the same target activity.
   *
   * Note: each instance makes two rounds of API calls — one here to discover
   * active tokens, and one inside modifyInstance for pre-flight validation.
   * This is deliberate: the pre-flight check uses fresh data to prevent
   * stale-state modifications in concurrent environments.
   */
  async batchModifyInstances(
    client: AxiosInstance,
    instanceIds: string[],
    targetActivityId: string,
    batchSize: number = DEFAULT_BATCH_SIZE,
    options: {
      instructionType?: "startBeforeActivity" | "startAfterActivity";
      skipCustomListeners?: boolean;
      skipIoMappings?: boolean;
      annotation?: string;
    } = {}
  ): Promise<IInstanceBatchSummary> {
    const results: IModifyResult[] = [];

    for (let i = 0; i < instanceIds.length; i += batchSize) {
      const batch = instanceIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (instanceId) => {
          try {
            // discover current token positions to derive cancel targets
            const treeRes = await client.get(
              `/process-instance/${instanceId}/activity-instances`
            );
            const incRes = await client.get(`/incident`, {
              params: { processInstanceId: instanceId },
            }).catch(() => ({ data: [] }));
            const activeTokens = extractActiveTokens(treeRes.data, incRes.data || []);
            const cancelIds = activeTokens.map((t) => t.activityId);

            if (cancelIds.length === 0) {
              return {
                instanceId,
                status: "error" as const,
                message: "No active tokens found",
              };
            }

            return this.modifyInstance(
              client, instanceId, cancelIds, targetActivityId, options
            );
          } catch (error: unknown) {
            return {
              instanceId,
              status: "error" as const,
              message: extractErrorMessage(error),
            };
          }
        })
      );
      results.push(...batchResults);
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    };
  }

  // ── History Track ──────────────────────────────────────────────

  /**
   * Build a full execution track for any process instance (running OR completed).
   * Uses the history API so it works even after the instance has finished.
   *
   * Aggregates:
   *   - Historic process instance metadata
   *   - Historic activity instances (the execution steps)
   *   - Historic incidents (with resolution status)
   *   - Historic variables (latest values)
   *   - User operation log (who did what)
   */
  async getHistoryTrack(
    client: AxiosInstance,
    instanceId: string
  ): Promise<IHistoryTrack> {
    // All history queries run in parallel — safe read operations
    const [histInstanceRes, histActivitiesRes, histIncidentsRes, histVarsRes] =
      await Promise.all([
        client.get(`/history/process-instance/${instanceId}`),
        client.get(`/history/activity-instance`, {
          params: {
            processInstanceId: instanceId,
            sortBy: "startTime",
            sortOrder: "asc",
          },
        }),
        client.get(`/history/incident`, {
          params: {
            processInstanceId: instanceId,
            sortBy: "createTime",
            sortOrder: "asc",
          },
        }),
        client.get(`/history/variable-instance`, {
          params: {
            processInstanceId: instanceId,
          },
        }),
      ]);

    const histInstance = histInstanceRes.data as Record<string, unknown>;
    const histActivities = (histActivitiesRes.data || []) as Array<
      Record<string, unknown>
    >;
    const histIncidents = (histIncidentsRes.data || []) as Array<
      Record<string, unknown>
    >;
    const histVars = (histVarsRes.data || []) as Array<
      Record<string, unknown>
    >;

    // User operations are optional — not every engine has them enabled
    let userOps: Array<Record<string, unknown>> = [];
    try {
      const opsRes = await client.get(`/history/user-operation`, {
        params: {
          processInstanceId: instanceId,
          sortBy: "timestamp",
          sortOrder: "asc",
        },
      });
      userOps = (opsRes.data || []) as Array<Record<string, unknown>>;
    } catch {
      // user-operation-log may not be accessible — that's fine
    }

    // Index incidents by activityId for quick lookup
    const incidentsByActivity = new Map<
      string,
      Array<Record<string, unknown>>
    >();
    for (const inc of histIncidents) {
      const aid = inc.activityId as string;
      if (!incidentsByActivity.has(aid)) {
        incidentsByActivity.set(aid, []);
      }
      incidentsByActivity.get(aid)!.push(inc);
    }

    // Build steps from historic activity instances
    const steps: IHistoryStep[] = histActivities.map((act) => {
      const activityId = act.activityId as string;
      const endTime = act.endTime as string | null;
      const canceled = act.canceled as boolean;
      const actIncidents = incidentsByActivity.get(activityId) || [];

      let status: IHistoryStep["status"];
      if (canceled) {
        status = "canceled";
      } else if (endTime) {
        status = actIncidents.some((i) => !(i.endTime)) ? "failed" : "completed";
      } else {
        status = actIncidents.some((i) => !(i.endTime)) ? "failed" : "active";
      }

      return {
        activityInstanceId: act.id as string,
        activityId,
        activityName: (act.activityName as string) || activityId,
        activityType: act.activityType as string,
        status,
        startTime: act.startTime as string,
        endTime: endTime || null,
        durationMs: (act.durationInMillis as number) ?? null,
        calledProcessInstanceId:
          (act.calledProcessInstanceId as string) || null,
        taskId: (act.taskId as string) || null,
        incidents: actIncidents.map((inc) => ({
          id: inc.id as string,
          type: inc.incidentType as string,
          message: (inc.incidentMessage as string) || "",
          createTime: inc.createTime as string,
          endTime: (inc.endTime as string) || null,
          resolved: !!(inc.endTime),
        })),
      };
    });

    // Build variables list (compact: name, type, value)
    const variables = histVars.map((v) => ({
      name: v.name as string,
      type: (v.type as string) || "Unknown",
      value: v.value,
      activityInstanceId: (v.activityInstanceId as string) || null,
    }));

    // Build user operations list
    const userOperations = userOps.map((op) => ({
      id: op.id as string,
      operationType: op.operationType as string,
      property: (op.property as string) || null,
      orgValue: (op.orgValue as string) || null,
      newValue: (op.newValue as string) || null,
      userId: (op.userId as string) || null,
      timestamp: op.timestamp as string,
    }));

    // Summary counts
    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const failedSteps = steps.filter(
      (s) => s.status === "failed" || s.status === "canceled"
    ).length;
    const activeSteps = steps.filter((s) => s.status === "active").length;
    const totalIncidents = histIncidents.length;
    const resolvedIncidents = histIncidents.filter((i) => !!(i.endTime)).length;

    logger.info(
      `[HISTORY-TRACK] ${instanceId}: ${steps.length} steps, ${totalIncidents} incidents`
    );

    return {
      instance: {
        id: histInstance.id as string,
        definitionId: histInstance.processDefinitionId as string,
        definitionKey: (histInstance.processDefinitionKey as string) || "",
        definitionName: (histInstance.processDefinitionName as string) || null,
        businessKey: (histInstance.businessKey as string) || null,
        state: histInstance.state as string,
        startTime: histInstance.startTime as string,
        endTime: (histInstance.endTime as string) || null,
        durationMs: (histInstance.durationInMillis as number) ?? null,
      },
      steps,
      variables,
      userOperations,
      summary: {
        totalSteps: steps.length,
        completedSteps,
        failedSteps,
        activeSteps,
        totalIncidents,
        resolvedIncidents,
      },
    };
  }
}
