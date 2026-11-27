/// <reference lib="dom" />
/** Playwright CDP bridge to Chromium inside the account VM. */

import { type Browser, type Page, chromium } from "playwright";
import {
  type ComputerRuntime,
  emptyRuntime,
  performClick,
  runComputerAction,
  wheelScroll,
} from "./browser-actions.ts";
import { parseComputerRequest } from "./computer-use.ts";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const RECORDING_LIMIT_MS = 10 * 60 * 1000;
export const RECORDING_EVENT_CAP = 2_000;

export type BrowserRecordEvent = {
  t: number;
  type: "navigation" | "click" | "type" | "scroll";
  url?: string;
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
};

export function recordingAccepts(startedAt: number, now: number, count: number): boolean {
  return now - startedAt <= RECORDING_LIMIT_MS && count < RECORDING_EVENT_CAP;
}

const RECORDING_SCRIPT = `(() => {
  if (window.__agentosRecording) return;
  window.__agentosRecording = true;
  const selector = (node) => {
    if (!(node instanceof Element)) return "";
    if (node.id) return "#" + CSS.escape(node.id);
    const name = node.getAttribute("name");
    if (name) return node.tagName.toLowerCase() + "[name='" + name.replaceAll("'", "") + "']";
    return node.tagName.toLowerCase();
  };
  document.addEventListener("click", (event) => {
    void window.__agentosRecord?.({ type: "click", selector: selector(event.target), url: location.href });
  }, true);
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    void window.__agentosRecord?.({
      type: "type",
      selector: selector(target),
      text: target.type === "password" ? "" : target.value.slice(0, 200),
      url: location.href,
    });
  }, true);
  let scrollTimer = 0;
  document.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      void window.__agentosRecord?.({ type: "scroll", x: window.scrollX, y: window.scrollY, url: location.href });
    }, 200);
  }, true);
})();`;

export interface BrowserSessionOptions {
  /** Move the real X pointer so the agent screen shows the cursor. Screen pixels, not CSS pixels. */
  osPointer?: (point: { x: number; y: number }) => Promise<void> | void;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private runtime: ComputerRuntime = emptyRuntime();
  private pointerDisabled = false;
  private chrome = { x: 0, y: 0, known: false };
  private recording: {
    events: BrowserRecordEvent[];
    stopListen: () => void;
  } | null = null;

  constructor(private readonly options: BrowserSessionOptions = {}) {}

  async connect(ipAddress: string, port: number): Promise<void> {
    await this.connectTo(`http://${ipAddress}:${port}`);
  }

  async connectTo(endpoint: string, headers?: Record<string, string>): Promise<void> {
    this.browser = await chromium.connectOverCDP(endpoint, { headers });
    const existing = this.browser.contexts()[0]?.pages()[0];
    this.page = existing ?? (await (await this.browser.newContext()).newPage());
    this.page.setDefaultTimeout(8_000);
    this.page.setDefaultNavigationTimeout(20_000);
  }

  async disconnect(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("browser page not connected");
    return this.page;
  }

