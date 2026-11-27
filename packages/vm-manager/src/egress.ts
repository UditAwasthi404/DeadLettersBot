import { isIP } from "node:net";
import { domainToASCII } from "node:url";

export type VMEgressProtocol = "TCP" | "UDP";

export interface VMEgressPort {
  protocol: VMEgressProtocol;
  port: number;
}

export interface VMEgressRule {
  cidr?: string;
  domain?: string;
  ports: VMEgressPort[];
}

const MAX_ALLOWLIST_BYTES = 16_384;
const MAX_RULES = 128;
const MAX_PORTS = 512;
const MAX_FIREWALL_RULES = 4_096;
const MAX_DOMAIN_ADDRESSES = 64;

export function parseVMEgressAllowlist(raw: string): VMEgressRule[] {
  if (Buffer.byteLength(raw, "utf8") > MAX_ALLOWLIST_BYTES)
    throw new Error(`VM_EGRESS_ALLOWLIST must be at most ${MAX_ALLOWLIST_BYTES} bytes`);

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("VM_EGRESS_ALLOWLIST must be valid JSON");
  }
  if (!Array.isArray(decoded) || decoded.length === 0 || decoded.length > MAX_RULES)
    throw new Error(`VM_EGRESS_ALLOWLIST must contain 1–${MAX_RULES} rules`);

  let portCount = 0;
  let projectedFirewallRuleCount = 0;
  return decoded.map((candidate, ruleIndex) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} must be an object`);
    const rule = candidate as Record<string, unknown>;
    if (Object.keys(rule).some((key) => key !== "cidr" && key !== "domain" && key !== "ports"))
      throw new Error(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} has unsupported fields`);

    const hasCidr = Object.hasOwn(rule, "cidr");
    const hasDomain = Object.hasOwn(rule, "domain");
    if (hasCidr === hasDomain)
      throw new Error(
        `VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} must specify exactly one CIDR or domain`,
      );
    const cidr =
      hasCidr && typeof rule.cidr === "string" && isCidr(rule.cidr) ? rule.cidr : undefined;
    const domain =
      hasDomain && typeof rule.domain === "string" ? normalizeDomain(rule.domain) : undefined;
    if ((hasCidr && !cidr) || (hasDomain && !domain))
      throw new Error(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} has an invalid CIDR or domain`);
    if (!Array.isArray(rule.ports) || rule.ports.length === 0)
      throw new Error(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} must allow at least one port`);

    portCount += rule.ports.length;
    if (portCount > MAX_PORTS)
      throw new Error(`VM_EGRESS_ALLOWLIST may contain at most ${MAX_PORTS} port rules`);

    const ports = rule.ports.map((value, portIndex): VMEgressPort => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(
          `VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} port ${portIndex + 1} must be an object`,
        );
      const portRule = value as Record<string, unknown>;
      if (Object.keys(portRule).some((key) => key !== "protocol" && key !== "port"))
        throw new Error(
          `VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} port ${portIndex + 1} has unsupported fields`,
        );
      if (
        (portRule.protocol !== "TCP" && portRule.protocol !== "UDP") ||
        !Number.isInteger(portRule.port) ||
        Number(portRule.port) < 1 ||
        Number(portRule.port) > 65_535
      )
        throw new Error(
          `VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} port ${portIndex + 1} must use TCP or UDP and a port from 1 to 65535`,
        );
      return { protocol: portRule.protocol, port: Number(portRule.port) };
    });

    projectedFirewallRuleCount += ports.length * (hasDomain ? MAX_DOMAIN_ADDRESSES : 1);
    if (projectedFirewallRuleCount > MAX_FIREWALL_RULES)
      throw new Error(
        `VM_EGRESS_ALLOWLIST may expand to at most ${MAX_FIREWALL_RULES} firewall rules`,
      );

    return hasCidr ? { cidr: cidr as string, ports } : { domain: domain as string, ports };
  });
}

function normalizeDomain(value: string): string | undefined {
  if (!value || value.length > 253 || value.includes("*") || value.trim() !== value)
    return undefined;
  const ascii = domainToASCII(value.replace(/\.$/, "").toLowerCase());
  if (!ascii || ascii.length > 253 || isIP(ascii)) return undefined;
  const labels = ascii.split(".");
  if (labels.length < 2) return undefined;
  if (labels.some((label) => label.length < 1 || label.length > 63)) return undefined;
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return undefined;
  if (["localhost", "local", "internal"].includes(labels.at(-1) ?? "")) return undefined;
  return ascii;
}

function isCidr(value: string): boolean {
  const slash = value.lastIndexOf("/");
  if (slash < 1 || slash === value.length - 1) return false;
  const address = value.slice(0, slash);
  const prefixText = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const version = isIP(address);
  const prefix = Number(prefixText);
  return version === 4 ? prefix <= 32 : version === 6 && prefix <= 128;
}
