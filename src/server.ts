import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOcrDocument, registerParseForm, registerParseLayout, registerGetResult, registerUploadDocument, registerGetQuota } from "./tools/index.js";
import type { UserContext } from "./types.js";

export function createServer(userContext?: UserContext): McpServer {
  const server = new McpServer({
    name: "document-ai",
    version: "1.0.0",
  });

  registerOcrDocument(server, userContext);
  registerParseForm(server, userContext);
  registerParseLayout(server, userContext);
  registerGetResult(server);
  registerUploadDocument(server, userContext);
  registerGetQuota(server, userContext);

  return server;
}
