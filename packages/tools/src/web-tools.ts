import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { type RequestOptions, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { parse } from "parse5";

export function isBlockedIp(ip: string): boolean {
  try {
    if (isIP(ip) === 0) return true;
    return ipaddr.process(ip).range() !== "unicast";
  } catch {
    return true;
  }
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

type PinnedFetchTarget = { url: URL; address: string; family: number };

/** Resolve once, reject unsafe DNS answers, and carry the chosen IP into the HTTP connection. */
async function resolvePublicHttpTarget(value: string | URL): Promise<PinnedFetchTarget> {
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
  const addresses: LookupAddress[] =
    isIP(host) === 0
      ? (await lookup(host, { all: true, verbatim: true }))
          .map((record) => record.address)
          .map((address) => ({ address, family: isIP(address) }))
      : [{ address: host, family: isIP(host) }];
  if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address.address)))
    throw new Error("URL targets a private or local network address");
  const address = addresses[0];
  if (!address) throw new Error("URL hostname has no addresses");
  return { url, address: address.address, family: address.family };
}

/** Reject URLs that FetchURL could use to reach the host network. */
export async function assertPublicHttpUrl(value: string): Promise<URL> {
  return (await resolvePublicHttpTarget(value)).url;
}

async function requestPublicHttp(
  target: PinnedFetchTarget,
  maxBytes: number,
): Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const lookupPinned = (
      _hostname: string,
      options: LookupOptions,
      callback: (
        err: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: number,
      ) => void,
    ) => {
      const pinned = { address: target.address, family: target.family };
      if (options.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    };
    const options: RequestOptions = {
      method: "GET",
      headers: { "User-Agent": "AgentOS/1.0" },
      lookup: lookupPinned,
      agent: false,
    };
    const request =
      target.url.protocol === "https:"
        ? httpsRequest(target.url, options, onResponse)
        : httpRequest(target.url, options, onResponse);
    const chunks: string[] = [];
    let bytesRead = 0;
    let truncated = false;
    let settled = false;
    let status = 0;
    let responseHeaders: import("node:http").IncomingHttpHeaders = {};

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error && !truncated) reject(error);
      else resolve({ status, headers: responseHeaders, text: chunks.join("") });
    }

    function onResponse(response: import("node:http").IncomingMessage) {
      status = response.statusCode ?? 0;
      responseHeaders = response.headers;
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        const remaining = maxBytes - bytesRead;
        const chunkBytes = Buffer.byteLength(chunk);
        if (chunkBytes <= remaining) {
          chunks.push(chunk);
          bytesRead += chunkBytes;
          return;
        }
        truncated = true;
        if (remaining > 0) {
          let partial = "";
          let partialBytes = 0;
          for (const char of chunk) {
            const charBytes = Buffer.byteLength(char);
            if (partialBytes + charBytes > remaining) break;
            partial += char;
            partialBytes += charBytes;
          }
          chunks.push(partial);
        }
        response.destroy();
        finish();
      });
      response.on("end", () => finish());
      response.on("error", finish);
    }

    const deadline = setTimeout(() => request.destroy(new Error("URL request timed out")), 10_000);
    request.on("error", finish);
    request.on("close", () => clearTimeout(deadline));
    request.end();
  });
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

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};

const OMIT_HTML_ELEMENTS = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "object",
  "embed",
  "canvas",
  "audio",
  "video",
]);
const BLOCK_HTML_ELEMENTS = new Set([
  "address",
  "article",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

function hasHiddenPresentation(attrs: Array<{ name: string; value: string }>): boolean {
  const values = new Map(attrs.map(({ name, value }) => [name.toLowerCase(), value]));
  if (values.has("hidden") || values.get("aria-hidden")?.trim().toLowerCase() === "true")
    return true;
  const style = values.get("style");
  if (!style) return false;
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration
      .slice(separator + 1)
      .replace(/\s*!important\s*$/i, "")
      .trim()
      .toLowerCase();
    if (
      (property === "display" && value === "none") ||
      (property === "visibility" && (value === "hidden" || value === "collapse")) ||
      (property === "opacity" && Number.parseFloat(value) === 0) ||
      (property === "font-size" && Number.parseFloat(value) === 0)
    )
      return true;
  }
  return false;
}

function textFromHtmlNode(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  const tagName = node.tagName?.toLowerCase();
  if (
    (tagName && OMIT_HTML_ELEMENTS.has(tagName)) ||
    (node.attrs && hasHiddenPresentation(node.attrs))
  )
    return "";
  const content = (node.childNodes ?? []).map(textFromHtmlNode).join("");
  return tagName && BLOCK_HTML_ELEMENTS.has(tagName) ? `\n${content}\n` : content;
}

function stripHtml(html: string): string {
  const document = parse(html) as unknown as HtmlNode;
  return textFromHtmlNode(document)
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchURL(url: string): Promise<unknown> {
  try {
    let current = await resolvePublicHttpTarget(url);
    const seen = new Set<string>();
    let response: Awaited<ReturnType<typeof requestPublicHttp>> | null = null;
    for (let hop = 0; hop < 4; hop += 1) {
      if (seen.has(current.url.href)) return { error: "redirect loop" };
      seen.add(current.url.href);
      response = await requestPublicHttp(current, 2 * 1024 * 1024);
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.location;
      const redirectLocation = Array.isArray(location) ? location[0] : location;
      if (!redirectLocation) return { error: "redirect missing location" };
      current = await resolvePublicHttpTarget(new URL(redirectLocation, current.url));
      response = null;
    }
    if (!response) return { error: "too many redirects" };
    if (response.status < 200 || response.status >= 300)
      return { error: `HTTP ${response.status}` };
    const rawContentType = response.headers["content-type"];
    const contentType = Array.isArray(rawContentType)
      ? (rawContentType[0] ?? "")
      : (rawContentType ?? "");
    if (
      !contentType.includes("html") &&
      !contentType.startsWith("text/") &&
      !contentType.includes("json") &&
      !contentType.includes("xml")
    )
      return { error: `unsupported content type: ${contentType || "unknown"}` };
    const raw = response.text;
    const content = (contentType.includes("html") ? stripHtml(raw) : raw).slice(0, 8000);
    return {
      trust: "untrusted_external_data",
      source: "fetched_web_document",
      contentType,
      content,
      url: current.url.href,
      status: response.status,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
