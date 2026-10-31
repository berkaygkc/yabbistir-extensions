#!/usr/bin/env node
// npm run pr-checks [-- --base <ref>]
//
// Runs the checks a pull request gets (docs/publishing.md, "The checks") on the commits between <ref> and HEAD:
// one extension folder and nothing only the maintainer changes; no install scripts or programs in any extension's
// package.json; the install state; a lockfile change limited to the extension's own libraries; for that extension,
// readable source (src/ and every file the build bundles), npm run build, the size of the package and of index.js,
// npm run validate and npm test; then, for every pull request, npm run typecheck, npm run docs -- --check, the tools'
// own tests, and a catalog built from the result.
// Every check runs, and a summary lists each one; exits with 1 when any fails. Uncommitted changes are not included.
//
//   --base <ref>   where the branch started (default: origin/main)
//   --root <dir>   the repository to check (default: this repository)

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { baseReader, changedFiles, commandData, commandProperty, printable, runChecks } from "./lib/pr-checks.mjs";

const inActions = process.env.GITHUB_ACTIONS === "true";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function main(argv) {
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
  let readBase;
  try {
    files = changedFiles(root, base);
    readBase = baseReader(root, base);
  } catch (error) {
    console.log(`${error.message} → fix: Fetch the base branch (git fetch origin main), or name another with --base.`);
    return 2;
  }
  console.log(`${files.length} file${files.length === 1 ? "" : "s"} changed since ${base}.`);

  const exec = (args) => {
    const shown = `npm ${args.join(" ")}`;
    console.log(inActions ? `::group::${commandData(shown)}` : `\n▸ ${printable(shown)}`);
    const result = spawnSync(npm, args, { cwd: root, stdio: "inherit" });
    if (inActions) console.log("::endgroup::");
    return result.status ?? 1;
  };
  const { ok, results } = await runChecks({ root, files, exec, readBase });

  console.log("\nChecks:");
  for (const result of results) {
    console.log(`  ${result.ok ? "ok  " : "FAIL"}  ${printable(result.name)}`);
    for (const problem of result.problems) {
      // Pull request text (paths, names) is in these lines: no control character may start a workflow command.
      console.log(`        ${printable(problem)}`);
      if (inActions) console.log(`::error title=${commandProperty(result.name)}::${commandData(problem)}`);
    }
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed} of ${results.length} checks failed.`);
  return ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
