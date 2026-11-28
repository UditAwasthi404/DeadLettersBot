/** Playwright mouse, keyboard, and accessibility actions for the computer-use loop. */

import type { Page } from "playwright";
import {
  alternateTarget,
  chooseRecovery,
  markRef,
  needsUser,
  shouldPaste,
  zoomClip,
} from "./computer-recovery.ts";
import {
  type ComputerRequest,
  type ModelImage,
  type ScreenGeometry,
  type StuckState,
  type TargetElement,
  actionSignature,
  cssToImage,
  emptyStuck,
  findElement,
  imageToCss,
  interpretClickSelector,
  jpegSize,
  nextJpegQuality,
  normalizeKey,
  noteStuck,
  screenFingerprint,
  summarizeElements,
} from "./computer-use.ts";

export interface ComputerRuntime {
  geometry: ScreenGeometry | null;
  elements: TargetElement[];
  stuck: StuckState;
  plan: string;
  lastShotAt: number;
}

export interface ComputerHooks {
  /** Move the OS pointer in viewport CSS pixels. Failures are ignored by the caller. */
  movePointer?: (point: { x: number; y: number }) => void;
}

export interface ComputerOutcome {
  runtime: ComputerRuntime;
  result: Record<string, unknown>;
  image?: ModelImage;
}

interface RawElement {
  role: string;
  name: string;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
  iconOnly: boolean;
  disabled: boolean;
}

interface Observed {
  runtime: ComputerRuntime;
  geo: ScreenGeometry;
  url: string;
  image?: ModelImage;
  imageBytes: number;
}

export function emptyRuntime(): ComputerRuntime {
  return { geometry: null, elements: [], stuck: emptyStuck(), plan: "", lastShotAt: 0 };
}

export async function runComputerAction(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  hooks: ComputerHooks = {},
): Promise<ComputerOutcome> {
  const started = performance.now();
  const marked = markRef(request.mark);
  const actionRequest = marked && !request.ref ? { ...request, ref: marked } : request;
  try {
    if (actionRequest.action === "plan") return planUpdate(actionRequest, runtime);
    if (actionRequest.action === "zoom") return await zoom(page, actionRequest, runtime, started);
    if (actionRequest.action === "wait")
      return await waitQuiet(page, actionRequest, runtime, started);
    if (actionRequest.action === "screenshot" || actionRequest.action === "find")
      return await look(page, actionRequest, runtime, started);
    if (actionRequest.action === "key")
      return await pressKey(page, actionRequest, runtime, started);
    if (actionRequest.action === "type")
      return await typeText(page, actionRequest, runtime, hooks, started);
    if (actionRequest.action === "scroll")
      return await scrollWheel(page, actionRequest, runtime, hooks, started);
    if (actionRequest.action === "drag")
      return await dragPointer(page, actionRequest, runtime, hooks, started);
    if (actionRequest.action === "move")
      return await movePointer(page, actionRequest, runtime, hooks, started);
    if (
      actionRequest.action === "tabs" ||
      actionRequest.action === "switch_tab" ||
      actionRequest.action === "dialog" ||
      actionRequest.action === "upload" ||
      actionRequest.action === "download"
    ) {
      return {
        runtime,
        result: {
          ok: false,
          action: actionRequest.action,
          message: "This action is handled by the browser session.",
        },
      };
    }
    await waitForQuiet(page);
    return await performClick(
      page,
      {
        ref: actionRequest.ref,
        query: actionRequest.query,
        x: actionRequest.x,
        y: actionRequest.y,
        button: actionRequest.action === "right_click" ? "right" : "left",
        clickCount: actionRequest.action === "double_click" ? 2 : 1,
        plan: actionRequest.plan,
      },
      runtime,
      hooks,
      started,
    );
  } catch (err) {
    return {
      runtime,
      result: {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - started),
      },
    };
  }
}

