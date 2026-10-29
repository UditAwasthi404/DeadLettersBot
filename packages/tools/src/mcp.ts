export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  warning?: string;
}

const SUSPICIOUS_MCP_METADATA =
  /ignore\s+(all\s+)?(previous|prior)\s+instructions|reveal\s+(the\s+)?(system|developer)\s+prompt|exfiltrat|send\s+(the\s+)?(secret|credential|token)|override\s+(the\s+)?(system|developer)\s+instructions/i;

type JsonRpcResponse = { result?: unknown; error?: { code?: number; message?: string } };

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
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) ||
    (hostname !== "127.0.0.1" && ipLiteral) ||
    (privateIpv4 && !localhost) ||
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

async function rpc(
  endpoint: string,
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<{ response: JsonRpcResponse; sessionId?: string }> {
  const url = validateMcpEndpoint(endpoint);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 5_000);
  try {
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2024-11-05",
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (sessionId) headers.set("MCP-Session-Id", sessionId);
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    if (!response.ok) throw new Error(`MCP endpoint returned HTTP ${response.status}`);
    const nextSessionId = response.headers.get("MCP-Session-Id") ?? sessionId;
    const text = await response.text();
    return { response: parseResponse(text), sessionId: nextSessionId ?? undefined };
  } finally {
    clearTimeout(deadline);
  }
}

async function initialize(endpoint: string, token?: string) {
  const { sessionId } = await rpc(endpoint, token, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "AgentOS", version: "0.1.0" },
  });
  const url = validateMcpEndpoint(endpoint);
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2024-11-05",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (sessionId) headers.set("MCP-Session-Id", sessionId);
  const notification = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers,
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  if (!notification.ok)
    throw new Error(`MCP initialization notification failed: HTTP ${notification.status}`);
  return sessionId;
}

export async function discoverMcpTools(endpoint: string, token?: string): Promise<MCPToolInfo[]> {
  const sessionId = await initialize(endpoint, token);
  const { response } = await rpc(endpoint, token, "tools/list", {}, sessionId);
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
  const sessionId = await initialize(endpoint, token);
  const { response } = await rpc(
    endpoint,
    token,
    "tools/call",
    {
      name,
      arguments: arguments_,
    },
    sessionId,
  );
  return {
    untrustedMcpOutput: true,
    content: (response.result as { content?: unknown } | undefined)?.content ?? response.result,
  };
}
