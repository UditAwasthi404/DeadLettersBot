import { spawn, spawnSync } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isIP } from "node:net";

const require = createRequire("/usr/local/lib/agentos/runtime.cjs");
const ipaddr = require("ipaddr.js");

const MAX_ALLOWLIST_BYTES = 16_384;
const MAX_RULES = 128;
const MAX_PORTS = 512;
const MAX_FIREWALL_RULES = 4_096;
const MAX_DNS_ADDRESSES_PER_FAMILY = 32;
const MAX_DNS_TTL_SECONDS = 300;
const DNS_RETRY_SECONDS = 5;
const MAX_DNS_REFRESH_SECONDS = 30;
const CHAIN = "AGENTOS_EGRESS";
const policy = process.env.VM_EGRESS_POLICY ?? "allow_all";
const helperMode = process.env.AGENTOS_EGRESS_FIREWALL_HELPER === "1";
const readyFile = "/run/agentos-egress-ready";
if (helperMode) rmSync(readyFile, { force: true });

function fail(message) {
  process.stderr.write(`[agentos-vm] ${message}\n`);
  process.exit(1);
}

function normalizeDomain(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 253 ||
    value.includes("*") ||
    value.trim() !== value
  )
    return false;
  const labels = value.replace(/\.$/, "").toLowerCase().split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) &&
    !["localhost", "local", "internal"].includes(labels.at(-1))
  );
}

function parseAllowlist(raw) {
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_ALLOWLIST_BYTES)
    fail(`VM_EGRESS_ALLOWLIST must be 1–${MAX_ALLOWLIST_BYTES} bytes`);
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    fail("VM_EGRESS_ALLOWLIST must be valid JSON");
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_RULES)
    fail(`VM_EGRESS_ALLOWLIST must contain 1–${MAX_RULES} rules`);
  let totalPorts = 0;
  return entries.map((entry, ruleIndex) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} must be an object`);
    if (Object.keys(entry).some((key) => key !== "cidr" && key !== "domain" && key !== "ports"))
      fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} has unsupported fields`);
    const hasCidr = Object.hasOwn(entry, "cidr");
    const hasDomain = Object.hasOwn(entry, "domain");
    if (hasCidr === hasDomain)
      fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} must specify exactly one CIDR or domain`);
    if (hasCidr && (typeof entry.cidr !== "string" || !validCidr(entry.cidr)))
      fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} has an invalid CIDR`);
    if (hasDomain && !normalizeDomain(entry.domain))
      fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} has an invalid domain`);
    if (!Array.isArray(entry.ports) || entry.ports.length === 0)
      fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} requires a port`);
    totalPorts += entry.ports.length;
    if (totalPorts > MAX_PORTS) fail(`VM_EGRESS_ALLOWLIST exceeds ${MAX_PORTS} ports`);
    const ports = entry.ports.map((portRule, portIndex) => {
      if (!portRule || typeof portRule !== "object" || Array.isArray(portRule))
        fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} port ${portIndex + 1} is invalid`);
      if (Object.keys(portRule).some((key) => key !== "protocol" && key !== "port"))
        fail(
          `VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} port ${portIndex + 1} has unsupported fields`,
        );
      if (
        (portRule.protocol !== "TCP" && portRule.protocol !== "UDP") ||
        !Number.isInteger(portRule.port) ||
        portRule.port < 1 ||
        portRule.port > 65_535
      )
        fail(`VM_EGRESS_ALLOWLIST rule ${ruleIndex + 1} port ${portIndex + 1} is invalid`);
      return { protocol: portRule.protocol.toLowerCase(), port: String(portRule.port) };
    });
    return hasCidr
      ? { cidr: entry.cidr, ports }
      : { domain: entry.domain.replace(/\.$/, "").toLowerCase(), ports };
  });
}

function validCidr(value) {
  const slash = value.lastIndexOf("/");
  if (slash < 1 || slash === value.length - 1) return false;
  const address = value.slice(0, slash);
  const prefixText = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const version = isIP(address);
  const prefix = Number(prefixText);
  return version === 4 ? prefix <= 32 : version === 6 && prefix <= 128;
}

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.error) fail(`${binary} failed: ${result.error.message}`);
  if (result.status !== 0)
    fail(
      `${binary} rejected an egress rule: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
}

