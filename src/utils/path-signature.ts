/**
 * Shared utility for computing deterministic path signatures.
 *
 * A path signature is a short hash of the ordered activity IDs in an
 * execution. Two instances that took the same route through the BPMN
 * produce the same signature — enabling cross-instance comparison.
 */

import { createHash } from "crypto";

const SKIP_ACTIVITY_TYPES = new Set([
  "multiInstanceBody",
  "processDefinition",
]);

/**
 * Compute a path signature from an ordered list of activity records.
 * Each record must have at least { activityId, activityType }.
 */
export function computePathSignature(
  activities: Array<{ activityId: string; activityType: string }>
): string {
  const pathIds = activities
    .filter((a) => !SKIP_ACTIVITY_TYPES.has(a.activityType))
    .map((a) => a.activityId);

  // Deduplicate consecutive same-activity entries (loops / retries)
  const deduped: string[] = [];
  for (const id of pathIds) {
    if (deduped[deduped.length - 1] !== id) deduped.push(id);
  }

  const raw = deduped.join(" > ");
  return createHash("sha256").update(raw).digest("hex").substring(0, 16);
}
