import { describe, expect, test } from "bun:test";
import { NoopVMManager, createVMManager } from "./docker.ts";

describe("createVMManager", () => {
  test("returns a VMManager (Docker or Noop)", async () => {
    const mgr = createVMManager();
    const info = await mgr.getVMStatus("missing");
    expect(info.status).toBe("terminated");
  });

  test("NoopVMManager always reports terminated", async () => {
    const mgr = new NoopVMManager();
    const provisioned = await mgr.provisionVM("acc-1");
    expect(provisioned.status).toBe("terminated");
    await mgr.suspendVM(provisioned.vmId);
    await mgr.terminateVM(provisioned.vmId);
    const exec = await mgr.execInContainer(provisioned.vmId, ["echo", "hi"]);
    expect(exec.exitCode).toBe(1);
    expect(exec.stderr).toContain("vm not available");
  });
});
