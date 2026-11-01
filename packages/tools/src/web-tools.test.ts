import { describe, expect, test } from "bun:test";
import { assertPublicHttpUrl, fetchURL, isBlockedIp } from "./web-tools.ts";

describe("public URL guard", () => {
  test("blocks loopback, link-local, and rewritten private addresses", async () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true);
    for (const url of [
      "http://127.0.0.1/latest/meta-data",
      "http://2130706433/",
      "http://169.254.169.254/",
      "http://10.1.2.3/",
      "http://[::1]/",
      "http://localhost:8787/health",
      "file:///etc/passwd",
      "http://user:pass@example.com/",
    ]) {
      const result = await fetchURL(url);
      expect(result).toMatchObject({ error: expect.any(String) });
      expect(String((result as { error: string }).error).toLowerCase()).not.toContain(
        "econnrefused",
      );
    }
  });

  test("accepts a public address literal without contacting it", async () => {
    const url = await assertPublicHttpUrl("https://8.8.8.8/dns-query");
    expect(url.hostname).toBe("8.8.8.8");
  });

  test("does not follow a redirect onto the host network", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("127.0.0.1")) throw new Error("redirect target was fetched");
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } });
    }) as typeof fetch;
    try {
      const result = await fetchURL("https://8.8.8.8/start");
      expect(result).toEqual({ error: "URL targets a private or local network address" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
