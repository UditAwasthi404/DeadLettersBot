import type { VMManager } from "@agentOS/vm-manager";
import { shellEscape } from "./shell-escape.ts";

export async function runShell(
  args: { command: string; cwd?: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const script = args.cwd ? `cd ${shellEscape(args.cwd)} && ${args.command}` : args.command;
  const cmd = [
    "unshare",
    "--user",
    "--map-root-user",
    "--pid",
    "--fork",
    "--mount-proc",
    "--net",
    "--",
    "sh",
    "-c",
    script,
  ];
  const { stdout, stderr, exitCode } = await vm.execInContainer(vmId, cmd, undefined, signal);
  return { stdout, stderr, exitCode };
}
