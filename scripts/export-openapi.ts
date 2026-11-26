import { writeFile } from "node:fs/promises";
import { openApiDocument } from "../packages/box-host/src/openapi.ts";

const output = new URL("../packages/sdk/openapi.json", import.meta.url);
const document = openApiDocument();
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.info("Updated packages/sdk/openapi.json from the box-host route schemas.");
