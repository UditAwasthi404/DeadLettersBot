/** Permission adapter (REQ-A10, A11). */

import type { ApprovalPolicy, PermissionLevel } from "@agentOS/shared";
import type { CatalogTool } from "./tools/catalog.ts";

export class PermissionDeniedError extends Error {
  override readonly name = "PermissionDeniedError";
}

export function checkPermission(
  toolName: string,
  catalog: CatalogTool[],
  policy: ApprovalPolicy,
): PermissionLevel {
  const tool = catalog.find((t) => t.name === toolName);
  if (!tool) {
    throw new PermissionDeniedError("unadvertised tool");
  }

  const matching = policy.autoReviewRules.filter((rule) => {
    try {
      return new RegExp(rule.actionPattern).test(toolName);
    } catch {
      return false;
    }
  });
  if (matching.some((rule) => rule.mode === "require")) return 3;
  if (matching.some((rule) => rule.mode === "always_allow")) return 0;

  return Math.max(tool.permissionLevel, policy.defaultLevel) as PermissionLevel;
}
