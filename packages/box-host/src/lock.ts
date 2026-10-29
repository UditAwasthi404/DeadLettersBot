import { closeSync, openSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function lockPath(): string {
  return process.env.LOCK_FILE ?? join(tmpdir(), "box-host.lock");
}

/** Exclusive process lock (REQ-H01 — one host process). */
export function acquireProcessLock(): () => void {
  const path = lockPath();
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    throw new Error(`box-host already running (lock: ${path})`);
  }
  return () => {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  };
}
