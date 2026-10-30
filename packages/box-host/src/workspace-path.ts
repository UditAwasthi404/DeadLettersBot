import { posix } from "node:path";

/** The agent user home inside the account VM. All bots on the account share it. */
export const BOT_WORKSPACE_ROOT = "/home/agent";

export function botWorkspacePath(input: string): string | null {
  if (!input.startsWith("/") || input.includes("\0")) return null;
  const normalized = posix.normalize(input);
  if (normalized !== BOT_WORKSPACE_ROOT && !normalized.startsWith(`${BOT_WORKSPACE_ROOT}/`))
    return null;
  return normalized;
}
