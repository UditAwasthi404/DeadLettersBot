import { createHash, randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import {
  ApiException,
  CoreV1Api,
  Exec,
  KubeConfig,
  type V1PersistentVolumeClaim,
  type V1Pod,
  type V1Status,
} from "@kubernetes/client-node";
import type { ExecResult, VMInfo, VMManager, VMStats, VMStatus } from "./interface.ts";

const MAX_EXEC_OUTPUT_BYTES = 1_048_576;
const VM_LABEL = "app.kubernetes.io/name";
const VM_LABEL_VALUE = "agentos-vm";
const COMPONENT_LABEL = "app.kubernetes.io/component";
const COMPONENT_VALUE = "vm";
const ACCOUNT_HASH_LABEL = "agentos.account-hash";
const ACCOUNT_ID_ANNOTATION = "agentos.account-id";
const VM_CONTAINER = "vm";

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return parsed;
}

function accountHash(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 32);
}

function vmName(hash: string): string {
  return `agentos-vm-${hash}`;
}

function workspaceName(hash: string): string {
  return `agentos-home-${hash}`;
}

function accountHashFromVmId(vmId: string): string {
  const match = /^agentos-vm-([a-f0-9]{32})$/.exec(vmId);
  if (!match) throw new Error("invalid Kubernetes VM id");
  return match[1] as string;
}

function apiStatus(err: unknown): number | undefined {
  if (err instanceof ApiException) return err.code;
  return undefined;
}

function isNotFound(err: unknown): boolean {
  return apiStatus(err) === 404;
}

function mapPodStatus(pod: V1Pod): VMStatus {
  const phase = pod.status?.phase?.toLowerCase();
  if (phase === "running") {
    const containers = pod.status?.containerStatuses ?? [];
    return containers.length > 0 && containers.every((container) => container.ready)
      ? "running"
      : "starting";
  }
  if (phase === "pending" || phase === "unknown" || phase === undefined) return "starting";
  return "terminated";
}

