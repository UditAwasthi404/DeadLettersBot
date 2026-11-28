import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const { _electron: electron } = require("playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const label = process.argv[2] ?? "current";
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Use an alphanumeric benchmark label");
const output = resolve(root, ".tmp", "agentos-bench");
await mkdir(output, { recursive: true });
const samples = [];
for (let index = 0; index < 3; index += 1) {
  const start = performance.now();
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve(root, "packages/desktop")],
    env: { ...process.env, VITE_DEV_SERVER_URL: process.env.AGENTOS_BENCH_URL ?? "http://127.0.0.1:5173" },
  });
  try {
    const page = await app.firstWindow();
    await page.locator("button:visible").first().waitFor();
    await page.locator("button:visible").first().focus();
    await page.waitForFunction(() => document.activeElement?.tagName === "BUTTON");
    const interactiveMs = performance.now() - start;
    const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((metric) => ({
      type: metric.type,
      workingSetKiB: metric.memory.workingSetSize,
    })));
    samples.push({ interactiveMs: Number(interactiveMs.toFixed(1)), processes: metrics });
    if (index === 0) await page.screenshot({ path: resolve(output, `${label}.png`) });
  } finally {
    await app.close();
  }
}
const times = samples.map((sample) => sample.interactiveMs).sort((a, b) => a - b);
const result = { label, platform: process.platform, node: process.version, measurement: "Process spawn to visible button receiving focus; dev server already warm; includes Playwright launch overhead", medianInteractiveMs: times[1], samples };
await writeFile(resolve(output, `${label}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
