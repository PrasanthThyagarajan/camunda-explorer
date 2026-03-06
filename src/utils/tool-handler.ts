import { formatError } from "./response-formatter.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  [key: string]: unknown;
};

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
