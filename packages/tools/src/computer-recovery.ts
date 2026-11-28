/** Planner hints and stuck-action recovery. No browser or network access. */

import type { TargetElement } from "./computer-use.ts";

export const PASTE_THRESHOLD = 120;

export type RecoveryKind = "rescreenshot" | "scroll" | "keyboard" | "alternate" | "ask";

export interface Recovery {
  kind: RecoveryKind;
  hint: string;
  key?: string;
}

const WALL =
  /captcha|log in|log-in|login|sign in|sign-in|password|verify you are human|two-factor|2fa|one-time code|otp/i;

export function shouldPaste(text: string): boolean {
  return text.length >= PASTE_THRESHOLD;
}

export function needsUser(url: string, names: string[]): string | null {
  const blob = `${url}\n${names.join("\n")}`;
  if (!WALL.test(blob)) return null;
  return "A login, captcha, or verification wall is on screen. Call SecureHandoff so the user can take over. Do not guess passwords or captcha answers.";
}

/** What to try after an action leaves the screen unchanged. `repeats` comes from noteStuck. */
export function chooseRecovery(repeats: number, userNeeded: string | null): Recovery {
  if (userNeeded) return { kind: "ask", hint: userNeeded };
  if (repeats >= 5) {
    return {
      kind: "ask",
      hint: "This is not changing. Call SecureHandoff if a person must continue, or SendToUser with what you tried and stop.",
    };
  }
  if (repeats >= 4) {
    return {
      kind: "keyboard",
      key: "Tab",
      hint: "Move focus with Tab, then press Enter on the focused control.",
    };
  }
  if (repeats >= 3) {
    return {
      kind: "scroll",
      hint: "Scroll and look again. The control may be offscreen.",
    };
  }
  if (repeats >= 2) {
    return {
      kind: "alternate",
      hint: "Pick a different numbered mark. Do not repeat the same click.",
    };
  }
  return {
    kind: "rescreenshot",
    hint: "The screen looked unchanged. Use the numbered marks on the latest view.",
  };
}

export function alternateTarget(
  elements: TargetElement[],
  failedRef?: string,
): TargetElement | null {
  return (
    elements.find(
      (element) => element.role === "button" && !element.disabled && element.ref !== failedRef,
    ) ?? null
  );
}

export function zoomClip(
  x: number,
  y: number,
  size: number,
  viewport: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const span = Math.max(80, Math.min(640, Math.round(size) || 240));
  const width = Math.min(span, Math.max(1, viewport.width));
  const height = Math.min(span, Math.max(1, viewport.height));
  const left = clamp(x - width / 2, 0, Math.max(0, viewport.width - width));
  const top = clamp(y - height / 2, 0, Math.max(0, viewport.height - height));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function markRef(mark: number | undefined): string | undefined {
  if (mark === undefined || !Number.isInteger(mark) || mark < 1 || mark > 100) return undefined;
  return `e${mark}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