function exitCodeFromStatus(status?: V1Status): number {
  if (status?.status === "Success") return 0;
  const exitCode = status?.details?.causes?.find((cause) => cause.reason === "ExitCode")?.message;
  if (exitCode && /^\d+$/.test(exitCode)) return Number(exitCode);
  return 1;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kubernetes-backed account VMs. Each account receives a non-root pod and durable home PVC. */
export class KubernetesVMManager implements VMManager {
  private readonly api: CoreV1Api;
  private readonly execClient: Exec;
  private readonly namespace: string;
  private readonly image: string;
  private readonly storageSize: string;

  constructor(kubeConfig?: KubeConfig) {
    const config = kubeConfig ?? new KubeConfig();
    if (!kubeConfig) config.loadFromDefault();
    this.api = config.makeApiClient(CoreV1Api);
    this.execClient = new Exec(config);
    this.namespace = process.env.VM_K8S_NAMESPACE || process.env.POD_NAMESPACE || "default";
    this.image = process.env.VM_IMAGE ?? "agentos/vm-manager";
    this.storageSize = process.env.VM_K8S_STORAGE_SIZE ?? "20Gi";
    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(this.namespace) || this.namespace.length > 63)
      throw new Error("VM_K8S_NAMESPACE must be a valid Kubernetes namespace name");
    if (!/^[1-9]\d*(?:Ki|Mi|Gi|Ti|K|M|G|T)?$/.test(this.storageSize))
      throw new Error("VM_K8S_STORAGE_SIZE must be a positive Kubernetes storage quantity");
  }

  private podName(vmId: string): string {
    accountHashFromVmId(vmId);
    return vmId;
  }

  private pvcName(vmId: string): string {
    return workspaceName(accountHashFromVmId(vmId));
  }

  private metadata(accountId: string, hash: string) {
    return {
      labels: {
        [VM_LABEL]: VM_LABEL_VALUE,
        [COMPONENT_LABEL]: COMPONENT_VALUE,
        [ACCOUNT_HASH_LABEL]: hash,
        ...(process.env.VM_K8S_INSTANCE
          ? { "app.kubernetes.io/instance": process.env.VM_K8S_INSTANCE }
          : {}),
      },
      annotations: { [ACCOUNT_ID_ANNOTATION]: accountId },
    };
  }

  private async readClaim(name: string): Promise<V1PersistentVolumeClaim | null> {
    try {
      return await this.api.readNamespacedPersistentVolumeClaim({
        name,
        namespace: this.namespace,
      });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private assertAccountOwnership(
    resource: {
      metadata?: { annotations?: Record<string, string>; labels?: Record<string, string> };
    },
    accountId: string,
    hash: string,
  ): void {
    if (
      resource.metadata?.annotations?.[ACCOUNT_ID_ANNOTATION] !== accountId ||
      resource.metadata.labels?.[ACCOUNT_HASH_LABEL] !== hash ||
      resource.metadata.labels?.[VM_LABEL] !== VM_LABEL_VALUE
    )
      throw new Error("refusing to use a Kubernetes VM resource owned by another account");
  }

  private async ensureWorkspace(accountId: string, hash: string): Promise<void> {
    const name = workspaceName(hash);
    const existing = await this.readClaim(name);
    if (existing) {
      this.assertAccountOwnership(existing, accountId, hash);
      return;
    }
    const metadata = this.metadata(accountId, hash);
    const claim: V1PersistentVolumeClaim = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: { name, ...metadata },
      spec: {
        accessModes: ["ReadWriteOnce"],
        ...(process.env.VM_K8S_STORAGE_CLASS
          ? { storageClassName: process.env.VM_K8S_STORAGE_CLASS }
          : {}),
        resources: { requests: { storage: this.storageSize } },
      },
    };
    try {
      await this.api.createNamespacedPersistentVolumeClaim({
        namespace: this.namespace,
        body: claim,
      });
    } catch (err) {
      if (apiStatus(err) !== 409) throw err;
      const racedClaim = await this.readClaim(name);
      if (!racedClaim) throw err;
      this.assertAccountOwnership(racedClaim, accountId, hash);
    }
  }

  private buildPod(accountId: string, hash: string): V1Pod {
    const memoryBytes = positiveIntegerFromEnv("VM_MEMORY_BYTES", 2_147_483_648);
    const cpuNanos = positiveIntegerFromEnv("VM_CPU_NANOS", 2_000_000_000);
    const cpuMillicores = Math.max(1, Math.ceil(cpuNanos / 1_000_000));
    const metadata = this.metadata(accountId, hash);
    const imagePullSecret = process.env.VM_IMAGE_PULL_SECRET;
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: vmName(hash), ...metadata },
      spec: {
        restartPolicy: "Always",
        automountServiceAccountToken: false,
        terminationGracePeriodSeconds: 10,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          runAsGroup: 1000,
          fsGroup: 1000,
          seccompProfile: { type: "RuntimeDefault" },
        },
        ...(imagePullSecret ? { imagePullSecrets: [{ name: imagePullSecret }] } : {}),
        containers: [
          {
            name: VM_CONTAINER,
            image: this.image,
            imagePullPolicy: process.env.VM_IMAGE_PULL_POLICY ?? "IfNotPresent",
            command: ["sleep", "infinity"],
            securityContext: {
              allowPrivilegeEscalation: false,
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              capabilities: { drop: ["ALL"] },
              seccompProfile: { type: "RuntimeDefault" },
            },
            resources: {
              requests: { cpu: `${cpuMillicores}m`, memory: `${memoryBytes}` },
              limits: { cpu: `${cpuMillicores}m`, memory: `${memoryBytes}` },
            },
            volumeMounts: [{ name: "home", mountPath: "/home/agent" }],
          },
        ],
        volumes: [{ name: "home", persistentVolumeClaim: { claimName: workspaceName(hash) } }],
      },
    };
  }

  private async readPod(vmId: string): Promise<V1Pod | null> {
    try {
      return await this.api.readNamespacedPod({
        name: this.podName(vmId),
        namespace: this.namespace,
      });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private async ensurePod(accountId: string, hash: string): Promise<void> {
    const name = vmName(hash);
    const existing = await this.readPod(name);
    if (existing) {
      this.assertAccountOwnership(existing, accountId, hash);
      const phase = existing.status?.phase;
      if (phase !== "Failed" && phase !== "Succeeded" && !existing.metadata?.deletionTimestamp)
        return;
      await this.api
        .deleteNamespacedPod({
          name,
          namespace: this.namespace,
          body: { gracePeriodSeconds: 0 },
        })
        .catch((err: unknown) => {
          if (!isNotFound(err)) throw err;
        });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!(await this.readPod(name))) break;
        await delay(100);
      }
      if (await this.readPod(name)) throw new Error("Kubernetes VM pod is still terminating");
    }
    try {
      await this.api.createNamespacedPod({
        namespace: this.namespace,
        body: this.buildPod(accountId, hash),
      });
    } catch (err) {
      if (apiStatus(err) !== 409) throw err;
      const racedPod = await this.readPod(name);
      if (!racedPod) throw err;
      this.assertAccountOwnership(racedPod, accountId, hash);
    }
  }

  async provisionVM(accountId: string): Promise<VMInfo> {
    const hash = accountHash(accountId);
    const id = vmName(hash);
    await this.ensureWorkspace(accountId, hash);
    await this.ensurePod(accountId, hash);
    const timeout = positiveIntegerFromEnv("VM_K8S_START_TIMEOUT_MS", 30_000);
    const deadline = Date.now() + timeout;
    let status = await this.getVMStatus(id);
    while (status.status !== "running" || !status.ipAddress) {
      if (status.status === "terminated") {
        const pod = await this.readPod(id);
        const detail = pod?.status?.containerStatuses?.[0]?.state?.waiting?.message;
        throw new Error(`Kubernetes VM failed to start${detail ? `: ${detail}` : ""}`);
      }
      if (Date.now() >= deadline)
        throw new Error(`Kubernetes VM did not become ready within ${timeout} ms`);
      await delay(250);
      status = await this.getVMStatus(id);
    }
    return status;
  }

  async wakeVM(vmId: string): Promise<VMInfo> {
    const hash = accountHashFromVmId(vmId);
    const claim = await this.readClaim(this.pvcName(vmId));
    if (!claim) return { vmId, accountId: "", status: "terminated" };
    const accountId = claim.metadata?.annotations?.[ACCOUNT_ID_ANNOTATION] ?? "";
    this.assertAccountOwnership(claim, accountId, hash);
    await this.ensurePod(accountId, hash);
    return await this.provisionVM(accountId);
  }

  async suspendVM(vmId: string): Promise<void> {
    this.podName(vmId);
    await this.api
      .deleteNamespacedPod({
        name: vmId,
        namespace: this.namespace,
        body: { gracePeriodSeconds: 10 },
      })
      .catch((err: unknown) => {
        if (!isNotFound(err)) throw err;
      });
  }

  async terminateVM(vmId: string): Promise<void> {
    this.podName(vmId);
    await this.api
      .deleteNamespacedPod({
        name: vmId,
        namespace: this.namespace,
        body: { gracePeriodSeconds: 10 },
      })
      .catch((err: unknown) => {
        if (!isNotFound(err)) throw err;
      });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!(await this.readPod(vmId))) break;
      await delay(100);
    }
    if (await this.readPod(vmId)) throw new Error("Kubernetes VM pod is still terminating");
    await this.api
      .deleteNamespacedPersistentVolumeClaim({
        name: this.pvcName(vmId),
        namespace: this.namespace,
        body: { gracePeriodSeconds: 0 },
      })
      .catch((err: unknown) => {
        if (!isNotFound(err)) throw err;
      });
  }

  async getVMStatus(vmId: string): Promise<VMInfo> {
    const hash = accountHashFromVmId(vmId);
    const [pod, claim] = await Promise.all([
      this.readPod(vmId),
      this.readClaim(workspaceName(hash)),
    ]);
    const ownedResource = pod ?? claim;
    const accountId = ownedResource?.metadata?.annotations?.[ACCOUNT_ID_ANNOTATION] ?? "";
    if (pod) {
      this.assertAccountOwnership(pod, accountId, hash);
      return {
        vmId,
        accountId,
        status: mapPodStatus(pod),
        ...(pod.status?.podIP ? { ipAddress: pod.status.podIP } : {}),
      };
    }
    if (claim) {
      this.assertAccountOwnership(claim, accountId, hash);
      return { vmId, accountId, status: "sleeping" };
    }
    return { vmId, accountId: "", status: "terminated" };
  }

  async listVMs(): Promise<VMInfo[]> {
    const claims = await this.api.listNamespacedPersistentVolumeClaim({
      namespace: this.namespace,
      labelSelector: `${VM_LABEL}=${VM_LABEL_VALUE}`,
    });
    const ids = claims.items
      .map((claim) => claim.metadata?.name ?? "")
      .filter((name) => name.startsWith("agentos-home-"))
      .map((name) => name.replace("agentos-home-", "agentos-vm-"));
    return await Promise.all(ids.map((id) => this.getVMStatus(id)));
  }

  async getVMStats(_vmId: string): Promise<VMStats | undefined> {
    // The metrics.k8s.io API is optional and is not required for VM lifecycle operations.
    return undefined;
  }

  private async connectExec(
    vmId: string,
    executionId: string,
    command: string[],
    stdout: PassThrough,
    stderr: PassThrough,
    input?: string,
    onStatus?: (status: V1Status) => void,
  ): Promise<Awaited<ReturnType<Exec["exec"]>>> {
    const vm = await this.getVMStatus(vmId);
    if (vm.status !== "running") throw new Error(`Kubernetes VM is ${vm.status}`);
    return await this.execClient.exec(
      this.namespace,
      this.podName(vmId),
      VM_CONTAINER,
      ["bash", "/usr/local/bin/agentos-controlled-exec", executionId, ...command],
      stdout,
      stderr,
      input === undefined ? null : Readable.from([input]),
      false,
      onStatus,
    );
  }

  private async killExecution(vmId: string, executionId: string): Promise<void> {
    await this.execInContainer(vmId, [
      "bash",
      "-c",
      'file="/tmp/agentos-exec-$1.pgid"; for attempt in {1..40}; do if [[ -s "$file" ]]; then read -r group < "$file"; if [[ "$group" =~ ^[0-9]+$ ]]; then kill -TERM -- "-$group" 2>/dev/null || true; fi; exit 0; fi; sleep 0.05; done',
      "agentos-kill",
      executionId,
    ]);
  }

  async execInContainer(
    vmId: string,
    cmd: string[],
    input?: string,
    signal?: AbortSignal,
  ): Promise<ExecResult> {
    if (signal?.aborted) return { stdout: "", stderr: "execution cancelled", exitCode: 130 };
    const executionId = randomUUID();
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let outputBytes = 0;
    let outputTruncated = false;
    const capture = (chunks: Uint8Array[], chunk: Buffer) => {
      const allowed = Math.max(0, MAX_EXEC_OUTPUT_BYTES - outputBytes);
      const length = Math.min(allowed, chunk.byteLength);
      if (length > 0) {
        chunks.push(Uint8Array.from(chunk.subarray(0, length)));
        outputBytes += length;
      }
      if (length < chunk.byteLength) outputTruncated = true;
    };
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on("data", (chunk: Buffer) => capture(stdoutChunks, chunk));
    stderr.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));
    let socket: Awaited<ReturnType<Exec["exec"]>> | undefined;
    let exitCode = 1;
    let cancelled = false;
    let cancelStarted = false;
    let resolveClosed: (() => void) | undefined;
    let rejectClosed: ((err: Error) => void) | undefined;
    const closed = new Promise<void>((resolve, reject) => {
      resolveClosed = resolve;
      rejectClosed = reject;
    });
    const abortExecution = () => {
      cancelled = true;
      if (!socket || cancelStarted) return;
      cancelStarted = true;
      void this.killExecution(vmId, executionId)
        .catch((err) => console.warn("[vm-manager:kubernetes] failed to stop execution", err))
        .finally(() => socket?.close());
    };
    signal?.addEventListener("abort", abortExecution, { once: true });
    try {
      socket = await this.connectExec(vmId, executionId, cmd, stdout, stderr, input, (status) => {
        exitCode = exitCodeFromStatus(status);
      });
      socket.on("close", () => resolveClosed?.());
      socket.on("error", (err: Error) => rejectClosed?.(err));
      if (signal?.aborted && socket.readyState !== socket.CLOSED) abortExecution();
      if (socket.readyState === socket.CLOSED) resolveClosed?.();
      await closed;
    } finally {
      signal?.removeEventListener("abort", abortExecution);
      if (socket && socket.readyState !== socket.CLOSED) socket.close();
      stdout.destroy();
      stderr.destroy();
    }
    const suffixes = [
      ...(cancelled ? ["execution cancelled"] : []),
      ...(outputTruncated ? [`output truncated after ${MAX_EXEC_OUTPUT_BYTES} bytes`] : []),
    ];
    return {
      stdout: Buffer.concat(stdoutChunks).toString(),
      stderr: [Buffer.concat(stderrChunks).toString(), ...suffixes].filter(Boolean).join("\n"),
      exitCode: cancelled ? 130 : exitCode,
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
    const executionId = randomUUID();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let buffer = "";
    stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onEvent(line.trim());
    });
    stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) console.warn("[vm-manager:kubernetes] inotify", message.slice(0, 300));
    });
    let socket: Awaited<ReturnType<Exec["exec"]>> | undefined;
    let resolveDone: (() => void) | undefined;
    let stopped = false;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const started = this.connectExec(
      vmId,
      executionId,
      ["inotifywait", "-m", "-e", "modify,create,delete,move", "--format", "%w%f", path],
      stdout,
      stderr,
      undefined,
    )
      .then((connectedSocket) => {
        socket = connectedSocket;
        const finish = () => resolveDone?.();
        socket.once("close", finish);
        socket.once("error", finish);
        if (socket.readyState === socket.CLOSED) finish();
      })
      .catch((err: unknown) => {
        console.warn("[vm-manager:kubernetes] file watcher stopped", err);
        resolveDone?.();
      });
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      await started;
      if (socket) {
        await this.killExecution(vmId, executionId).catch(() => {});
        if (socket.readyState !== socket.CLOSED) socket.close();
      }
      stdout.destroy();
      stderr.destroy();
      await done;
    };
    return { stop, done };
  }
}
