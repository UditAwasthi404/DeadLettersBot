import { describe, expect, test } from "bun:test";
import type { ApprovalPolicy } from "@agentOS/shared";
import { PermissionDeniedError, checkPermission } from "./permissions.ts";
import { STATIC_CATALOG } from "./tools/catalog.ts";

const basePolicy = (overrides: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  autoReviewRules: [],
  defaultLevel: 0,
  ...overrides,
});

describe("checkPermission", () => {
  test("unadvertised tool throws", () => {
    expect(() => checkPermission("NotATool", STATIC_CATALOG, basePolicy())).toThrow(
      PermissionDeniedError,
    );
    expect(() => checkPermission("NotATool", STATIC_CATALOG, basePolicy())).toThrow(
      "unadvertised tool",
    );
  });

  test('autoReviewRule "require" overrides catalog level', () => {
    const level = checkPermission(
      "ReadFile",
      STATIC_CATALOG,
      basePolicy({
        autoReviewRules: [{ actionPattern: "^ReadFile$", mode: "require" }],
      }),
    );
    expect(level).toBe(3);
  });

  test('autoReviewRule "always_allow" returns 0', () => {
    const level = checkPermission(
      "RunShell",
      STATIC_CATALOG,
      basePolicy({
        autoReviewRules: [{ actionPattern: "^RunShell$", mode: "always_allow" }],
        defaultLevel: 2,
      }),
    );
    expect(level).toBe(0);
  });

  test("takes max of catalog level and policy.defaultLevel", () => {
    const level = checkPermission("ReadFile", STATIC_CATALOG, basePolicy({ defaultLevel: 2 }));
    expect(level).toBe(2);
  });
});
