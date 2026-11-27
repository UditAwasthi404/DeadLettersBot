/// <reference lib="dom" />
/** Playwright CDP bridge to Chromium inside the account VM. */

import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type Download, type Page, chromium } from "playwright";
import {
  type ComputerRuntime,
  emptyRuntime,
  performClick,
  runComputerAction,
  wheelScroll,
} from "./browser-actions.ts";
import { type ComputerRequest, parseComputerRequest } from "./computer-use.ts";
import { RECORDING_EVENT_CAP, RECORDING_LIMIT_MS, recordingAccepts } from "./recording.ts";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { RECORDING_EVENT_CAP, RECORDING_LIMIT_MS, recordingAccepts } from "./recording.ts";

export type BrowserRecordEvent = {
  t: number;
  type: "navigation" | "click" | "type" | "scroll";
  url?: string;
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
};

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
  private readonly watched = new WeakSet<Page>();
  private dialogPolicy: "accept" | "dismiss" = "dismiss";
  private lastDialog: { type: string; message: string } | null = null;
  private lastDownload: { name: string; path: string; bytes: number } | null = null;
  private downloadQueue: Promise<void> = Promise.resolve();
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
    this.watchBrowser(this.page);
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
      const special = await this.sessionAction(parsed.request);
      if (special) return special;
      const outcome = await runComputerAction(this.requirePage(), parsed.request, this.runtime, {
        movePointer: (point) => this.aim(point.x, point.y),
      });
      this.runtime = outcome.runtime;
      return outcome.image ? { ...outcome.result, image: outcome.image } : outcome.result;
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  private watchBrowser(page: Page): void {
    const context = page.context();
    context.on("page", (next) => this.watchPage(next));
    for (const open of context.pages()) this.watchPage(open);
  }

  private watchPage(page: Page): void {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    page.on("dialog", (dialog) => {
      this.lastDialog = { type: dialog.type(), message: dialog.message().slice(0, 240) };
      const pending = this.dialogPolicy === "accept" ? dialog.accept() : dialog.dismiss();
      this.dialogPolicy = "dismiss";
      void pending.catch(() => {});
    });
    page.on("download", (download) => {
      this.downloadQueue = this.downloadQueue.then(() => this.saveDownload(download));
    });
  }

  private async saveDownload(download: Download): Promise<void> {
    const name =
      download
        .suggestedFilename()
        .replace(/[^\w.\- ]+/g, "_")
        .slice(0, 80) || "download";
    const target = join(tmpdir(), `agentos-${Date.now()}-${name}`);
    try {
      await download.saveAs(target);
      this.lastDownload = { name, path: target, bytes: statSync(target).size };
    } catch {
      this.lastDownload = null;
    }
  }

  private async sessionAction(request: ComputerRequest): Promise<unknown | null> {
    if (request.action === "tabs") {
      const pages = this.page?.context().pages() ?? [];
      return {
        ok: true,
        action: "tabs",
        tabs: pages.map((page, index) => ({
          index,
          url: page.url(),
          active: page === this.page,
        })),
      };
    }
    if (request.action === "switch_tab") {
      const pages = this.page?.context().pages() ?? [];
      const next = pages[request.tab ?? 0];
      if (!next) return { ok: false, action: "switch_tab", message: "That tab is not open." };
      this.page = next;
      await next.bringToFront().catch(() => {});
      this.runtime = { ...this.runtime, elements: [], lastShotAt: 0 };
      return { ok: true, action: "switch_tab", index: request.tab ?? 0, url: next.url() };
    }
    if (request.action === "dialog") {
      this.dialogPolicy = request.accept ? "accept" : "dismiss";
      return {
        ok: true,
        action: "dialog",
        accept: request.accept === true,
        lastDialog: this.lastDialog,
        message: request.accept
          ? "The next dialog will be accepted. Repeat the click that opens it."
          : "Dialogs are dismissed. Call dialog with accept true before a click you want to confirm.",
      };
    }
    if (request.action === "upload") return this.uploadFiles(request.paths ?? []);
    if (request.action === "download") return this.collectDownload();
    return null;
  }

  private async uploadFiles(paths: string[]): Promise<unknown> {
    if (!paths.length) return { ok: false, action: "upload", message: "upload requires paths" };
    if (paths.length > 3)
      return { ok: false, action: "upload", message: "upload accepts at most 3 files" };
    for (const path of paths) {
      if (path.includes("\0") || !existsSync(path))
        return { ok: false, action: "upload", message: `file not found: ${path.slice(0, 180)}` };
    }
    await this.requirePage()
      .locator("input[type=file]")
      .first()
      .setInputFiles(paths, { timeout: 4_000 });
    return { ok: true, action: "upload", files: paths.length, verified: true };
  }

  private async collectDownload(): Promise<unknown> {
    const started = Date.now();
    while (Date.now() - started < 5_000) {
      await this.downloadQueue.catch(() => {});
      if (this.lastDownload)
        return { ok: true, action: "download", verified: true, ...this.lastDownload };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
      ok: false,
      action: "download",
      message: "No download started. Click the download control, then call download again.",
    };
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
