import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const script = new URL("../../../infra/docker/agentos-pointer.sh", import.meta.url);

function run(args: string[]) {
  return spawnSync("bash", [script.pathname, ...args], { encoding: "utf8" });
}

describe("agent pointer helper", () => {
  test("rejects a bot id that is not a uuid", () => {
    const result = run(["not-a-bot", "mousemove", "1", "2"]);
    expect(result.status).toBe(2);
  });

  test("rejects coordinates and actions outside the pointer contract", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(run([id, "click", "1", "2"]).status).toBe(2);
    expect(run([id, "mousemove", "-1", "2"]).status).toBe(2);
    expect(run([id, "mousemove", "9000", "2"]).status).toBe(2);
  });

  test("fails closed when that bot has no display", () => {
    const result = run(["00000000-0000-4000-8000-000000000001", "mousemove", "10", "20"]);
    expect(result.status).toBe(1);
  });
});
