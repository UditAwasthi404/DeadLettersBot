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
  /** Account VMs this process knows about. Empty when no runtime state is recorded. */
  listVMs(): Promise<VMInfo[]>;
  execInContainer(
    vmId: string,
    cmd: string[],
    input?: string,
    signal?: AbortSignal,
  ): Promise<ExecResult>;
  /** Start or reuse a bot-isolated Xvfb + Chromium instance and return its CDP port. */
  ensureBotBrowser(vmId: string, botId: string): Promise<number>;
  /** Start or reuse x11vnc on that bot's Xvfb display and return its RFB port. */
  ensureBotVnc(vmId: string, botId: string): Promise<number>;
  /**
   * Watch a VM path with inotify. `done` settles when the watcher exits.
   * `stop` ends the watch.
   */
  watchFiles(
    vmId: string,
    path: string,
    onEvent: (file: string) => void,
  ): Promise<{ stop: () => Promise<void>; done: Promise<void> }>;
}
