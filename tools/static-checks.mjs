#!/usr/bin/env node
// node tools/static-checks.mjs [--root <dir>] [--base <ref>] [--head <ref>]
//
// The checks of a pull request that read files and git only (tools/lib/static-rules.mjs): one extension folder, and
// nothing only the maintainer changes; extension package.json files that name registry libraries and run nothing; the
// install state (tools/lockfile-state.mjs); and the lockfile diff since <base>. Everything is read from the commit
// <head> through git (git ls-tree, git cat-file, git diff), never from the files on disk, so a link or an uncommitted
// file cannot change what is checked. Nothing is installed and nothing of the repository is run:
// .github/workflows/static.yml runs this file from the base branch against the pull request's commits as data. Node's
// built-in modules only. Exits with 1 when a check fails, 2 when <base> or <head> cannot be read.
//
//   --root <dir>   the git repository holding the commits (default: this repository)
//   --base <ref>   where the branch started (default: origin/main)
//   --head <ref>   the commit to check (default: HEAD)

import path from "node:path";
import { fileURLToPath } from "node:url";

import { baseReader, changedFiles, commandData, commandProperty, commitTree, printable, runStaticChecks } from "./lib/static-rules.mjs";

function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  let base = "origin/main";
  let head = "HEAD";
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--base") base = argv[++index] ?? base;
    else if (argument === "--head") head = argv[++index] ?? head;
    else {
      console.log("Usage: node tools/static-checks.mjs [--root <dir>] [--base <ref>] [--head <ref>]");
      return 2;
    }
  }
  let files;
  let readBase;
  let tree;
  try {
    files = changedFiles(root, base, head);
    readBase = baseReader(root, base, head);
    tree = commitTree(root, head);
  } catch (error) {
    console.log(`${printable(error.message)} → fix: Fetch the base branch, or name others with --base and --head.`);
    return 2;
  }
  const { ok, results } = runStaticChecks({ tree, files, readBase });
  const inActions = process.env.GITHUB_ACTIONS === "true";
  console.log(`${files.length} file${files.length === 1 ? "" : "s"} changed since ${printable(base)} in ${printable(head)}.\n\nStatic checks:`);
  for (const result of results) {
    console.log(`  ${result.ok ? "ok  " : "FAIL"}  ${printable(result.name)}`);
    for (const problem of result.problems) {
      // Pull request text (paths, names) is in these lines: no control character may start a workflow command.
      console.log(`        ${printable(problem)}`);
      if (inActions) console.log(`::error title=${commandProperty(result.name)}::${commandData(problem)}`);
    }
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed === 0 ? `\nAll ${results.length} static checks passed.` : `\n${failed} of ${results.length} static checks failed.`);
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
