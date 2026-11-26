import type { VMManager } from "@agentOS/vm-manager";
import { shellEscape } from "./shell-escape.ts";

const DEFAULT_SHELL_TIMEOUT_MS = 120_000;

export async function runShell(
  args: { command: string; cwd?: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const script = args.cwd ? `cd ${shellEscape(args.cwd)} && ${args.command}` : args.command;
  const cmd = [
    "setpriv",
    "--no-new-privs",
    "--bounding-set=-all",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--",
    "/usr/local/bin/agentos-shell",
    "--",
    "sh",
    "-c",
    script,
  ];
  const timeoutMs = Number(process.env.RUN_SHELL_TIMEOUT_MS ?? DEFAULT_SHELL_TIMEOUT_MS);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("shell command timed out"));
  }, timeoutMs);
  timer.unref?.();

  try {
    const { stdout, stderr, exitCode, outputTruncated } = await vm.execInContainer(
      vmId,
      cmd,
      undefined,
      controller.signal,
    );
    if (timedOut)
      return {
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}command timed out after ${timeoutMs} ms`,
        exitCode: 124,
        timedOut: true,
      };
    return {
      stdout,
      stderr,
      exitCode,
      ...(outputTruncated ? { outputTruncated: true } : {}),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
