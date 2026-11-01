import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
/**
 * Docker-based VM manager (BUILD_PLAN Track D).
 * Image `agentos-vm` is built by infra/docker/Dockerfile.vm. NoopVMManager keeps the host startable without Docker.
 */
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import type { ExecResult, VMInfo, VMManager, VMStatus } from "./interface.ts";

const IMAGE = "agentos-vm";

type StateFile = Record<string, { accountId: string; vmId: string }>;

function statePath(): string {
  return process.env.VM_STATE_FILE ?? join(tmpdir(), "agentOS-vms.json");
}

function loadState(): StateFile {
  const path = statePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StateFile;
  } catch {
    return {};
  }
}

function saveState(state: StateFile): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function mapDockerState(status?: string, paused?: boolean): VMStatus {
  if (!status) return "terminated";
  if (paused) return "sleeping";
  const s = status.toLowerCase();
  if (s === "running") return "running";
  if (s === "paused") return "sleeping";
  if (s === "created" || s === "restarting") return "starting";
  if (s === "exited" || s === "dead" || s === "removing") return "terminated";
  return "terminated";
}

export class NoopVMManager implements VMManager {
  async provisionVM(accountId: string): Promise<VMInfo> {
    return { vmId: `noop-${accountId}`, accountId, status: "terminated" };
  }
  async wakeVM(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "", status: "terminated" };
  }
  async suspendVM(_vmId: string): Promise<void> {}
  async terminateVM(_vmId: string): Promise<void> {}
  async getVMStatus(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "", status: "terminated" };
  }
  async listVMs(): Promise<VMInfo[]> {
    return [];
  }
  async execInContainer(
    _vmId: string,
    _cmd: string[],
    _input?: string,
    _signal?: AbortSignal,
  ): Promise<ExecResult> {
    return { stdout: "", stderr: "vm not available", exitCode: 1 };
  }
  async ensureBotBrowser(_vmId: string, _botId: string): Promise<number> {
    throw new Error("browser VM not available");
  }
  async ensureBotVnc(_vmId: string, _botId: string): Promise<number> {
    throw new Error("vnc not available");
  }
  async watchFiles(): Promise<{ stop: () => Promise<void>; done: Promise<void> }> {
    // shortcut: no inotify without a Docker VM; file-change routines stay idle until the VM is running.
    return { stop: async () => {}, done: new Promise(() => {}) };
  }
}

export class DockerVMManager implements VMManager {
  constructor(private readonly docker: Docker) {}

  private containerName(accountId: string): string {
    return `agentOS-vm-${accountId}`;
  }

  private accountNetworkName(accountId: string): string {
    const suffix = createHash("sha256").update(accountId).digest("hex").slice(0, 16);
    return `agentos-vm-${suffix}`;
  }

  private async hostContainerId(): Promise<string | undefined> {
    if (process.env.VM_HOST_IN_DOCKER !== "1" || !process.env.HOSTNAME) return undefined;
    const info = await this.docker.getContainer(process.env.HOSTNAME).inspect();
    return info.Id;
  }

  private async ensureAccountNetwork(accountId: string): Promise<string> {
    const name = this.accountNetworkName(accountId);
    let network: Docker.Network;
    try {
      network = await this.docker.createNetwork({
        Name: name,
        Driver: "bridge",
        Labels: { "agentos.accountId": accountId },
      });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 409) throw err;
      network = this.docker.getNetwork(name);
      const details = (await network.inspect()) as { Labels?: Record<string, string> };
      if (details.Labels?.["agentos.accountId"] !== accountId)
        throw new Error("refusing to reuse a Docker network owned by another account");
    }

