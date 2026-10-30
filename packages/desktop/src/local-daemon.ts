import { exec } from "node:child_process";

export type LocalMachineAccess = "never" | "always_confirm" | "always_allow";

export interface LocalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const OUTPUT_CAP = 8_000;

export async function runLocalCommand(
  cmd: string,
  cwd?: string,
  policy: LocalMachineAccess = "always_confirm",
): Promise<LocalExecResult> {
  if (policy === "never") return { stdout: "", stderr: "local execution disabled", exitCode: 1 };
  if (policy === "always_confirm") throw new Error("local execution requires approval");
  if (!cmd.trim()) return { stdout: "", stderr: "command is empty", exitCode: 1 };
  return await new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({
        stdout: String(stdout).slice(0, OUTPUT_CAP),
        stderr: String(stderr).slice(0, OUTPUT_CAP),
        exitCode: code,
      });
    });
  });
}
