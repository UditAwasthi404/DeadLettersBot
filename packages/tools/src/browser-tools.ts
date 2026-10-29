/// <reference lib="dom" />
/** Playwright CDP bridge to Chromium inside the account VM. */

import { type Browser, type Page, chromium } from "playwright";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;

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

  async evaluate(script: string): Promise<unknown> {
    try {
      const result = await this.requirePage().evaluate(script);
      return { ok: true, result };
    } catch (err) {
      return { error: errMsg(err) };
    }
  }
}
