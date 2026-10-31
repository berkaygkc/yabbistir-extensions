// The rules a pull request is checked by that read files and git only: nothing installed, nothing of the pull request
// run. tools/static-checks.mjs applies them in the static job of .github/workflows/pr.yml, which takes this file from
// the base branch and reads the pull request as data, so no test or edit in the pull request can change its result;
// tools/lib/pr-checks.mjs applies them too, with the build and the tests. Node's built-in modules and
// tools/lockfile-state.mjs only: this file must run where nothing is installed.
//
// .github/workflows/pr-label.yml carries copies of permissionChanges and authorToMention: it runs with a write token
// and never checks out the pull request, so it cannot import them. tools/test/pr-checks.test.mjs keeps the copies
// identical to the functions here, so both must stay self-contained.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { entryProblems, isWorkspace, resolveIn, stateProblems } from "../lockfile-state.mjs";

/** What may change next to an extension's folder: the lockfile when it adds a library, and what npm run docs writes. */
export const ALLOWED_BESIDE_AN_EXTENSION = ["package-lock.json", "docs/manifest.md", "docs/api.md", "llms-full.txt"];

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

/** The files git tracks under extensions/, or undefined outside a git repository. */
export function trackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--", "extensions"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout.split("\0").filter(Boolean) : undefined;
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

/** package.json fields that make npm run or link something when it installs: an extension's package.json is data only. */
const RUNNING_FIELDS = ["bin", "scripts", "directories", "gypfile"];
const DEPENDENCY_KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*$/;
const TARBALL = /\.(?:tgz|tar|tar\.gz)$/i;

/** Whether a dependency spec names a registry version: a version, a range or a tag, or an npm: alias to one. */
function registrySpec(spec) {
  if (typeof spec !== "string") return false;
  if (TARBALL.test(spec)) return false;
  if (spec.startsWith("npm:")) {
    const rest = spec.slice("npm:".length);
    const at = rest.indexOf("@", 1);
    if (at === -1) return PACKAGE_NAME.test(rest);
    const range = rest.slice(at + 1);
    return PACKAGE_NAME.test(rest.slice(0, at)) && !range.startsWith("npm:") && registrySpec(range);
  }
  // No ":" (git:, file:, link:, http:, github:, workspace:), no "/" (paths, user/repo), no "#", no leading "." or "~/",
  // and no tarball name (npm reads "lib.tgz" as a file next to package.json).
  return /^[\w.^~<>=|*+\- ]*$/.test(spec) && !spec.startsWith(".") && !TARBALL.test(spec);
}

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
  const problems = RUNNING_FIELDS.filter((field) => Object.hasOwn(manifest, field)).map((field) =>
    `${file}: "${field}" would make npm run or link something at install → fix: Remove "${field}"; an extension's package.json only lists the libraries the build bundles.`);
  for (const field of ["bundleDependencies", "bundledDependencies"]) {
    if (Object.hasOwn(manifest, field)) problems.push(`${file}: "${field}" ships copies of libraries that skip the registry → fix: Remove "${field}".`);
  }
  for (const kind of DEPENDENCY_KINDS) {
    if (!Object.hasOwn(manifest, kind)) continue;
    const specs = manifest[kind];
    if (specs === null || typeof specs !== "object" || Array.isArray(specs)) {
      problems.push(`${file}: ${kind}: it is not an object of library names and versions → fix: Write it as npm does, { "<library>": "<version>" }.`);
      continue;
    }
    for (const [name, spec] of Object.entries(specs)) {
      if (registrySpec(spec)) continue;
      problems.push(`${file}: ${kind}.${name}: ${JSON.stringify(spec)} is not a version from the npm registry → fix: Depend on a library published on npm, by version or range: no git, file, link or URL dependencies.`);
    }
  }
  return problems;
}

/** JSON with sorted keys, so two lockfiles compare by content. */
const canonical = (value) => JSON.stringify(value, (key, inner) =>
  inner !== null && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : inner);

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
  const links = (target) => Object.keys(packages).filter((location) => packages[location]?.link === true && packages[location].resolved === target);
  const mine = lockTree(packages, [own, ...links(own)]);
  const others = lockTree(packages, ["", ...Object.keys(packages).filter((location) => isWorkspace(location) && location !== own)]);
  return new Set([...mine].filter((location) => !others.has(location)));
}

