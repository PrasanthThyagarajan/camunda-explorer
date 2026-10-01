import type { ICamundaApiClient } from "../interfaces/camunda-api-client.js";

/** Both the Axios client used by the services and the MCP tool client satisfy this. */
type LivenessClient = Pick<ICamundaApiClient, "get" | "post">;

/** History states in which an instance can never be modified again. */
const ENDED_STATES = new Set([
  "COMPLETED",
  "EXTERNALLY_TERMINATED",
  "INTERNALLY_TERMINATED",
]);

const HISTORY_ID_CHUNK = 200;

/** Stands in for the real terminal state when engine history is unavailable. */
export const UNCONFIRMED_END_STATE = "NOT_RUNNING";

export type Liveness =
  | { state: "running" }
  | { state: "processed"; endState: string; endTime: string | null }
  | { state: "not_found" }
  | { state: "unknown" };

export function isInstanceGoneError(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404;
}

function toVerdict(row: Record<string, unknown>): Liveness {
  const historyState = String(row.state || "").toUpperCase();
  if (ENDED_STATES.has(historyState)) {
    return {
      state: "processed",
      endState: historyState,
      endTime: (row.endTime as string) || null,
    };
  }
  // History disagrees with the runtime query — the instance is neither proven
  // finished nor proven absent, so callers must not treat it as skippable.
  return { state: "unknown" };
}

/**
 * Classify instance IDs that a runtime query did not return.
 *
 * Callers pass only the IDs already known to be missing from
 * `POST /process-instance`, so an empty list costs no request.
 * History can be disabled on the engine; when the lookup fails every ID in
 * that chunk collapses into one unconfirmed "no longer running" verdict
 * instead of being misreported as never having existed.
 */
export async function classifyEndedInstances(
  client: LivenessClient,
  instanceIds: string[]
): Promise<Map<string, Liveness>> {
  const verdicts = new Map<string, Liveness>();
  if (instanceIds.length === 0) return verdicts;

  for (let i = 0; i < instanceIds.length; i += HISTORY_ID_CHUNK) {
    const ids = instanceIds.slice(i, i + HISTORY_ID_CHUNK);

    let rows: Array<Record<string, unknown>>;
    try {
      const response = await client.post(
        "/history/process-instance",
        { processInstanceIds: ids },
        { params: { maxResults: ids.length } }
      );
      rows = (response.data || []) as Array<Record<string, unknown>>;
    } catch {
      for (const id of ids) {
        verdicts.set(id, {
          state: "processed",
          endState: UNCONFIRMED_END_STATE,
          endTime: null,
        });
      }
      continue;
    }

    for (const row of rows) {
      verdicts.set(String(row.id), toVerdict(row));
    }
    for (const id of ids) {
      if (!verdicts.has(id)) verdicts.set(id, { state: "not_found" });
    }
  }

  return verdicts;
}

/**
 * Classify a single instance. Used on the one-at-a-time paths, where the
 * trigger is a 404 from a runtime endpoint rather than a gap in a list.
 */
export async function classifyInstance(
  client: LivenessClient,
  instanceId: string
): Promise<Liveness> {
  try {
    await client.get(`/process-instance/${instanceId}`);
    return { state: "running" };
  } catch (error: unknown) {
    if (!isInstanceGoneError(error)) return { state: "unknown" };
  }

  try {
    const response = await client.get(`/history/process-instance/${instanceId}`);
    return toVerdict((response.data || {}) as Record<string, unknown>);
  } catch (error: unknown) {
    return isInstanceGoneError(error) ? { state: "not_found" } : { state: "unknown" };
  }
}

/** Human-readable reason shown against a skipped instance. */
export function describeProcessed(endState: string, endTime: string | null): string {
  if (endState === UNCONFIRMED_END_STATE) {
    return "No longer running (engine history unavailable — end state unconfirmed)";
  }
  return `Already processed — finished ${endState}${endTime ? ` at ${endTime}` : ""}`;
}
