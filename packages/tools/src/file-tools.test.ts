import { describe, expect, test } from "bun:test";
import type { ExecResult, VMInfo, VMManager } from "@agentOS/vm-manager";
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
  async execInContainer(_vmId: string, cmd: string[], input?: string): Promise<ExecResult> {
    this.lastCmd = cmd;
    this.lastInput = input;
    if (cmd[0] === "cat") return { stdout: "hello file", stderr: "", exitCode: 0 };
    if (cmd[0] === "ls") return { stdout: "file.txt\n", stderr: "", exitCode: 0 };
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
    expect(await readFile({ path: "/etc/hostname" }, "v", vm)).toEqual({ content: "hello file" });
    expect(await listDirectory({ path: "/tmp" }, "v", vm)).toEqual({ listing: "file.txt\n" });
    await writeFile({ path: "/tmp/x", content: "hi" }, "v", vm);
    expect(vm.lastInput).toBe("hi");
    expect(vm.lastCmd[0]).toBe("sh");
    const shell = await runShell({ command: "echo hi", cwd: "/tmp" }, "v", vm);
    expect(shell).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });

  test("readFile rejects path traversal", async () => {
    const vm = new StubVM();
    expect(await readFile({ path: "/home/agent/../../etc/passwd" }, "v", vm)).toEqual({
      error: "path traversal denied",
    });
    expect(vm.lastCmd).toEqual([]);
  });
});
