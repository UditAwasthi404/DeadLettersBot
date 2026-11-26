import { readFile, writeFile } from "node:fs/promises";

const tag = process.env.RELEASE_TAG ?? "";
const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (!match?.[1]) throw new Error(`invalid desktop release tag: ${tag}`);

const packagePath = new URL("../packages/desktop/package.json", import.meta.url);
const pkg = JSON.parse(await readFile(packagePath, "utf8"));
pkg.version = match[1];
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