const parseObject = (text) => {
  if (text === null || text === undefined) return {};
  try {
    const value = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The lockfile locations a change to package.json files asks for: each owner (the root "" or a workspace folder) whose
 * package.json differs, and everything reachable from each dependency whose spec differs. `manifests` holds the
 * package.json texts by owner location, { base, head }.
 */
function askedFor(packages, manifests) {
  const owners = new Set([...Object.keys(manifests.base ?? {}), ...Object.keys(manifests.head ?? {})]);
  const asked = [];
  const starts = [];
  for (const owner of owners) {
    const before = parseObject(manifests.base?.[owner]) ?? {};
    const after = parseObject(manifests.head?.[owner]) ?? {};
    if (canonical(before) === canonical(after)) continue;
    asked.push(owner);
    for (const kind of DEPENDENCY_KINDS) {
      for (const name of new Set([...Object.keys(before[kind] ?? {}), ...Object.keys(after[kind] ?? {})])) {
        if (before[kind]?.[name] === after[kind]?.[name]) continue;
        const found = resolveIn(packages, owner, name);
        if (found !== undefined) starts.push(found);
      }
    }
  }
  return new Set([...asked, ...lockTree(packages, starts)]);
}

/**
 * The problems with a pull request's package-lock.json change (base and head texts; null: no file). Always: the file's
 * own fields stay, and every changed entry is its own package's registry tarball with a sha512 integrity, or a
 * workspace.
 * With `extension` (the one extension the pull request changes): only that extension's own libraries change (not the
 * tools' packages with their platform builds, not another workspace's, not one shared with them, not an entry nothing
 * needs), and none has an install script or a command-line program. Without: every change is one a package.json change
 * asks for (`manifests`: package.json texts by owner location, { base, head }).
 */
export function lockfileProblems(baseText, headText, { extension, manifests = { base: {}, head: {} } } = {}) {
  const base = parseObject(baseText);
  const head = parseObject(headText);
  if (base === undefined || head === undefined) return ["package-lock.json: it is not valid JSON → fix: Run npm install and commit the lockfile it writes."];
  const list = (items) => items.slice(0, 6).join(", ") + (items.length > 6 ? ` and ${items.length - 6} more` : "");
  const shown = (location) => (location === "" ? "the root entry" : location);
  const problems = [];

  const fields = [...new Set([...Object.keys(base), ...Object.keys(head)])].filter((key) => key !== "packages" && canonical(base[key]) !== canonical(head[key]));
  if (fields.length > 0) problems.push(`package-lock.json: it changes ${list(fields.map((key) => `"${key}"`))} → fix: Leave the file's own fields as npm wrote them.`);

  const before = base.packages ?? {};
  const after = head.packages ?? {};
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter((location) => canonical(before[location]) !== canonical(after[location]));

  // Each changed entry is its own package's tarball on the registry, with a sha512 integrity (tools/lockfile-state.mjs).
  const unfit = entryProblems(after);
  const elsewhere = changed.filter((location) => unfit.has(location));
  if (elsewhere.length > 0) {
    problems.push(`package-lock.json: not from the npm registry as npm writes it: ${list(elsewhere.map((location) => `${location} (it ${unfit.get(location)})`))} → fix: Use libraries published on npm, by version: no git, file, link or URL dependencies, and never edit the lockfile by hand.`);
  }

  if (extension !== undefined) {
    const mineBefore = ownLocations(before, extension);
    const mineAfter = ownLocations(after, extension);
    const outside = [];
    const running = [];
    for (const location of changed) {
      const mine = (!Object.hasOwn(before, location) || mineBefore.has(location)) && (!Object.hasOwn(after, location) || mineAfter.has(location));
      if (!mine) outside.push(shown(location));
      else if (after[location]?.hasInstallScript === true || after[location]?.bin !== undefined) running.push(location);
    }
    if (outside.length > 0) {
      problems.push(`package-lock.json: it changes ${list(outside)}, outside extensions/${extension}'s own libraries → fix: Change only the extension's own libraries (npm install <library> -w extensions/${extension}), and leave the tools' packages as they are.`);
    }
    if (running.length > 0) {
      problems.push(`package-lock.json: ${list(running)} ${running.length === 1 ? "has" : "have"} an install script or a command-line program → fix: Use a plain JavaScript library: the build bundles it, and nothing of it should run when npm installs it.`);
    }
    return problems;
  }

  const askedBefore = askedFor(before, manifests);
  const askedAfter = askedFor(after, manifests);
  const unasked = changed.filter((location) =>
    !((!Object.hasOwn(before, location) || askedBefore.has(location)) && (!Object.hasOwn(after, location) || askedAfter.has(location))));
  if (unasked.length > 0) {
    problems.push(`package-lock.json: lockfile changes without a package.json change: ${list(unasked.map(shown))} → fix: Change the dependency in package.json and run npm install; never edit the lockfile by hand.`);
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
 * Runs the static checks for a pull request that changes `files`, in the checkout at `root`: one extension folder;
 * extension package.json files; the install state (tools/lockfile-state.mjs); and, when package-lock.json changes, its
 * diff. `readBase(file)` gives a file's text where the branch started (null: it did not exist); `tracked()` the files
 * git tracks under extensions/ (undefined: those on disk).
 * @returns {{ ok: boolean, results: Array<{ name: string, ok: boolean, problems: string[] }>, scope: { extensions: string[] } }}
 */
export function runStaticChecks({ root, files, readBase = () => null, tracked = () => trackedFiles(root) }) {
  const results = [];
  const record = (name, problems) => results.push({ name, ok: problems.length === 0, problems });

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

  record("the install state: registry lockfile entries, no npm-shrinkwrap.json or .npmrc, no node_modules or case twins under extensions/",
    stateProblems(root, { files: tracked() }));

  // On every pull request that touches it: the macOS runner never installs the Linux packages, so only this sees them.
  if (files.includes("package-lock.json")) {
    const headText = (file) => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : null);
    const baseLock = readBase("package-lock.json");
    const headLock = headText("package-lock.json");
    const owners = new Set([""]);
    for (const text of [baseLock, headLock]) {
      try {
        for (const location of Object.keys(JSON.parse(text ?? "{}").packages ?? {})) if (isWorkspace(location)) owners.add(location);
      } catch {
        // lockfileProblems reports a lockfile that is not JSON.
      }
    }
    const manifests = { base: {}, head: {} };
    for (const owner of owners) {
      const file = owner === "" ? "package.json" : `${owner}/package.json`;
      manifests.base[owner] = readBase(file);
      manifests.head[owner] = headText(file);
    }
    const extension = scope.extensions.length === 1 ? scope.extensions[0] : undefined;
    record(extension === undefined
      ? "package-lock.json changes only what a package.json change asks for, all from the npm registry"
      : `package-lock.json changes only extensions/${extension}/'s libraries, all from the npm registry`,
    lockfileProblems(baseLock, headLock, { extension, manifests }));
  }
  return { ok: results.every((result) => result.ok), results, scope };
}
