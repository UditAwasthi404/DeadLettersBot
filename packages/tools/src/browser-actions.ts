/** Playwright mouse, keyboard, and accessibility actions for the computer-use loop. */

import type { Page } from "playwright";
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
  return { geometry: null, elements: [], stuck: emptyStuck() };
}

export async function runComputerAction(
  page: Page,
  request: ComputerRequest,
  runtime: ComputerRuntime,
  hooks: ComputerHooks = {},
): Promise<ComputerOutcome> {
  const started = performance.now();
  try {
    if (request.action === "screenshot" || request.action === "find")
      return await look(page, request, runtime, started);
    if (request.action === "key") return await pressKey(page, request, runtime, started);
    if (request.action === "type") return await typeText(page, request, runtime, hooks, started);
    if (request.action === "scroll")
      return await scrollWheel(page, request, runtime, hooks, started);
    if (request.action === "drag") return await dragPointer(page, request, runtime, hooks, started);
    if (request.action === "move") return await movePointer(page, request, runtime, hooks, started);
    return await performClick(
      page,
      {
        ref: request.ref,
        query: request.query,
        x: request.x,
        y: request.y,
        button: request.action === "right_click" ? "right" : "left",
        clickCount: request.action === "double_click" ? 2 : 1,
        plan: request.plan,
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
  await page.keyboard.insertText(text.slice(0, 4000));
  if (request.submit) await page.keyboard.press("Enter");
  return finish(
    page,
    { ...runtime, elements, geometry: geo },
    request,
    before,
    {
      action: "type",
      typedCharacters: Math.min(text.length, 4000),
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

async function finish(
  page: Page,
  runtime: ComputerRuntime,
  request: ComputerRequest,
  before: string,
  result: Record<string, unknown>,
  started: number,
): Promise<ComputerOutcome> {
  await page.waitForTimeout(140);
  const observed = await observe(page, runtime, true);
  const fingerprint = screenFingerprint(observed.url, observed.runtime.elements);
  const stuck = noteStuck(observed.runtime.stuck, actionSignature(request), fingerprint);
  observed.runtime.stuck = stuck.state;
  const changed = before !== fingerprint;
  let hint = typeof result.hint === "string" ? result.hint : "";
  if (stuck.stuck) {
    hint =
      "This action did not change the screen. Choose a different control, or press Enter to submit.";
  } else if (!changed && request.action !== "move") {
    hint =
      hint || "The screen looked unchanged. Check the element list before repeating this action.";
  }
  return {
    runtime: observed.runtime,
    image: observed.image,
    result: {
      ok: true,
      ...result,
      url: observed.url,
      changed,
      elements: summarizeElements(observed.runtime.elements, observed.geo),
      imageBytes: observed.imageBytes,
      viewport: { width: observed.geo.viewportWidth, height: observed.geo.viewportHeight },
      imageSize: { width: observed.geo.imageWidth, height: observed.geo.imageHeight },
      deviceScaleFactor: observed.geo.deviceScaleFactor,
      coordinateSpace: "screenshot pixels",
      ...(request.plan ? { plan: request.plan } : {}),
      ...(hint ? { hint } : {}),
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
    runtime: { ...runtime, elements, geometry: geo },
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
