#!/usr/bin/env node
// node tools/static-checks.mjs [--root <dir>] [--base <ref>]
//
// The checks of a pull request that read files and git only (tools/lib/static-rules.mjs): one extension folder;
// extension package.json files that name registry libraries and run nothing; the install state
// (tools/lockfile-state.mjs); and the lockfile diff since <ref>. Nothing is installed and nothing of the checkout is
// run, so the static job of .github/workflows/pr.yml runs this file from the base branch against the pull request's
// checkout as data. Node's built-in modules only. Exits with 1 when a check fails.
//
//   --root <dir>   the checkout to check (default: this repository)
//   --base <ref>   where the branch started (default: origin/main)

import path from "node:path";
import { fileURLToPath } from "node:url";

import { baseReader, changedFiles, runStaticChecks } from "./lib/static-rules.mjs";

function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  let base = "origin/main";
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--base") base = argv[++index] ?? base;
    else {
      console.log("Usage: node tools/static-checks.mjs [--root <dir>] [--base <ref>]");
      return 2;
    }
  }
  let files;
  let readBase;
  try {
    files = changedFiles(root, base);
    readBase = baseReader(root, base);
  } catch (error) {
    console.log(`${error.message} → fix: Fetch the base branch, or name another with --base.`);
    return 2;
  }
  const { ok, results } = runStaticChecks({ root, files, readBase });
  console.log(`${files.length} file${files.length === 1 ? "" : "s"} changed since ${base}.\n\nStatic checks:`);
  for (const result of results) {
    console.log(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name}`);
    for (const problem of result.problems) {
      console.log(`        ${problem}`);
      if (process.env.GITHUB_ACTIONS === "true") console.log(`::error title=${result.name}::${problem}`);
    }
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed === 0 ? `\nAll ${results.length} static checks passed.` : `\n${failed} of ${results.length} static checks failed.`);
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
