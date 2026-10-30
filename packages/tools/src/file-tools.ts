import { posix } from "node:path";
import type { VMManager } from "@agentOS/vm-manager";
import { shellEscape } from "./shell-escape.ts";

function pathDenied(input: string): boolean {
  const slash = input.replaceAll("\\", "/");
  const normalized = posix.normalize(slash);
  return slash.split("/").includes("..") || normalized.split("/").includes("..");
}

function traversalError(input: string): { error: "path traversal denied" } | null {
  return pathDenied(input) ? { error: "path traversal denied" } : null;
}

export async function readFile(
  args: { path: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const denied = traversalError(args.path);
  if (denied) return denied;
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
  const denied = traversalError(args.path);
  if (denied) return denied;
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
  const denied = traversalError(args.path);
  if (denied) return denied;
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
  const denied = traversalError(args.path);
  if (denied) return denied;
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
  const denied = traversalError(args.path);
  if (denied) return denied;
  const { stdout, stderr, exitCode } = await vm.execInContainer(
    vmId,
    ["ls", "-la", args.path],
    undefined,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { listing: stdout };
}
