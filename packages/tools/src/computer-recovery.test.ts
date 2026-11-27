import { describe, expect, test } from "bun:test";
import {
  alternateTarget,
  chooseRecovery,
  markRef,
  needsUser,
  shouldPaste,
  zoomClip,
} from "./computer-recovery.ts";
import type { TargetElement } from "./computer-use.ts";

function button(ref: string, name = ""): TargetElement {
  return {
    ref,
    role: "button",
    name,
    selector: "button",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    iconOnly: !name,
    disabled: false,
  };
}

describe("computer recovery", () => {
  test("pastes long text and types short text", () => {
    expect(shouldPaste("hi")).toBe(false);
    expect(shouldPaste("x".repeat(120))).toBe(true);
  });

  test("asks the user on a captcha or login wall", () => {
    expect(needsUser("https://accounts.example/login", [])).toMatch(/SecureHandoff/);
    expect(needsUser("https://chatgpt.com/", ["Verify you are human"])).toMatch(
      /captcha|verification/i,
    );
    expect(needsUser("https://chatgpt.com/", ["Send prompt"])).toBeNull();
  });

  test("walks rescreenshot, another mark, scroll, keyboard, then ask", () => {
    expect(chooseRecovery(0, null).kind).toBe("rescreenshot");
    expect(chooseRecovery(2, null).kind).toBe("alternate");
    expect(chooseRecovery(3, null).kind).toBe("scroll");
    expect(chooseRecovery(4, null).kind).toBe("keyboard");
    expect(chooseRecovery(5, null).kind).toBe("ask");
    expect(chooseRecovery(1, "Call SecureHandoff").kind).toBe("ask");
  });

  test("suggests a different button than the one that failed", () => {
    const next = alternateTarget([button("e1", "Attach"), button("e2", "Send")], "e1");
    expect(next?.ref).toBe("e2");
    expect(alternateTarget([button("e1")], "e1")).toBeNull();
  });

  test("crops a zoom around a point and stays inside the viewport", () => {
    expect(zoomClip(10, 10, 200, { width: 1280, height: 800 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(zoomClip(640, 400, 240, { width: 1280, height: 800 }).x).toBe(520);
  });

  test("maps a set-of-marks index onto an element ref", () => {
    expect(markRef(3)).toBe("e3");
    expect(markRef(0)).toBeUndefined();
    expect(markRef(1.5)).toBeUndefined();
  });
});
