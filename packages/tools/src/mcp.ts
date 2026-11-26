import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup as resolveHost } from "node:dns/promises";
import { type IncomingHttpHeaders, type RequestOptions, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  warning?: string;
}

const SUSPICIOUS_MCP_METADATA =
  /ignore\s+(all\s+)?(previous|prior)\s+instructions|reveal\s+(the\s+)?(system|developer)\s+prompt|exfiltrat|send\s+(the\s+)?(secret|credential|token)|override\s+(the\s+)?(system|developer)\s+instructions/i;

type JsonRpcResponse = { result?: unknown; error?: { code?: number; message?: string } };
type PinnedEndpoint = { url: URL; address: string; family: number };
type McpHttpResponse = { status: number; headers: IncomingHttpHeaders; text: string };

const MAX_MCP_RESPONSE_BYTES = 1_048_576;
const MCP_REQUEST_TIMEOUT_MS = 5_000;

function ipv4AsNumber(address: string): number {
  return address.split(".").reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}

function matchesIpv4Subnet(address: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (address & mask) === (ipv4AsNumber(base) & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4AsNumber(address);
  const nonPublicSubnets: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return !nonPublicSubnets.some(([base, prefix]) => matchesIpv4Subnet(value, base, prefix));
}

function expandIpv6(address: string): number[] {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    const value = ipv4AsNumber(ipv4);
    normalized = `${normalized.slice(0, lastColon)}:${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [left = "", right] = normalized.split("::");
  const leftWords = left ? left.split(":").map((word) => Number.parseInt(word || "0", 16)) : [];
  const rightWords = right ? right.split(":").map((word) => Number.parseInt(word || "0", 16)) : [];
  if (right === undefined) return leftWords;
  return [
    ...leftWords,
    ...Array(Math.max(0, 8 - leftWords.length - rightWords.length)).fill(0),
    ...rightWords,
  ];
}

function isPublicIpv6(address: string): boolean {
  const words = expandIpv6(address);
  if (
    words.length !== 8 ||
    words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
  )
    return false;
  const [first = 0, second = 0] = words;
  const globalUnicast = (first & 0xe000) === 0x2000;
  const protocolAssignments = first === 0x2001 && second <= 0x01ff;
  const documentation =
    (first === 0x2001 && second === 0x0db8) || (first === 0x3fff && second < 0x1000);
  const sixToFour = first === 0x2002;
  return globalUnicast && !protocolAssignments && !documentation && !sixToFour;
}

function isLoopbackAddress(address: string): boolean {
  if (isIP(address) === 4) return address.startsWith("127.");
  return address === "::1";
}

async function pinMcpEndpoint(value: string): Promise<PinnedEndpoint> {
  const url = validateMcpEndpoint(value);
  let addresses: LookupAddress[];
  try {
    addresses = await resolveHost(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("MCP endpoint hostname could not be resolved");
  }
  if (addresses.length === 0) throw new Error("MCP endpoint hostname has no addresses");
  const allowLoopback =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  for (const item of addresses) {
    const publicAddress =
      item.family === 4 ? isPublicIpv4(item.address) : isPublicIpv6(item.address);
    if (!publicAddress && !(allowLoopback && isLoopbackAddress(item.address)))
      throw new Error("MCP endpoint resolved to a non-public network address");
  }
  const pinned = addresses[0];
  if (!pinned) throw new Error("MCP endpoint hostname has no addresses");
  return { url, address: pinned.address, family: pinned.family };
}

export function validateMcpEndpoint(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipLiteral = /^[0-9.]+$/.test(hostname) || hostname.includes(":");
  const ipv4 = hostname.split(".").map(Number);
  const [octet0 = Number.NaN, octet1 = Number.NaN] = ipv4;
  const privateIpv4 =
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (octet0 === 0 ||
      octet0 === 10 ||
      octet0 === 127 ||
      (octet0 === 169 && octet1 === 254) ||
      (octet0 === 172 && octet1 >= 16 && octet1 <= 31) ||
      (octet0 === 192 && octet1 === 168));
  const localhost = hostname === "localhost" || hostname === "127.0.0.1";
  const localDevelopmentEndpoint = url.protocol === "http:" && localhost;
  if (
    (url.protocol !== "https:" && !localDevelopmentEndpoint) ||
    (hostname !== "127.0.0.1" && ipLiteral) ||
    (privateIpv4 && !localDevelopmentEndpoint) ||
    (localhost && !localDevelopmentEndpoint) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new Error("MCP endpoints must use HTTPS and cannot target private-network addresses");
  if (url.username || url.password) throw new Error("MCP endpoint URL cannot contain credentials");
  return url;
}

function parseResponse(text: string): JsonRpcResponse {
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
  const payload = dataLine ? dataLine.slice(5).trim() : text;
  const parsed = JSON.parse(payload) as JsonRpcResponse;
  if (parsed.error)
    throw new Error(
      `MCP error ${parsed.error.code ?? ""}: ${parsed.error.message ?? "request failed"}`,
    );
  return parsed;
}

function requestMcp(
  endpoint: PinnedEndpoint,
  headers: Headers,
  body: string,
): Promise<McpHttpResponse> {
  return new Promise((resolve, reject) => {
    const lookup = (
      _hostname: string,
      options: LookupOptions,
      callback: (
        err: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: number,
      ) => void,
    ) => {
      const address = { address: endpoint.address, family: endpoint.family };
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    const outgoingHeaders: Record<string, string> = {};
    headers.forEach((value, name) => {
      outgoingHeaders[name] = value;
    });
    const options: RequestOptions = {
      method: "POST",
      headers: outgoingHeaders,
      lookup,
      agent: false,
    };
    const send = endpoint.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(endpoint.url, options, (response) => {
      const chunks: string[] = [];
      let size = 0;
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size > MAX_MCP_RESPONSE_BYTES) {
          request.destroy(new Error("MCP response exceeded the 1 MiB limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text: chunks.join(""),
        });
      });
      response.on("error", reject);
    });
    const deadline = setTimeout(
      () => request.destroy(new Error("MCP request timed out")),
      MCP_REQUEST_TIMEOUT_MS,
    );
    request.on("error", reject);
    request.on("close", () => clearTimeout(deadline));
    request.end(body);
  });
}

async function rpc(
  endpoint: PinnedEndpoint,
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<{ response: JsonRpcResponse; sessionId?: string }> {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2024-11-05",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (sessionId) headers.set("MCP-Session-Id", sessionId);
  const response = await requestMcp(
    endpoint,
    headers,
    JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params,
    }),
  );
  if (response.status < 200 || response.status >= 300)
    throw new Error(`MCP endpoint returned HTTP ${response.status}`);
  const nextSessionId = response.headers["mcp-session-id"] ?? sessionId;
  return {
    response: parseResponse(response.text),
    sessionId: Array.isArray(nextSessionId) ? nextSessionId[0] : nextSessionId,
  };
}

async function initialize(endpoint: string, token?: string) {
  const pinnedEndpoint = await pinMcpEndpoint(endpoint);
  const { sessionId } = await rpc(pinnedEndpoint, token, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "AgentOS", version: "0.1.0" },
  });
  const url = pinnedEndpoint.url;
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2024-11-05",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (sessionId) headers.set("MCP-Session-Id", sessionId);
  const notification = await requestMcp(
    pinnedEndpoint,
    headers,
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  );
  if (notification.status < 200 || notification.status >= 300)
    throw new Error(`MCP initialization notification failed: HTTP ${notification.status}`);
  return { endpoint: pinnedEndpoint, sessionId };
}

export async function discoverMcpTools(endpoint: string, token?: string): Promise<MCPToolInfo[]> {
  const initialized = await initialize(endpoint, token);
  const { response } = await rpc(
    initialized.endpoint,
    token,
    "tools/list",
    {},
    initialized.sessionId,
  );
  const result = response.result as { tools?: Array<Omit<MCPToolInfo, "warning">> } | undefined;
  const tools = (result?.tools ?? []).map((tool) => {
    const suspicious = SUSPICIOUS_MCP_METADATA.test(`${tool.name} ${tool.description ?? ""}`);
    return {
      ...tool,
      warning: suspicious ? "Tool metadata contains a prompt-injection pattern." : undefined,
    };
  });
  if (process.env.MCP_STRICT_MODE === "1" && tools.some((tool) => tool.warning))
    throw new Error("MCP strict mode blocked a server with suspicious tool metadata");
  return tools;
}

export async function callMcpTool(
  endpoint: string,
  token: string | undefined,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<unknown> {
  const initialized = await initialize(endpoint, token);
  const { response } = await rpc(
    initialized.endpoint,
    token,
    "tools/call",
    {
      name,
      arguments: arguments_,
    },
    initialized.sessionId,
  );
  return {
    untrustedMcpOutput: true,
    content: (response.result as { content?: unknown } | undefined)?.content ?? response.result,
  };
}
