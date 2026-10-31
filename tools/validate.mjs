#!/usr/bin/env node
// npm run validate -- [<id> …]
//
// Checks extensions/<id> (every extension when no id is given) by the app's rules and the store's. Prints one line per
// issue, `extensions/<id>/manifest.json: <field>: <message> (expected …) → fix: …`, and exits with 1 when there is an
// error; warnings alone exit with 0.
//
// When dist/<id>/ holds a build newer than everything the build reads from extensions/<id>/ (all but tests/), that build
// is checked instead, index.js included, and its issues are reported at the source files they come from. Otherwise the
// source folder is checked, with a note that index.js needs a build to be checked too.
//
//   --app          only the app's rules (what the app itself would refuse), without the store's
//   --root <dir>   the repository whose extensions/ to read (default: this repository)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fileTypeIssues, formatIssue, validateExtension } from "./lib/validate.mjs";

/** The newest modification time among the files and folders the build reads from `folder`: everything but tests/. */
function newestSource(folder) {
  let newest = 0;
  const walk = (directory, top) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || (top && entry.name === "tests")) continue;
      const full = path.join(directory, entry.name);
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
      if (entry.isDirectory()) walk(full, false);
    }
  };
  walk(folder, true);
  return newest;
}

/** dist/<id>/ when it holds a build of extensions/<id>/ that is newer than its sources; undefined otherwise. */
function freshBuild(root, id, folder) {
  const built = path.join(root, "dist", id);
  let compiled;
  try {
    compiled = fs.statSync(path.join(built, "index.js")).mtimeMs;
  } catch {
    return undefined;
  }
  return compiled > newestSource(folder) ? built : undefined;
}

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
    const built = freshBuild(root, id, folder);
    const { issues } = validateExtension(built ?? folder, { store, relativeTo: root });
    // The build's copy holds regular files whatever the source has, so links are looked for in the source too.
    if (store && built) issues.unshift(...fileTypeIssues(folder, { relativeTo: root }));
    // The build's files are copies: an issue is fixed in the source, so it is named there.
    const builtPrefix = `${path.relative(root, built ?? folder)}${path.sep}`;
    for (const issue of issues) {
      if (built && issue.path.startsWith(builtPrefix)) issue.path = path.join(shown, issue.path.slice(builtPrefix.length));
      console.log(formatIssue(issue));
    }
    const own = issues.filter((issue) => issue.level === "error").length;
    errors += own;
    warnings += issues.length - own;
    if (issues.length === 0) console.log(built ? `${shown}: ok, with its build in ${path.relative(root, built)}` : `${shown}: ok`);
    if (store && !built && !fs.existsSync(path.join(folder, "index.js"))) {
      console.log(`${shown}: note: not built yet (or out of date): run npm run build -- ${id} to check index.js too`);
    }
  }
  if (errors + warnings > 0) {
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    console.log(`\n${count(errors, "error")}, ${count(warnings, "warning")} in ${count(ids.length, "extension")}.`);
  }
  return errors > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
