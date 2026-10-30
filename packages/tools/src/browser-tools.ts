/// <reference lib="dom" />
/** Playwright CDP bridge to Chromium inside the account VM. */

import { type Browser, type Page, chromium } from "playwright";

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

export class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private recording: {
    events: BrowserRecordEvent[];
    stopListen: () => void;
  } | null = null;

  async connect(ipAddress: string, port: number): Promise<void> {
    this.browser = await chromium.connectOverCDP(`http://${ipAddress}:${port}`);
    const existing = this.browser.contexts()[0]?.pages()[0];
    this.page = existing ?? (await (await this.browser.newContext()).newPage());
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
    try {
      await this.requirePage().click(selector);
      return { ok: true };
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async type(selector: string, text: string): Promise<unknown> {
    try {
      await this.requirePage().fill(selector, text);
      return { ok: true };
    } catch (err) {
      return { error: errMsg(err) };
    }
  }

  async screenshot(): Promise<unknown> {
    try {
      const buf = await this.requirePage().screenshot({ type: "jpeg", quality: 60 });
      return { dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}` };
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
      await this.requirePage().evaluate(
        ({ dir, amount }) => {
          window.scrollBy(0, dir === "down" ? amount : -amount);
        },
        { dir: direction, amount: px ?? 500 },
      );
      return { ok: true };
    } catch (err) {
      return { error: errMsg(err) };
    }
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
