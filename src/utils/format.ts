/**
 * Shared formatting utilities used across the intelligence layer.
 */

/** Format milliseconds into a human-readable duration string. */
export function fmtMs(ms: number): string {
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return mins + "m " + secs + "s";
  const hrs = Math.floor(mins / 60);
  return hrs + "h " + (mins % 60) + "m";
}
