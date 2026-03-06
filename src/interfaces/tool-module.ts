import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ICamundaApiClient } from "./camunda-api-client.js";

export interface IToolModule {
  readonly name: string;
  register(server: McpServer, client: ICamundaApiClient): void;
}
