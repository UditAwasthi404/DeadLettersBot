import { posix } from "node:path";
import type { VMManager } from "@agentOS/vm-manager";

const WORKSPACE_ROOT = "/home/agent";

function workspacePath(input: string): string | null {
  const slash = input.replaceAll("\\", "/");
  if (!slash.trim() || slash.includes("\0") || slash.split("/").includes("..")) return null;
  const resolved = posix.resolve(WORKSPACE_ROOT, slash);
  return resolved === WORKSPACE_ROOT || resolved.startsWith(`${WORKSPACE_ROOT}/`) ? resolved : null;
}

function fileCommand(path: string, operation: string): string[] {
  return ["agentos-file", operation, path];
}

export async function readFile(
  args: { path: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const path = workspacePath(args.path);
  if (!path) return { error: `path must stay inside ${WORKSPACE_ROOT}` };
  const { stdout, stderr, exitCode, outputTruncated } = await vm.execInContainer(
    vmId,
    fileCommand(path, "read"),
    undefined,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { content: stdout, ...(outputTruncated ? { truncated: true } : {}) };
}

export async function writeFile(
  args: { path: string; content: string },
  vmId: string,
  vm: VMManager,
  signal?: AbortSignal,
): Promise<unknown> {
  const path = workspacePath(args.path);
  if (!path) return { error: `path must stay inside ${WORKSPACE_ROOT}` };
  const { stderr, exitCode } = await vm.execInContainer(
    vmId,
    fileCommand(path, "write"),
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
  const path = workspacePath(args.path);
  if (!path) return { error: `path must stay inside ${WORKSPACE_ROOT}` };
  const { stderr, exitCode } = await vm.execInContainer(
    vmId,
    fileCommand(path, "append"),
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
  const path = workspacePath(args.path);
  if (!path) return { error: `path must stay inside ${WORKSPACE_ROOT}` };
  const { stderr, exitCode } = await vm.execInContainer(
    vmId,
    fileCommand(path, "delete"),
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
  const path = workspacePath(args.path);
  if (!path) return { error: `path must stay inside ${WORKSPACE_ROOT}` };
  const { stdout, stderr, exitCode, outputTruncated } = await vm.execInContainer(
    vmId,
    fileCommand(path, "list"),
    undefined,
    signal,
  );
  if (exitCode !== 0) return { error: stderr || `exit ${exitCode}` };
  return { listing: stdout, ...(outputTruncated ? { truncated: true } : {}) };
}