export async function performClick(
  page: Page,
  input: {
    selector?: string;
    ref?: string;
    query?: string;
    x?: number;
    y?: number;
    button?: "left" | "right";
    clickCount?: number;
    plan?: string;
  },
  runtime: ComputerRuntime,
  hooks: ComputerHooks = {},
  started = performance.now(),
): Promise<ComputerOutcome> {
  const interpreted = input.selector ? interpretClickSelector(input.selector) : {};
  if (interpreted.selector) {
    const box = await boxOf(page, interpreted.selector);
    if (box) {
      const before = screenFingerprint(page.url(), runtime.elements);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await clickAt(page, x, y, input.button ?? "left", input.clickCount ?? 1, hooks);
      return finish(
        page,
        runtime,
        clickRequest(input),
        before,
        {
          action: "click",
          target: { selector: interpreted.selector },
          reason: "element box",
          css: { x: Math.round(x), y: Math.round(y) },
          ...(input.plan ? { plan: input.plan } : {}),
        },
        started,
      );
    }
  }
  const query = input.query ?? interpreted.query ?? queryFromSelector(input.selector);
  const elements = await elementsFor(page, runtime, { ref: input.ref, query });
  const geo = geometryOf(runtime, await viewportOf(page));
  const resolved = resolvePoint({ ref: input.ref, query, x: input.x, y: input.y }, elements, geo);
  const before = screenFingerprint(page.url(), elements);
  if (resolved.kind === "key") {
    await page.keyboard.press(resolved.key);
    return finish(
      page,
      { ...runtime, elements, geometry: geo },
      clickRequest(input),
      before,
      {
        ok: true,
        action: "key",
        key: resolved.key,
        fallback: "enter",
        reason: resolved.reason,
        ...(input.plan ? { plan: input.plan } : {}),
      },
      started,
    );
  }
  if (resolved.kind === "miss") {
    const looked = await observe(page, { ...runtime, elements, geometry: geo }, true);
    return {
      runtime: looked.runtime,
      image: looked.image,
      result: {
        ok: false,
        action: "click",
        message: resolved.reason,
        elements: summarizeElements(looked.runtime.elements, looked.geo),
        coordinateSpace: "screenshot pixels",
        ...(input.plan ? { plan: input.plan } : {}),
        durationMs: Math.round(performance.now() - started),
      },
    };
  }
  await clickAt(page, resolved.x, resolved.y, input.button ?? "left", input.clickCount ?? 1, hooks);
  return finish(
    page,
    { ...runtime, elements, geometry: geo },
    clickRequest(input),
    before,
    {
      action:
        input.clickCount === 2
          ? "double_click"
          : input.button === "right"
            ? "right_click"
            : "click",
      reason: resolved.reason,
      ...(resolved.target
        ? {
            target: {
              ref: resolved.target.ref,
              role: resolved.target.role,
              name: resolved.target.name,
              iconOnly: resolved.target.iconOnly,
            },
          }
        : {}),
      css: { x: Math.round(resolved.x), y: Math.round(resolved.y) },
      ...(input.plan ? { plan: input.plan } : {}),
    },
    started,
  );
}

export async function wheelScroll(
  page: Page,
  direction: "up" | "down",
  px: number | undefined,
): Promise<Record<string, unknown>> {
  const amount = Math.max(40, Math.min(1600, px ?? 480));
  const viewport = await viewportOf(page);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, direction === "down" ? amount : -amount);
  return { ok: true, direction, px: amount };
}

async function look(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  started: number,
): Promise<ComputerOutcome> {
  if (
    request.action === "screenshot" &&
    runtime.lastShotAt > 0 &&
    Date.now() - runtime.lastShotAt < 1500 &&
    runtime.elements.length > 0 &&
    runtime.geometry
  ) {
    return {
      runtime,
      result: {
        ok: true,
        action: "screenshot",
        cached: true,
        verified: true,
        elements: summarizeElements(runtime.elements, runtime.geometry),
        message: "The screen was just captured. Act on the numbered marks.",
        ...(runtime.plan ? { plan: runtime.plan } : {}),
        durationMs: Math.round(performance.now() - started),
      },
    };
  }
  const observed = await observe(page, runtime, true);
  const match = request.query ? findElement(observed.runtime.elements, request.query) : null;
  return {
    runtime: observed.runtime,
    image: observed.image,
    result: {
      ok: true,
      action: request.action,
      url: observed.url,
      elements: summarizeElements(observed.runtime.elements, observed.geo),
      ...(match
        ? {
            match: match.element
              ? {
                  ref: match.element.ref,
                  role: match.element.role,
                  name: match.element.name,
                  ...cssToImage(
                    match.element.x + match.element.width / 2,
                    match.element.y + match.element.height / 2,
                    observed.geo,
                  ),
                }
              : null,
            reason: match.reason,
            ...(match.fallback ? { fallback: match.fallback } : {}),
          }
        : {}),
      imageBytes: observed.imageBytes,
      viewport: { width: observed.geo.viewportWidth, height: observed.geo.viewportHeight },
      imageSize: { width: observed.geo.imageWidth, height: observed.geo.imageHeight },
      deviceScaleFactor: observed.geo.deviceScaleFactor,
      coordinateSpace: "screenshot pixels",
      ...(request.plan ? { plan: request.plan } : {}),
      durationMs: Math.round(performance.now() - started),
    },
  };
}

