import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvalArgs, runEvalMode, runEvalModeFromFiles } from "./eval-mode.ts";

describe("eval-mode", () => {
  test("synthetic ok fixture delivers and settles", async () => {
    const result = await runEvalMode({
      prompt: "say ok",
      fixture: "ok",
      disabledToolIds: ["RunShell"],
    });
    expect(result.status).toBe("completed");
    expect(result.deliveries).toContain("ok");
    expect(result.toolCalls.some((call) => call.name === "SendToUser")).toBe(true);
  });

  test("scripted file tools use the local sandbox", async () => {
    const result = await runEvalMode({
      prompt: "write then read",
      fixture: [
        {
          type: "toolCall",
          toolCall: {
            name: "WriteFile",
            args: { path: "/home/agent/memo.txt", content: "sandbox" },
          },
        },
        {
          type: "toolCall",
          toolCall: { name: "ReadFile", args: { path: "/home/agent/memo.txt" } },
        },
        { type: "ok" },
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]?.name).toBe("WriteFile");
    expect(result.toolCalls[1]?.name).toBe("ReadFile");
    expect(JSON.stringify(result.toolCalls[1]?.result)).toContain("sandbox");
    expect(result.deliveries).toContain("ok");
  });

  test("disabled tools are rejected", async () => {
    const result = await runEvalMode({
      prompt: "shell",
      disabledToolIds: ["RunShell"],
      fixture: [
        {
          type: "toolCall",
          toolCall: { name: "RunShell", args: { command: "echo hi" } },
        },
        { type: "ok" },
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]?.isError).toBe(true);
  });

  test("request and result files round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentos-eval-"));
    const requestPath = join(dir, "request.json");
    const resultPath = join(dir, "result.json");
    try {
      await writeFile(
        requestPath,
        JSON.stringify({ prompt: "ok please", fixture: "ok", stepBudget: 2 }),
      );
      const result = await runEvalModeFromFiles(requestPath, resultPath);
      expect(result.status).toBe("completed");
      const written = JSON.parse(await readFile(resultPath, "utf8")) as { deliveries: string[] };
      expect(written.deliveries).toContain("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parseEvalArgs reads request and optional result paths", () => {
    const parsed = parseEvalArgs([
      "bun",
      "src/index.ts",
      "--eval-mode",
      "fixtures/eval/ok-request.json",
      "tmp/result.json",
    ]);
    expect(parsed?.requestPath.endsWith("ok-request.json")).toBe(true);
    expect(parsed?.resultPath.endsWith("result.json")).toBe(true);
  });
});
