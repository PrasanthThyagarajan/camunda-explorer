/**
 * Utility — strips undefined / null / empty-string values from a params object.
 *
 * Moved here from client/camunda-client.ts because it is a pure utility
 * with no dependency on the HTTP client.
 *
 * SOLID — Single Responsibility Principle (SRP):
 *   The HTTP client module is responsible for transport; parameter
 *   sanitisation is a general-purpose concern that belongs in utils.
 */

export function cleanParams(
  params: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      cleaned[k] = v;
    }
  }
  return cleaned;
}