async function pressKey(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  started: number,
): Promise<ComputerOutcome> {
  const key = normalizeKey(request.key);
  if (!key) {
    return {
      runtime,
      result: {
        ok: false,
        action: "key",
        message: "Use a key such as Enter, Tab, Escape, or Control+Enter",
      },
    };
  }
  const before = screenFingerprint(page.url(), runtime.elements);
  await page.keyboard.press(key);
  return finish(page, runtime, request, before, { action: "key", key }, started);
}

async function typeText(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  hooks: ComputerHooks,
  started: number,
): Promise<ComputerOutcome> {
  const text = request.text ?? "";
  if (!text) return { runtime, result: { ok: false, action: "type", message: "text is required" } };
  await waitForQuiet(page);
  const elements = await elementsFor(page, runtime, request);
  const geo = geometryOf(runtime, await viewportOf(page));
  const before = screenFingerprint(page.url(), elements);
  const interpreted = request.query ? interpretClickSelector(request.query) : {};
  if (interpreted.selector) {
    const box = await boxOf(page, interpreted.selector);
    if (box) await clickAt(page, box.x + box.width / 2, box.y + box.height / 2, "left", 1, hooks);
  } else if (request.ref || request.query || (request.x !== undefined && request.y !== undefined)) {
    const resolved = resolvePoint(
      interpreted.query ? { ...request, query: interpreted.query } : request,
      elements,
      geo,
    );
    if (resolved.kind === "point") await clickAt(page, resolved.x, resolved.y, "left", 1, hooks);
  }
  const typed = text.slice(0, 8000);
  await insertText(page, typed);
  if (request.submit) await page.keyboard.press("Enter");
  return finish(
    page,
    { ...runtime, elements, geometry: geo },
    request,
    before,
    {
      action: "type",
      typedCharacters: Math.min(text.length, 8000),
      pasted: shouldPaste(text),
      submit: Boolean(request.submit),
    },
    started,
  );
}

async function scrollWheel(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  hooks: ComputerHooks,
  started: number,
): Promise<ComputerOutcome> {
  const amount = Math.max(40, Math.min(1600, request.delta ?? 480));
  const direction = request.direction ?? "down";
  const viewport = await viewportOf(page);
  const geo = geometryOf(runtime, viewport);
  const point =
    request.x !== undefined && request.y !== undefined
      ? imageToCss(request.x, request.y, geo)
      : { x: viewport.width / 2, y: viewport.height / 2 };
  const before = screenFingerprint(page.url(), runtime.elements);
  await pointerTo(page, point.x, point.y, hooks);
  const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
  const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
  await page.mouse.wheel(dx, dy);
  return finish(
    page,
    { ...runtime, geometry: geo },
    request,
    before,
    { action: "scroll", direction, px: amount },
    started,
  );
}

