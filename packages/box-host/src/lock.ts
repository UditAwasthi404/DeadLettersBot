import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function lockPath(): string {
  return process.env.LOCK_FILE ?? join(tmpdir(), "box-host.lock");
}

function isBoxHostProcess(pid: number): boolean {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean);
    const executable = args[0] ?? "";
    return executable.includes("bun") && args.some((arg) => arg.includes("box-host"));
  } catch {
    // /proc is unavailable (non-Linux). A live pid is treated as the holder.
    return true;
  }
}

function lockHolderAlive(path: string): boolean {
  let owner = "";
  try {
    owner = readFileSync(path, "utf8").trim();
  } catch {
    return false;
  }
  const pid = Number(owner);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
  return isBoxHostProcess(pid);
}

/** Exclusive process lock (REQ-H01 — one host process). A lock whose process is gone is replaced. */
export function acquireProcessLock(): () => void {
  const path = lockPath();
  const acquire = () => {
    const fd = openSync(path, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
  };
  try {
    acquire();
  } catch {
    if (lockHolderAlive(path)) throw new Error(`box-host already running (lock: ${path})`);
    try {
      unlinkSync(path);
    } catch {
      throw new Error(`box-host already running (lock: ${path})`);
    }
    try {
      acquire();
    } catch {
      throw new Error(`box-host already running (lock: ${path})`);
    }
  }
  return () => {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  };
}
