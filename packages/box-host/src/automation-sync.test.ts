import { describe, expect, test } from "bun:test";
import { isBoxHostedForAutomationSync, shadowIdsToDelete } from "./automation-sync.ts";

describe("automation sync", () => {
  test("startup reconciliation does not delete orphan shadows", () => {
    expect(shadowIdsToDelete(["live"], ["live", "removed"], "reconcile")).toEqual([]);
  });

  test("explicit sync deletes shadows whose local routine is gone", () => {
    expect(shadowIdsToDelete(["live"], ["live", "removed"], "sync")).toEqual(["removed"]);
  });

  test("session boxes are excluded when the flag is 0", () => {
    const previous = process.env.BOX_HOSTED_FOR_AUTOMATION_SYNC;
    process.env.BOX_HOSTED_FOR_AUTOMATION_SYNC = "0";
    expect(isBoxHostedForAutomationSync()).toBe(false);
    // process.env stores strings, so assigning undefined would leave the text "undefined".
    // biome-ignore lint/performance/noDelete: env keys must be removed, not set to the string "undefined"
    delete process.env.BOX_HOSTED_FOR_AUTOMATION_SYNC;
    expect(isBoxHostedForAutomationSync()).toBe(true);
    // biome-ignore lint/performance/noDelete: env keys must be removed, not set to the string "undefined"
    if (previous === undefined) delete process.env.BOX_HOSTED_FOR_AUTOMATION_SYNC;
    else process.env.BOX_HOSTED_FOR_AUTOMATION_SYNC = previous;
  });
});
