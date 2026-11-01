/** A queued or running subagent is stalled when it makes no checkpoint progress in time. */

export function subagentStallWindowMs(): number {
  const raw = Number(process.env.SUBAGENT_STALL_MS ?? 180_000);
  if (!Number.isInteger(raw) || raw < 1_000 || raw > 86_400_000) return 180_000;
  return raw;
}

export function subagentIsStalled(
  input: {
    status: string;
    createdAt: Date;
    startedAt: Date | null;
    lastProgressAt: Date | null;
  },
  now: number,
  stallMs: number,
): boolean {
  if (input.status !== "queued" && input.status !== "running") return false;
  const mark =
    input.status === "running"
      ? (input.lastProgressAt ?? input.startedAt ?? input.createdAt)
      : input.createdAt;
  return now - mark.getTime() >= stallMs;
}

export function shouldRecordStall(events: Array<{ at: string }>, now: number, stallMs: number): boolean {
  const last = events.at(-1);
  if (!last) return true;
  const at = Date.parse(last.at);
  return !Number.isFinite(at) || now - at >= stallMs;
}
