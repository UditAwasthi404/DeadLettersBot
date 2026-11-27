#!/usr/bin/env node
/**
 * Runs every fixtures/eval/*-request.json through box-host --eval-mode and
 * reports task completion rate (Phase 4 Track F eval/regression foundation).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(root, "packages/box-host/fixtures/eval");
const outDir = join(root, "tmp/eval-suite");
const regressionFloor = Number(process.env.EVAL_REGRESSION_FLOOR ?? 0.8);

mkdirSync(outDir, { recursive: true });

const requests = readdirSync(fixturesDir)
  .filter((name) => name.endsWith("-request.json"))
  .sort();

if (requests.length === 0) {
  console.error("No eval fixtures found");
  process.exit(1);
}

let completed = 0;
const rows = [];

for (const name of requests) {
  const requestPath = join(fixturesDir, name);
  const resultPath = join(outDir, name.replace(/-request\.json$/, "-result.json"));
  const run = spawnSync(
    "bun",
    ["run", "src/index.ts", "--eval-mode", requestPath, resultPath],
    {
      cwd: join(root, "packages/box-host"),
      encoding: "utf8",
      env: { ...process.env, INFERENCE_MOCK: "1" },
    },
  );
  let status = "error";
  let error = run.stderr?.trim() || run.stdout?.trim() || `exit ${run.status}`;
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    status = result.status;
    error = result.error;
    if (status === "completed") completed += 1;
  } catch {
    // keep error from process output
  }
  rows.push({ name, status, error });
  console.log(`${status === "completed" ? "PASS" : "FAIL"} ${name}${error ? ` — ${error}` : ""}`);
}

const rate = completed / requests.length;
const summary = {
  total: requests.length,
  completed,
  rate,
  regressionFloor,
  rows,
};
writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `\nEval suite: ${completed}/${requests.length} completed (${(rate * 100).toFixed(1)}%)`,
);

if (rate < regressionFloor) {
  console.error(`Completion rate below regression floor ${regressionFloor}`);
  process.exit(1);
}
