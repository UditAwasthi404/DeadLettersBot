import { describe, expect, test } from "bun:test";
import {
  looksLikeDesktopRefusal,
  shouldNudgeDesktopUse,
  userLikelyWantsDesktop,
} from "./desktop-nudge.ts";

describe("desktop nudge heuristics", () => {
  test("detects YouTube / Canva style tasks", () => {
    expect(userLikelyWantsDesktop("open canva and make a thumbnail")).toBe(true);
    expect(userLikelyWantsDesktop("create a youtube playlist with these videos")).toBe(true);
    expect(userLikelyWantsDesktop("what is 2+2?")).toBe(false);
  });

  test("detects chatbot refusal dumps", () => {
    expect(
      looksLikeDesktopRefusal(
        "I don't have access to create a playlist. Add them yourself:\nhttps://www.youtube.com/watch?v=abc",
      ),
    ).toBe(true);
    expect(looksLikeDesktopRefusal("Opened YouTube and created the playlist.")).toBe(false);
  });

  test("nudges SendToUser end-turn without Computer on desktop tasks", () => {
    expect(
      shouldNudgeDesktopUse({
        desktopUsedThisTurn: false,
        nudgeAlreadySent: false,
        userPrompt: "make a youtube playlist with HTML CSS JS courses",
        sendToUserContents: [
          "I cannot create a playlist from your account. Add these yourself: https://www.youtube.com/watch?v=1",
        ],
        endTurn: true,
      }),
    ).toBe(true);

    expect(
      shouldNudgeDesktopUse({
        desktopUsedThisTurn: true,
        nudgeAlreadySent: false,
        userPrompt: "make a youtube playlist",
        sendToUserContents: ["Done — playlist created."],
        endTurn: true,
      }),
    ).toBe(false);
  });
});
