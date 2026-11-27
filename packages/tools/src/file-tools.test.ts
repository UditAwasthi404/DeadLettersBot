import { describe, expect, test } from "bun:test";
import type { ExecResult, VMInfo, VMManager } from "@agentos/vm-manager";
import { listDirectory, readFile, writeFile } from "./file-tools.ts";
import { shellEscape } from "./shell-escape.ts";
import { runShell } from "./shell-tool.ts";

class StubVM implements VMManager {
  lastCmd: string[] = [];
  lastInput?: string;
  async provisionVM(accountId: string): Promise<VMInfo> {
    return { vmId: "v", accountId, status: "running" };
  }
  async wakeVM(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "", status: "running" };
  }
  async suspendVM(): Promise<void> {}
  async terminateVM(): Promise<void> {}
  async getVMStatus(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "", status: "running" };
  }
  async listVMs(): Promise<VMInfo[]> {
    return [];
  }
  async getVMStats() {
    return undefined;
  }
  async execInContainer(_vmId: string, cmd: string[], input?: string): Promise<ExecResult> {
    this.lastCmd = cmd;
    this.lastInput = input;
    if (cmd[0] === "agentos-file" && cmd[1] === "read")
      return { stdout: "hello file", stderr: "", exitCode: 0 };
    if (cmd[0] === "agentos-file" && cmd[1] === "list")
      return { stdout: "file.txt\n", stderr: "", exitCode: 0 };
    if (cmd[0] === "agentos-file") return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "ok", stderr: "", exitCode: 0 };
  }
  async ensureBotBrowser(): Promise<number> {
    return 9222;
  }
  async ensureBotVnc(): Promise<number> {
    return 7000;
  }
  async watchFiles(): Promise<{ stop: () => Promise<void>; done: Promise<void> }> {
    return { stop: async () => {}, done: new Promise(() => {}) };
  }
}

describe("file/shell tools", () => {
  test("shellEscape quotes paths", () => {
    expect(shellEscape("a'b")).toBe(`'a'\\''b'`);
  });

  test("readFile / listDirectory / writeFile / runShell", async () => {
    const vm = new StubVM();
    expect(await readFile({ path: "/home/agent/notes.txt" }, "v", vm)).toEqual({
      content: "hello file",
    });
    expect(vm.lastCmd).toEqual(["agentos-file", "read", "/home/agent/notes.txt"]);
    expect(await listDirectory({ path: "/home/agent" }, "v", vm)).toEqual({
      listing: "file.txt\n",
    });
    await writeFile({ path: "/home/agent/x.txt", content: "hi" }, "v", vm);
    expect(vm.lastInput).toBe("hi");
    expect(vm.lastCmd).toEqual(["agentos-file", "write", "/home/agent/x.txt"]);
    const shell = await runShell({ command: "echo hi", cwd: "/tmp" }, "v", vm);
    expect(shell).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    expect(vm.lastCmd[0]).toBe("setpriv");
    expect(vm.lastCmd).toContain("/usr/local/bin/agentos-shell");
  });

  test("readFile rejects path traversal and absolute escapes", async () => {
    const vm = new StubVM();
    expect(await readFile({ path: "/home/agent/../../etc/passwd" }, "v", vm)).toEqual({
      error: "path must stay inside /home/agent",
    });
    expect(await readFile({ path: "/etc/hostname" }, "v", vm)).toEqual({
      error: "path must stay inside /home/agent",
    });
    expect(vm.lastCmd).toEqual([]);
  });
});
