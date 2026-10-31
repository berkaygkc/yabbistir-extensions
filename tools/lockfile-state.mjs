#!/usr/bin/env node
// node tools/lockfile-state.mjs [--root <dir>]
//
// Checks what npm would install from the repository at <dir>, as it is, before anything is installed. The publish job
// runs it before npm ci, so a lockfile that slipped past a pull request's checks stops the publish; the pull request
// checks run it too. It uses Node's built-in modules only and imports nothing of the repository, so no installed
// package can change its answer.
//
//   - Every entry of package-lock.json that npm downloads is that package's own tarball on the npm registry,
//     https://registry.npmjs.org/<name>/-/<name without scope>-<version>.tgz, with a sha512 integrity: npm checks the
//     download against the integrity, and the address ties both to the package's name and version. The name is the
//     entry's folder after node_modules/, or for an npm: alias the target the alias names. Bundled entries, which come
//     inside another package's tarball, are refused as well.
//   - Links and workspace entries point at workspace folders: extensions/<id> or packages/<name>.
//   - There is no npm-shrinkwrap.json and no .npmrc at the root: npm would read them instead of, or on top of, the
//     lockfile and its defaults.
//   - No node_modules is committed under extensions/, and no two paths there differ only in letter case (a
//     case-insensitive disk would keep one of them, so the file reviewed and the file built could differ).
//
// Exits with 1 and one line per problem when any of these fails.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY = "https://registry.npmjs.org/";
const WORKSPACE_FOLDER = /^(?:extensions|packages)\/[^/]+$/;
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;
const DEPENDENCY_KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

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

/** The npm: aliases in a lockfile: location → the package the alias names. */
function aliasTargets(packages) {
  const targets = new Map();
  for (const [location, entry] of Object.entries(packages)) {
    for (const kind of DEPENDENCY_KINDS) {
      for (const [name, spec] of Object.entries(entry?.[kind] ?? {})) {
        if (typeof spec !== "string" || !spec.startsWith("npm:")) continue;
        const rest = spec.slice("npm:".length);
        const at = rest.indexOf("@", 1);
        const found = resolveIn(packages, location, name);
        if (found !== undefined) targets.set(found, at === -1 ? rest : rest.slice(0, at));
      }
    }
  }
  return targets;
}

/**
 * Why each entry of a lockfile's `packages` may not be installed, by location; entries that may are left out.
 * @returns {Map<string, string>}
 */
export function entryProblems(packages) {
  const problems = new Map();
  const aliases = aliasTargets(packages);
  for (const [location, entry] of Object.entries(packages)) {
    if (location === "") continue;
    const record = entry !== null && typeof entry === "object" ? entry : {};
    if (isWorkspace(location)) {
      if (!WORKSPACE_FOLDER.test(location)) problems.set(location, "is not a workspace folder (extensions/<id> or packages/<name>)");
      continue;
    }
    if (record.link === true) {
      if (typeof record.resolved !== "string" || !WORKSPACE_FOLDER.test(record.resolved)) problems.set(location, "links somewhere other than a workspace folder");
      continue;
    }
    const folder = folderOf(location);
    const alias = aliases.get(location);
    if (alias !== undefined && record.name !== alias) {
      problems.set(location, `is an npm: alias for ${alias}, but its entry names ${record.name ?? folder}`);
      continue;
    }
    if (record.name !== undefined && record.name !== folder && alias === undefined) {
      problems.set(location, `names ${record.name}, which no npm: alias asks for in ${folder}'s place`);
      continue;
    }
    const name = record.name ?? folder;
    if (!PACKAGE_NAME.test(name) || typeof record.version !== "string" || !VERSION.test(record.version)) {
      problems.set(location, "has no package name and version npm could have written");
      continue;
    }
    const expected = registryTarball(name, record.version);
    if (record.resolved !== expected) {
      problems.set(location, `does not come from its own tarball on the npm registry, ${expected}`);
      continue;
    }
    if (typeof record.integrity !== "string" || !SHA512.test(record.integrity)) problems.set(location, "has no sha512 integrity hash");
  }
  return problems;
}

/** The files git tracks under `root`, or every file found on disk when `root` is not a git checkout. */
function filesOf(root) {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status === 0) return result.stdout.split("\0").filter(Boolean);
  const found = [];
  const walk = (relative) => {
    for (const name of fs.readdirSync(path.join(root, relative))) {
      const inner = relative === "" ? name : `${relative}/${name}`;
      if (inner === ".git") continue;
      if (fs.lstatSync(path.join(root, inner)).isDirectory()) walk(inner);
      else found.push(inner);
    }
  };
  if (fs.existsSync(path.join(root, "extensions"))) walk("extensions");
  return found;
}

/** Paths under extensions/ (folders included) that another one there equals but for letter case. */
export function caseCollisions(files) {
  const spellings = new Map();
  for (const file of files.filter((name) => name.startsWith("extensions/"))) {
    const parts = file.split("/");
    for (let end = 2; end <= parts.length; end++) {
      const spelled = parts.slice(0, end).join("/");
      const key = spelled.toLowerCase();
      if (!spellings.has(key)) spellings.set(key, new Set());
      spellings.get(key).add(spelled);
    }
  }
  return [...spellings.values()].filter((set) => set.size > 1).map((set) => [...set].sort());
}

const list = (items) => items.slice(0, 8).join(", ") + (items.length > 8 ? ` and ${items.length - 8} more` : "");

/** Every problem with the install state of the repository at `root`, one line each; `files` (default: what git tracks) are its files. */
export function stateProblems(root, { files: given } = {}) {
  const problems = [];
  for (const file of ["npm-shrinkwrap.json", ".npmrc"]) {
    if (fs.existsSync(path.join(root, file))) {
      problems.push(`${file}: npm would read it ${file === ".npmrc" ? "on top of its defaults" : "instead of package-lock.json"} → fix: Remove it; the store installs from package-lock.json with npm's defaults.`);
    }
  }
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  } catch {
    problems.push("package-lock.json: it is missing or is not JSON → fix: Run npm install and commit the lockfile it writes.");
  }
  if (lock !== undefined) {
    const packages = lock !== null && typeof lock === "object" && lock.packages !== null && typeof lock.packages === "object" ? lock.packages : undefined;
    if (packages === undefined) problems.push("package-lock.json: it has no \"packages\" → fix: Run npm install with npm 7 or later and commit the lockfile it writes.");
    else {
      for (const [location, reason] of entryProblems(packages)) {
        problems.push(`package-lock.json: ${location}: it ${reason} → fix: Install the library from the npm registry by version (npm install <library>@<version>), and never edit the lockfile by hand.`);
      }
    }
  }
  const files = given ?? filesOf(root);
  const vendored = files.filter((file) => /^extensions\/[^/]+\/(?:.*\/)?node_modules(?:\/|$)/.test(file));
  if (vendored.length > 0) {
    problems.push(`${list(vendored)}: node_modules is committed under extensions/ → fix: Remove it (git rm -r --cached) and list the library in the extension's package.json.`);
  }
  for (const spellings of caseCollisions(files)) {
    problems.push(`${spellings.join(" and ")}: these differ only in letter case, and a case-insensitive disk keeps one of them → fix: Rename one, or remove one.`);
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
  const problems = stateProblems(root);
  for (const problem of problems) console.log(problem);
  console.log(problems.length === 0 ? "lockfile state: ok" : `lockfile state: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  return problems.length === 0 ? 0 : 1;
}

// A command when run, a module when imported (by tools/lib/static-rules.mjs).
const invoked = process.argv[1] !== undefined && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = main(process.argv.slice(2));
