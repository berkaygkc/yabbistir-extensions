#!/usr/bin/env node
// node tools/lockfile-state.mjs [--root <dir>]
//
// Checks what npm would install from the repository at <dir>, as it is on disk, before anything is installed. The
// publish job runs it before npm ci, so a lockfile that slipped past a pull request's checks stops the publish; the
// static checks (tools/static-checks.mjs) apply the same rules to a pull request's commit, read through git. It uses
// Node's built-in modules only and imports nothing of the repository, so no installed package can change its answer.
//
//   - Every entry of package-lock.json that npm downloads is that package's own tarball on the npm registry,
//     https://registry.npmjs.org/<name>/-/<name without scope>-<version>.tgz, with a sha512 integrity: npm checks the
//     download against the integrity, and the address ties both to the package's name and version. The name is the
//     entry's folder after node_modules/: an entry that names another package (an npm: alias) is refused, and so is an
//     npm: spec in any package.json or in the lockfile's root and workspace entries. No two packages share one
//     integrity. Bundled entries, which come inside another package's tarball, are refused as well.
//   - Workspace entries are extensions/<id> or packages/<name>, and a link entry is node_modules/<name> pointing at the
//     workspace whose package is called <name>. An extension's package is named after its id, so no workspace can
//     stand in for a library.
//   - The root entry and every workspace entry ask for exactly the dependencies their package.json asks for, and every
//     workspace package.json has its entry.
//   - There is no npm-shrinkwrap.json and no .npmrc at the root: npm would read them instead of, or on top of, the
//     lockfile and its defaults. package.json and package-lock.json are regular files, reached through no link, and
//     nothing the repository tracks is a symbolic link or a submodule: a link can show a check one file and npm or the
//     build another.
//   - No node_modules is committed under extensions/, at any depth, and no two paths there differ only in letter case
//     or Unicode normalization (a Mac's disk keeps one of them, so the file reviewed and the file built could differ).
//
// Exits with 1 and one line per problem when any of these fails.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY = "https://registry.npmjs.org/";
/** A workspace folder: extensions/<id> (an extension id) or packages/<name>. */
const WORKSPACE_FOLDER = /^(?:extensions\/[a-z0-9]+(?:\.[a-z0-9-]+)+|packages\/[a-z0-9][a-z0-9._-]*)$/;
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;
const DEPENDENCY_KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const MAX_BUFFER = 64 * 1024 * 1024;

/** A lockfile location that is a workspace (or the root) rather than something in node_modules. */
export const isWorkspace = (location) => location !== "" && !location.split("/").includes("node_modules");

