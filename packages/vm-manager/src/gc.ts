import { type Database, accounts } from "@agentOS/shared";
import { lt } from "drizzle-orm";
import type { VMManager } from "./interface.ts";

/**
 * Terminate VMs whose accounts have been idle longer than the threshold.
 * shortcut: no 7-day user warning yet; add when an email or notification channel exists.
 */
export async function gcIdleVMs(
  vm: VMManager,
  db: Database,
  thresholdDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdDays * 86_400_000);
  const idle = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(lt(accounts.lastActiveAt, cutoff));
  const idleIds = new Set(idle.map((account) => account.id));
  let terminated = 0;
  for (const info of await vm.listVMs()) {
    if (!idleIds.has(info.accountId) || info.status === "terminated") continue;
    await vm.terminateVM(info.vmId);
    terminated += 1;
  }
  return terminated;
}