    const hostContainerId = await this.hostContainerId();
    if (hostContainerId) {
      const details = (await network.inspect()) as {
        Containers?: Record<string, { Name?: string }>;
      };
      const alreadyAttached = Object.keys(details.Containers ?? {}).some(
        (id) => id === hostContainerId,
      );
      if (!alreadyAttached) await network.connect({ Container: hostContainerId });
    }
    return name;
  }

  async provisionVM(accountId: string): Promise<VMInfo> {
    const name = this.containerName(accountId);
    const networkName = await this.ensureAccountNetwork(accountId);
    let container = this.docker.getContainer(name);
    try {
      const existing = await container.inspect();
      if (existing.Config?.Labels?.["agentos.accountId"] !== accountId)
        throw new Error("refusing to reuse a Docker VM owned by another account");
      if (existing.State?.Paused) await container.unpause();
      for (const attachedNetwork of Object.keys(existing.NetworkSettings?.Networks ?? {})) {
        if (attachedNetwork !== networkName) {
          await this.docker
            .getNetwork(attachedNetwork)
            .disconnect({ Container: container.id, Force: true });
        }
      }
      const attached = await container.inspect();
      if (!attached.NetworkSettings?.Networks?.[networkName])
        await this.docker.getNetwork(networkName).connect({ Container: container.id });
      if (attached.State?.Status !== "running" && !attached.State?.Paused) await container.start();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
      container = await this.docker.createContainer({
        Image: IMAGE,
        name,
        Labels: { "agentos.accountId": accountId },
        HostConfig: {
          Memory: Number(process.env.VM_MEMORY_BYTES ?? 2_147_483_648),
          MemorySwap: Number(process.env.VM_MEMORY_BYTES ?? 2_147_483_648),
          NanoCpus: Number(process.env.VM_CPU_NANOS ?? 2_000_000_000),
          PidsLimit: Number(process.env.VM_PIDS_LIMIT ?? 512),
          NetworkMode: networkName,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          Init: true,
        },
      });
      await container.start();
    }
    const vmId = container.id;
    const state = loadState();
    state[accountId] = { accountId, vmId };
    saveState(state);
    return this.waitUntilAddressed(vmId);
  }

  private async waitUntilAddressed(vmId: string): Promise<VMInfo> {
    let latest = await this.getVMStatus(vmId);
    for (
      let attempt = 0;
      attempt < 20 && (latest.status !== "running" || !latest.ipAddress);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      latest = await this.getVMStatus(vmId);
    }
    return latest;
  }

  async wakeVM(vmId: string): Promise<VMInfo> {
    const container = this.docker.getContainer(vmId);
    try {
      await container.unpause();
    } catch {
      await container.start();
    }
    return this.getVMStatus(vmId);
  }

  async suspendVM(vmId: string): Promise<void> {
    await this.docker.getContainer(vmId).pause();
  }

  async listVMs(): Promise<VMInfo[]> {
    const infos: VMInfo[] = [];
    for (const entry of Object.values(loadState())) infos.push(await this.getVMStatus(entry.vmId));
    return infos;
  }

  async terminateVM(vmId: string): Promise<void> {
    const container = this.docker.getContainer(vmId);
    const info = await container.inspect().catch(() => null);
    const accountId = info?.Config?.Labels?.["agentos.accountId"];
    try {
      await container.stop();
    } catch {
      /* already stopped */
    }
    await container.remove({ force: true });
    if (accountId) {
      const networkName = this.accountNetworkName(accountId);
      const network = this.docker.getNetwork(networkName);
      const hostContainerId = await this.hostContainerId().catch(() => undefined);
      if (hostContainerId) {
        await network.disconnect({ Container: hostContainerId, Force: true }).catch(() => {});
      }
      await network.remove().catch(() => {});
    }
    const state = loadState();
    for (const [accountId, entry] of Object.entries(state)) {
      if (entry.vmId === vmId) delete state[accountId];
    }
    saveState(state);
  }

  async getVMStatus(vmId: string): Promise<VMInfo> {
    try {
      const info = await this.docker.getContainer(vmId).inspect();
      const accountId =
        info.Config?.Labels?.["agentos.accountId"] ??
        Object.values(loadState()).find((e) => e.vmId === vmId)?.accountId ??
        "";
      const status = mapDockerState(info.State?.Status, info.State?.Paused);
      const ip =
        info.NetworkSettings?.IPAddress ||
        Object.values(info.NetworkSettings?.Networks ?? {}).find((network) => network.IPAddress)
          ?.IPAddress ||
        undefined;
      return { vmId, accountId, status, ipAddress: ip };
    } catch {
      return { vmId, accountId: "", status: "terminated" };
    }
  }

  async execInContainer(
    vmId: string,
    cmd: string[],
    input?: string,
    signal?: AbortSignal,
  ): Promise<ExecResult> {
    if (signal?.aborted) return { stdout: "", stderr: "execution cancelled", exitCode: 130 };
    const container = this.docker.getContainer(vmId);
    const executionId = randomUUID();
    const attachStdin = input !== undefined;
    const exec = await container.exec({
      Cmd: ["bash", "/usr/local/bin/agentos-controlled-exec", executionId, ...cmd],
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: attachStdin,
      User: "agent",
      Env: [
        "HOME=/home/agent",
        "USER=agent",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      ],
    });
    const stream = await exec.start({ hijack: true, stdin: attachStdin });

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    stdoutStream.on("data", (c: Buffer) => stdoutChunks.push(Uint8Array.from(c)));
    stderrStream.on("data", (c: Buffer) => stderrChunks.push(Uint8Array.from(c)));
    this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    let abortInProgress = false;
    const abortExecution = () => {
      if (abortInProgress) return;
      abortInProgress = true;
      void exec
        .inspect()
        .then(async (details) => {
          const pid = details.Pid;
          if (details.Running && typeof pid === "number" && pid > 1)
            await this.execInContainer(vmId, [
              "bash",
              "-c",
              'kill -TERM "$1"',
              "agentos-kill",
              String(pid),
            ]);
        })
        .catch((err) => console.warn("[vm-manager] failed to stop controlled execution", err));
    };
    signal?.addEventListener("abort", abortExecution, { once: true });
    if (signal?.aborted) abortExecution();

    if (attachStdin) {
      stream.write(input ?? "");
      stream.end();
    }

    await new Promise<void>((resolve, reject) => {
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });

    signal?.removeEventListener("abort", abortExecution);
    const inspect = await exec.inspect();
    const cancelled = signal?.aborted ?? false;
    return {
      stdout: Buffer.concat(stdoutChunks).toString(),
      stderr: cancelled
        ? `${Buffer.concat(stderrChunks).toString()}execution cancelled`
        : Buffer.concat(stderrChunks).toString(),
      exitCode: cancelled ? 130 : (inspect.ExitCode ?? 0),
    };
  }

  async ensureBotBrowser(vmId: string, botId: string): Promise<number> {
    if (!/^[0-9a-f-]{36}$/i.test(botId)) throw new Error("invalid bot id for browser isolation");
    const result = await this.execInContainer(vmId, [
      "bash",
      "/usr/local/bin/agentos-ensure-browser",
      botId,
    ]);
    const port = Number(result.stdout.trim());
    if (result.exitCode !== 0 || !Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error(`failed to start isolated browser: ${result.stderr || result.stdout}`);
    return port;
  }

  async ensureBotVnc(vmId: string, botId: string): Promise<number> {
    if (!/^[0-9a-f-]{36}$/i.test(botId)) throw new Error("invalid bot id for vnc");
    const result = await this.execInContainer(vmId, [
      "bash",
      "/usr/local/bin/agentos-ensure-vnc",
      botId,
    ]);
    const port = Number(result.stdout.trim());
    if (result.exitCode !== 0 || !Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error(`failed to start vnc: ${result.stderr || result.stdout}`);
    return port;
  }

  async watchFiles(
    vmId: string,
    path: string,
    onEvent: (file: string) => void,
  ): Promise<{ stop: () => Promise<void>; done: Promise<void> }> {
    const container = this.docker.getContainer(vmId);
    const exec = await container.exec({
      Cmd: ["inotifywait", "-m", "-e", "modify,create,delete,move", "--format", "%w%f", path],
      AttachStdout: true,
      AttachStderr: true,
      User: "agent",
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    this.docker.modem.demuxStream(stream, stdout, stderr);
    let buffer = "";
    stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onEvent(line.trim());
    });
    stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn("[vm-manager] inotify", text.slice(0, 300));
    });
    let stopped = false;
    const done = new Promise<void>((resolve) => {
      stream.on("end", () => resolve());
      stream.on("error", () => resolve());
    });
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      stream.destroy();
      const details = await exec.inspect().catch(() => null);
      const pid = details?.Pid;
      if (details?.Running && typeof pid === "number" && pid > 1)
        await this.execInContainer(vmId, [
          "bash",
          "-c",
          'kill -TERM "$1"',
          "agentos-kill",
          String(pid),
        ]).catch(() => {});
    };
    return { stop, done };
  }
}

/** Prefer Docker when the socket looks available; otherwise NoopVMManager. */
export function createVMManager(): VMManager {
  try {
    if (process.platform !== "win32") {
      const raw = process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock";
      const sock = raw.startsWith("unix://") ? raw.slice("unix://".length) : raw;
      if (!existsSync(sock)) {
        console.warn("[vm-manager] Docker socket unavailable; using NoopVMManager");
        return new NoopVMManager();
      }
    }
    return new DockerVMManager(new Docker());
  } catch (err) {
    console.warn(
      "[vm-manager] Docker socket unavailable; using NoopVMManager",
      err instanceof Error ? err.message : err,
    );
    return new NoopVMManager();
  }
}
