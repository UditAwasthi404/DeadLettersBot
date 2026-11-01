import { describe, expect, test } from "bun:test";
import { shouldRecordStall, subagentIsStalled } from "./subagent-stall.ts";

const start = new Date("2026-10-30T12:00:00.000Z");

describe("subagent stall", () => {
  test("running children stall from the last checkpoint", () => {
    expect(
      subagentIsStalled(
        { status: "running", createdAt: start, startedAt: start, lastProgressAt: start },
        start.getTime() + 180_000,
        180_000,
      ),
    ).toBe(true);
    expect(
      subagentIsStalled(
        {
          status: "running",
          createdAt: start,
          startedAt: start,
          lastProgressAt: new Date(start.getTime() + 120_000),
        },
        start.getTime() + 180_000,
        180_000,
      ),
    ).toBe(false);
  });

  test("queued children stall from creation, and finished children do not", () => {
    expect(
      subagentIsStalled(
        { status: "queued", createdAt: start, startedAt: null, lastProgressAt: null },
        start.getTime() + 180_000,
        180_000,
      ),
    ).toBe(true);
    expect(
      subagentIsStalled(
        { status: "completed", createdAt: start, startedAt: start, lastProgressAt: start },
        start.getTime() + 1_000_000,
        180_000,
      ),
    ).toBe(false);
  });

  test("stall events are not recorded again inside the same window", () => {
    const now = start.getTime() + 200_000;
    expect(shouldRecordStall([], now, 180_000)).toBe(true);
    expect(shouldRecordStall([{ at: new Date(now - 10_000).toISOString() }], now, 180_000)).toBe(
      false,
    );
    expect(shouldRecordStall([{ at: new Date(now - 180_000).toISOString() }], now, 180_000)).toBe(
      true,
    );
  });
});
