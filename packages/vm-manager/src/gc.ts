import { type Database, accounts } from "@agentos/shared";
import { lt } from "drizzle-orm";
import type { VMManager } from "./interface.ts";

/**
 * Stop idle VM compute without deleting persistent workspace data. Account deletion
 * must be an explicit lifecycle action, not a side effect of inactivity.
 */
export async function gcIdleVMs(vm: VMManager, db: Database, thresholdDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdDays * 86_400_000);
  const idle = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(lt(accounts.lastActiveAt, cutoff));
  const idleIds = new Set(idle.map((account) => account.id));
  let suspended = 0;
  for (const info of await vm.listVMs()) {
    if (!idleIds.has(info.accountId) || info.status !== "running") continue;
    await vm.suspendVM(info.vmId);
    suspended += 1;
  }
  return suspended;
}