  async navigate(url: string): Promise<unknown> {
    try {
      await this.requirePage().goto(url, { waitUntil: "domcontentloaded" });
      return { ok: true };
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async click(selector: string): Promise<unknown> {
    return this.clickTarget({ selector });
  }

  async clickTarget(input: {
    selector?: string;
    query?: string;
    x?: number;
    y?: number;
  }): Promise<unknown> {
    try {
      const outcome = await performClick(this.requirePage(), input, this.runtime, {
        movePointer: (point) => this.aim(point.x, point.y),
      });
      this.runtime = outcome.runtime;
      return outcome.image ? { ...outcome.result, image: outcome.image } : outcome.result;
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async type(selector: string, text: string): Promise<unknown> {
    return this.typeText({ selector, text });
  }

  async typeText(input: {
    selector?: string;
    query?: string;
    text: string;
    submit?: boolean;
  }): Promise<unknown> {
    try {
      const outcome = await runComputerAction(
        this.requirePage(),
        {
          action: "type",
          text: input.text,
          ...(input.selector ? { query: input.selector } : {}),
          ...(input.query ? { query: input.query } : {}),
          ...(input.submit ? { submit: true } : {}),
        },
        this.runtime,
        { movePointer: (point) => this.aim(point.x, point.y) },
      );
      this.runtime = outcome.runtime;
      return outcome.image ? { ...outcome.result, image: outcome.image } : outcome.result;
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async computer(args: Record<string, unknown>): Promise<unknown> {
    const parsed = parseComputerRequest(args);
    if (!parsed.ok) return { error: parsed.error };
    try {
      const outcome = await runComputerAction(this.requirePage(), parsed.request, this.runtime, {
        movePointer: (point) => this.aim(point.x, point.y),
      });
      this.runtime = outcome.runtime;
      return outcome.image ? { ...outcome.result, image: outcome.image } : outcome.result;
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async screenshot(): Promise<unknown> {
    try {
      const outcome = await runComputerAction(
        this.requirePage(),
        { action: "screenshot" },
        this.runtime,
        { movePointer: (point) => this.aim(point.x, point.y) },
      );
      this.runtime = outcome.runtime;
      return outcome.image ? { ...outcome.result, image: outcome.image } : outcome.result;
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async extract(selector?: string, _question?: string): Promise<unknown> {
    try {
      const page = this.requirePage();
      let content: string;
      if (selector) {
        content = await page.$$eval(selector, (els) =>
          els
            .map((element) => {
              if (!(element instanceof HTMLElement)) return "";
              const tag = element.tagName.toLowerCase();
              if (["script", "style", "noscript", "template", "svg", "iframe"].includes(tag))
                return "";
              if (element.closest('[hidden], [aria-hidden="true"]')) return "";
              const style = getComputedStyle(element);
              if (style.display === "none" || style.visibility === "hidden") return "";
              return element.innerText.trim();
            })
            .filter(Boolean)
            .join("\n"),
        );
      } else {
        content = await page.evaluate(() => document.body.innerText);
      }
      return {
        trust: "untrusted_external_data",
        source: "browser_page",
        url: page.url(),
        extraction: "visible_text_only",
        content: content.slice(0, 8000),
      };
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async scroll(direction: "up" | "down", px?: number): Promise<unknown> {
    try {
      return await wheelScroll(this.requirePage(), direction, px);
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  /** Best-effort OS cursor. One failure disables further attempts so a missing helper cannot stall the loop. */
  private aim(cssX: number, cssY: number): void {
    if (!this.options.osPointer || this.pointerDisabled) return;
    void this.aimScreen(cssX, cssY);
  }

  private async aimScreen(cssX: number, cssY: number): Promise<void> {
    try {
      const screen = await this.screenPoint(cssX, cssY);
      await this.options.osPointer?.(screen);
    } catch {
      this.pointerDisabled = true;
    }
  }

  private async screenPoint(cssX: number, cssY: number): Promise<{ x: number; y: number }> {
    if (!this.chrome.known) {
      const page = this.requirePage();
      try {
        const session = await page.context().newCDPSession(page);
        try {
          const target = (await session.send("Browser.getWindowForTarget")) as {
            windowId: number;
          };
          const placed = (await session.send("Browser.getWindowBounds", {
            windowId: target.windowId,
          })) as { bounds?: { left?: number; top?: number; height?: number } };
          const inner = await page.evaluate(() => globalThis.innerHeight);
          const top = placed.bounds?.top ?? 0;
          const height = placed.bounds?.height ?? inner;
          this.chrome = {
            x: placed.bounds?.left ?? 0,
            y: top + Math.max(0, height - inner),
            known: true,
          };
        } finally {
          await session.detach();
        }
      } catch {
        this.chrome = { x: 0, y: 0, known: true };
      }
    }
    return { x: this.chrome.x + cssX, y: this.chrome.y + cssY };
  }

  async waitForElement(selector: string, timeoutMs?: number): Promise<unknown> {
    try {
      await this.requirePage().waitForSelector(selector, { timeout: timeoutMs ?? 10_000 });
      return { ok: true };
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async startRecording(): Promise<void> {
    if (this.recording) throw new Error("recording already in progress");
    const page = this.requirePage();
    const events: BrowserRecordEvent[] = [];
    const startedAt = Date.now();
    const push = (event: Omit<BrowserRecordEvent, "t">) => {
      if (!recordingAccepts(startedAt, Date.now(), events.length)) return;
      events.push({ ...event, t: Date.now() - startedAt });
    };
    await page.exposeBinding(
      "__agentosRecord",
      (_source, payload: Partial<BrowserRecordEvent> | null) => {
        if (!payload?.type) return;
        if (!["click", "type", "scroll", "navigation"].includes(payload.type)) return;
        push({
          type: payload.type,
          url: typeof payload.url === "string" ? payload.url.slice(0, 2000) : undefined,
          selector:
            typeof payload.selector === "string" ? payload.selector.slice(0, 500) : undefined,
          text: typeof payload.text === "string" ? payload.text.slice(0, 200) : undefined,
          x: typeof payload.x === "number" ? payload.x : undefined,
          y: typeof payload.y === "number" ? payload.y : undefined,
        });
      },
    );
    await page.addInitScript(RECORDING_SCRIPT);
    await page.evaluate(RECORDING_SCRIPT);
    const onNavigate = (frame: { url: () => string; parentFrame: () => unknown }) => {
      if (frame.parentFrame()) return;
      push({ type: "navigation", url: frame.url() });
    };
    page.on("framenavigated", onNavigate);
    this.recording = { events, stopListen: () => page.off("framenavigated", onNavigate) };
  }

  async stopRecording(): Promise<BrowserRecordEvent[]> {
    if (!this.recording) throw new Error("recording is not in progress");
    const events = this.recording.events.filter((event) => event.t <= RECORDING_LIMIT_MS);
    this.recording.stopListen();
    this.recording = null;
    return events;
  }

  async evaluate(script: string): Promise<unknown> {
    try {
      const result = await this.requirePage().evaluate(script);
      return { ok: true, result };
    } catch (err) {
      return { error: errMsg(err) };
    }
  }
}
