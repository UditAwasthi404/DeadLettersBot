export type VMStatus = "running" | "sleeping" | "starting" | "terminated";

export interface VMInfo {
  vmId: string;
  accountId: string;
  status: VMStatus;
  ipAddress?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface VMManager {
  provisionVM(accountId: string): Promise<VMInfo>;
  wakeVM(vmId: string): Promise<VMInfo>;
  suspendVM(vmId: string): Promise<void>;
  terminateVM(vmId: string): Promise<void>;
  getVMStatus(vmId: string): Promise<VMInfo>;
  execInContainer(
    vmId: string,
    cmd: string[],
    input?: string,
    signal?: AbortSignal,
  ): Promise<ExecResult>;
  /** Start or reuse a bot-isolated Xvfb + Chromium instance and return its CDP port. */
  ensureBotBrowser(vmId: string, botId: string): Promise<number>;
}
