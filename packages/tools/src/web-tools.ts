import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Bun's node:net BlockList does not implement checks, so the ranges are evaluated here.
const BLOCKED_IPV4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["255.255.255.255", 32],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256 + octet) >>> 0;
  }
  return value;
}

function ipv4InCidr(ip: number, base: string, bits: number): boolean {
  const start = ipv4ToInt(base);
  if (start === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (start & mask);
}

function expandIpv6(ip: string): number[] | null {
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const parse = (text: string) => (text ? text.split(":") : []);
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 && missing < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  const words: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    words.push(Number.parseInt(group, 16));
  }
  return words;
}

function isBlockedIpv6(ip: string): boolean {
  const words = expandIpv6(ip);
  if (!words) return true;
  const first = words[0] ?? 0;
  if (words.every((word) => word === 0)) return true;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true;
  return (first & 0xff00) === 0xff00;
}

function ipv4FromMapped(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted?.[1] && isIP(dotted[1]) === 4) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex?.[1] || !hex[2]) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export function isBlockedIp(ip: string): boolean {
  const mapped = ipv4FromMapped(ip);
  if (mapped) return isBlockedIp(mapped);
  if (isIP(ip) === 4) {
    const value = ipv4ToInt(ip);
    if (value === null) return true;
    return BLOCKED_IPV4.some(([base, bits]) => ipv4InCidr(value, base, bits));
  }
  if (isIP(ip) === 6) return isBlockedIpv6(ip);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".localdomain") ||
    host.endsWith(".internal")
  );
}

/** Reject URLs that FetchURL could use to reach the host network. */
export async function assertPublicHttpUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("only http and https URLs can be fetched");
  if (url.username || url.password) throw new Error("URL cannot contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || isBlockedHostname(host)) throw new Error("URL targets a blocked host");
  const addresses =
    isIP(host) === 0
      ? (await lookup(host, { all: true, verbatim: true })).map((record) => record.address)
      : [host];
  if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address)))
    throw new Error("URL targets a private or local network address");
  return url;
}

export async function searchWeb(query: string): Promise<unknown> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return { error: "BRAVE_API_KEY not set" };

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");

  const res = await fetch(url.toString(), {
    headers: { "X-Subscription-Token": key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { error: `Brave HTTP ${res.status}` };

  const body = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const results = (body.web?.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
  return {
    trust: "untrusted_external_data",
    source: "web_search",
    results,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|template|svg|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<(script|style|noscript|template|svg|iframe|object|embed)\b[^>]*\/?\s*>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object|embed)\b[^>]*>[\s\S]*$/gi, " ")
    .replace(
      /<([a-z][\w:-]*)\b(?=[^>]*(?:\shidden(?:\s|=|>)|aria-hidden=["']true["']|style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readTextBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      const chunk = value.subarray(0, remaining);
      bytesRead += chunk.byteLength;
      output += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) break;
    }
    output += decoder.decode();
    return output;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function fetchURL(url: string): Promise<unknown> {
  try {
    let current = await assertPublicHttpUrl(url);
    const seen = new Set<string>();
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop += 1) {
      if (seen.has(current.href)) return { error: "redirect loop" };
      seen.add(current.href);
      res = await fetch(current, {
        headers: { "User-Agent": "AgentOS/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location) return { error: "redirect missing location" };
      current = await assertPublicHttpUrl(new URL(location, current).href);
      res = null;
    }
    if (!res) return { error: "too many redirects" };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    if (
      !contentType.includes("html") &&
      !contentType.startsWith("text/") &&
      !contentType.includes("json") &&
      !contentType.includes("xml")
    )
      return { error: `unsupported content type: ${contentType || "unknown"}` };
    const raw = await readTextBounded(res, 2 * 1024 * 1024);
    const content = (contentType.includes("html") ? stripHtml(raw) : raw).slice(0, 8000);
    return {
      trust: "untrusted_external_data",
      source: "fetched_web_document",
      contentType,
      content,
      url: res.url || url,
      status: res.status,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
