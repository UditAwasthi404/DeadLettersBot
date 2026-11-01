/**
 * Hosted automation shadows (REQ-R01–R03).
 * Startup reconciliation upserts local routines and leaves orphan shadows in place.
 * Deleting a routine on a hosted box hides it locally; POST /v1/automation/sync removes the shadow.
 * Session boxes (BOX_HOSTED_FOR_AUTOMATION_SYNC=0) skip this path.
 */
import {
  type Database,
  automationShadows,
  routineRuns,
  routines,
} from "@agentOS/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";

export function isBoxHostedForAutomationSync(): boolean {
  return process.env.BOX_HOSTED_FOR_AUTOMATION_SYNC !== "0";
}

/** Explicit sync deletes shadows whose routine is gone. Startup reconciliation does not. */
export function shadowIdsToDelete(
  liveRoutineIds: readonly string[],
  shadowRoutineIds: readonly string[],
  mode: "reconcile" | "sync",
): string[] {
  if (mode === "reconcile") return [];
  const live = new Set(liveRoutineIds);
  return shadowRoutineIds.filter((id) => !live.has(id));
}

type RoutineRow = typeof routines.$inferSelect;

export async function upsertAutomationShadow(db: Database, routine: RoutineRow): Promise<void> {
  if (!isBoxHostedForAutomationSync() || routine.deletedAt) return;
  await db
    .insert(automationShadows)
    .values({
      accountId: routine.accountId,
      routineId: routine.id,
      botId: routine.botId,
      skillId: routine.skillId,
      name: routine.name,
      trigger: routine.trigger,
      enabled: routine.enabled,
      onError: routine.onError,
    })
    .onConflictDoUpdate({
      target: automationShadows.routineId,
      set: {
        accountId: routine.accountId,
        botId: routine.botId,
        skillId: routine.skillId,
        name: routine.name,
        trigger: routine.trigger,
        enabled: routine.enabled,
        onError: routine.onError,
        updatedAt: new Date(),
      },
    });
}

export async function reconcileAutomationShadows(db: Database): Promise<number> {
  if (!isBoxHostedForAutomationSync()) return 0;
  const rows = await db.select().from(routines).where(isNull(routines.deletedAt));
  for (const row of rows) await upsertAutomationShadow(db, row);
  return rows.length;
}

export async function loadScheduleSources(db: Database): Promise<RoutineRow[]> {
  if (!isBoxHostedForAutomationSync()) {
    return db
      .select()
      .from(routines)
      .where(and(eq(routines.enabled, true), isNull(routines.deletedAt)));
  }
  const rows = await db
    .select()
    .from(automationShadows)
    .where(eq(automationShadows.enabled, true));
  return rows.map((shadow) => ({
    id: shadow.routineId,
    accountId: shadow.accountId,
    botId: shadow.botId,
    skillId: shadow.skillId,
    name: shadow.name,
    trigger: shadow.trigger,
    enabled: shadow.enabled,
    onError: shadow.onError,
    lastTriggeredAt: shadow.lastTriggeredAt,
    deletedAt: null,
    createdAt: shadow.createdAt,
    updatedAt: shadow.updatedAt,
  }));
}

export async function syncAutomationShadows(
  db: Database,
  accountId: string,
): Promise<{ upserted: number; deleted: number }> {
  if (!isBoxHostedForAutomationSync())
    throw new Error("this box is excluded from hosted automation sync");
  const live = await db
    .select()
    .from(routines)
    .where(and(eq(routines.accountId, accountId), isNull(routines.deletedAt)));
  for (const row of live) await upsertAutomationShadow(db, row);
  const shadows = await db
    .select({ routineId: automationShadows.routineId })
    .from(automationShadows)
    .where(eq(automationShadows.accountId, accountId));
  const removeIds = shadowIdsToDelete(
    live.map((row) => row.id),
    shadows.map((row) => row.routineId),
    "sync",
  );
  if (removeIds.length === 0) return { upserted: live.length, deleted: 0 };
  await db
    .delete(automationShadows)
    .where(
      and(
        eq(automationShadows.accountId, accountId),
        inArray(automationShadows.routineId, removeIds),
      ),
    );
  await db.delete(routineRuns).where(inArray(routineRuns.routineId, removeIds));
  await db
    .delete(routines)
    .where(and(eq(routines.accountId, accountId), inArray(routines.id, removeIds)));
  return { upserted: live.length, deleted: removeIds.length };
}
