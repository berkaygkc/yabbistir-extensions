// The rules a pull request is checked by (docs/publishing.md, "The checks"), and the run that applies them.
//
// .github/workflows/pr-label.yml carries copies of permissionChanges and authorToMention: it runs with a write token
// and never checks out the pull request, so it cannot import them. tools/test/pr-checks.test.mjs keeps the copies
// identical to the functions here, so both must stay self-contained.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bundledInputs } from "./build.mjs";
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

/** Reads a file as it was where the branch left `base` (the merge base); null when it did not exist there. */
export function baseReader(root, base) {
  const mergeBase = spawnSync("git", ["merge-base", base, "HEAD"], { cwd: root, encoding: "utf8" });
  if (mergeBase.status !== 0) throw new Error(`git merge-base ${base} HEAD failed: ${mergeBase.stderr.trim()}`);
  const commit = mergeBase.stdout.trim();
  return (file) => {
    const shown = spawnSync("git", ["show", `${commit}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return shown.status === 0 ? shown.stdout : null;
  };
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

/** package.json fields that make npm run or link something when it installs: an extension's package.json is data only. */
const RUNNING_FIELDS = ["bin", "scripts", "directories", "gypfile"];

/** Whether extensions/<id>/package.json (its `text`) only names libraries: no programs, scripts or native builds. */
export function packageProblems(id, text) {
  const file = `extensions/${id}/package.json`;
  let manifest;
  try {
    manifest = JSON.parse(String(text).replace(/^\uFEFF/, ""));
  } catch {
    return [`${file}: it is not valid JSON → fix: Make it a JSON object, as npm writes it.`];
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return [`${file}: it is not valid JSON → fix: Make it a JSON object, as npm writes it.`];
  return RUNNING_FIELDS.filter((field) => Object.hasOwn(manifest, field)).map((field) =>
    `${file}: "${field}" would make npm run or link something at install → fix: Remove "${field}"; an extension's package.json only lists the libraries the build bundles.`);
}

/** JSON with sorted keys, so two lockfiles compare by content. */
const canonical = (value) => JSON.stringify(value, (key, inner) =>
  inner !== null && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : inner);

/** Where npm finds `name` for the package at `from` in a lockfile's `packages`: the nearest node_modules up the path. */
function resolveIn(packages, from, name) {
  const parts = from === "" ? [] : from.split("/");
  for (let end = parts.length; end >= 0; end--) {
    if (end > 0 && parts[end - 1] === "node_modules") continue;
    const prefix = parts.slice(0, end).join("/");
    const candidate = prefix === "" ? `node_modules/${name}` : `${prefix}/node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
  }
  return undefined;
}

/** Every lockfile location reachable from `starts`: their dependencies of every kind, links followed. */
function lockTree(packages, starts) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length > 0) {
    const location = queue.shift();
    if (seen.has(location) || !Object.hasOwn(packages, location)) continue;
    seen.add(location);
    const entry = packages[location] ?? {};
    if (entry.link === true && typeof entry.resolved === "string") {
      queue.push(entry.resolved);
      continue;
    }
    const names = Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies, ...entry.devDependencies });
    for (const name of names) {
      const found = resolveIn(packages, location, name);
      if (found !== undefined) queue.push(found);
    }
  }
  return seen;
}

/** The lockfile locations that belong to extension `id` alone: its tree, minus what the root or another workspace reaches. */
function ownLocations(packages, id) {
  const own = `extensions/${id}`;
  const isWorkspace = (location) => location !== "" && !location.split("/").includes("node_modules");
  const links = (target) => Object.keys(packages).filter((location) => packages[location]?.link === true && packages[location].resolved === target);
  const mine = lockTree(packages, [own, ...links(own)]);
  const others = lockTree(packages, ["", ...Object.keys(packages).filter((location) => isWorkspace(location) && location !== own)]);
  return new Set([...mine].filter((location) => !others.has(location)));
}

/**
 * How a pull request that changes extension `id` changes package-lock.json (base and head texts; null: no file)
 * beyond that extension's own libraries. The tools' packages (the root's devDependencies, with their platform builds),
 * other workspaces' packages, packages shared with them, the root entry and the file's own fields must stay as they
 * are; and a library of the extension may not have an install script or a command-line program.
 */
export function lockfileProblems(baseText, headText, id) {
  const parse = (text) => {
    if (text === null || text === undefined) return {};
    try {
      const value = JSON.parse(String(text));
      return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const base = parse(baseText);
  const head = parse(headText);
  if (base === undefined || head === undefined) return ["package-lock.json: it is not valid JSON → fix: Run npm install and commit the lockfile it writes."];
  const fix = `Change only the extension's own libraries (npm install <library> -w extensions/${id}), and leave the tools' packages as they are.`;
  const list = (items) => items.slice(0, 6).join(", ") + (items.length > 6 ? ` and ${items.length - 6} more` : "");
  const problems = [];

  const fields = [...new Set([...Object.keys(base), ...Object.keys(head)])].filter((key) => key !== "packages" && canonical(base[key]) !== canonical(head[key]));
  if (fields.length > 0) problems.push(`package-lock.json: it changes ${list(fields.map((key) => `"${key}"`))} → fix: ${fix}`);

  const before = base.packages ?? {};
  const after = head.packages ?? {};
  const mineBefore = ownLocations(before, id);
  const mineAfter = ownLocations(after, id);
  const outside = [];
  const running = [];
  for (const location of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (canonical(before[location]) === canonical(after[location])) continue;
    const mine = (!Object.hasOwn(before, location) || mineBefore.has(location)) && (!Object.hasOwn(after, location) || mineAfter.has(location));
    if (!mine) outside.push(location === "" ? "the root entry" : location);
    else if (after[location]?.hasInstallScript === true || after[location]?.bin !== undefined) running.push(location);
  }
  if (outside.length > 0) problems.push(`package-lock.json: it changes ${list(outside)}, outside extensions/${id}'s own libraries → fix: ${fix}`);
  if (running.length > 0) {
    problems.push(`package-lock.json: ${list(running)} ${running.length === 1 ? "has" : "have"} an install script or a command-line program → fix: Use a plain JavaScript library: the build bundles it, and nothing of it should run when npm installs it.`);
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
 * `npm <args>` there and returns its exit status; `readBase(file)` gives a file's text where the branch started (null
 * when it did not exist); `inputsOf(id)` gives the extension's bundled files (bundledInputs). Every check runs, so
 * one push shows every problem.
 * @returns {Promise<{ ok: boolean, results: Array<{ name: string, ok: boolean, problems: string[] }> }>}
 */
export async function runChecks({ root, files, exec, readBase = () => null, inputsOf = (id) => bundledInputs(root, id) }) {
  const results = [];
  const record = (name, problems) => results.push({ name, ok: problems.length === 0, problems });
  const command = (args, name, fix) => {
    const ok = exec(args) === 0;
    record(name, ok ? [] : [`${name} failed (its output is above) → fix: ${fix}`]);
    return ok;
  };

  const scope = checkScope(files);
  record(`one extension folder per pull request${scope.extensions.length === 1 ? ` (extensions/${scope.extensions[0]}/)` : ""}`, scope.problems);

  const extensions = path.join(root, "extensions");
  const packages = (fs.existsSync(extensions) ? fs.readdirSync(extensions).sort() : []).flatMap((id) => {
    const folder = path.join(extensions, id);
    const problems = [];
    if (fs.existsSync(path.join(folder, "package.json"))) problems.push(...packageProblems(id, fs.readFileSync(path.join(folder, "package.json"), "utf8")));
    if (fs.existsSync(path.join(folder, "binding.gyp"))) {
      problems.push(`extensions/${id}/binding.gyp: npm would compile it at install → fix: Remove it; extensions are JavaScript the build bundles.`);
    }
    return problems;
  });
  record("no install scripts or programs in extensions/*/package.json", packages);

  if (scope.extensions.length === 1 && files.includes("package-lock.json")) {
    const lockfile = path.join(root, "package-lock.json");
    const head = fs.existsSync(lockfile) ? fs.readFileSync(lockfile, "utf8") : null;
    record(`package-lock.json changes only extensions/${scope.extensions[0]}/'s libraries`, lockfileProblems(readBase("package-lock.json"), head, scope.extensions[0]));
  }

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
