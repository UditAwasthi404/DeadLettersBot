import { readFileSync, writeFileSync } from "node:fs";

const path = "packages/box-host/src/gateway.ts";
const lines = readFileSync(path, "utf8").split(/\n/);
const start = lines.findIndex((line) => line.includes('app.get("/openapi.json"'));
const end = lines.findIndex(
  (line, index) => index > start && line.includes('app.post("/v1/auth/bootstrap"'),
);
if (start < 0 || end < 0) {
  console.error("markers", start, end);
  process.exit(1);
}
const replacement = [
  '  app.get("/openapi.json", (c) => c.json(openApiDocument()));',
  '  app.get("/docs", apiReference({ url: "/openapi.json" }));',
  "",
];
lines.splice(start, end - start, ...replacement);
writeFileSync(path, lines.join("\n"));
console.log("spliced", start, end);
