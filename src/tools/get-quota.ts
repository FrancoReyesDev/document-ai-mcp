import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCredits } from "../storage/index.js";
import type { UserContext } from "../types.js";

export function registerGetQuota(server: McpServer, userContext?: UserContext): void {
  server.tool(
    "get_quota",
    "Check your available pages and usage stats.",
    {},
    async () => {
      if (!userContext) {
        return { content: [{ type: "text" as const, text: "Error: not authenticated" }], isError: true };
      }

      const credits = await getCredits(userContext.apiKeyHash);

      return {
        content: [{
          type: "text" as const,
          text: `Pages available: ${credits.pagesAvailable}\nUsed this month: ${credits.pagesUsedThisMonth}\nTotal used: ${credits.pagesUsedTotal}`,
        }],
      };
    },
  );
}
