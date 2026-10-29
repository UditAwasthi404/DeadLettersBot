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
    const res = await fetch(url, {
      headers: { "User-Agent": "AgentOS/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
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
