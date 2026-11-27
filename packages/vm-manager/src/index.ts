export { KubernetesVMManager } from "./kubernetes.ts";
export { DockerVMManager, NoopVMManager, createVMManager } from "./docker.ts";
export { gcIdleVMs } from "./gc.ts";
export {
  parseVMEgressAllowlist,
  type VMEgressPort,
  type VMEgressProtocol,
  type VMEgressRule,
} from "./egress.ts";
export type {
  BrowserEndpoint,
  ExecResult,
  VMInfo,
  VMManager,
  VMStats,
  VMStatus,
} from "./interface.ts";