/** Where npm finds `name` for the package at `from` in a lockfile's `packages`: the nearest node_modules up the path. */
export function resolveIn(packages, from, name) {
  const parts = from === "" ? [] : from.split("/");
  for (let end = parts.length; end >= 0; end--) {
    if (end > 0 && parts[end - 1] === "node_modules") continue;
    const prefix = parts.slice(0, end).join("/");
    const candidate = prefix === "" ? `node_modules/${name}` : `${prefix}/node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
  }
  return undefined;
}

/** The registry address of `name`@`version`'s tarball, as npm writes it in a lockfile. */
export function registryTarball(name, version) {
  const file = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `${REGISTRY}${name}/-/${file}-${version}.tgz`;
}

/** The folder name of a node_modules location: what code requires it by. */
const folderOf = (location) => location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
/** Whether a relative path has an empty, "." or ".." part, which could lead somewhere else than it seems to. */
const wanders = (relative) => relative.split("/").some((part) => part === "" || part === "." || part === "..");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
/** JSON with sorted keys, so two values compare by content. */
const canonical = (value) => JSON.stringify(value, (key, inner) =>
  isObject(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : inner);
/** A dependency map as npm writes it into a lockfile entry: an empty or missing one is left out. */
const dependencyMap = (value) => (isObject(value) && Object.keys(value).length > 0 ? value : null);
/** The npm: specs among the dependencies of a lockfile entry or a package.json, as "<kind>.<name>". */
const aliasSpecs = (record) => DEPENDENCY_KINDS.flatMap((kind) => Object.entries(isObject(record?.[kind]) ? record[kind] : {})
  .filter(([, spec]) => typeof spec === "string" && /^\s*npm:/i.test(spec)).map(([name]) => `${kind}.${name}`));
/** Text with control characters shown as \u escapes, so a path cannot start a line of its own in a log. */
export const printable = (text) => String(text).replace(/[\u0000-\u001f\u007f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * Why each entry of a lockfile's `packages` may not be installed, by location; entries that may are left out.
 * @returns {Map<string, string>}
 */
export function entryProblems(packages) {
  const problems = new Map();
  const hashes = new Map(); // integrity → (name@version → its locations)
  for (const [location, entry] of Object.entries(packages)) {
    const record = isObject(entry) ? entry : {};
    if (location === "") {
      const aliases = aliasSpecs(record);
      if (aliases.length > 0) problems.set(location, `asks for npm: aliases (${aliases.join(", ")}), which install another package under a library's name`);
      continue;
    }
    if (wanders(location)) {
      problems.set(location, "has an empty, \".\" or \"..\" part in its path");
      continue;
    }
    if (isWorkspace(location)) {
      const folder = location.slice(location.indexOf("/") + 1);
      const aliases = aliasSpecs(record);
      if (!WORKSPACE_FOLDER.test(location)) problems.set(location, "is not a workspace folder (extensions/<id> or packages/<name>)");
      else if (location.startsWith("extensions/") && record.name !== undefined && record.name !== folder) {
        problems.set(location, `names its package ${record.name}, but an extension's package is named after its id, ${folder}`);
      } else if (aliases.length > 0) problems.set(location, `asks for npm: aliases (${aliases.join(", ")}), which install another package under a library's name`);
      continue;
    }
    if (record.inBundle === true) {
      problems.set(location, "comes bundled inside another package (inBundle), so no address of its own can be checked");
      continue;
    }
    const folder = folderOf(location);
    if (record.name !== undefined && record.name !== folder) {
      problems.set(location, `installs ${record.name} under the name ${folder}: an alias, which the store refuses`);
      continue;
    }
    if (record.link === true) {
      const target = record.resolved;
      if (typeof target !== "string" || !WORKSPACE_FOLDER.test(target) || !isObject(packages[target])) {
        problems.set(location, "links somewhere other than a workspace folder");
        continue;
      }
      // An extension's package is named after its id; a package of packages/ by its entry.
      const own = target.slice(target.indexOf("/") + 1);
      const name = target.startsWith("extensions/") ? own : packages[target].name ?? own;
      if (location !== `node_modules/${name}`) problems.set(location, `links ${target} under another name than its package's, ${name}`);
      continue;
    }
    if (!PACKAGE_NAME.test(folder) || typeof record.version !== "string" || !VERSION.test(record.version)) {
      problems.set(location, "has no package name and version npm could have written");
      continue;
    }
    const expected = registryTarball(folder, record.version);
    if (record.resolved !== expected) {
      problems.set(location, `does not come from its own tarball on the npm registry, ${expected}`);
      continue;
    }
    if (typeof record.integrity !== "string" || !SHA512.test(record.integrity)) {
      problems.set(location, "has no sha512 integrity hash");
      continue;
    }
    if (!hashes.has(record.integrity)) hashes.set(record.integrity, new Map());
    const owners = hashes.get(record.integrity);
    const id = `${folder}@${record.version}`;
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id).push(location);
  }
  // npm takes a package it has cached by its integrity alone, whatever the address: one hash may stand for one package.
  for (const owners of hashes.values()) {
    if (owners.size < 2) continue;
    for (const [id, locations] of owners) {
      const others = [...owners.keys()].filter((other) => other !== id).join(", ");
      for (const location of locations) problems.set(location, `has the same integrity hash as ${others}: one hash cannot stand for two packages`);
    }
  }
  return problems;
}

