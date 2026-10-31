// The checks a pull request gets (docs/publishing.md, "The checks") and the run that applies them: the static rules of
// tools/lib/static-rules.mjs, then, for the extension it changes, readable source, the build, sizes, validate and its
// tests, and for every pull request the typecheck, the docs, the tools' tests and a catalog.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bundledInputs } from "./build.mjs";
import { diskTree, runStaticChecks } from "./static-rules.mjs";
import { listFiles } from "./zip.mjs";

export * from "./static-rules.mjs";

/** The largest package the app downloads. */
export const MAX_PACKAGE_BYTES = 5_000_000;
export const MAX_INDEX_BYTES = 1_000_000;
/** The largest catalog the app downloads. */
export const MAX_CATALOG_BYTES = 2_000_000;
/** Longer lines in src/, or a higher average line length in one file, read as minified or obfuscated code. */
export const MAX_LINE = 500;
export const MAX_AVERAGE_LINE = 200;

const READABLE_FIX = "Write the source by hand, and let the build bundle libraries from npm.";

/** Whether `text` (a file in src/, shown as `file`) reads as hand-written: no line over MAX_LINE characters, no average over MAX_AVERAGE_LINE. */
export function readabilityProblems(file, text) {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const lengths = lines.map((line) => [...line].length);
  const long = lengths.findIndex((length) => length > MAX_LINE);
  if (long !== -1) {
    const more = lengths.filter((length) => length > MAX_LINE).length - 1;
    return [`${file}:${long + 1}: a line of ${lengths[long]} characters${more > 0 ? ` (and ${more} more like it)` : ""} reads as minified or obfuscated code (expected at most ${MAX_LINE}) → fix: ${READABLE_FIX}`];
  }
  // Blank lines are left out, so padding cannot hide a dense file.
  const written = lengths.filter((length, index) => lines[index].trim() !== "");
  const average = written.length === 0 ? 0 : written.reduce((sum, length) => sum + length, 0) / written.length;
  if (average > MAX_AVERAGE_LINE) {
    return [`${file}: its lines average ${Math.round(average)} characters, which reads as minified or obfuscated code (expected at most ${MAX_AVERAGE_LINE}) → fix: ${READABLE_FIX}`];
  }
  return [];
}

/** Whether the built package and index.js of extension `id` fit the store's limits. */
export function sizeProblems(id, { packageBytes, indexBytes }) {
  const problems = [];
  const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (packageBytes > MAX_PACKAGE_BYTES) {
    problems.push(`dist/${id}-<version>.yabext: the package is ${megabytes(packageBytes)} (${packageBytes} bytes; expected at most ${MAX_PACKAGE_BYTES}) → fix: Leave large data and libraries out; the app does not download bigger packages.`);
  }
  if (indexBytes > MAX_INDEX_BYTES) {
    problems.push(`dist/${id}/index.js: the bundle is ${megabytes(indexBytes)} (${indexBytes} bytes; expected at most ${MAX_INDEX_BYTES}) → fix: Import only what the extension uses, and prefer the yab API to large libraries.`);
  }
  return problems;
}

/**
 * Runs every check for a pull request that changes `files`, in the checkout at `root`. `exec(args)` runs `npm <args>`
 * there and returns its exit status; `readBase(file)` gives a file's text where the branch started (null when it did
 * not exist); `inputsOf(id)` gives the extension's bundled files (bundledInputs); `tracked()` the repository's files
 * (undefined: what git tracks there, or outside git the files under extensions/). The static rules read the checkout
 * on disk here (lockfile-state's diskTree), where tools/static-checks.mjs reads a commit through git. Every check runs,
 * so one push shows every problem.
 * @returns {Promise<{ ok: boolean, results: Array<{ name: string, ok: boolean, problems: string[] }> }>}
 */
export async function runChecks({ root, files, exec, readBase = () => null, inputsOf = (id) => bundledInputs(root, id), tracked = () => undefined }) {
  const results = [];
  const record = (name, problems) => results.push({ name, ok: problems.length === 0, problems });
  const command = (args, name, fix) => {
    const ok = exec(args) === 0;
    record(name, ok ? [] : [`${name} failed (its output is above) → fix: ${fix}`]);
    return ok;
  };

  const statics = runStaticChecks({ tree: diskTree(root, { files: tracked() }), files, readBase });
  results.push(...statics.results);
  const { scope } = statics;

  for (const id of scope.extensions) {
    const folder = path.join(root, "extensions", id);
    if (!fs.existsSync(path.join(folder, "manifest.json"))) continue; // removed by the pull request: nothing to build
    // Everything in src/, and every file of the folder the build bundles from wherever it is (node_modules aside).
    const source = path.join(folder, "src");
    const measured = new Set(fs.existsSync(source) ? listFiles(source).map((file) => `extensions/${id}/src/${file}`) : []);
    const bundled = await inputsOf(id);
    if (bundled.ok) for (const file of bundled.inputs) measured.add(file);
    const unreadable = [...measured].sort().flatMap((file) => readabilityProblems(file, fs.readFileSync(path.join(root, file), "utf8")));
    record(`readable source in extensions/${id}/ (src/ and every file the build bundles)`, unreadable);

    if (command(["run", "build", "--", id], `npm run build -- ${id}`, "Run it locally and fix what it reports.")) {
      let sizes;
      try {
        const { version } = JSON.parse(fs.readFileSync(path.join(root, "dist", id, "manifest.json"), "utf8"));
        sizes = sizeProblems(id, {
          packageBytes: fs.statSync(path.join(root, "dist", `${id}-${version}.yabext`)).size,
          indexBytes: fs.statSync(path.join(root, "dist", id, "index.js")).size,
        });
      } catch (error) {
        sizes = [`dist/${id}: the build's output is incomplete (${error.message})`];
      }
      record(`size of the ${id} package and its index.js`, sizes);
    }
    command(["run", "validate", "--", id], `npm run validate -- ${id}`, "Run it locally and fix every error it reports.");
    command(["test", "--", id], `npm test -- ${id}`, "Run it locally and make the tests pass.");
  }

  command(["run", "typecheck"], "npm run typecheck", "Run it locally and fix the type errors.");
  command(["run", "docs", "--", "--check"], "npm run docs -- --check", "Run npm run docs and commit what it writes.");
  command(["run", "test:tools"], "npm run test:tools", "Run it locally and make the tests pass.");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "yab-catalog-"));
  try {
    command(["run", "catalog", "--", "--out", out], "npm run catalog", "Run npm run catalog -- --out site/v1 locally and fix what it reports.");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
  return { ok: results.every((result) => result.ok), results };
}