async function dragPointer(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  hooks: ComputerHooks,
  started: number,
): Promise<ComputerOutcome> {
  const viewport = await viewportOf(page);
  const geo = geometryOf(runtime, viewport);
  if (
    request.x === undefined ||
    request.y === undefined ||
    request.toX === undefined ||
    request.toY === undefined
  ) {
    return {
      runtime,
      result: {
        ok: false,
        action: "drag",
        message: "drag requires x, y, toX, and toY in screenshot pixels",
      },
    };
  }
  const from = imageToCss(request.x, request.y, geo);
  const to = imageToCss(request.toX, request.toY, geo);
  const before = screenFingerprint(page.url(), runtime.elements);
  await pointerTo(page, from.x, from.y, hooks);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  hooks.movePointer?.(to);
  return finish(
    page,
    { ...runtime, geometry: geo },
    request,
    before,
    { action: "drag", from: roundPoint(from), to: roundPoint(to) },
    started,
  );
}

async function movePointer(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  hooks: ComputerHooks,
  started: number,
): Promise<ComputerOutcome> {
  const viewport = await viewportOf(page);
  const geo = geometryOf(runtime, viewport);
  const elements = await elementsFor(page, runtime, request);
  const resolved = resolvePoint(request, elements, geo);
  if (resolved.kind !== "point") {
    return {
      runtime,
      result: { ok: false, action: "move", message: "move requires a ref, query, or x/y" },
    };
  }
  await pointerTo(page, resolved.x, resolved.y, hooks);
  const imagePoint = cssToImage(resolved.x, resolved.y, geo);
  return {
    runtime: { ...runtime, elements, geometry: geo },
    result: {
      ok: true,
      action: "move",
      x: imagePoint.x,
      y: imagePoint.y,
      reason: resolved.reason,
      coordinateSpace: "screenshot pixels",
      ...(request.plan ? { plan: request.plan } : {}),
      durationMs: Math.round(performance.now() - started),
    },
  };
}

function planUpdate(request: ComputerRequest, runtime: ComputerRuntime): ComputerOutcome {
  const plan = (request.plan ?? "").trim().slice(0, 400);
  if (!plan) {
    return { runtime, result: { ok: false, action: "plan", message: "plan text is required" } };
  }
  return {
    runtime: { ...runtime, plan },
    result: { ok: true, action: "plan", plan, verified: true },
  };
}

async function finish(
  page: Page,
  runtime: ComputerRuntime,
  request: ComputerRequest,
  before: string,
  result: Record<string, unknown>,
  started: number,
): Promise<ComputerOutcome> {
  await page.waitForTimeout(140);
  let observed = await observe(page, runtime, true);
  const fingerprint = screenFingerprint(observed.url, observed.runtime.elements);
  const stuck = noteStuck(observed.runtime.stuck, actionSignature(request), fingerprint);
  observed.runtime.stuck = stuck.state;
  const changed = before !== fingerprint;
  const user = needsUser(
    observed.url,
    observed.runtime.elements.map((element) => element.name),
  );
  const recovery = chooseRecovery(stuck.state.repeats, user);
  let recoveryTaken = "";
  if (stuck.stuck && recovery.kind === "scroll") {
    await page.mouse.wheel(0, 480);
    recoveryTaken = "scrolled";
    observed = await observe(page, observed.runtime, true);
  } else if (stuck.stuck && recovery.kind === "keyboard") {
    await page.keyboard.press(recovery.key ?? "Tab");
    recoveryTaken = "pressed Tab";
    observed = await observe(page, observed.runtime, true);
  }
  const alternate =
    recovery.kind === "alternate" || !changed
      ? alternateTarget(observed.runtime.elements, request.ref)
      : null;
  const verified = changed || request.action === "move" || request.action === "plan";
  const plan = (request.plan ?? observed.runtime.plan).trim();
  if (plan) observed.runtime.plan = plan.slice(0, 400);
  return {
    runtime: observed.runtime,
    image: observed.image,
    result: {
      ok: true,
      ...result,
      url: observed.url,
      changed,
      verified,
      recovery: recovery.kind,
      elements: summarizeElements(observed.runtime.elements, observed.geo),
      imageBytes: observed.imageBytes,
      viewport: { width: observed.geo.viewportWidth, height: observed.geo.viewportHeight },
      imageSize: { width: observed.geo.imageWidth, height: observed.geo.imageHeight },
      deviceScaleFactor: observed.geo.deviceScaleFactor,
      coordinateSpace: "screenshot pixels",
      ...(observed.runtime.plan ? { plan: observed.runtime.plan } : {}),
      ...(user ? { askUser: true } : {}),
      ...(recoveryTaken ? { recoveryTaken } : {}),
      ...(alternate
        ? {
            alternate: {
              ref: alternate.ref,
              name: alternate.name,
              mark: markNumber(alternate.ref),
            },
          }
        : {}),
      hint: user ?? recovery.hint,
      durationMs: Math.round(performance.now() - started),
    },
  };
}

