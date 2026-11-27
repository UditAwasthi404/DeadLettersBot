import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
/**
 * Docker-based VM manager (BUILD_PLAN Track D).
 * Image `agentos/vm-manager` is built by infra/docker/Dockerfile.vm. NoopVMManager keeps the host startable without Docker.
 */
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { type VMEgressRule, parseVMEgressAllowlist } from "./egress.ts";
import type { ExecResult, VMInfo, VMManager, VMStats, VMStatus } from "./interface.ts";
import { KubernetesVMManager } from "./kubernetes.ts";

const IMAGE = process.env.VM_IMAGE ?? "agentos/vm-manager";
const MAX_EXEC_OUTPUT_BYTES = 1_048_576;
const PREWARM_CONTAINER_PREFIX = "agentos-vm-pool-";

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
  if (s === "exited") return "sleeping";
  if (s === "dead" || s === "removing") return "terminated";
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
  async getVMStats(_vmId: string): Promise<VMStats | undefined> {
    return undefined;
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
  private static prewarmQueue: Promise<void> = Promise.resolve();
  private readonly prewarmPoolSize: number;
  private readonly egressPolicy: "allow_all" | "deny_all" | "allowlist";
  private readonly egressAllowlist: VMEgressRule[];
  private readonly egressConfigHash: string;

  constructor(private readonly docker: Docker) {
    const requestedEgressPolicy = process.env.VM_EGRESS_POLICY ?? "allow_all";
    if (
      requestedEgressPolicy !== "allow_all" &&
      requestedEgressPolicy !== "deny_all" &&
      requestedEgressPolicy !== "allowlist"
    )
      throw new Error("VM_EGRESS_POLICY must be allow_all, deny_all, or allowlist");
    this.egressPolicy = requestedEgressPolicy;
    const allowlistValue = process.env.VM_EGRESS_ALLOWLIST?.trim() ?? "";
    if (this.egressPolicy === "allowlist") {
      if (!allowlistValue) throw new Error("VM_EGRESS_ALLOWLIST is required for allowlist mode");
      this.egressAllowlist = parseVMEgressAllowlist(allowlistValue);
    } else {
      if (allowlistValue)
        throw new Error("VM_EGRESS_ALLOWLIST requires VM_EGRESS_POLICY=allowlist");
      this.egressAllowlist = [];
    }
    this.egressConfigHash = createHash("sha256")
      .update(JSON.stringify({ policy: this.egressPolicy, rules: this.egressAllowlist }))
      .digest("hex");

    const requestedPoolSize = Number(process.env.VM_PREWARM_POOL_SIZE ?? 0);
    this.prewarmPoolSize = Number.isInteger(requestedPoolSize)
      ? Math.max(0, Math.min(requestedPoolSize, 20))
      : 0;
    if (this.egressPolicy === "allowlist" && this.prewarmPoolSize > 0)
      throw new Error("VM_PREWARM_POOL_SIZE cannot be used with VM_EGRESS_POLICY=allowlist");
    if (this.prewarmPoolSize > 0) {
      const timer = setInterval(() => {
        void this.reconcilePrewarmPool().catch((err: unknown) =>
          console.warn("[vm-manager] VM prewarm pool reconciliation failed", err),
        );
      }, 30_000);
      timer.unref?.();
      void this.reconcilePrewarmPool().catch((err: unknown) =>
        console.warn("[vm-manager] VM prewarm pool initialization failed", err),
      );
    }
  }

  private async withPrewarmLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = DockerVMManager.prewarmQueue;
    let release!: () => void;
    DockerVMManager.prewarmQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private containerHostConfig(networkMode: string, egressHelper = false) {
    const memory = Number(process.env.VM_MEMORY_BYTES ?? 2_147_483_648);
    return {
      Memory: egressHelper ? 67_108_864 : memory,
      MemorySwap: egressHelper ? 67_108_864 : memory,
      NanoCpus: egressHelper ? 100_000_000 : Number(process.env.VM_CPU_NANOS ?? 2_000_000_000),
      PidsLimit: egressHelper ? 64 : Number(process.env.VM_PIDS_LIMIT ?? 512),
      NetworkMode: networkMode,
      CapDrop: ["ALL"],
      ...(egressHelper ? { CapAdd: ["NET_ADMIN", "SETUID", "SETGID"] } : {}),
      SecurityOpt: ["no-new-privileges:true"],
      Init: true,
    };
  }

  private containerCreateOptions(
    name: string,
    networkMode: string,
    labels: Record<string, string>,
  ) {
    return {
      Image: IMAGE,
      name,
      User: "agent",
      Env: [
        `VM_EGRESS_POLICY=${this.egressPolicy}`,
        ...(this.egressPolicy === "allowlist"
          ? [
              `VM_EGRESS_ALLOWLIST=${JSON.stringify(this.egressAllowlist)}`,
              "AGENTOS_EGRESS_FIREWALL_SHARED=1",
            ]
          : []),
      ],
      Labels: { ...labels, "agentos.egressConfigHash": this.egressConfigHash },
      HostConfig: this.containerHostConfig(networkMode),
    };
  }

  private egressHelperName(accountId: string): string {
    const suffix = createHash("sha256").update(accountId).digest("hex").slice(0, 16);
    return `agentos-egress-${suffix}`;
  }

  private async waitForEgressHelperReady(
    container: Docker.Container,
    accountId: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const info = await container.inspect();
      if (!info.State?.Running)
        throw new Error(`Docker egress helper for account ${accountId} stopped during startup`);
      const health = info.State.Health?.Status;
      if (health === "healthy") return info.Id;
      if (health === "unhealthy")
        throw new Error(`Docker egress helper for account ${accountId} failed its readiness check`);
      if (!info.State.Health)
        throw new Error(
          `Docker egress helper for account ${accountId} has no readiness healthcheck; rebuild the VM image and reprovision it`,
        );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `Docker egress helper for account ${accountId} did not become ready within 30 seconds`,
    );
  }

  private async ensureEgressHelper(accountId: string, networkName: string): Promise<string> {
    const name = this.egressHelperName(accountId);
    let container: Docker.Container;
    try {
      container = await this.docker.createContainer({
        Image: IMAGE,
        name,
        User: "root",
        Cmd: ["sleep", "infinity"],
        Env: [
          "VM_EGRESS_POLICY=allowlist",
          `VM_EGRESS_ALLOWLIST=${JSON.stringify(this.egressAllowlist)}`,
          "AGENTOS_EGRESS_FIREWALL_HELPER=1",
        ],
        Labels: {
          "agentos.accountId": accountId,
          "agentos.egressHelper": "true",
          "agentos.egressConfigHash": this.egressConfigHash,
        },
        HostConfig: this.containerHostConfig(networkName, true),
      });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err;
      container = this.docker.getContainer(name);
    }

    const info = await container.inspect();
    if (
      info.Config?.Labels?.["agentos.accountId"] !== accountId ||
      info.Config?.Labels?.["agentos.egressHelper"] !== "true"
    )
      throw new Error("refusing to reuse a Docker egress helper owned by another account");
    if (info.HostConfig?.NetworkMode !== networkName)
      throw new Error(
        `VM egress network changed for account ${accountId}; terminate and reprovision this VM before using the new policy`,
      );
    if (info.Config?.Labels?.["agentos.egressConfigHash"] !== this.egressConfigHash)
      throw new Error(
        `VM egress rules changed for account ${accountId}; terminate and reprovision this VM before using the new policy`,
      );
    if (!info.State?.Running) {
      try {
        await container.start();
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode !== 304) throw err;
      }
    }
    return this.waitForEgressHelperReady(container, accountId);
  }

  private async existingEgressHelperId(accountId: string): Promise<string> {
    const container = this.docker.getContainer(this.egressHelperName(accountId));
    const info = await container.inspect().catch((err: unknown) => {
      if ((err as { statusCode?: number }).statusCode === 404)
        throw new Error(
          `Docker egress helper for account ${accountId} is missing; reprovision its VM`,
        );
      throw err;
    });
    if (
      info.Config?.Labels?.["agentos.accountId"] !== accountId ||
      info.Config?.Labels?.["agentos.egressHelper"] !== "true"
    )
      throw new Error("refusing to reuse a Docker egress helper owned by another account");
    if (info.Config?.Labels?.["agentos.egressConfigHash"] !== this.egressConfigHash)
      throw new Error(`VM egress rules changed for account ${accountId}; reprovision its VM`);
    if (!info.State?.Running)
      throw new Error(
        `Docker egress helper for account ${accountId} is stopped; reprovision its VM`,
      );
    await this.waitForEgressHelperReady(container, accountId);
    return info.Id;
  }

  private async removeEgressHelper(accountId: string): Promise<void> {
    const container = this.docker.getContainer(this.egressHelperName(accountId));
    const info = await container.inspect().catch((err: unknown) => {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    });
    if (!info) return;
    if (
      info.Config?.Labels?.["agentos.accountId"] !== accountId ||
      info.Config?.Labels?.["agentos.egressHelper"] !== "true"
    )
      throw new Error("refusing to remove a Docker egress helper owned by another account");
    await container.remove({ force: true });
  }

  private async egressHelperAddress(accountId: string): Promise<string | undefined> {
    const container = this.docker.getContainer(this.egressHelperName(accountId));
    const info = await container.inspect().catch((err: unknown) => {
      if ((err as { statusCode?: number }).statusCode === 404) return undefined;
      throw err;
    });
    if (
      !info ||
      info.Config?.Labels?.["agentos.accountId"] !== accountId ||
      info.Config?.Labels?.["agentos.egressHelper"] !== "true"
    )
      return undefined;
    return (
      info.NetworkSettings?.IPAddress ||
      Object.values(info.NetworkSettings?.Networks ?? {}).find((network) => network.IPAddress)
        ?.IPAddress
    );
  }

  private assertEgressConfig(
    info: Awaited<ReturnType<Docker.Container["inspect"]>>,
    allowLegacy = true,
    egressHelperId?: string,
  ): void {
    const storedHash = info.Config?.Labels?.["agentos.egressConfigHash"];
    if (
      this.egressPolicy === "allowlist" &&
      egressHelperId &&
      info.HostConfig?.NetworkMode !== `container:${egressHelperId}`
    )
      throw new Error(
        `VM egress network changed for ${info.Name?.replace(/^\/+/, "") ?? info.Id}; terminate and reprovision this VM before using the new policy`,
      );
    if (storedHash === this.egressConfigHash) return;
    if (!storedHash && allowLegacy && this.egressPolicy !== "allowlist") return;
    throw new Error(
      `VM egress policy changed for ${info.Name?.replace(/^\/+/, "") ?? info.Id}; terminate and reprovision this VM before using the new policy`,
    );
  }

  private async poolContainers(): Promise<Docker.ContainerInfo[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers.filter((container) =>
      container.Names?.some((name) =>
        name.replace(/^\/+/, "").startsWith(PREWARM_CONTAINER_PREFIX),
      ),
    );
  }

  private async reconcilePrewarmPool(): Promise<void> {
    if (this.prewarmPoolSize < 1) return;
    await this.withPrewarmLock(async () => {
      let ready = 0;
      for (const entry of await this.poolContainers()) {
        const container = this.docker.getContainer(entry.Id);
        const info = await container.inspect().catch((err: unknown) => {
          if ((err as { statusCode?: number }).statusCode === 404) return null;
          throw err;
        });
        if (!info) continue;
        if (info.Config?.Labels?.["agentos.prewarm"] !== "true") continue;
        if (
          info.State?.Running &&
          info.Config?.Labels?.["agentos.egressConfigHash"] === this.egressConfigHash
        ) {
          ready += 1;
          continue;
        }
        await container.remove({ force: true }).catch((err: unknown) => {
          if ((err as { statusCode?: number }).statusCode !== 404)
            console.warn("[vm-manager] failed to remove stopped prewarm container", err);
        });
      }

      while (ready < this.prewarmPoolSize) {
        const name = `${PREWARM_CONTAINER_PREFIX}${randomUUID()}`;
        const container = await this.docker.createContainer(
          this.containerCreateOptions(name, "none", { "agentos.prewarm": "true" }),
        );
        await container.start();
        ready += 1;
      }
    });
  }

  private async claimPrewarmedContainer(
    accountId: string,
    networkName: string,
  ): Promise<Docker.Container | undefined> {
    return this.withPrewarmLock(async () => {
      for (const entry of await this.poolContainers()) {
        const container = this.docker.getContainer(entry.Id);
        const info = await container.inspect().catch((err: unknown) => {
          if ((err as { statusCode?: number }).statusCode === 404) return null;
          throw err;
        });
        const currentName = info?.Name?.replace(/^\/+/, "") ?? "";
        if (!info || !currentName.startsWith(PREWARM_CONTAINER_PREFIX)) continue;
        if (info.Config?.Labels?.["agentos.prewarm"] !== "true") continue;
        if (info.Config?.Labels?.["agentos.egressConfigHash"] !== this.egressConfigHash) continue;
        if (!info.State?.Running) continue;
        try {
          await container.rename({ name: this.containerName(accountId) });
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 409) continue;
          throw err;
        }
        const networks = info.NetworkSettings?.Networks ?? {};
        if (!networks[networkName])
          await this.docker.getNetwork(networkName).connect({ Container: container.id });
        void this.reconcilePrewarmPool().catch((err: unknown) =>
          console.warn("[vm-manager] failed to replenish prewarm pool", err),
        );
        return container;
      }
      return undefined;
    });
  }

  private containerName(accountId: string): string {
    return `agentOS-vm-${accountId}`;
  }

  private accountNetworkName(accountId: string): string {
    const suffix = createHash("sha256").update(accountId).digest("hex").slice(0, 16);
    return `agentos-vm-${suffix}`;
  }

  private isAccountContainer(
    info: Awaited<ReturnType<Docker.Container["inspect"]>>,
    accountId: string,
  ): boolean {
    if (info.Config?.Labels?.["agentos.accountId"] === accountId) return true;
    const name = info.Name?.replace(/^\/+/, "");
    return (
      info.Config?.Labels?.["agentos.prewarm"] === "true" && name === this.containerName(accountId)
    );
  }

  private accountIdForContainer(info: Awaited<ReturnType<Docker.Container["inspect"]>>): string {
    const labeled = info.Config?.Labels?.["agentos.accountId"];
    if (labeled) return labeled;
    const stored = Object.values(loadState()).find((entry) => entry.vmId === info.Id)?.accountId;
    if (stored) return stored;
    const name = info.Name?.replace(/^\/+/, "") ?? "";
    if (name.startsWith(PREWARM_CONTAINER_PREFIX)) return "";
    return name.startsWith("agentOS-vm-") ? name.slice("agentOS-vm-".length) : "";
  }

  private async attachToAccountNetwork(
    container: Docker.Container,
    networkName: string,
    info: Awaited<ReturnType<Docker.Container["inspect"]>>,
  ): Promise<void> {
    for (const attachedNetwork of Object.keys(info.NetworkSettings?.Networks ?? {})) {
      if (attachedNetwork === networkName || attachedNetwork === "none") continue;
      await this.docker
        .getNetwork(attachedNetwork)
        .disconnect({ Container: container.id, Force: true });
    }
    const attached = await container.inspect();
    if (!attached.NetworkSettings?.Networks?.[networkName])
      await this.docker.getNetwork(networkName).connect({ Container: container.id });
    if (attached.State?.Paused) await container.unpause();
    else if (attached.State?.Status !== "running") await container.start();
  }

  private async hostContainerId(): Promise<string | undefined> {
    if (process.env.VM_HOST_IN_DOCKER !== "1" || !process.env.HOSTNAME) return undefined;
    const info = await this.docker.getContainer(process.env.HOSTNAME).inspect();
    return info.Id;
  }

  private async ensureAccountNetwork(accountId: string): Promise<string> {
    const name = this.accountNetworkName(accountId);
    const isolated = this.egressPolicy === "deny_all";
    const labels = {
      "agentos.accountId": accountId,
      "agentos.egressPolicy": this.egressPolicy,
      "agentos.egressConfigHash": this.egressConfigHash,
    };
    let network: Docker.Network;
    try {
      network = await this.docker.createNetwork({
        Name: name,
        Driver: "bridge",
        Internal: isolated,
        Labels: labels,
      });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 409) throw err;
      network = this.docker.getNetwork(name);
      const details = (await network.inspect()) as {
        Labels?: Record<string, string>;
        Internal?: boolean;
      };
      if (details.Labels?.["agentos.accountId"] !== accountId)
        throw new Error("refusing to reuse a Docker network owned by another account");
      if (Boolean(details.Internal) !== isolated)
        throw new Error(
          `VM_EGRESS_POLICY changed for account ${accountId}; terminate its VM before reprovisioning`,
        );
      const storedHash = details.Labels?.["agentos.egressConfigHash"];
      if (storedHash && storedHash !== this.egressConfigHash)
        throw new Error(
          `VM egress rules changed for account ${accountId}; terminate its VM before reprovisioning`,
        );
      if (this.egressPolicy === "allowlist" && storedHash !== this.egressConfigHash)
        throw new Error(
          `VM_EGRESS_ALLOWLIST changed for account ${accountId}; terminate its VM before reprovisioning`,
        );
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
    const egressHelperId =
      this.egressPolicy === "allowlist"
        ? await this.ensureEgressHelper(accountId, networkName)
        : undefined;
    const containerNetworkMode = egressHelperId ? `container:${egressHelperId}` : networkName;
    let container = this.docker.getContainer(name);
    let existing: Awaited<ReturnType<Docker.Container["inspect"]>> | undefined;
    try {
      existing = await container.inspect();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
    if (!existing) {
      container =
        (await this.claimPrewarmedContainer(accountId, networkName)) ??
        (await this.createAccountContainer(accountId, name, containerNetworkMode));
      existing = await container.inspect();
    }
    this.assertEgressConfig(existing, true, egressHelperId);
    if (!this.isAccountContainer(existing, accountId))
      throw new Error("refusing to reuse a Docker VM owned by another account");
    if (egressHelperId) {
      if (existing.State?.Paused) await container.unpause();
      else if (existing.State?.Status !== "running") await container.start();
    } else {
      await this.attachToAccountNetwork(container, networkName, existing);
    }
    const vmId = container.id;
    const state = loadState();
    state[accountId] = { accountId, vmId };
    saveState(state);
    return this.waitUntilAddressed(vmId);
  }

  private async createAccountContainer(
    accountId: string,
    name: string,
    networkName: string,
  ): Promise<Docker.Container> {
    try {
      const container = await this.docker.createContainer(
        this.containerCreateOptions(name, networkName, { "agentos.accountId": accountId }),
      );
      await container.start();
      return container;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err;
      const container = this.docker.getContainer(name);
      const info = await container.inspect();
      this.assertEgressConfig(info);
      if (!this.isAccountContainer(info, accountId))
        throw new Error("refusing to reuse a Docker VM owned by another account");
      return container;
    }
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
    const info = await container.inspect();
    const accountId = this.accountIdForContainer(info);
    const helperId =
      this.egressPolicy === "allowlist" ? await this.existingEgressHelperId(accountId) : undefined;
    this.assertEgressConfig(info, true, helperId);
    try {
      await container.unpause();
    } catch {
      await container.start();
    }
    return this.getVMStatus(vmId);
  }

  async suspendVM(vmId: string): Promise<void> {
    const container = this.docker.getContainer(vmId);
    const info = await container.inspect().catch((err: unknown) => {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    });
    if (info?.State?.Running) await container.stop({ t: 10 });
  }

  async listVMs(): Promise<VMInfo[]> {
    const infos: VMInfo[] = [];
    for (const entry of Object.values(loadState())) infos.push(await this.getVMStatus(entry.vmId));
    return infos;
  }

  async getVMStats(vmId: string): Promise<VMStats | undefined> {
    const stats = await this.docker.getContainer(vmId).stats({ stream: false, "one-shot": true });
    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = Math.max(stats.cpu_stats.online_cpus || 1, 1);
    const cpuPercent =
      systemDelta > 0 && cpuDelta >= 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
    const memoryUsedBytes = Math.max(0, stats.memory_stats.usage ?? 0);
    const memoryLimitBytes = Math.max(0, stats.memory_stats.limit ?? 0);
    return {
      cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
      memoryUsedBytes,
      memoryLimitBytes,
    };
  }

  async terminateVM(vmId: string): Promise<void> {
    const container = this.docker.getContainer(vmId);
    const info = await container.inspect().catch(() => null);
    const accountId =
      (info ? this.accountIdForContainer(info) : "") ||
      Object.values(loadState()).find((entry) => entry.vmId === vmId)?.accountId ||
      "";
    try {
      await container.stop();
    } catch {
      /* already stopped */
    }
    await container.remove({ force: true });
    if (accountId) {
      await this.removeEgressHelper(accountId);
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
      const accountId = this.accountIdForContainer(info);
      const status = mapDockerState(info.State?.Status, info.State?.Paused);
      let ip =
        info.NetworkSettings?.IPAddress ||
        Object.values(info.NetworkSettings?.Networks ?? {}).find((network) => network.IPAddress)
          ?.IPAddress ||
        undefined;
      if (!ip && this.egressPolicy === "allowlist" && accountId)
        ip = await this.egressHelperAddress(accountId);
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
    let capturedBytes = 0;
    let outputTruncated = false;
    const capture = (chunks: Uint8Array[], chunk: Buffer) => {
      const available = Math.max(0, MAX_EXEC_OUTPUT_BYTES - capturedBytes);
      const length = Math.min(available, chunk.byteLength);
      if (length > 0) {
        chunks.push(Uint8Array.from(chunk.subarray(0, length)));
        capturedBytes += length;
      }
      if (length < chunk.byteLength) outputTruncated = true;
    };
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    stdoutStream.on("data", (c: Buffer) => capture(stdoutChunks, c));
    stderrStream.on("data", (c: Buffer) => capture(stderrChunks, c));
    this.docker.modem.demuxStream(
      stream as unknown as NodeJS.ReadableStream,
      stdoutStream,
      stderrStream,
    );

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

    try {
      if (attachStdin) {
        stream.write(input ?? "");
        stream.end();
      }

      await new Promise<void>((resolve, reject) => {
        stream.on("end", () => resolve());
        stream.on("error", (err: Error) => reject(err));
      });
    } finally {
      signal?.removeEventListener("abort", abortExecution);
    }

    const inspect = await exec.inspect();
    const cancelled = signal?.aborted ?? false;
    const stdout = Buffer.concat(stdoutChunks).toString();
    const stderr = Buffer.concat(stderrChunks).toString();
    const stderrSuffixes = [
      ...(cancelled ? ["execution cancelled"] : []),
      ...(outputTruncated ? [`output truncated after ${MAX_EXEC_OUTPUT_BYTES} bytes`] : []),
    ];
    return {
      stdout,
      stderr: [stderr, ...stderrSuffixes].filter(Boolean).join("\n"),
      exitCode: cancelled ? 130 : (inspect.ExitCode ?? 0),
      ...(outputTruncated ? { outputTruncated: true } : {}),
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
    this.docker.modem.demuxStream(stream as unknown as NodeJS.ReadableStream, stdout, stderr);
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

/** Verify the selected runtime before serving requests; only development may use NoopVMManager. */
export async function createVMManager(): Promise<VMManager> {
  const backend = process.env.VM_BACKEND ?? "docker";
  if (backend === "kubernetes") {
    const manager = new KubernetesVMManager();
    try {
      await manager.listVMs();
      return manager;
    } catch (err) {
      throw new Error(
        `Kubernetes VM backend is unavailable: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  if (backend === "noop") {
    if (process.env.NODE_ENV === "production")
      throw new Error("VM_BACKEND=noop cannot be used in production");
    return new NoopVMManager();
  }
  if (backend !== "docker") throw new Error("VM_BACKEND must be docker, kubernetes, or noop");
  const docker = new Docker();
  try {
    await docker.ping();
    return new DockerVMManager(docker);
  } catch (err) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        `Docker VM backend is unavailable: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    console.warn(
      "[vm-manager] Docker socket unavailable; using NoopVMManager",
      err instanceof Error ? err.message : err,
    );
    return new NoopVMManager();
  }
}
