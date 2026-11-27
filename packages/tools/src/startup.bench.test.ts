import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function coldImport(specifier: string): { ms: number; rss: number } {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      `const started = performance.now(); const before = process.memoryUsage().rss; await import(${JSON.stringify(specifier)}); console.log(JSON.stringify({ ms: performance.now() - started, rss: process.memoryUsage().rss - before }));`,
    ],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );
  if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout || "import failed");
  return JSON.parse(probe.stdout.trim()) as { ms: number; rss: number };
}

describe("startup cost", () => {
  test("computer helpers stay lighter than the Playwright driver", () => {
    const computer = coldImport("./src/computer-use.ts");
    const browser = coldImport("./src/browser-tools.ts");
    expect(computer.ms).toBeLessThan(browser.ms);
    expect(computer.rss).toBeLessThan(browser.rss);
  });
});