async function observe(
  page: Page,
  runtime: ComputerRuntime,
  withImage: boolean,
): Promise<Observed> {
  const elements = await readElements(page);
  const viewport = await viewportOf(page);
  let image: ModelImage | undefined;
  let imageBytes = 0;
  let imageWidth = viewport.width;
  let imageHeight = viewport.height;
  if (withImage) {
    await paintMarks(page, elements);
    const shot = await captureJpeg(page);
    image = { mediaType: "image/jpeg", data: shot.data };
    imageBytes = shot.bytes;
    if (shot.width > 0 && shot.height > 0) {
      imageWidth = shot.width;
      imageHeight = shot.height;
    }
  }
  const geo: ScreenGeometry = {
    imageWidth,
    imageHeight,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
  };
  return {
    runtime: {
      ...runtime,
      elements,
      geometry: geo,
      lastShotAt: withImage ? Date.now() : runtime.lastShotAt,
    },
    geo,
    url: page.url(),
    image,
    imageBytes,
  };
}

async function elementsFor(
  page: Page,
  runtime: ComputerRuntime,
  request: { ref?: string; query?: string },
): Promise<TargetElement[]> {
  if (
    request.ref &&
    !request.query &&
    runtime.elements.some((element) => element.ref === request.ref)
  )
    return runtime.elements;
  return readElements(page);
}

function geometryOf(
  runtime: ComputerRuntime,
  viewport: { width: number; height: number; deviceScaleFactor: number },
): ScreenGeometry {
  return (
    runtime.geometry ?? {
      imageWidth: viewport.width,
      imageHeight: viewport.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
    }
  );
}

function resolvePoint(
  request: { ref?: string; query?: string; x?: number; y?: number },
  elements: TargetElement[],
  geo: ScreenGeometry,
):
  | { kind: "point"; x: number; y: number; target?: TargetElement; reason: string }
  | { kind: "key"; key: "Enter"; reason: string }
  | { kind: "miss"; reason: string } {
  if (request.ref) {
    const found = elements.find((element) => element.ref === request.ref && !element.disabled);
    if (found) {
      return {
        kind: "point",
        x: found.x + found.width / 2,
        y: found.y + found.height / 2,
        target: found,
        reason: "element ref",
      };
    }
  }
  if (request.query) {
    const found = findElement(elements, request.query);
    if (found.element) {
      return {
        kind: "point",
        x: found.element.x + found.element.width / 2,
        y: found.element.y + found.element.height / 2,
        target: found.element,
        reason: found.reason,
      };
    }
    if (request.x !== undefined && request.y !== undefined) {
      const css = imageToCss(request.x, request.y, geo);
      return { kind: "point", ...css, reason: "screenshot coordinates after the query missed" };
    }
    if (found.fallback === "enter") {
      return { kind: "key", key: "Enter", reason: `${found.reason}. Pressed Enter.` };
    }
    return { kind: "miss", reason: found.reason };
  }
  if (request.x !== undefined && request.y !== undefined) {
    const css = imageToCss(request.x, request.y, geo);
    return { kind: "point", ...css, reason: "screenshot coordinates" };
  }
  return {
    kind: "miss",
    reason: "Pass an element ref, a query such as send, or screenshot x and y",
  };
}

async function clickAt(
  page: Page,
  x: number,
  y: number,
  button: "left" | "right",
  clickCount: number,
  hooks: ComputerHooks,
): Promise<void> {
  await pointerTo(page, x, y, hooks);
  await page.mouse.click(x, y, { button, clickCount, delay: clickCount > 1 ? 40 : 15 });
}

async function pointerTo(page: Page, x: number, y: number, hooks: ComputerHooks): Promise<void> {
  await page.mouse.move(x, y, { steps: 8 });
  hooks.movePointer?.({ x, y });
  await paintCursor(page, x, y);
}

