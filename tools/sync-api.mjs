#!/usr/bin/env node
// For maintainers: copies the extension API's types and the manifest schema from a checkout of the app.
//
//   node tools/sync-api.mjs <app checkout>           copies Extensions/api/index.d.ts and Extensions/schema/manifest.schema.json
//   node tools/sync-api.mjs <app checkout> --check   copies nothing; exits with 1 when either differs
//
// The app is where both are made; here they are copies, so extensions build and validate against what the app runs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const FILES = [
  ["Extensions/api/index.d.ts", "packages/api/index.d.ts"],
  ["Extensions/schema/manifest.schema.json", "schema/manifest.schema.json"],
];

function main(argv) {
  const check = argv.includes("--check");
  const app = argv.find((argument) => !argument.startsWith("--"));
  if (!app) {
    console.error("Usage: node tools/sync-api.mjs <app checkout> [--check]");
    return 2;
  }
  let differs = false;
  for (const [from, to] of FILES) {
    const source = path.resolve(app, from);
    if (!fs.existsSync(source)) {
      console.error(`${source} does not exist: is ${app} a checkout of the app?`);
      return 2;
    }
    const target = path.join(repository, to);
    const incoming = fs.readFileSync(source);
    const same = fs.existsSync(target) && Buffer.compare(fs.readFileSync(target), incoming) === 0;
    if (same) {
      console.log(`${to}: up to date`);
      continue;
    }
    differs = true;
    if (check) console.log(`${to}: differs from the app's ${from}`);
    else {
      fs.writeFileSync(target, incoming);
      console.log(`${to}: copied from the app's ${from}`);
    }
  }
  return check && differs ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
