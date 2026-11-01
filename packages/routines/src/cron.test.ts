import { describe, expect, test } from "bun:test";
import { isValidCron, matchesCron, nextCronOccurrence } from "./index.ts";

describe("cron expressions", () => {
  test("accepts wildcards, lists, ranges, and steps", () => {
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("0 0 1 * 0,7")).toBe(true);
    const atQuarter = new Date(2026, 10, 1, 12, 15, 30);
    expect(matchesCron("*/15 * * * *", atQuarter)).toBe(true);
    expect(matchesCron("*/15 * * * *", new Date(2026, 10, 1, 12, 7, 0))).toBe(false);
  });

  test("treats weekday 0 and 7 as Sunday", () => {
    const sunday = new Date(2026, 10, 1, 8, 0, 0);
    expect(sunday.getDay()).toBe(0);
    expect(matchesCron("0 8 * * 0", sunday)).toBe(true);
    expect(matchesCron("0 8 * * 7", sunday)).toBe(true);
    expect(matchesCron("0 8 * * 1", sunday)).toBe(false);
  });

  test("an empty list item does not match every value", () => {
    expect(isValidCron("1,,2 * * * *")).toBe(false);
    expect(isValidCron("1, * * * *")).toBe(false);
    expect(matchesCron("1,,2 * * * *", new Date(2026, 10, 1, 12, 7, 0))).toBe(false);
    expect(nextCronOccurrence("1,,2 * * * *", new Date(2026, 10, 1, 12, 0, 0))).toBeNull();
  });

  test("rejects inverted ranges and steps that never advance", () => {
    expect(isValidCron("10-1 * * * *")).toBe(false);
    expect(isValidCron("*/0 * * * *")).toBe(false);
    expect(isValidCron("* * * * 8")).toBe(false);
  });

  test("returns null when the calendar can never match", () => {
    expect(nextCronOccurrence("0 0 31 2 *", new Date(2026, 0, 1))).toBeNull();
  });

  test("finds the next minute after the given instant", () => {
    const next = nextCronOccurrence("0 9 * * 1", new Date(2026, 10, 1, 12, 0, 0));
    expect(next).not.toBeNull();
    expect(next?.getDay()).toBe(1);
    expect(next?.getHours()).toBe(9);
    expect(next?.getMinutes()).toBe(0);
    expect(matchesCron("0 9 * * 1", next ?? new Date(0))).toBe(true);
  });
});
