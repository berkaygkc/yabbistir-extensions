#!/usr/bin/env node
// npm run build -- <id> [<id> …]
//
// Builds extensions/<id> into dist/<id>/ (manifest.json, index.js, locales/, README.md, CHANGELOG.md, icon.png), checks
// that folder with the store's rules, and packs it into dist/<id>-<version>.yabext. Without an id, builds every extension.
//
//   --root <dir>   the repository whose extensions/ to read (default: this repository)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildExtension } from "./lib/build.mjs";

async function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  const ids = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm run build -- [<id> …]");
      return 0;
    } else ids.push(argument.replace(/\/+$/, "").replace(/^extensions\//, ""));
  }
  if (ids.length === 0) {
    const directory = path.join(root, "extensions");
    if (fs.existsSync(directory)) {
      ids.push(...fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort());
    }
    if (ids.length === 0) {
      console.log("No extensions to build in extensions/.");
      return 0;
    }
  }

  let failed = 0;
  for (const id of ids) {
    const result = await buildExtension(root, id);
    for (const message of result.messages) console.log(message);
    if (result.ok) {
      const warnings = result.issues.length;
      console.log(`built ${path.relative(root, result.folder)}, validated${warnings > 0 ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}, packed ${path.relative(root, result.archive)}`);
    } else {
      console.log(`build failed: ${id}`);
      failed++;
    }
  }
  return failed > 0 ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