const kindOfMode = (mode) => (mode === "100644" || mode === "100755" ? "file" : mode === "120000" ? "link" : "other");

/**
 * A repository's files as npm and the build find them on disk under `root`. `entries` are the files git tracks there,
 * each a "file", a "link" or "other" (a submodule); outside git, every file found under extensions/; with `files`,
 * those paths, taken for regular files. `kind(file)` looks at the disk itself, following no link, in the file's folders
 * either; `read(file)` gives a regular file's text, and null for anything else.
 */
export function diskTree(root, { files } = {}) {
  const kind = (file) => {
    if (wanders(file)) return null;
    let at = root;
    const parts = file.split("/");
    for (let index = 0; index < parts.length; index++) {
      at = path.join(at, parts[index]);
      const stat = fs.lstatSync(at, { throwIfNoEntry: false });
      if (stat === undefined) return null;
      if (stat.isSymbolicLink()) return "link";
      if (index === parts.length - 1) return stat.isFile() ? "file" : "other";
      if (!stat.isDirectory()) return null;
    }
    return null;
  };
  let entries;
  if (files !== undefined) entries = files.map((file) => ({ path: file, kind: "file" }));
  else {
    const listed = spawnSync("git", ["ls-files", "-s", "-z"], { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER });
    if (listed.status === 0) {
      entries = listed.stdout.split("\0").filter(Boolean)
        .map((line) => ({ path: line.slice(line.indexOf("\t") + 1), kind: kindOfMode(line.slice(0, line.indexOf(" "))) }));
    } else {
      entries = [];
      const walk = (relative) => {
        for (const name of fs.readdirSync(path.join(root, relative))) {
          const inner = `${relative}/${name}`;
          const stat = fs.lstatSync(path.join(root, inner));
          if (stat.isDirectory()) walk(inner);
          else entries.push({ path: inner, kind: stat.isSymbolicLink() ? "link" : stat.isFile() ? "file" : "other" });
        }
      };
      if (fs.lstatSync(path.join(root, "extensions"), { throwIfNoEntry: false })?.isDirectory()) walk("extensions");
    }
  }
  return { entries, kind, read: (file) => (kind(file) === "file" ? fs.readFileSync(path.join(root, file), "utf8") : null) };
}

/**
 * A commit's files, read through git in the repository at `root` (git ls-tree and git cat-file): nothing on disk is
 * read, so no link or file in a checkout can change what is seen. The same shape as diskTree.
 */
export function commitTree(root, commit) {
  if (typeof commit !== "string" || commit === "" || commit.startsWith("-")) throw new Error(`not a commit: ${commit}`);
  const listed = spawnSync("git", ["ls-tree", "-r", "-z", "--full-tree", commit], { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER });
  if (listed.status !== 0) throw new Error(`git ls-tree ${commit} failed: ${(listed.stderr || listed.error?.message || "").trim()}`);
  const blobs = new Map();
  for (const line of listed.stdout.split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t");
    const [mode, , object] = line.slice(0, tab).split(" ");
    blobs.set(line.slice(tab + 1), { kind: kindOfMode(mode), object });
  }
  return {
    entries: [...blobs].map(([file, blob]) => ({ path: file, kind: blob.kind })),
    kind: (file) => blobs.get(file)?.kind ?? null,
    read: (file) => {
      const blob = blobs.get(file);
      if (blob?.kind !== "file") return null;
      const shown = spawnSync("git", ["cat-file", "blob", blob.object], { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER });
      if (shown.status !== 0) throw new Error(`git cat-file blob ${blob.object} (${file}) failed: ${(shown.stderr || shown.error?.message || "").trim()}`);
      return shown.stdout;
    },
  };
}

