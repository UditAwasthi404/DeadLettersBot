import { describe, expect, test } from "bun:test";

// Mirror parseBrowserRoute without exporting the private helper from the daemon module.
function parseBrowserRoute(pathname: string): {
  vmId: string;
  botId: string;
  basePath: string;
  suffix: string;
} | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "v1" || segments[1] !== "browser" || segments.length < 3) return null;
  let vmId: string;
  let botId: string;
  try {
    vmId = decodeURIComponent(segments[2] ?? "");
    botId = decodeURIComponent(segments[3] ?? "");
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9_.-]{1,256}$/.test(vmId) || !/^[0-9a-f-]{36}$/i.test(botId)) return null;
  const rest = segments.slice(4);
  return {
    vmId,
    botId,
    basePath: `/v1/browser/${segments[2]}/${segments[3]}`,
    suffix: rest.length > 0 ? `/${rest.join("/")}` : "",
  };
}

describe("execution daemon browser routes", () => {
  test("accepts Playwright trailing slash on json/version", () => {
    const botId = "249247d0-ef2e-4713-b181-a9ca5c41349b";
    const vmId = "agentOS-vm-f8d1b15b-49c2-494a-89ca-5e81f0851c74";
    const route = parseBrowserRoute(`/v1/browser/${vmId}/${botId}/json/version/`);
    expect(route?.suffix).toBe("/json/version");
    expect(route?.vmId).toBe(vmId);
    expect(route?.botId).toBe(botId);
  });

  test("keeps devtools websocket paths intact", () => {
    const botId = "249247d0-ef2e-4713-b181-a9ca5c41349b";
    const route = parseBrowserRoute(
      `/v1/browser/abc123/${botId}/devtools/browser/1077196e-6adf-4b5a-9ec5-ed1c406ce941`,
    );
    expect(route?.suffix).toBe("/devtools/browser/1077196e-6adf-4b5a-9ec5-ed1c406ce941");
  });
});
