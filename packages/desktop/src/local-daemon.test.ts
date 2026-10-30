import { describe, expect, test } from "bun:test";
import { runLocalCommand } from "./local-daemon.ts";

describe("runLocalCommand", () => {
  test("refuses a disabled policy, an empty command, and an unapproved confirm", async () => {
    expect(await runLocalCommand("echo hi", undefined, "never")).toEqual({
      stdout: "",
      stderr: "local execution disabled",
      exitCode: 1,
    });
    expect((await runLocalCommand("   ", undefined, "always_allow")).exitCode).toBe(1);
    await expect(runLocalCommand("echo hi", undefined, "always_confirm")).rejects.toThrow(
      "requires approval",
    );
  });

  test("runs an approved command and caps output", async () => {
    const result = await runLocalCommand(
      `node -e "process.stdout.write('x'.repeat(9000))"`,
      undefined,
      "always_allow",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(8000);
  });
});