/** Paths under extensions/ (folders included) that another one there equals but for letter case or Unicode normalization. */
export function caseCollisions(files) {
  const spellings = new Map();
  for (const file of files.filter((name) => name.startsWith("extensions/"))) {
    const parts = file.split("/");
    for (let end = 2; end <= parts.length; end++) {
      const spelled = parts.slice(0, end).join("/");
      const key = spelled.normalize("NFC").toLowerCase().normalize("NFC");
      if (!spellings.has(key)) spellings.set(key, new Set());
      spellings.get(key).add(spelled);
    }
  }
  return [...spellings.values()].filter((set) => set.size > 1).map((set) => [...set].sort());
}

const list = (items) => items.slice(0, 8).join(", ") + (items.length > 8 ? ` and ${items.length - 8} more` : "");
const INSTALL_FIX = "Run npm install and commit the package.json and package-lock.json it leaves; never edit the lockfile by hand.";
const ENTRY_FIX = "List the library in the extension's package.json by its own name, at an exact version, and run npm install at the repository's root; never edit the lockfile by hand.";
/** The fix for an alias: also the case of a library whose own dependencies npm installs under an alias. */
export const ALIAS_FIX = "Depend on every library by its own name. Some libraries bring a dependency npm installs under an alias (glob@10 brings string-width-cjs, for example), and the store refuses those too: pick another library, or ask the maintainer.";
/** Whether a reason entryProblems gives is about an alias. */
export const isAlias = (reason) => /\balias/.test(reason);
const LINK_FIX = "Commit the file itself; npm would read wherever the link points.";

