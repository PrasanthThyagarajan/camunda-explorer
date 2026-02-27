/**
 * Utilities for formatting Camunda API responses into MCP tool responses.
 *
 * The MCP SDK expects tool callbacks to return objects with an index signature
 * `{ [x: string]: unknown; content: [...]; ... }`. We use a plain-object return
 * shape instead of a named interface so TypeScript doesn't complain about the
 * missing index signature.
 */

/**
 * Format a successful response.
 */
export function formatResponse(
  data: unknown,
  summary?: string
): { content: Array<{ type: "text"; text: string }>; [key: string]: unknown } {
  const parts: Array<{ type: "text"; text: string }> = [];

  if (summary) {
    parts.push({ type: "text", text: summary });
  }

  if (data !== null && data !== undefined) {
    parts.push({
      type: "text",
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    });
  }

  return { content: parts.length > 0 ? parts : [{ type: "text", text: "OK" }] };
}

/**
 * Format an error response.
 */
export function formatError(
  error: unknown
): { content: Array<{ type: "text"; text: string }>; isError: true; [key: string]: unknown } {
  if (error && typeof error === "object" && "statusCode" in error) {
    const apiErr = error as {
      statusCode: number;
      message: string;
      responseBody?: Record<string, unknown>;
    };
    const body = apiErr.responseBody;
    const lines: string[] = [
      `Camunda API Error (HTTP ${apiErr.statusCode})`,
    ];
    if (body?.type) lines.push(`Type: ${body.type}`);
    if (body?.message) lines.push(`Message: ${body.message}`);
    else lines.push(`Message: ${apiErr.message}`);

    if (apiErr.statusCode === 404) {
      lines.push(
        "Hint: The resource may not exist or the ID may be incorrect."
      );
    }
    if (apiErr.statusCode === 403) {
      lines.push("Hint: Check your authentication credentials.");
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: true,
    };
  }

  if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
    return {
      content: [
        {
          type: "text",
          text: "Cannot connect to Camunda engine. Is it running?\nCheck CAMUNDA_BASE_URL in your environment.",
        },
      ],
      isError: true,
    };
  }

  const msg = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${msg}` }],
    isError: true,
  };
}

/**
 * Build a compact summary table string from an array of objects,
 * handy for presenting list results to the AI.
 */
export function summarizeList(
  items: Record<string, unknown>[],
  label: string,
  keyFields: string[]
): string {
  if (!items || items.length === 0) return `No ${label} found.`;

  const header = `Found ${items.length} ${label}:\n`;
  const rows = items.map((item, i) => {
    const fields = keyFields
      .map((k) => `${k}=${item[k] ?? "—"}`)
      .join(", ");
    return `  ${i + 1}. ${fields}`;
  });
  return header + rows.join("\n");
}
