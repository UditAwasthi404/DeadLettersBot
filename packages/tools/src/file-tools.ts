import type { VMManager } from "@agentOS/vm-manager";
import { shellEscape } from "./shell-escape.ts";

export async function readFile(
  args: { path: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const { stdout, stderr, exitCode } = await vm.execInContainer(
    vmId,
    ["cat", args.path],
    undefined,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { content: stdout };
}

export async function writeFile(
  args: { path: string; content: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const { stderr, exitCode } = await vm.execInContainer(
    vmId,
    ["sh", "-c", `cat > ${shellEscape(args.path)}`],
    args.content,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { ok: true };
}

export async function appendFile(
  args: { path: string; content: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const { stderr, exitCode } = await vm.execInContainer(
    vmId,
    ["sh", "-c", `cat >> ${shellEscape(args.path)}`],
    args.content,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { ok: true };
}

export async function deleteFile(
  args: { path: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const { stderr, exitCode } = await vm.execInContainer(
    vmId,
    ["rm", "-f", args.path],
    undefined,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { ok: true };
}

export async function listDirectory(
  args: { path: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const { stdout, stderr, exitCode } = await vm.execInContainer(
    vmId,
    ["ls", "-la", args.path],
    undefined,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { listing: stdout };
}
