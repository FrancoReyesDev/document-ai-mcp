import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkAndResetQuota } from "../storage/index.js";
import type { UserContext } from "../types.js";

export function registerGetQuota(server: McpServer, userContext?: UserContext): void {
  server.tool(
    "get_quota",
    "Check your current usage quota: pages used this month, monthly limit, and plan.",
    {},
    async () => {
      if (!userContext) {
        return { content: [{ type: "text" as const, text: "Error: not authenticated" }], isError: true };
      }

      const quota = await checkAndResetQuota(userContext.apiKeyHash);
      const remaining = quota.monthlyPages - quota.pagesUsed;

      return {
        content: [{
          type: "text" as const,
          text: `Plan: ${userContext.plan}\nPages used: ${quota.pagesUsed}/${quota.monthlyPages}\nRemaining: ${remaining}\nPeriod: ${quota.currentMonth}`,
        }],
      };
    },
  );
}
