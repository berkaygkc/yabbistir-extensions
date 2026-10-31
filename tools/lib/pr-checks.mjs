// The rules a pull request is checked by (docs/publishing.md, "The checks"), and the run that applies them.
//
// .github/workflows/pr-label.yml carries copies of permissionChanges and authorToMention: it runs with a write token
// and never checks out the pull request, so it cannot import them. tools/test/pr-checks.test.mjs keeps the copies
// identical to the functions here, so both must stay self-contained.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listFiles } from "./zip.mjs";

/** The largest package the app downloads. */
export const MAX_PACKAGE_BYTES = 5_000_000;
export const MAX_INDEX_BYTES = 1_000_000;
/** The largest catalog the app downloads. */
export const MAX_CATALOG_BYTES = 2_000_000;
/** Longer lines in src/, or a higher average line length in one file, read as minified or obfuscated code. */
export const MAX_LINE = 500;
export const MAX_AVERAGE_LINE = 200;

/** What may change next to an extension's folder: the lockfile when it adds a library, and what npm run docs writes. */
export const ALLOWED_BESIDE_AN_EXTENSION = ["package-lock.json", "docs/manifest.md", "docs/api.md", "llms-full.txt"];

const READABLE_FIX = "Write the source by hand, and let the build bundle libraries from npm.";

/** The files a branch changes since it left `base`, both sides of a move included. */
export function changedFiles(root, base) {
  const result = spawnSync("git", ["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git diff against ${base} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout.split("\0").filter(Boolean);
}

/**
 * The extensions a pull request changes, and how it breaks the rule of one `extensions/<id>/` folder and nothing else
 * (besides ALLOWED_BESIDE_AN_EXTENSION). A pull request without an extension may change anything.
 */
export function checkScope(files) {
  const extensions = new Set();
  const others = [];
  for (const file of files) {
    const match = /^extensions\/([^/]+)\/./.exec(file);
    if (match) extensions.add(match[1]);
    else others.push(file);
  }
  const ids = [...extensions].sort();
  const problems = [];
  const folders = ids.map((id) => `extensions/${id}/`).join(", ");
  if (ids.length > 1) {
    problems.push(`the pull request changes ${ids.length} extension folders (${folders}) → fix: Send one pull request per extension.`);
  }
  const outside = others.filter((file) => !ALLOWED_BESIDE_AN_EXTENSION.includes(file));
  if (ids.length > 0 && outside.length > 0) {
    const shown = outside.slice(0, 5).join(", ") + (outside.length > 5 ? ` and ${outside.length - 5} more` : "");
    problems.push(`the pull request changes ${shown} besides ${folders} → fix: Send changes to the tools, templates, docs or packages/api in a pull request of their own.`);
  }
  return { extensions: ids, problems };
}

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
 * Which of the reviewed fields differ between two manifest.json texts (null: no such file): "permissions",
 * "network" (the domains; none means any host) and "requires" (each tool's name and install command, which Settings
 * shows to copy). A text that is not a JSON object yields ["manifest.json"]. Order and letter case do not count.
 */
export function permissionChanges(baseText, headText) {
  const read = (text) => {
    if (text === null || text === undefined) return {};
    try {
      const value = JSON.parse(String(text).replace(/^\uFEFF/, ""));
      return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const base = read(baseText);
  const head = read(headText);
  if (base === undefined || head === undefined) return ["manifest.json"];
  const list = (value) => (Array.isArray(value) ? value : []);
  const object = (value) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value : {});
  const text = (value) => (typeof value === "string" ? value : JSON.stringify(value) ?? "");
  const set = (values) => JSON.stringify([...new Set(values)].sort());
  const fields = {
    permissions: (manifest) => set(list(manifest.permissions).map(text)),
    network: (manifest) => set(list(object(manifest.network).domains).map((domain) => text(domain).toLowerCase())),
    requires: (manifest) => set(list(object(manifest.requires).tools).map((tool) => JSON.stringify([text(object(tool).name), text(object(tool).install)]))),
  };
  return Object.keys(fields).filter((field) => fields[field](base) !== fields[field](head));
}

/**
 * The author to name on a pull request by someone else: the `author` of the extension's manifest.json on the base
 * branch (null for a new extension), unless it is the pull request's author by login or by profile name.
 */
export function authorToMention(baseText, login, name) {
  let author;
  try {
    author = JSON.parse(String(baseText ?? "null").replace(/^\uFEFF/, ""))?.author;
  } catch {
    return null;
  }
  if (typeof author !== "string" || author.trim() === "") return null;
  const same = (a, b) => typeof b === "string" && a.trim().replace(/^@/, "").localeCompare(b.trim(), "en", { sensitivity: "base" }) === 0;
  return same(author, login) || same(author, name) ? null : author.trim();
}

/**
 * Runs every check for a pull request that changes `files`, in the repository at `root`. `exec(args)` runs
 * `npm <args>` there and returns its exit status. Every check runs, so one push shows every problem.
 * @returns {{ ok: boolean, results: Array<{ name: string, ok: boolean, problems: string[] }> }}
 */
export function runChecks({ root, files, exec }) {
  const results = [];
  const record = (name, problems) => results.push({ name, ok: problems.length === 0, problems });
  const command = (args, name, fix) => {
    const ok = exec(args) === 0;
    record(name, ok ? [] : [`${name} failed (its output is above) → fix: ${fix}`]);
    return ok;
  };

  const scope = checkScope(files);
  record(`one extension folder per pull request${scope.extensions.length === 1 ? ` (extensions/${scope.extensions[0]}/)` : ""}`, scope.problems);

  for (const id of scope.extensions) {
    const folder = path.join(root, "extensions", id);
    if (!fs.existsSync(path.join(folder, "manifest.json"))) continue; // removed by the pull request: nothing to build
    const source = path.join(folder, "src");
    const unreadable = fs.existsSync(source)
      ? listFiles(source).flatMap((file) => readabilityProblems(`extensions/${id}/src/${file}`, fs.readFileSync(path.join(source, file), "utf8")))
      : [];
    record(`readable source in extensions/${id}/src/`, unreadable);

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
