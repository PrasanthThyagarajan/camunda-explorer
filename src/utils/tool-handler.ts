/**
 * Higher-order function that wraps MCP tool handlers with automatic
 * error handling.
 *
 * SOLID — Don't Repeat Yourself (DRY) / Single Responsibility:
 *   Every tool handler previously contained an identical try/catch
 *   block calling formatError(). This wrapper extracts that
 *   cross-cutting concern so each tool only contains its happy-path
 *   logic.
 *
 * Usage:
 *   server.tool("camunda_xxx", "…", schema,
 *     safeToolHandler(async (params) => {
 *       const resp = await client.get(…);
 *       return formatResponse(resp.data);
 *     })
 *   );
 */

import { formatError } from "./response-formatter.js";

/** Shape returned by every MCP tool callback (matches MCP SDK's CallToolResult). */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  [key: string]: unknown;
};

/**
 * Wrap a tool handler so that any thrown error is automatically
 * converted to a formatted MCP error response.
 */
export function safeToolHandler<TParams>(
  handler: (params: TParams) => Promise<ToolResult>
): (params: TParams) => Promise<ToolResult> {
  return async (params: TParams): Promise<ToolResult> => {
    try {
      return await handler(params);
    } catch (error) {
      return formatError(error);
    }
  };
}
