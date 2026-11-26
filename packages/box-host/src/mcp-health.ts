import { decryptToken } from "@agentos/connectors";
import { mcpServers } from "@agentos/shared";
import { discoverMcpTools } from "@agentos/tools";
import { and, eq } from "drizzle-orm";
import type { GatewayDeps } from "./gateway.ts";
import { loggedError, logger } from "./logger.ts";

let activeRun: Promise<number> | undefined;

/** Refresh last-known MCP health and discovered tool catalogs without invoking tools. */
export function processMcpHealthChecks(deps: GatewayDeps): Promise<number> {
  if (activeRun) return activeRun;
  activeRun = refreshMcpHealth(deps).finally(() => {
    activeRun = undefined;
  });
  return activeRun;
}

async function refreshMcpHealth(deps: GatewayDeps): Promise<number> {
  const rows = await deps.db
    .select({
      id: mcpServers.id,
      accountId: mcpServers.accountId,
      url: mcpServers.url,
      authTokenCiphertext: mcpServers.authTokenCiphertext,
    })
    .from(mcpServers);
  let next = 0;
  let checked = 0;
  const workerCount = Math.min(rows.length, 4);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        if (!row) continue;
        let health: "healthy" | "error" = "healthy";
        let cachedTools: Awaited<ReturnType<typeof discoverMcpTools>> | undefined;
        try {
          const key = process.env.CONNECTOR_ENCRYPTION_KEY;
          if (row.authTokenCiphertext && !key)
            throw new Error("MCP token decryption is not configured");
          const token =
            row.authTokenCiphertext && key
              ? await decryptToken(
                  row.authTokenCiphertext,
                  key,
                  process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS,
                  async (ciphertext) => {
                    await deps.db
                      .update(mcpServers)
                      .set({ authTokenCiphertext: ciphertext })
                      .where(eq(mcpServers.id, row.id));
                  },
                )
              : undefined;
          cachedTools = await discoverMcpTools(row.url, token);
        } catch (err) {
          health = "error";
          logger.warn({ ...loggedError(err), serverId: row.id }, "MCP health check failed");
        }
        await deps.db
          .update(mcpServers)
          .set({
            lastHealth: health,
            lastError:
              health === "error"
                ? "Discovery failed; check endpoint availability, tunnel status, and credentials."
                : null,
            lastCheckedAt: new Date(),
            ...(cachedTools ? { cachedTools } : {}),
          })
          .where(and(eq(mcpServers.id, row.id), eq(mcpServers.accountId, row.accountId)));
        checked += 1;
      }
    }),
  );
  return checked;
}
