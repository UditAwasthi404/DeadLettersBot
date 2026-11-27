import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { emptyRuntime, runComputerAction } from "./browser-actions.ts";

const pageHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/composer.html"),
  "utf8",
);

async function withComposer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function chromiumLaunchable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const launched = await chromiumLaunchable();

describe("computer use on a local composer", () => {
  test.skipIf(!launched)("clicks an icon-only send button after typing", async () => {
    await withComposer(async (url) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
        await page.goto(url);
        let runtime = emptyRuntime();
        const typed = await runComputerAction(
          page,
          { action: "type", query: "Message", text: "hello from the agent" },
          runtime,
        );
        runtime = typed.runtime;
        expect(typed.result.ok).toBe(true);
        const clicked = await runComputerAction(page, { action: "click", query: "send" }, runtime);
        expect(clicked.result.ok).toBe(true);
        expect(await page.locator("#out").innerText()).toBe("sent:hello from the agent");
        const marked = await runComputerAction(page, { action: "screenshot" }, clicked.runtime);
        const elements = marked.result.elements as Array<{ mark?: number; ref: string }>;
        expect(elements.some((element) => element.ref === "e1" || element.ref === "e2")).toBe(true);
      } finally {
        await browser.close();
      }
    });
  });
});