/** The root's and each workspace's package.json against their lockfile entries: the same dependencies, the same names, no npm: aliases. */
function manifestProblems(tree, packages) {
  const problems = [];
  const folders = new Set([""]);
  for (const location of Object.keys(packages)) if (isWorkspace(location) && WORKSPACE_FOLDER.test(location)) folders.add(location);
  for (const { path: file } of tree.entries) {
    const match = /^((?:extensions|packages)\/[^/]+)\/package\.json$/.exec(file);
    if (match && !wanders(match[1])) folders.add(match[1]);
  }
  for (const folder of [...folders].sort()) {
    const file = folder === "" ? "package.json" : `${folder}/package.json`;
    const entry = packages[folder];
    if (folder !== "" && !isObject(entry)) {
      problems.push(`${file}: package-lock.json has no entry for ${folder}, so what npm installs for it was never written down → fix: ${INSTALL_FIX}`);
      continue;
    }
    const text = tree.read(file);
    if (text === null) {
      problems.push(tree.kind(file) === null
        ? `${file}: it is missing, but package-lock.json has an entry for ${folder === "" ? "the root" : folder} → fix: ${INSTALL_FIX}`
        : `${file}: it is a symbolic link or not a regular file → fix: ${LINK_FIX}`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      manifest = undefined;
    }
    if (!isObject(manifest)) {
      problems.push(`${file}: it is not a JSON object → fix: Write it as npm does.`);
      continue;
    }
    for (const alias of aliasSpecs(manifest)) {
      problems.push(`${file}: ${alias}: an npm: alias installs another package under this name, which the store refuses → fix: Depend on the library by its own name.`);
    }
    const differing = DEPENDENCY_KINDS.filter((kind) => canonical(dependencyMap(manifest[kind])) !== canonical(dependencyMap(entry?.[kind])));
    if (folder === "" && canonical(manifest.workspaces ?? null) !== canonical(entry?.workspaces ?? null)) differing.push("workspaces");
    if (differing.length > 0) {
      problems.push(`${file}: its ${differing.join(", ")} differ from package-lock.json's entry for ${folder === "" ? "the root" : folder}, and npm ci installs what the lockfile says → fix: ${INSTALL_FIX}`);
    }
    if (folder === "") continue;
    const base = folder.slice(folder.indexOf("/") + 1);
    if (folder.startsWith("extensions/") && manifest.name !== base) {
      problems.push(`${file}: its name is ${JSON.stringify(manifest.name)}, not the extension's id → fix: Name the package after the extension: { "name": "${base}", "private": true }.`);
    }
    const name = typeof manifest.name === "string" ? manifest.name : base;
    const locked = entry.name ?? base;
    if (locked !== name) problems.push(`${file}: it is named ${name}, but package-lock.json names it ${locked} → fix: ${INSTALL_FIX}`);
  }
  return problems;
}

/**
 * Every problem with the install state of a repository, one line each. Every line starts with fixed text (a file name
 * of the repository's own, or words), never with a path a pull request chose: a log line that starts with "::" is a
 * workflow command. `tree` is diskTree(root) or commitTree(root,
 * commit); a path stands for diskTree(path, options).
 */
export function stateProblems(tree, options) {
  if (typeof tree === "string") tree = diskTree(tree, options);
  const problems = [];
  const odd = tree.entries.filter((entry) => entry.kind !== "file").map((entry) => entry.path);
  if (odd.length > 0) {
    problems.push(`symbolic links or submodules, not regular files: ${list(odd)} → fix: Commit regular files only; a link can show a check one file and npm or the build another.`);
  }
  for (const file of ["npm-shrinkwrap.json", ".npmrc"]) {
    if (tree.kind(file) !== null) {
      problems.push(`${file}: npm would read it ${file === ".npmrc" ? "on top of its defaults" : "instead of package-lock.json"} → fix: Remove it; the store installs from package-lock.json with npm's defaults.`);
    }
  }
  let packages;
  const lockKind = tree.kind("package-lock.json");
  if (lockKind === null) problems.push(`package-lock.json: it is missing → fix: ${INSTALL_FIX}`);
  else if (lockKind !== "file") problems.push(`package-lock.json: it is a symbolic link or not a regular file → fix: ${LINK_FIX}`);
  else {
    let lock;
    try {
      lock = JSON.parse(tree.read("package-lock.json"));
    } catch {
      problems.push(`package-lock.json: it is not JSON → fix: ${INSTALL_FIX}`);
    }
    if (lock !== undefined) {
      if (isObject(lock) && isObject(lock.packages)) packages = lock.packages;
      else problems.push("package-lock.json: it has no \"packages\" → fix: Run npm install with npm 7 or later and commit the lockfile it writes.");
    }
  }
  if (packages !== undefined) {
    for (const [location, reason] of entryProblems(packages)) {
      problems.push(`package-lock.json: ${location === "" ? "the root entry" : location}: it ${reason} → fix: ${isAlias(reason) ? ALIAS_FIX : ENTRY_FIX}`);
    }
    problems.push(...manifestProblems(tree, packages));
  }
  const files = tree.entries.map((entry) => entry.path);
  const vendored = files.filter((file) => /^extensions\/(?:.*\/)?node_modules(?:\/|$)/i.test(file));
  if (vendored.length > 0) {
    problems.push(`node_modules committed under extensions/: ${list(vendored)} → fix: Remove it (git rm -r --cached) and list the library in the extension's package.json.`);
  }
  for (const spellings of caseCollisions(files)) {
    problems.push(`paths that differ only in letter case or Unicode normalization: ${spellings.join(" and ")} → fix: Rename one, or remove one; a Mac's disk keeps only one of them.`);
  }
  return problems;
}

function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--root") root = path.resolve(argv[++index] ?? ".");
    else {
      console.log("Usage: node tools/lockfile-state.mjs [--root <dir>]");
      return 2;
    }
  }
  const problems = stateProblems(diskTree(root));
  for (const problem of problems) console.log(printable(problem));
  console.log(problems.length === 0 ? "lockfile state: ok" : `lockfile state: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  return problems.length === 0 ? 0 : 1;
}

// A command when run, a module when imported (by tools/lib/static-rules.mjs).
const invoked = process.argv[1] !== undefined && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = main(process.argv.slice(2));