async function boxOf(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    return await page.locator(selector).first().boundingBox({ timeout: 800 });
  } catch {
    return null;
  }
}

async function viewportOf(
  page: Page,
): Promise<{ width: number; height: number; deviceScaleFactor: number }> {
  return page.evaluate(() => ({
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
    deviceScaleFactor: window.devicePixelRatio || 1,
  }));
}

async function captureJpeg(
  page: Page,
): Promise<{ data: string; width: number; height: number; bytes: number }> {
  const style = "#__agentos_cursor{display:none !important}";
  let quality = 40;
  let buffer = await page.screenshot({
    type: "jpeg",
    quality,
    scale: "css",
    timeout: 5_000,
    style,
  });
  const lower = nextJpegQuality(buffer.length, quality);
  if (lower) {
    quality = lower;
    buffer = await page.screenshot({
      type: "jpeg",
      quality,
      scale: "css",
      timeout: 5_000,
      style,
    });
  }
  const parsed = jpegSize(buffer);
  return {
    data: buffer.toString("base64"),
    width: parsed?.width ?? 0,
    height: parsed?.height ?? 0,
    bytes: buffer.length,
  };
}

async function readElements(page: Page): Promise<TargetElement[]> {
  const raw = await page.evaluate((): RawElement[] => {
    const nodes = document.querySelectorAll(
      "a, button, input, textarea, select, summary, [role='button'], [role='link'], [role='textbox'], [role='searchbox'], [role='combobox'], [role='tab'], [contenteditable='true']",
    );
    const found: RawElement[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!(node instanceof HTMLElement) || node.id === "__agentos_cursor") continue;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth)
        continue;
      const tag = node.tagName.toLowerCase();
      const explicit = node.getAttribute("role");
      const inputType = (node.getAttribute("type") || "text").toLowerCase();
      const role =
        explicit ||
        (tag === "a"
          ? "link"
          : tag === "button" ||
              (tag === "input" && ["button", "submit", "reset"].includes(inputType))
            ? "button"
            : tag === "textarea" || node.getAttribute("contenteditable") === "true"
              ? "textbox"
              : tag === "select"
                ? "combobox"
                : tag === "input"
                  ? "textbox"
                  : tag);
      const labelled =
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        node.getAttribute("placeholder") ||
        node.getAttribute("alt") ||
        "";
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      const name = (labelled || text).slice(0, 80);
      let selector = tag;
      if (node.id) selector = `#${CSS.escape(node.id)}`;
      else if (node.getAttribute("data-testid"))
        selector = `[data-testid="${CSS.escape(node.getAttribute("data-testid") || "")}"]`;
      else if (node.getAttribute("aria-label"))
        selector = `${tag}[aria-label="${CSS.escape(node.getAttribute("aria-label") || "")}"]`;
      else if (node.getAttribute("name"))
        selector = `${tag}[name="${CSS.escape(node.getAttribute("name") || "")}"]`;
      found.push({
        role,
        name,
        selector: selector.slice(0, 300),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        iconOnly: !text && Boolean(node.querySelector("svg, img")),
        disabled: node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true",
      });
      if (found.length >= 100) break;
    }
    return found;
  });
  return raw.map((element, index) => ({ ...element, ref: `e${index + 1}` }));
}

async function zoom(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  started: number,
): Promise<ComputerOutcome> {
  if (request.x === undefined || request.y === undefined) {
    return { runtime, result: { ok: false, action: "zoom", message: "zoom requires x and y" } };
  }
  const viewport = await viewportOf(page);
  const geo = geometryOf(runtime, viewport);
  const css = imageToCss(request.x, request.y, geo);
  const clip = zoomClip(css.x, css.y, request.delta ?? 240, viewport);
  await paintMarks(page, runtime.elements);
  const buffer = await page.screenshot({
    type: "jpeg",
    quality: 55,
    scale: "css",
    clip,
    timeout: 5_000,
    style: "#__agentos_cursor{display:none !important}",
  });
  const parsed = jpegSize(buffer);
  return {
    runtime: { ...runtime, lastShotAt: Date.now() },
    image: { mediaType: "image/jpeg", data: buffer.toString("base64") },
    result: {
      ok: true,
      action: "zoom",
      verified: true,
      origin: cssToImage(clip.x, clip.y, geo),
      clip,
      imageSize: { width: parsed?.width ?? clip.width, height: parsed?.height ?? clip.height },
      coordinateSpace: "crop pixels; add origin to map back to the full screenshot",
      ...(runtime.plan ? { plan: runtime.plan } : {}),
      durationMs: Math.round(performance.now() - started),
    },
  };
}

