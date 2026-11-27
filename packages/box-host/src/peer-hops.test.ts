import { describe, expect, test } from "bun:test";
import { PEER_MESSAGE_HOP_BUDGET, peerHopBudgetExceeded } from "./peer-hops.ts";

describe("peer hop budget", () => {
  test("allows hops through the budget and blocks the next", () => {
    expect(PEER_MESSAGE_HOP_BUDGET).toBe(5);
    expect(peerHopBudgetExceeded(5)).toBe(false);
    expect(peerHopBudgetExceeded(6)).toBe(true);
  });
});