function runRestore(binary, script) {
  const result = spawnSync(binary, ["--wait", "5", "--noflush"], {
    encoding: "utf8",
    input: script,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) fail(`${binary} failed: ${result.error.message}`);
  if (result.status !== 0)
    fail(
      `${binary} rejected refreshed egress rules: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
}

function ensureChain(binary) {
  const result = spawnSync(binary, ["-w", "5", "-S", CHAIN], { encoding: "utf8" });
  if (result.status !== 0) run(binary, ["-w", "5", "-N", CHAIN]);
}

function installBasePolicy() {
  for (const binary of ["iptables", "ip6tables"]) {
    run(binary, ["-w", "5", "-P", "OUTPUT", "DROP"]);
    run(binary, ["-w", "5", "-F", "OUTPUT"]);
    ensureChain(binary);
    run(binary, ["-w", "5", "-F", CHAIN]);
    run(binary, ["-w", "5", "-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"]);
    run(binary, [
      "-w",
      "5",
      "-A",
      "OUTPUT",
      "-m",
      "conntrack",
      "--ctstate",
      "ESTABLISHED,RELATED",
      "-j",
      "ACCEPT",
    ]);
  }
  for (const protocol of ["udp", "tcp"])
    run("iptables", [
      "-w",
      "5",
      "-A",
      "OUTPUT",
      "-d",
      "127.0.0.11/32",
      "-p",
      protocol,
      "--dport",
      "53",
      "-j",
      "ACCEPT",
    ]);
  for (const binary of ["iptables", "ip6tables"])
    run(binary, ["-w", "5", "-A", "OUTPUT", "-j", CHAIN]);
}

const domainRules = new Map();
const domainCache = new Map();
const domainNextLookup = new Map();

function publicAddress(value) {
  try {
    const parsed = ipaddr.process(value);
    if (parsed.range() !== "unicast") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function resolverResultIsAuthoritativeEmpty(result) {
  if (result.status === "fulfilled") return true;
  const code = result.reason?.code;
  return code === "ENODATA" || code === "ENOTFOUND" || code === "ENONAME";
}

async function resolveDomain(domain, resolver, now) {
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    resolver.resolve4(domain, { ttl: true }),
    resolver.resolve6(domain, { ttl: true }),
  ]);
  const results = [ipv4Result, ipv6Result];
  const cached = domainCache.get(domain) ?? new Map();
  const families = [4, 6];
  let nextLookupMs = MAX_DNS_REFRESH_SECONDS * 1000;

  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    const version = families[index];
    if (result.status === "rejected" && !resolverResultIsAuthoritativeEmpty(result)) {
      nextLookupMs = Math.min(nextLookupMs, DNS_RETRY_SECONDS * 1000);
      continue;
    }

    for (const address of cached.keys()) if (isIP(address) === version) cached.delete(address);
    if (result.status === "rejected") continue;

    const records = result.value.slice(0, MAX_DNS_ADDRESSES_PER_FAMILY);
    for (const record of records) {
      const address = publicAddress(record.address);
      if (!address || isIP(address) !== version) continue;
      const ttl = Math.max(1, Math.min(MAX_DNS_TTL_SECONDS, Number(record.ttl) || 1));
      cached.set(address, now + ttl * 1000);
      nextLookupMs = Math.min(nextLookupMs, ttl * 1000);
    }
  }

  for (const [address, expiresAt] of cached) if (expiresAt <= now) cached.delete(address);
  if (cached.size) domainCache.set(domain, cached);
  else domainCache.delete(domain);
  domainNextLookup.set(
    domain,
    now + Math.max(1000, Math.min(nextLookupMs, MAX_DNS_REFRESH_SECONDS * 1000)),
  );
}

function createFirewallRules(rules, now) {
  const rulesByFamily = { 4: new Set(), 6: new Set() };
  let count = 0;
  const add = (family, destination, ports) => {
    for (const portRule of ports) {
      const line = `-A ${CHAIN} -d ${destination} -p ${portRule.protocol} --dport ${portRule.port} -j ACCEPT`;
      if (rulesByFamily[family].has(line)) continue;
      rulesByFamily[family].add(line);
      count++;
      if (count > MAX_FIREWALL_RULES)
        throw new Error(`resolved allowlist exceeds the ${MAX_FIREWALL_RULES}-rule firewall limit`);
    }
  };

  for (const rule of rules) {
    if (rule.cidr) {
      add(isIP(rule.cidr.slice(0, rule.cidr.lastIndexOf("/"))), rule.cidr, rule.ports);
      continue;
    }
    const cached = domainCache.get(rule.domain);
    if (!cached) continue;
    for (const [address, expiresAt] of cached) {
      if (expiresAt <= now) {
        cached.delete(address);
        continue;
      }
      const version = isIP(address);
      add(version, `${address}/${version === 4 ? 32 : 128}`, rule.ports);
    }
  }
  return rulesByFamily;
}

function expireDomainAddresses(now) {
  let expired = false;
  for (const [domain, cached] of domainCache) {
    for (const [address, expiresAt] of cached) {
      if (expiresAt > now) continue;
      cached.delete(address);
      expired = true;
    }
    if (cached.size === 0) domainCache.delete(domain);
  }
  return expired;
}

function applyFirewallRules(rulesByFamily) {
  for (const [version, binary, restoreBinary] of [
    [4, "iptables", "iptables-restore"],
    [6, "ip6tables", "ip6tables-restore"],
  ]) {
    // Clear first so a failed restore leaves the managed chain closed.
    run(binary, ["-w", "5", "-F", CHAIN]);
    const rules = [...rulesByFamily[version]];
    runRestore(restoreBinary, `*filter\n-F ${CHAIN}\n${rules.join("\n")}\nCOMMIT\n`);
  }
}

function markFirewallReady(nextRefreshAt) {
  const deadline = Number.isFinite(nextRefreshAt) ? String(nextRefreshAt) : "";
  const temporaryFile = `${readyFile}.tmp`;
  writeFileSync(temporaryFile, `${process.pid}:${Date.now()}:${deadline}`, { mode: 0o644 });
  renameSync(temporaryFile, readyFile);
}

async function refreshFirewall(rules, resolver) {
  const now = Date.now();
  if (expireDomainAddresses(now)) applyFirewallRules(createFirewallRules(rules, now));
  await Promise.all(
    [...domainRules.keys()]
      .filter((domain) => (domainNextLookup.get(domain) ?? 0) <= now)
      .map((domain) => resolveDomain(domain, resolver, now)),
  );
  let firewallRules;
  try {
    firewallRules = createFirewallRules(rules, Date.now());
  } catch (error) {
    for (const binary of ["iptables", "ip6tables"]) run(binary, ["-w", "5", "-F", CHAIN]);
    throw error;
  }
  applyFirewallRules(firewallRules);
  const nextAt = Math.min(
    ...[...domainRules.keys()].map((domain) => {
      const cached = domainCache.get(domain);
      const nextExpiry = cached ? Math.min(...cached.values()) : Number.POSITIVE_INFINITY;
      return Math.min(
        domainNextLookup.get(domain) ?? Date.now() + DNS_RETRY_SECONDS * 1000,
        nextExpiry,
      );
    }),
  );
  markFirewallReady(nextAt);
  if (!domainRules.size) return;
  const delay = Number.isFinite(nextAt)
    ? Math.max(1000, nextAt - Date.now())
    : MAX_DNS_REFRESH_SECONDS * 1000;
  const timer = setTimeout(() => {
    void refreshFirewall(rules, resolver).catch((error) =>
      fail(`egress rule refresh failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, delay);
  timer.unref?.();
}

function startCommand(command, args) {
  if (!command) fail("VM command is missing");
  const childCommand = helperMode ? "/usr/bin/setpriv" : command;
  const childArgs = helperMode
    ? ["--reuid=1000", "--regid=1000", "--clear-groups", command, ...args]
    : args;
  const child = spawn(childCommand, childArgs, { stdio: "inherit" });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  child.on("error", (error) => fail(`failed to start the VM process: ${error.message}`));
  child.on("exit", (code, signal) => {
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

if (policy !== "allow_all" && policy !== "deny_all" && policy !== "allowlist")
  fail("VM_EGRESS_POLICY must be allow_all, deny_all, or allowlist");

if (helperMode) {
  if (policy !== "allowlist") fail("the Docker egress helper requires allowlist mode");
  if (process.getuid?.() !== 0)
    fail("allowlist setup requires the container entrypoint to start as root");
  const rules = parseAllowlist(process.env.VM_EGRESS_ALLOWLIST ?? "");
  for (const rule of rules) if (rule.domain) domainRules.set(rule.domain, rule);
  installBasePolicy();
  const resolver = new Resolver({ timeout: 2_000, tries: 2 });
  resolver.setServers(["127.0.0.11"]);
  await refreshFirewall(rules, resolver);
} else if (policy === "allowlist" && process.env.AGENTOS_EGRESS_FIREWALL_SHARED !== "1") {
  fail("allowlist mode requires the Docker egress helper network namespace");
}

const [command, ...args] = process.argv.slice(2);
startCommand(command, args);
