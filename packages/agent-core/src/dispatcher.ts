/** Tool dispatch (REQ-A06) — routes to @agentOS/tools implementations. */

import type { ApprovalPolicy, ToolCall, ToolResult } from "@agentOS/shared";
import type { BrowserSession } from "@agentOS/tools";
import {
  appendFile,
  deleteFile,
  fetchURL,
  listDirectory,
  readFile,
  runShell,
  searchWeb,
  writeFile,
} from "@agentOS/tools";
import type { VMManager } from "@agentOS/vm-manager";
import { PermissionDeniedError, checkPermission } from "./permissions.ts";
import type { CatalogTool } from "./tools/catalog.ts";

export type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

export interface DispatcherDeps {
  vm: VMManager | null;
  vmId: string | null;
  browser: BrowserSession | null;
  signal?: AbortSignal;
  localExec?: (
    command: string,
    cwd?: string,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

function withErrorFlag(result: unknown): { result: unknown; isError: boolean } {
  const isError =
    Boolean(result) &&
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    (result as { error?: unknown }).error !== undefined;
  return { result, isError };
}

const UNTRUSTED_TOOL_SOURCES: Record<string, string> = {
  ReadFile: "file_contents",
  ListDirectory: "filesystem_listing",
  RunShell: "shell_output",
  RequestLocalExec: "local_shell_output",
  BrowserExtractContent: "browser_page",
  BrowserEvaluate: "browser_evaluation",
  BrowserScreenshot: "browser_screenshot",
  SearchWeb: "web_search",
  FetchURL: "fetched_web_document",
};

export function wrapUntrusted(
  source: string,
  payload: unknown,
): { trust: "untrusted_external_data"; source: string; content: string } {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    trust: "untrusted_external_data",
    source,
    content: `[UNTRUSTED_EXTERNAL_DATA]\n${body}\n[/UNTRUSTED_EXTERNAL_DATA]`,
  };
}

// tool_duration_ms is recorded by the turn runner around this call so MCP and connector tools share it.
export async function dispatchTool(
  tc: ToolCall,
  catalog: CatalogTool[],
  policy: ApprovalPolicy,
  deps: DispatcherDeps,
): Promise<ToolResult> {
  try {
    checkPermission(tc.name, catalog, policy);

    let raw: unknown;

    switch (tc.name) {
      case "SendToUser":
        raw = { ok: true };
        break;

      case "ReadFile":
      case "WriteFile":
      case "AppendFile":
      case "DeleteFile":
      case "ListDirectory":
      case "RunShell": {
        if (!deps.vm || !deps.vmId) {
          raw = { error: "vm not available" };
          break;
        }
        const vm = deps.vm;
        const vmId = deps.vmId;
        if (tc.name === "ReadFile") {
          raw = await readFile({ path: String(tc.args.path ?? "") }, vmId, vm, deps.signal);
        } else if (tc.name === "WriteFile") {
          raw = await writeFile(
            { path: String(tc.args.path ?? ""), content: String(tc.args.content ?? "") },
            vmId,
            vm,
            deps.signal,
          );
        } else if (tc.name === "AppendFile") {
          raw = await appendFile(
            { path: String(tc.args.path ?? ""), content: String(tc.args.content ?? "") },
            vmId,
            vm,
            deps.signal,
          );
        } else if (tc.name === "DeleteFile") {
          raw = await deleteFile({ path: String(tc.args.path ?? "") }, vmId, vm, deps.signal);
        } else if (tc.name === "ListDirectory") {
          raw = await listDirectory({ path: String(tc.args.path ?? "") }, vmId, vm, deps.signal);
        } else {
          raw = await runShell(
            {
              command: String(tc.args.command ?? ""),
              cwd: tc.args.cwd !== undefined ? String(tc.args.cwd) : undefined,
            },
            vmId,
            vm,
            deps.signal,
          );
        }
        break;
      }

      case "BrowserNavigate":
      case "BrowserClick":
      case "BrowserType":
      case "BrowserScreenshot":
      case "BrowserExtractContent":
      case "BrowserScroll":
      case "BrowserWaitForElement":
      case "BrowserEvaluate": {
        if (!deps.browser) {
          raw = { error: "browser session not available" };
          break;
        }
        const b = deps.browser;
        if (tc.name === "BrowserNavigate") {
          raw = await b.navigate(String(tc.args.url ?? ""));
        } else if (tc.name === "BrowserClick") {
          raw = await b.click(String(tc.args.selector ?? ""));
        } else if (tc.name === "BrowserType") {
          raw = await b.type(String(tc.args.selector ?? ""), String(tc.args.text ?? ""));
        } else if (tc.name === "BrowserScreenshot") {
          raw = await b.screenshot();
        } else if (tc.name === "BrowserExtractContent") {
          raw = await b.extract(
            tc.args.selector !== undefined ? String(tc.args.selector) : undefined,
            tc.args.question !== undefined ? String(tc.args.question) : undefined,
          );
        } else if (tc.name === "BrowserScroll") {
          raw = await b.scroll(
            tc.args.direction === "up" ? "up" : "down",
            typeof tc.args.px === "number" ? tc.args.px : undefined,
          );
        } else if (tc.name === "BrowserWaitForElement") {
          raw = await b.waitForElement(
            String(tc.args.selector ?? ""),
            typeof tc.args.timeoutMs === "number" ? tc.args.timeoutMs : undefined,
          );
        } else {
          raw = await b.evaluate(String(tc.args.script ?? ""));
        }
        break;
      }

      case "RequestLocalExec": {
        if (!deps.localExec) {
          raw = { error: "local execution is not available" };
          break;
        }
        raw = await deps.localExec(
          String(tc.args.command ?? ""),
          tc.args.cwd !== undefined ? String(tc.args.cwd) : undefined,
        );
        break;
      }

      case "SearchWeb":
        raw = await searchWeb(String(tc.args.query ?? ""));
        break;

      case "FetchURL":
        raw = await fetchURL(String(tc.args.url ?? ""));
        break;

      case "GetDynamicTools":
      case "CallDynamicTool":
        raw = { error: "dynamic tools not yet implemented" };
        break;

      default:
        throw new PermissionDeniedError("unadvertised tool");
    }

    const flagged = withErrorFlag(raw);
    const source = UNTRUSTED_TOOL_SOURCES[tc.name];
    const result =
      !flagged.isError && source ? wrapUntrusted(source, flagged.result) : flagged.result;
    const { isError } = flagged;
    return { toolCallId: tc.id, name: tc.name, result, isError };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return {
        toolCallId: tc.id,
        name: tc.name,
        result: { error: err.message },
        isError: true,
      };
    }
    throw err;
  }
}
