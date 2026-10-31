#!/usr/bin/env node
// npm run validate -- [<id> …]
//
// Checks extensions/<id> (every extension when no id is given) by the app's rules and the store's. Prints one line per
// issue, `extensions/<id>/manifest.json: <field>: <message> (expected …) → fix: …`, and exits with 1 when there is an
// error; warnings alone exit with 0.
//
//   --app          only the app's rules (what the app itself would refuse), without the store's
//   --root <dir>   the repository whose extensions/ to read (default: this repository)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatIssue, validateExtension } from "./lib/validate.mjs";

function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  let store = true;
  const ids = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--app") store = false;
    else if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm run validate -- [--app] [<id> …]");
      return 0;
    } else ids.push(argument.replace(/\/+$/, "").replace(/^extensions\//, ""));
  }

  const extensions = path.join(root, "extensions");
  if (ids.length === 0) {
    const found = fs.existsSync(extensions)
      ? fs.readdirSync(extensions, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort()
      : [];
    if (found.length === 0) {
      console.log("No extensions to validate in extensions/.");
      return 0;
    }
    ids.push(...found);
  }

  let errors = 0;
  let warnings = 0;
  for (const id of ids) {
    const folder = path.join(extensions, id);
    const shown = path.relative(root, folder);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      console.log(`${shown}: there is no such extension folder → fix: Create it with npm run new -- ${id}, or check the id.`);
      errors++;
      continue;
    }
    const { issues } = validateExtension(folder, { store, relativeTo: root });
    for (const issue of issues) console.log(formatIssue(issue));
    const own = issues.filter((issue) => issue.level === "error").length;
    errors += own;
    warnings += issues.length - own;
    if (issues.length === 0) console.log(`${shown}: ok`);
    if (store && !fs.existsSync(path.join(folder, "index.js"))) {
      console.log(`${shown}: note: it is not built yet, so index.js was not checked → fix: Run npm run build -- ${id}, which builds it and checks the result.`);
    }
  }
  if (errors + warnings > 0) {
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    console.log(`\n${count(errors, "error")}, ${count(warnings, "warning")} in ${count(ids.length, "extension")}.`);
  }
  return errors > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
