#!/usr/bin/env node
// npm test -- [<id> …]
//
// Runs extensions/<id>/tests/*.test.mjs with node --test (every extension's tests when no id is given).
//
//   --root <dir>   the repository whose extensions/ to read (default: this repository)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  const ids = [];
  const passthrough = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument.startsWith("--")) passthrough.push(argument);
    else ids.push(argument.replace(/\/+$/, "").replace(/^extensions\//, ""));
  }
  const directory = path.join(root, "extensions");
  if (ids.length === 0 && fs.existsSync(directory)) {
    ids.push(...fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort());
  }

  const files = [];
  for (const id of ids) {
    const tests = path.join(directory, id, "tests");
    if (!fs.existsSync(path.join(directory, id))) {
      console.log(`extensions/${id}: there is no such extension folder → fix: Check the id.`);
      return 1;
    }
    if (!fs.existsSync(tests)) continue;
    files.push(...fs.readdirSync(tests).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => path.join(tests, name)));
  }
  if (files.length === 0) {
    console.log("No tests found: extensions/<id>/tests/*.test.mjs.");
    return 0;
  }
  const result = spawnSync(process.execPath, ["--test", ...passthrough, ...files], { stdio: "inherit", cwd: root });
  return result.status ?? 1;
}

process.exitCode = main(process.argv.slice(2));
