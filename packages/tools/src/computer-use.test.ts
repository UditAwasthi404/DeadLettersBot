import { describe, expect, test } from "bun:test";
import {
  type TargetElement,
  cssToImage,
  findElement,
  imageToCss,
  interpretClickSelector,
  jpegSize,
  nextJpegQuality,
  normalizeKey,
  noteStuck,
  presentToolResult,
} from "./computer-use.ts";

const geo = {
  imageWidth: 640,
  imageHeight: 400,
  viewportWidth: 1280,
  viewportHeight: 800,
  deviceScaleFactor: 2,
};

function element(
  patch: Partial<TargetElement> & Pick<TargetElement, "ref" | "role">,
): TargetElement {
  return {
    name: "",
    selector: patch.role,
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    iconOnly: false,
    disabled: false,
    ...patch,
  };
}

describe("computer-use coordinates", () => {
  test("scales screenshot pixels onto the viewport and back", () => {
    expect(imageToCss(320, 200, geo)).toEqual({ x: 640, y: 400 });
    expect(cssToImage(640, 400, geo)).toEqual({ x: 320, y: 200 });
  });

  test("clamps points that fall outside the viewport", () => {
    expect(imageToCss(-20, 900, geo).x).toBe(0);
    expect(imageToCss(-20, 900, geo).y).toBe(799);
  });
});

describe("computer-use element targeting", () => {
  const composer = element({
    ref: "e1",
    role: "textbox",
    name: "Message ChatGPT",
    x: 200,
    y: 680,
    width: 700,
    height: 48,
  });
  const attach = element({
    ref: "e2",
    role: "button",
    name: "",
    selector: "button",
    x: 220,
    y: 684,
    width: 32,
    height: 32,
    iconOnly: true,
  });
  const sendIcon = element({
    ref: "e3",
    role: "button",
    name: "",
    selector: "button[data-testid='send-button']",
    x: 980,
    y: 684,
    width: 32,
    height: 32,
    iconOnly: true,
  });

  test("finds ChatGPT's icon-only send button beside the composer", () => {
    const found = findElement([composer, attach, sendIcon], "Send");
    expect(found.element?.ref).toBe("e3");
    expect(found.fallback).toBeNull();
  });

  test("chooses the rightmost unlabeled icon when the send control has no name", () => {
    const plain = element({
      ref: "e5",
      role: "button",
      name: "",
      selector: "button",
      x: 1000,
      y: 684,
      width: 32,
      height: 32,
      iconOnly: true,
    });
    const found = findElement([composer, attach, plain], "Send");
    expect(found.element?.ref).toBe("e5");
    expect(found.reason).toContain("icon");
  });

  test("prefers an accessible send name over a nearby icon", () => {
    const named = element({
      ref: "e4",
      role: "button",
      name: "Send prompt",
      selector: "button[aria-label='Send prompt']",
      x: 900,
      y: 684,
      width: 36,
      height: 36,
    });
    const found = findElement([composer, attach, sendIcon, named], "send button");
    expect(found.element?.ref).toBe("e4");
  });

  test("presses Enter when a send control is not on screen", () => {
    const found = findElement([composer], "Send");
    expect(found.element).toBeNull();
    expect(found.fallback).toBe("enter");
  });

  test("does not click an unrelated control for a weak query", () => {
    const settings = element({
      ref: "e9",
      role: "button",
      name: "Settings",
      x: 20,
      y: 20,
    });
    const found = findElement([settings], "send");
    expect(found.element).toBeNull();
  });

  test("treats a plain label as a query and a CSS selector as a selector", () => {
    expect(interpretClickSelector("Send")).toEqual({ query: "Send" });
    expect(interpretClickSelector("button[data-testid='send-button']").selector).toContain(
      "send-button",
    );
    expect(interpretClickSelector("textarea").selector).toBe("textarea");
  });
});

describe("computer-use guards", () => {
  test("reads JPEG size from the start-of-frame marker", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x90, 0x02, 0x80, 0x01, 0x00, 0x00, 0xff,
      0xd9,
    ]);
    expect(jpegSize(bytes)).toEqual({ width: 640, height: 400 });
  });

  test("recaptures only when the JPEG exceeds the budget", () => {
    expect(nextJpegQuality(40_000, 40)).toBeNull();
    expect(nextJpegQuality(120_000, 40)).toBe(24);
    expect(nextJpegQuality(120_000, 24)).toBeNull();
  });

  test("accepts typing keys and rejects shell-like chords", () => {
    expect(normalizeKey("Enter")).toBe("Enter");
    expect(normalizeKey("Control+Enter")).toBe("Control+Enter");
    expect(normalizeKey("rm -rf")).toBeNull();
    expect(normalizeKey("")).toBeNull();
  });

  test("flags the third identical unchanged action as stuck", () => {
    let state = { signature: "", fingerprint: "", repeats: 0 };
    state = noteStuck(state, "click|send", "https://chatgpt.com\n").state;
    state = noteStuck(state, "click|send", "https://chatgpt.com\n").state;
    const third = noteStuck(state, "click|send", "https://chatgpt.com\n");
    expect(third.stuck).toBe(true);
  });

  test("strips screenshot bytes before a result is shown", () => {
    const shown = presentToolResult({
      ok: true,
      image: { mediaType: "image/jpeg", data: "abc" },
      dataUrl: "data:image/jpeg;base64,abc",
      elements: [{ ref: "e1" }],
    }) as { ok: boolean; image?: unknown; dataUrl?: unknown; elements: unknown[] };
    expect(shown.ok).toBe(true);
    expect(shown.image).toBeUndefined();
    expect(shown.dataUrl).toBeUndefined();
    expect(shown.elements).toHaveLength(1);
  });
});
