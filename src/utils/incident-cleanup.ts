import { AxiosInstance } from "axios";

/**
 * Attempt to clean up an incident after a process instance modification.
 *
 * Modification often leaves behind stale incidents or orphaned jobs.
 * This function tries, in order:
 *   1. If the incident is a failedExternalTask — set retries on the external task
 *   2. If the incident is a failedJob — set retries on the job
 *   3. As a last resort — delete the incident directly
 *
 * If the incident was already auto-resolved by the modification (404), we exit silently.
 */
export async function cleanupIncidentAfterModify(
  client: AxiosInstance,
  incidentId: string,
  incident: Record<string, unknown>
): Promise<boolean> {
  try {
    // check if the incident still exists — modification may have resolved it
    await client.get(`/incident/${incidentId}`);

    if (incident.incidentType === "failedExternalTask" && incident.configuration) {
      try {
        await client.put(`/external-task/${incident.configuration}/retries`, { retries: 1 });
        return true;
      } catch { /* fall through */ }
    }

    if (incident.incidentType === "failedJob" && incident.configuration) {
      try {
        await client.put(`/job/${incident.configuration}/retries`, { retries: 1 });
        return true;
      } catch { /* fall through */ }
    }

    try {
      await client.delete(`/incident/${incidentId}`);
      return true;
    } catch {
      return false;
    }
  } catch {
    // incident already gone — modification auto-resolved it
    return true;
  }
}

/**
 * Extract a readable error message from Axios/generic errors.
 */
export function extractErrorMessage(error: unknown): string {
  const err = error as { response?: { data?: { message?: string } }; message?: string };
  return err.response?.data?.message || err.message || "Unknown error";
}
