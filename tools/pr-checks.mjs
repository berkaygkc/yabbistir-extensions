#!/usr/bin/env node
// npm run pr-checks [-- --base <ref>]
//
// Runs the checks a pull request gets (docs/publishing.md, "The checks") on the commits between <ref> and HEAD:
// one extension folder and nothing else; for that extension, readable source in src/, npm run build, the size of the
// package and of index.js, npm run validate and npm test; then, for every pull request, npm run typecheck,
// npm run docs -- --check, the tools' own tests, and a catalog built from the result. Every check runs, and a summary
// lists each one; exits with 1 when any fails. Uncommitted changes are not included.
//
//   --base <ref>   where the branch started (default: origin/main)
//   --root <dir>   the repository to check (default: this repository)

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { changedFiles, runChecks } from "./lib/pr-checks.mjs";

const inActions = process.env.GITHUB_ACTIONS === "true";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  let base = "origin/main";
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--base") base = argv[++index] ?? base;
    else if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm run pr-checks [-- --base <ref>]");
      return 0;
    } else {
      console.log(`Unknown argument: ${argument}. Usage: npm run pr-checks [-- --base <ref>]`);
      return 2;
    }
  }

  let files;
  try {
    files = changedFiles(root, base);
  } catch (error) {
    console.log(`${error.message} → fix: Fetch the base branch (git fetch origin main), or name another with --base.`);
    return 2;
  }
  console.log(`${files.length} file${files.length === 1 ? "" : "s"} changed since ${base}.`);

  const exec = (args) => {
    const shown = `npm ${args.join(" ")}`;
    console.log(inActions ? `::group::${shown}` : `\n▸ ${shown}`);
    const result = spawnSync(npm, args, { cwd: root, stdio: "inherit" });
    if (inActions) console.log("::endgroup::");
    return result.status ?? 1;
  };
  const { ok, results } = runChecks({ root, files, exec });

  console.log("\nChecks:");
  for (const result of results) {
    console.log(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name}`);
    for (const problem of result.problems) {
      console.log(`        ${problem}`);
      if (inActions) console.log(`::error title=${result.name}::${problem}`);
    }
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed} of ${results.length} checks failed.`);
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