async function waitQuiet(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  started: number,
): Promise<ComputerOutcome> {
  const quiet = await waitForQuiet(page, request.delta ?? 800);
  return {
    runtime,
    result: {
      ok: true,
      action: "wait",
      verified: true,
      waitedMs: quiet,
      ...(runtime.plan ? { plan: runtime.plan } : {}),
      durationMs: Math.round(performance.now() - started),
    },
  };
}

async function waitForQuiet(page: Page, maxMs = 800): Promise<number> {
  const cap = Math.max(100, Math.min(5_000, maxMs));
  await page.waitForLoadState("domcontentloaded", { timeout: 1_000 }).catch(() => {});
  let last = Date.now();
  const touch = () => {
    last = Date.now();
  };
  page.on("request", touch);
  const started = Date.now();
  try {
    while (Date.now() - started < cap) {
      if (Date.now() - last >= 200) break;
      await page.waitForTimeout(50);
    }
  } finally {
    page.off("request", touch);
  }
  return Date.now() - started;
}

async function insertText(page: Page, text: string): Promise<void> {
  if (!shouldPaste(text)) {
    await page.keyboard.insertText(text);
    return;
  }
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"])
    .catch(() => {});
  const pasted = await page
    .evaluate(async (value) => {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return false;
      }
    }, text)
    .catch(() => false);
  if (pasted) {
    await page.keyboard.press("Control+V");
    return;
  }
  await page.keyboard.insertText(text);
}

async function paintMarks(page: Page, elements: TargetElement[]): Promise<void> {
  const marks = elements.slice(0, 36).map((element) => ({
    n: markNumber(element.ref),
    x: Math.round(element.x + element.width / 2),
    y: Math.round(element.y),
  }));
  await page.evaluate((badges) => {
    document.getElementById("__agentos_marks")?.remove();
    const root = document.createElement("div");
    root.id = "__agentos_marks";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    for (const badge of badges) {
      const node = document.createElement("div");
      node.textContent = String(badge.n);
      node.style.cssText = `position:absolute;left:${badge.x}px;top:${badge.y}px;transform:translate(-50%,-100%);min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#4f46e5;color:#fff;font:700 11px/16px sans-serif;text-align:center;box-shadow:0 0 0 1px #fff;`;
      root.appendChild(node);
    }
    document.documentElement.appendChild(root);
  }, marks);
}

function markNumber(ref: string): number {
  const value = Number(ref.slice(1));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

async function paintCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ left, top }) => {
      const id = "__agentos_cursor";
      let node = document.getElementById(id);
      if (!node) {
        node = document.createElement("div");
        node.id = id;
        node.setAttribute("aria-hidden", "true");
        node.style.cssText =
          "position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:rgba(99,102,241,.92);border:2px solid #fff;box-shadow:0 0 0 1px #000;pointer-events:none;z-index:2147483647;";
        document.documentElement.appendChild(node);
      }
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
    },
    { left: x, top: y },
  );
}

function queryFromSelector(selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  const aria = selector.match(/aria-label\s*=\s*["']([^"']+)["']/i);
  if (aria?.[1]) return aria[1];
  const testId = selector.match(/data-testid\s*=\s*["']([^"']+)["']/i);
  if (testId?.[1]) return testId[1].replace(/[-_]/g, " ");
  return undefined;
}

function clickRequest(input: {
  ref?: string;
  query?: string;
  x?: number;
  y?: number;
}): ComputerRequest {
  return {
    action: "click",
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.query ? { query: input.query } : {}),
    ...(input.x !== undefined ? { x: input.x } : {}),
    ...(input.y !== undefined ? { y: input.y } : {}),
  };
}

function roundPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
