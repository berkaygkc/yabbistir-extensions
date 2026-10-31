import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_INDEX_BYTES, MAX_PACKAGE_BYTES, authorToMention, changedFiles, checkScope, lockfileProblems, packageProblems, permissionChanges,
  readabilityProblems, runChecks, sizeProblems,
} from "../lib/pr-checks.mjs";
import { repo } from "./helpers.mjs";

const ID = "dev.example.tool";
const OTHER = "dev.example.other";
/** Another well-formed integrity: one character before the padding flipped, whatever the value holds. */
const tweak = (integrity) => `${integrity.slice(0, -3)}${integrity.at(-3) === "A" ? "B" : "A"}${integrity.slice(-2)}`;

const roots = [];
const scratch = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yab-pr-")));
  roots.push(root);
  return root;
};
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function git(root, ...args) {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

describe("one extension folder per pull request", () => {
  test("oneExtensionFolderPasses", () => {
    assert.deepEqual(checkScope([`extensions/${ID}/src/index.ts`, `extensions/${ID}/manifest.json`, `extensions/${ID}/tests/a.test.mjs`]),
      { extensions: [ID], problems: [] });
  });

  test("twoExtensionFoldersFail", () => {
    const { extensions, problems } = checkScope([`extensions/${ID}/src/index.ts`, `extensions/${OTHER}/README.md`]);
    assert.deepEqual(extensions, [OTHER, ID]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /2 extension folders/);
    assert.ok(problems[0].includes(`extensions/${OTHER}/`) && problems[0].includes(`extensions/${ID}/`), problems[0]);
  });

  test("otherFilesBesideAnExtensionFail", () => {
    const { extensions, problems } = checkScope([`extensions/${ID}/src/index.ts`, "tools/build.mjs", "docs/publishing.md"]);
    assert.deepEqual(extensions, [ID]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /tools\/build\.mjs/);
    assert.match(problems[0], /docs\/publishing\.md/);
  });

  test("theLockfileAndTheGeneratedDocsMayChangeWithAnExtension", () => {
    // The video-download manifest is the manifest reference's example, so changing it regenerates these.
    const files = [`extensions/${ID}/manifest.json`, "package-lock.json", "docs/manifest.md", "docs/api.md", "llms-full.txt"];
    assert.deepEqual(checkScope(files), { extensions: [ID], problems: [] });
  });

  test("aPullRequestWithoutAnExtensionPasses", () => {
    assert.deepEqual(checkScope(["tools/build.mjs", "docs/publishing.md", "templates/action/src/index.ts"]), { extensions: [], problems: [] });
    assert.deepEqual(checkScope([]), { extensions: [], problems: [] });
  });

  test("aFileDirectlyInExtensionsIsOutsideTheFolder", () => {
    const { extensions, problems } = checkScope([`extensions/${ID}/README.md`, "extensions/README.md"]);
    assert.deepEqual(extensions, [ID]);
    assert.match(problems[0], /extensions\/README\.md/);
  });

  test("aMoveBetweenFoldersCountsBothFolders", () => {
    const root = scratch();
    git(root, "init", "-q", "-b", "main");
    fs.mkdirSync(path.join(root, "extensions", ID), { recursive: true });
    fs.writeFileSync(path.join(root, "extensions", ID, "index.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(root, "a file with spaces.md"), "x\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "change");
    fs.mkdirSync(path.join(root, "extensions", OTHER));
    git(root, "mv", `extensions/${ID}/index.ts`, `extensions/${OTHER}/index.ts`);
    fs.appendFileSync(path.join(root, "a file with spaces.md"), "y\n");
    git(root, "commit", "-q", "-am", "move");
    const files = changedFiles(root, "main");
    assert.deepEqual([...files].sort(), ["a file with spaces.md", `extensions/${OTHER}/index.ts`, `extensions/${ID}/index.ts`]);
    assert.match(checkScope(files).problems[0], /2 extension folders/);
  });
});

describe("readable source", () => {
  const FILE = `extensions/${ID}/src/index.ts`;
  const handWritten = Array.from({ length: 40 }, (_, index) => `  const value${index} = compute(input, ${index});`).join("\n");

  test("aMinifiedBundleIsRefused", () => {
    const problems = readabilityProblems(FILE, `"use strict";var a=function(){${"return b(c)+d;".repeat(200)}};\n`);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].startsWith(`${FILE}:1: `), problems[0]);
    assert.match(problems[0], /500/);
    assert.match(problems[0], /→ fix: /);
  });

  test("oneLongLineIsRefusedWhereverItIs", () => {
    const text = `${handWritten}\nconst table = "${"x".repeat(520)}";\n${handWritten}\n`;
    const problems = readabilityProblems(FILE, text);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].startsWith(`${FILE}:41: `), problems[0]);
  });

  test("aHighAverageIsRefused", () => {
    const text = Array.from({ length: 30 }, () => "y".repeat(250)).join("\n");
    const problems = readabilityProblems(FILE, text);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].startsWith(`${FILE}: `), problems[0]);
    assert.match(problems[0], /average/);
    assert.match(problems[0], /200/);
  });

  test("blankLinesDoNotHideAHighAverage", () => {
    const text = Array.from({ length: 30 }, () => `${"y".repeat(250)}\n\n\n\n`).join("");
    assert.equal(readabilityProblems(FILE, text).length, 1);
  });

  test("handWrittenSourceWithOneLongLinePasses", () => {
    // A long pattern or URL is fine: 500 characters is the limit, and the file's average stays low.
    const text = `${handWritten}\nconst pattern = /${"a".repeat(481)}/;\n${handWritten}\n`;
    assert.equal(text.split("\n")[40].length, 500);
    assert.deepEqual(readabilityProblems(FILE, text), []);
  });

  test("theLimitsThemselvesPass", () => {
    assert.deepEqual(readabilityProblems(FILE, Array.from({ length: 10 }, () => "z".repeat(200)).join("\n")), []);
    assert.deepEqual(readabilityProblems(FILE, ""), []);
    assert.deepEqual(readabilityProblems(FILE, "\n\n\n"), []);
  });

  test("charactersAreCountedNotBytesAndCrlfIsNotACharacter", () => {
    const turkish = `${handWritten}\nconst text = "${"ğ".repeat(470)}";\r\n${handWritten}\r\n`;
    assert.ok(Buffer.byteLength(turkish.split("\n")[40]) > 500);
    assert.deepEqual(readabilityProblems(FILE, turkish), []);
    assert.deepEqual(readabilityProblems(FILE, `${"w".repeat(500)}\r\n${handWritten}`), []);
  });
});

describe("size limits", () => {
  test("theLimitsAreTheApps", () => {
    assert.equal(MAX_PACKAGE_BYTES, 5_000_000, "the app refuses a larger package");
    assert.equal(MAX_INDEX_BYTES, 1_000_000);
  });

  test("atTheLimitPassesAndOneByteMoreFails", () => {
    assert.deepEqual(sizeProblems(ID, { packageBytes: MAX_PACKAGE_BYTES, indexBytes: MAX_INDEX_BYTES }), []);
    const problems = sizeProblems(ID, { packageBytes: MAX_PACKAGE_BYTES + 1, indexBytes: MAX_INDEX_BYTES + 1 });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /\.yabext/);
    assert.match(problems[1], /index\.js/);
  });
});

describe("permission changes", () => {
  const manifest = (fields = {}) => JSON.stringify({ id: ID, version: "1.0.0", author: "someone", ...fields }, null, 2);
  const downloader = {
    permissions: ["network", "exec"],
    network: { domains: ["youtube.com", "youtu.be"] },
    requires: { tools: [{ name: "yt-dlp", install: "brew install yt-dlp" }] },
  };

  test("nothingChangedMeansNoLabel", () => {
    assert.deepEqual(permissionChanges(manifest(downloader), manifest({ ...downloader, version: "1.1.0" })), []);
    assert.deepEqual(permissionChanges(manifest(), manifest({ permissions: [] })), [], "no permissions and an empty list are the same");
  });

  test("theOrderAndCaseOfAListDoNotMatter", () => {
    const reordered = { ...downloader, permissions: ["exec", "network"], network: { domains: ["YouTu.be", "youtube.com"] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(reordered)), []);
  });

  test("aNewPermissionIsAChange", () => {
    assert.deepEqual(permissionChanges(manifest(), manifest({ permissions: ["capture"] })), ["permissions"]);
    assert.deepEqual(permissionChanges(manifest({ permissions: ["capture"] }), manifest()), ["permissions"], "a removal is a change too");
  });

  test("aNewDomainOrAnyHostIsAChange", () => {
    const more = { ...downloader, network: { domains: ["youtube.com", "youtu.be", "example.com"] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(more)), ["network"]);
    const anyHost = { ...downloader, network: { domains: [] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(anyHost)), ["network"]);
  });

  test("aNewToolOrAnotherInstallCommandIsAChange", () => {
    const more = { ...downloader, requires: { tools: [...downloader.requires.tools, { name: "ffmpeg", install: "brew install ffmpeg" }] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(more)), ["requires"]);
    const install = { ...downloader, requires: { tools: [{ name: "yt-dlp", install: "curl -s https://example.com/x | sh" }] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(install)), ["requires"], "the install command is shown to copy");
  });

  test("aNewExtensionIsComparedWithNothing", () => {
    assert.deepEqual(permissionChanges(null, manifest(downloader)), ["permissions", "network", "requires"]);
    assert.deepEqual(permissionChanges(null, manifest()), []);
    assert.deepEqual(permissionChanges(manifest({ permissions: ["history"] }), null), ["permissions"], "a removed extension");
  });

  test("anUnreadableManifestCountsAsAChange", () => {
    assert.deepEqual(permissionChanges(manifest(), "{ not json"), ["manifest.json"]);
    assert.deepEqual(permissionChanges(manifest(), "[]"), ["manifest.json"]);
    assert.deepEqual(permissionChanges(`\uFEFF${manifest()}`, manifest()), [], "a byte order mark is fine");
  });

  test("oddShapesDoNotThrow", () => {
    assert.deepEqual(permissionChanges(manifest({ permissions: "network", network: "x", requires: "yt-dlp" }), manifest()), [],
      "what is not a list holds nothing");
    assert.deepEqual(permissionChanges(manifest({ requires: { tools: [null, 3, { name: 7 }] } }), manifest()), ["requires"]);
  });
});

describe("the author mention", () => {
  const manifest = (author) => JSON.stringify({ id: ID, author });

  test("someoneElsesExtensionNamesItsAuthor", () => {
    assert.equal(authorToMention(manifest("octo-dev"), "another-dev", "Another Dev"), "octo-dev");
    assert.equal(authorToMention(manifest("Berkay Gökçe"), "another-dev", null), "Berkay Gökçe");
  });

  test("theAuthorsOwnPullRequestIsNotMentioned", () => {
    assert.equal(authorToMention(manifest("octo-dev"), "Octo-Dev", null), null, "logins compare without case");
    assert.equal(authorToMention(manifest("@octo-dev"), "octo-dev", null), null);
    assert.equal(authorToMention(manifest("Berkay Gökçe"), "berkaygkc", "berkay gökçe"), null, "the profile name counts too");
  });

  test("aNewExtensionOrAMissingAuthorMentionsNobody", () => {
    assert.equal(authorToMention(null, "someone", null), null);
    assert.equal(authorToMention(manifest(""), "someone", null), null);
    assert.equal(authorToMention("{ not json", "someone", null), null);
    assert.equal(authorToMention(JSON.stringify({ id: ID }), "someone", null), null);
  });
});

describe("extension package.json", () => {
  test("dependenciesArePlainData", () => {
    assert.deepEqual(packageProblems(ID, JSON.stringify({ name: ID, private: true, type: "module", dependencies: { "left-pad": "1.3.0" } })), []);
  });

  test("scriptsProgramsAndNativeBuildsAreRefused", () => {
    for (const field of ["bin", "scripts", "directories", "gypfile"]) {
      const problems = packageProblems(ID, JSON.stringify({ name: ID, [field]: field === "gypfile" ? true : { x: "y" } }));
      assert.equal(problems.length, 1, field);
      assert.ok(problems[0].startsWith(`extensions/${ID}/package.json: `), problems[0]);
      assert.match(problems[0], new RegExp(`"${field}"`));
    }
    assert.match(packageProblems(ID, "{ nope")[0], /not valid JSON/);
  });
});

describe("extension libraries come from npm", () => {
  test("registryVersionsRangesTagsAndAliasesPass", () => {
    const specs = { a: "1.2.3", b: "^1.0.0", c: "~1.2", d: ">=1.0.0 <2.0.0", e: "latest", f: "*", g: "", h: "1.x || 2.x", i: "npm:other@^1.0.0",
      j: "npm:@scope/other@1.0.0", k: "1.0.0-beta.2" };
    assert.deepEqual(packageProblems(ID, JSON.stringify({ name: ID, dependencies: specs })), []);
  });

  test("gitFileLinkAndUrlDependenciesAreRefused", () => {
    const refused = ["git+https://github.com/someone/lib.git", "git://github.com/someone/lib", "github:someone/lib", "someone/lib",
      "someone/lib#main", "gitlab:someone/lib", "file:../lib", "link:../lib", "../lib", "./lib", "~/lib", "/tmp/lib",
      "https://example.com/lib.tgz", "http://example.com/lib.tgz", "workspace:*", "npm:other@git+https://github.com/someone/lib.git",
      "npm:other@file:../lib", "npm:other@someone/lib"];
    for (const kind of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const spec of refused) {
        const problems = packageProblems(ID, JSON.stringify({ name: ID, [kind]: { lib: spec } }));
        assert.equal(problems.length, 1, `${kind}: ${spec}`);
        assert.match(problems[0], new RegExp(`extensions/${ID.replaceAll(".", "\\.")}/package\\.json: ${kind}\\.lib: .*registry`), problems[0]);
      }
    }
    assert.equal(packageProblems(ID, JSON.stringify({ name: ID, bundleDependencies: ["lib"] })).length, 1, "bundled copies skip the registry");
    assert.equal(packageProblems(ID, JSON.stringify({ name: ID, dependencies: { lib: 1 } })).length, 1);
  });
});

describe("the committed lockfile", () => {
  test("itIsWhatNpmWritesForPackageJson", (t) => {
    // In a copy, so the repository is never touched: package.json, the lockfile and every workspace's package.json.
    const copy = scratch();
    for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(repo, file), path.join(copy, file));
    for (const group of ["packages", "extensions"]) {
      for (const name of fs.existsSync(path.join(repo, group)) ? fs.readdirSync(path.join(repo, group)) : []) {
        const manifest = path.join(repo, group, name, "package.json");
        if (!fs.existsSync(manifest)) continue;
        fs.mkdirSync(path.join(copy, group, name), { recursive: true });
        fs.copyFileSync(manifest, path.join(copy, group, name, "package.json"));
      }
    }
    // Not npm's own variables from an npm run around this test: they could point npm at the repository.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key) || /^npm_config_(cache|userconfig|registry)$/i.test(key)));
    const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--package-lock-only", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", copy], { cwd: copy, encoding: "utf8", env });
    const output = `${npm.stdout ?? ""}${npm.stderr ?? ""}`;
    if (npm.error || (npm.status !== 0 && /ENOTCACHED|offline/i.test(output))) {
      t.skip(`npm could not run offline here (${npm.error?.code ?? "not in the cache"}): run npm ci once, then npm run test:tools`);
      return;
    }
    assert.equal(npm.status, 0, output);
    const written = fs.readFileSync(path.join(copy, "package-lock.json"), "utf8").split("\n");
    const committed = fs.readFileSync(path.join(repo, "package-lock.json"), "utf8").split("\n");
    const line = written.findIndex((text, index) => text !== committed[index]);
    if (line !== -1 || written.length !== committed.length) {
      const at = line === -1 ? Math.min(written.length, committed.length) : line;
      assert.fail(`package-lock.json is not what npm writes: line ${at + 1} is ${JSON.stringify(committed[at])}, npm writes ${JSON.stringify(written[at])} → fix: Run npm install --package-lock-only and commit it.`);
    }
  });
});

describe("the lockfile beside an extension", () => {
  const real = JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8"));
  const base = JSON.stringify(real, null, 2);
  /** The real lockfile, plus extensions/<ID> with left-pad (which needs tiny); `change` edits it further. */
  const lockfile = (change = () => {}, start = real) => {
    const lock = structuredClone(start);
    lock.packages[`extensions/${ID}`] = { name: ID, version: "1.0.0", dependencies: { "left-pad": "1.3.0" } };
    lock.packages[`node_modules/${ID}`] = { resolved: `extensions/${ID}`, link: true };
    lock.packages["node_modules/left-pad"] = { version: "1.3.0", resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
      integrity: "sha512-left", dependencies: { tiny: "^1.0.0" } };
    lock.packages["node_modules/tiny"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/tiny/-/tiny-1.0.0.tgz", integrity: "sha512-tiny" };
    change(lock);
    return JSON.stringify(lock, null, 2);
  };

  test("theExtensionsOwnLibrariesMayChange", () => {
    assert.deepEqual(lockfileProblems(base, lockfile(), { extension: ID }), []);
    assert.deepEqual(lockfileProblems(lockfile(), base, { extension: ID }), [], "and go away");
    const updated = lockfile((lock) => { lock.packages["node_modules/tiny"].version = "1.0.1"; });
    assert.deepEqual(lockfileProblems(lockfile(), updated, { extension: ID }), []);
  });

  test("theToolsPackagesMayNotChange", () => {
    const swapped = lockfile((lock) => { lock.packages["node_modules/@esbuild/linux-x64"].integrity = tweak(lock.packages["node_modules/@esbuild/linux-x64"].integrity); });
    const problems = lockfileProblems(base, swapped, { extension: ID });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /node_modules\/@esbuild\/linux-x64/);
    assert.match(problems[0], /→ fix: /);
  });

  test("aLibrarySharedWithTheToolsMayNotChange", () => {
    const sharing = (change) => lockfile((lock) => { lock.packages[`extensions/${ID}`].dependencies.fflate = "0.8.3"; change(lock); });
    assert.deepEqual(lockfileProblems(base, sharing(() => {}), { extension: ID }), [], "using it as it is is fine");
    const changed = sharing((lock) => { lock.packages["node_modules/fflate"].resolved += "?swapped"; });
    assert.ok(lockfileProblems(sharing(() => {}), changed, { extension: ID }).some((problem) => /node_modules\/fflate.*outside/.test(problem)),
      "even when the extension already used it");
  });

  test("theRootEntryAndTheFileItselfMayNotChange", () => {
    assert.match(lockfileProblems(base, lockfile((lock) => { lock.packages[""].devDependencies.esbuild = "0.0.1"; }), { extension: ID })[0], /the root entry/);
    assert.match(lockfileProblems(base, lockfile((lock) => { lock.lockfileVersion = 2; }), { extension: ID })[0], /lockfileVersion/);
    assert.match(lockfileProblems(base, "{ nope", { extension: ID })[0], /not valid JSON/);
  });

  test("anEntryNothingNeedsMayNotBeAdded", () => {
    const orphan = lockfile((lock) => {
      lock.packages["node_modules/stray"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/stray/-/stray-1.0.0.tgz", integrity: "sha512-s" };
    });
    assert.ok(lockfileProblems(base, orphan, { extension: ID }).some((problem) => /node_modules\/stray.*outside/.test(problem)));
  });

  test("anotherExtensionsLibrariesMayNotChange", () => {
    const withOther = structuredClone(real);
    withOther.packages[`extensions/${OTHER}`] = { name: OTHER, version: "1.0.0", dependencies: { other: "1.0.0" } };
    withOther.packages["node_modules/other"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/other/-/other-1.0.0.tgz", integrity: "sha512-o" };
    // The extension uses the same library, so only "it is another workspace's too" keeps it out.
    const uses = (lock) => { lock.packages[`extensions/${ID}`].dependencies.other = "1.0.0"; };
    const changed = lockfile((lock) => { uses(lock); lock.packages["node_modules/other"].integrity = "sha512-changed"; }, withOther);
    assert.ok(lockfileProblems(lockfile(uses, withOther), changed, { extension: ID }).some((problem) => /node_modules\/other.*outside/.test(problem)));
  });

  test("everyChangedLibraryComesFromTheRegistryWithAnIntegrity", () => {
    const sources = {
      git: (entry) => { entry.resolved = "git+ssh://git@github.com/someone/tiny.git#0123abc"; delete entry.integrity; },
      file: (entry) => { entry.resolved = "file:../tiny"; },
      "another host": (entry) => { entry.resolved = "https://example.com/tiny/-/tiny-1.0.0.tgz"; },
      "no integrity": (entry) => { delete entry.integrity; },
      "no resolved": (entry) => { delete entry.resolved; },
      "a link elsewhere": (entry) => { for (const key of Object.keys(entry)) delete entry[key]; Object.assign(entry, { resolved: "../outside", link: true }); },
    };
    for (const [name, change] of Object.entries(sources)) {
      const problems = lockfileProblems(base, lockfile((lock) => change(lock.packages["node_modules/tiny"])), { extension: ID });
      assert.ok(problems.some((problem) => /node_modules\/tiny/.test(problem) && /registry/.test(problem)), `${name}: ${problems.join("\n")}`);
    }
    for (const extension of [ID, undefined]) {
      const problems = lockfileProblems(base, lockfile((lock) => sources.git(lock.packages["node_modules/tiny"])), { extension });
      assert.ok(problems.some((problem) => /registry/.test(problem)), "with or without an extension");
    }
  });

  test("aLibraryWithAnInstallScriptOrAProgramIsRefused", () => {
    for (const field of [{ hasInstallScript: true }, { bin: { tiny: "cli.js" } }]) {
      const problems = lockfileProblems(base, lockfile((lock) => { Object.assign(lock.packages["node_modules/tiny"], field); }), { extension: ID });
      assert.equal(problems.length, 1, JSON.stringify(field));
      assert.match(problems[0], /node_modules\/tiny.*install script or a command-line program/);
    }
  });
});

describe("the lockfile without an extension", () => {
  const real = JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8"));
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  const apiPackage = fs.readFileSync(path.join(repo, "packages", "api", "package.json"), "utf8");
  /** package.json texts by location, before and after; `root` changes the root's. */
  const manifests = (root = () => {}) => {
    const changed = structuredClone(rootPackage);
    root(changed);
    return { base: { "": JSON.stringify(rootPackage), "packages/api": apiPackage }, head: { "": JSON.stringify(changed), "packages/api": apiPackage } };
  };
  const edit = (change) => {
    const lock = structuredClone(real);
    change(lock);
    return JSON.stringify(lock, null, 2);
  };
  const swap = (lock) => { lock.packages["node_modules/@esbuild/linux-x64"].integrity = tweak(lock.packages["node_modules/@esbuild/linux-x64"].integrity); };
  /** esbuild 0.28.2 → 0.29.0 as npm writes it: the package, its platform builds and the root entry. */
  const upgrade = (lock) => {
    for (const [location, entry] of Object.entries(lock.packages)) {
      if (location !== "node_modules/esbuild" && !location.startsWith("node_modules/@esbuild/")) continue;
      entry.version = "0.29.0";
      entry.resolved = entry.resolved.replaceAll("0.28.2", "0.29.0");
      entry.integrity = `${entry.integrity.slice(0, -2)}x=`;
      for (const name of Object.keys(entry.optionalDependencies ?? {})) entry.optionalDependencies[name] = "0.29.0";
    }
    lock.packages[""].devDependencies.esbuild = "0.29.0";
  };
  const bump = (root) => { root.devDependencies.esbuild = "0.29.0"; };

  test("aToolsEntryChangedWithoutItsPackageJsonFails", () => {
    const problems = lockfileProblems(JSON.stringify(real), edit(swap), { manifests: manifests() });
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /lockfile changes without a package\.json change: node_modules\/@esbuild\/linux-x64/);
  });

  test("anUpgradeThatPackageJsonAsksForPasses", () => {
    assert.deepEqual(lockfileProblems(JSON.stringify(real), edit(upgrade), { manifests: manifests(bump) }), []);
    const withSwap = edit((lock) => { upgrade(lock); lock.packages["node_modules/fflate"].integrity = tweak(lock.packages["node_modules/fflate"].integrity); });
    const problems = lockfileProblems(JSON.stringify(real), withSwap, { manifests: manifests(bump) });
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /without a package\.json change: node_modules\/fflate( |$)/);
    assert.match(lockfileProblems(JSON.stringify(real), edit(upgrade), { manifests: manifests() })[0], /without a package\.json change/,
      "the same upgrade, not asked for");
  });
});

describe("the pull request run", () => {
  /** A repository with extensions/<ID>/src/index.ts; `exec` stands in for npm and records each command. */
  function setUp({ source = "export const actions = {};\n", packageBytes = 4096, indexBytes = 2048, failing = [], extra = {} } = {}) {
    const root = scratch();
    const folder = path.join(root, "extensions", ID);
    fs.mkdirSync(path.join(folder, "src"), { recursive: true });
    fs.writeFileSync(path.join(folder, "src", "index.ts"), source);
    fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ id: ID, version: "1.2.0" }));
    for (const [file, text] of Object.entries(extra)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    const calls = [];
    const exec = (args) => {
      const command = args.join(" ");
      calls.push(command);
      if (command === `run build -- ${ID}`) {
        fs.mkdirSync(path.join(root, "dist", ID), { recursive: true });
        fs.copyFileSync(path.join(folder, "manifest.json"), path.join(root, "dist", ID, "manifest.json"));
        for (const [file, size] of [[path.join(root, "dist", ID, "index.js"), indexBytes], [path.join(root, "dist", `${ID}-1.2.0.yabext`), packageBytes]]) {
          fs.writeFileSync(file, "");
          fs.truncateSync(file, size);
        }
      }
      return failing.some((prefix) => command.startsWith(prefix)) ? 1 : 0;
    };
    return { root, calls, exec };
  }
  const failed = (results) => results.filter((result) => !result.ok).map((result) => result.name);

  test("anExtensionPullRequestRunsEveryCheck", async () => {
    const { root, calls, exec } = setUp();
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec });
    assert.equal(ok, true, JSON.stringify(results, null, 2));
    assert.deepEqual(calls.map((call) => call.replace(/--out \S+$/, "--out <dir>")), [
      `run build -- ${ID}`,
      `run validate -- ${ID}`,
      `test -- ${ID}`,
      "run typecheck",
      "run docs -- --check",
      "run test:tools",
      "run catalog -- --out <dir>",
    ]);
    const names = results.map((result) => result.name);
    for (const name of ["one extension folder", "readable source", "size"]) {
      assert.ok(names.some((entry) => entry.includes(name)), `${name} is among ${names.join(", ")}`);
    }
  });

  test("staleDocsFailTheRun", async () => {
    const { root, exec } = setUp({ failing: ["run docs"] });
    const { ok, results } = await runChecks({ root, files: ["docs/publishing.md"], exec });
    assert.equal(ok, false);
    assert.deepEqual(failed(results), ["npm run docs -- --check"]);
    const docs = results.find((result) => result.name === "npm run docs -- --check");
    assert.match(docs.problems.join("\n"), /npm run docs.*commit/);
  });

  test("aPullRequestWithoutAnExtensionRunsTheRepositoryChecks", async () => {
    const { root, calls, exec } = setUp();
    assert.equal((await runChecks({ root, files: ["tools/build.mjs"], exec })).ok, true);
    assert.deepEqual(calls.map((call) => call.split(" -- ")[0]), ["run typecheck", "run docs", "run test:tools", "run catalog"]);
  });

  test("anOversizedPackageFails", async () => {
    const { root, exec } = setUp({ packageBytes: MAX_PACKAGE_BYTES + 1 });
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/manifest.json`], exec });
    assert.equal(ok, false);
    assert.equal(failed(results).length, 1);
    assert.match(failed(results)[0], /size/);
  });

  test("minifiedSourceFailsAndTheOtherChecksStillRun", async () => {
    const { root, calls, exec } = setUp({ source: `export const actions={${"a:1,".repeat(300)}};\n` });
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec });
    assert.equal(ok, false);
    assert.equal(failed(results).length, 1);
    assert.match(failed(results)[0], /readable source/);
    assert.ok(calls.includes(`run build -- ${ID}`));
  });

  test("aFailingCommandFailsItsCheck", async () => {
    const { root, exec } = setUp({ failing: [`test -- ${ID}`, "run test:tools"] });
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec });
    assert.equal(ok, false);
    assert.deepEqual(failed(results), [`npm test -- ${ID}`, "npm run test:tools"]);
  });

  test("obfuscatedCodeImportedFromOutsideSrcFails", async () => {
    const dense = `export const y = "${"q".repeat(600)}";\n`;
    const { root, exec } = setUp({
      source: "import { x } from \"../vendor/x.ts\";\nimport { y } from \"lib\";\nexport const actions = { a: { run: () => ({ text: x + y }) } };\n",
      extra: {
        [`extensions/${ID}/vendor/x.ts`]: `export const x = "${"z".repeat(600)}";\n`,
        // Libraries come from npm, and the review reads them; only the extension's own files are measured.
        [`extensions/${ID}/node_modules/lib/package.json`]: JSON.stringify({ name: "lib", main: "index.js" }),
        [`extensions/${ID}/node_modules/lib/index.js`]: dense,
        // Not bundled, so not measured: test fixtures may be long.
        [`extensions/${ID}/tests/fixture.ts`]: dense,
      },
    });
    const { results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec });
    const readable = results.find((result) => result.name.startsWith("readable source"));
    assert.equal(readable.ok, false);
    assert.equal(readable.problems.length, 1, readable.problems.join("\n"));
    assert.ok(readable.problems[0].startsWith(`extensions/${ID}/vendor/x.ts:1: `), readable.problems[0]);
  });

  test("anExtensionPackageJsonWithScriptsFails", async () => {
    const plain = setUp({ extra: { [`extensions/${ID}/package.json`]: JSON.stringify({ name: ID, private: true, dependencies: { a: "1.0.0" } }) } });
    assert.equal((await runChecks({ root: plain.root, files: [`extensions/${ID}/package.json`], exec: plain.exec })).ok, true);
    const scripted = setUp({ extra: { [`extensions/${OTHER}/package.json`]: JSON.stringify({ name: OTHER, scripts: { postinstall: "node x.js" } }) } });
    const { ok, results } = await runChecks({ root: scripted.root, files: [`extensions/${ID}/src/index.ts`], exec: scripted.exec });
    assert.equal(ok, false);
    assert.deepEqual(failed(results), ["no install scripts or programs in extensions/*/package.json"], "every extension's, not only the changed one");
    assert.match(results.find((result) => !result.ok).problems[0], new RegExp(`extensions/${OTHER.replaceAll(".", "\\.")}/package\\.json: .*scripts`));
  });

  test("theLockfileIsCheckedWhenItChangesBesideAnExtension", async () => {
    const real = fs.readFileSync(path.join(repo, "package-lock.json"), "utf8");
    const swapped = JSON.parse(real);
    swapped.packages["node_modules/@esbuild/linux-x64"].integrity = tweak(swapped.packages["node_modules/@esbuild/linux-x64"].integrity);
    const { root, calls, exec } = setUp({ extra: { "package-lock.json": JSON.stringify(swapped, null, 2) } });
    const rootPackage = fs.readFileSync(path.join(repo, "package.json"), "utf8");
    fs.writeFileSync(path.join(root, "package.json"), rootPackage);
    const readBase = (file) => ({ "package-lock.json": real, "package.json": rootPackage })[file] ?? null;
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`, "package-lock.json"], exec, readBase });
    assert.equal(ok, false);
    assert.equal(failed(results).length, 1);
    assert.match(results.find((result) => !result.ok).problems[0], /node_modules\/@esbuild\/linux-x64/);
    assert.ok(calls.includes(`run build -- ${ID}`), "the other checks still run");
    // Without an extension too: the macOS runner never installs that package, so only this check sees the swap.
    const docsOnly = await runChecks({ root, files: ["docs/publishing.md", "package-lock.json"], exec, readBase });
    assert.equal(docsOnly.ok, false);
    assert.match(docsOnly.results.find((result) => !result.ok).problems[0], /without a package\.json change: node_modules\/@esbuild\/linux-x64/);
  });

  test("nodeModulesCommittedInAnExtensionFail", async () => {
    const { root, exec } = setUp();
    const tracked = () => [`extensions/${ID}/src/index.ts`, `extensions/${ID}/node_modules/lib/index.js`, "node_modules/.package-lock.json"];
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec, tracked });
    assert.equal(ok, false);
    assert.deepEqual(failed(results), ["no node_modules inside extensions/"]);
    assert.match(results.find((result) => !result.ok).problems[0], new RegExp(`extensions/${ID.replaceAll(".", "\\.")}/node_modules/lib/index\\.js`));
  });

  test("twoFoldersFailAndARemovedFolderIsNotBuilt", async () => {
    const { root, calls, exec } = setUp();
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`, `extensions/${OTHER}/manifest.json`], exec });
    assert.equal(ok, false);
    assert.match(failed(results)[0], /one extension folder/);
    assert.ok(!calls.some((call) => call.includes(OTHER)), "the removed extension has nothing to build");
    assert.ok(calls.includes(`run build -- ${ID}`));
  });
});

describe("the workflows", () => {
  const workflow = (name) => fs.readFileSync(path.join(repo, ".github", "workflows", name), "utf8");
  const lines = (text) => text.split("\n").map((line) => line.trim()).filter((line) => line !== "").join("\n");

  test("theLabelWorkflowCarriesTheTestedFunctions", () => {
    const script = lines(workflow("pr-label.yml"));
    for (const fn of [permissionChanges, authorToMention]) {
      assert.ok(script.includes(lines(fn.toString())), `pr-label.yml holds ${fn.name} exactly as tools/lib/pr-checks.mjs has it`);
    }
  });

  describe("the label script, against a fake API", () => {
    const text = workflow("pr-label.yml");
    const script = text.slice(text.indexOf("script: |\n") + "script: |\n".length).split("\n").map((line) => line.slice(12)).join("\n");
    const AsyncFunction = (async () => {}).constructor;
    const manifest = (fields) => JSON.stringify({ id: ID, author: "octo-dev", ...fields });
    const BOT = "github-actions[bot]";
    let warnings;

    /**
     * Runs the script for a pull request by `login`. `contents` maps "<ref>:<id>" (ref base or head) to manifest
     * text, to { encoding, content }, or to an Error; anything else is a 404. Returns the label and comment calls.
     */
    async function label({ login, contents, files = [{ filename: `extensions/${ID}/src/index.ts` }, { filename: "README.md" }], comments = [] }) {
      const calls = [];
      warnings = [];
      const notFound = () => Object.assign(new Error("Not Found"), { status: 404 });
      const github = {
        paginate: async (method, params) => (await method(params)).data,
        rest: {
          pulls: { listFiles: async () => ({ data: files }) },
          repos: {
            getContent: async ({ path: file, ref }) => {
              const value = contents[`${ref}:${/^extensions\/([^/]+)\/manifest\.json$/.exec(file)?.[1]}`];
              if (value instanceof Error) throw value;
              if (value == null) throw notFound();
              if (typeof value === "object") return { data: { type: "file", ...value } };
              return { data: { type: "file", encoding: "base64", content: Buffer.from(value).toString("base64") } };
            },
            listCommits: async ({ author }) => ({ data: author === "octo-dev" ? [{ sha: "c0ffee" }] : [] }),
          },
          users: { getByUsername: async ({ username }) => ({ data: { name: username === "octo-dev" ? "Octo Dev" : null } }) },
          issues: {
            addLabels: async ({ labels }) => calls.push(["label", ...labels]),
            listComments: async () => ({ data: comments }),
            createComment: async ({ body }) => calls.push(["comment", body]),
          },
        },
      };
      const context = { repo: { owner: "owner", repo: "store" },
        payload: { pull_request: { number: 7, user: { login }, base: { sha: "base" }, head: { sha: "head" } } } };
      await new AsyncFunction("github", "context", "core", script)(github, context, { info() {}, warning: (message) => warnings.push(message) });
      return calls;
    }

    test("aPermissionChangeIsLabelledAndTheAuthorNamed", async () => {
      const calls = await label({ login: "another-dev", contents: { [`base:${ID}`]: manifest(), [`head:${ID}`]: manifest({ permissions: ["network"] }) } });
      assert.deepEqual(calls[0], ["label", "permissions-changed"]);
      assert.equal(calls[1][0], "comment");
      assert.match(calls[1][1], /`dev\.example\.tool` by @octo-dev/);
      assert.deepEqual(await label({ login: "octo-dev", contents: { [`base:${ID}`]: manifest(), [`head:${ID}`]: manifest({ version: "1.0.1" }) } }), [],
        "the author's own fix");
      assert.deepEqual(await label({ login: "another-dev", contents: { [`head:${ID}`]: manifest({ permissions: ["exec"], requires: { tools: [{ name: "x" }] } }) } }),
        [["label", "permissions-changed"]], "a new extension: no one else to name");
      const named = await label({ login: "another-dev", contents: { [`base:${ID}`]: manifest({ author: "Octo" }), [`head:${ID}`]: manifest({ author: "Octo" }) } });
      assert.match(named[0][1], /by Octo$/m, "a name that has no commits here is written, not mentioned");
    });

    test("onlyTheWorkflowsOwnCommentCountsAsAlreadyPosted", async () => {
      const contents = { [`base:${ID}`]: manifest(), [`head:${ID}`]: manifest() };
      const posted = (await label({ login: "another-dev", contents }))[0][1];
      assert.deepEqual(await label({ login: "another-dev", contents, comments: [{ body: posted, user: { login: BOT } }] }), []);
      const copied = await label({ login: "another-dev", contents, comments: [{ body: posted, user: { login: "another-dev" } }] });
      assert.equal(copied.length, 1, "a pasted marker does not silence the mention");
      assert.equal(copied[0][0], "comment");
    });

    test("aManifestItCannotReadIsLabelled", async () => {
      const big = await label({ login: "octo-dev", contents: { [`base:${ID}`]: manifest(), [`head:${ID}`]: { encoding: "none", content: "" } } });
      assert.deepEqual(big, [["label", "permissions-changed"]], "over 1 MB the API sends no content");
      assert.equal(warnings.length, 1);
      const failing = await label({ login: "octo-dev",
        contents: { [`base:${ID}`]: manifest(), [`head:${ID}`]: Object.assign(new Error("Server Error"), { status: 502 }) } });
      assert.deepEqual(failing, [["label", "permissions-changed"]]);
      assert.match(warnings[0], /502|Server Error/);
    });

    test("aMovedFolderIsReadOnBothSides", async () => {
      const calls = await label({
        login: "another-dev",
        files: [{ filename: `extensions/${OTHER}/manifest.json`, previous_filename: `extensions/${ID}/manifest.json` }],
        contents: { [`base:${ID}`]: manifest({ permissions: ["network"] }), [`head:${OTHER}`]: manifest({ id: OTHER, author: "another-dev" }) },
      });
      assert.deepEqual(calls[0], ["label", "permissions-changed"]);
      assert.match(calls[1][1], /`dev\.example\.tool` by @octo-dev/, "the folder it left is someone else's");
    });
  });

  test("theLabelWorkflowNeverRunsPullRequestCode", () => {
    const text = workflow("pr-label.yml");
    assert.match(text, /^\s+pull_request_target:/m);
    assert.doesNotMatch(text, /actions\/checkout/);
    assert.doesNotMatch(text, /^\s*(- )?run:/m, "no shell steps, only the API");
    assert.doesNotMatch(text, /\bnpm\b|\bnode\s/);
    assert.match(text, /^permissions: \{\}$/m);
    assert.match(text, /^ {4}permissions:\n {6}contents: read\n {6}pull-requests: write\n(?! {6})/m, "granted to the job, and no more");
    // No expression anywhere but the concurrency group, which is a number: nothing a pull request writes reaches the script.
    assert.equal(text.split("${{").length - 1, 1, "one expression in the whole file");
    assert.equal(text.match(/\$\{\{.*?\}\}/g)?.[0], "${{ github.event.pull_request.number }}");
    assert.match(text, /^concurrency:\n {2}group: pr-label-\$\{\{ github\.event\.pull_request\.number \}\}\n/m);
  });

  test("pullRequestChecksRunWithAReadOnlyToken", () => {
    const text = workflow("pr.yml");
    assert.match(text, /^on:\n {2}pull_request:/m);
    assert.doesNotMatch(text, /pull_request_target|secrets\./);
    assert.match(text, /^permissions:\n {2}contents: read\n(?! )/m);
    assert.match(text, /fetch-depth: 0/);
    assert.match(text, /node tools\/pr-checks\.mjs/);
  });

  /** A workflow's jobs, by name: the lines of each job's block, without comment lines. */
  const jobsOf = (text) => {
    const jobs = {};
    let name;
    for (const line of text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length).split("\n")) {
      const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (match) jobs[(name = match[1])] = "";
      else if (name && !line.trim().startsWith("#")) jobs[name] += `${line}\n`; // comments aside
    }
    return jobs;
  };

  test("onlyTheSignJobSeesTheKeyAndItRunsNoRepositoryCode", () => {
    const text = workflow("publish.yml");
    assert.match(text, /^on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:/m);
    assert.match(text, /^permissions: \{\}$/m);
    const { build, sign, deploy } = jobsOf(text);
    assert.ok(build && sign && deploy, Object.keys(jobsOf(text)).join(", "));
    assert.equal(text.match(/secrets\./g)?.length, 1, "the key is read once");
    assert.match(sign, /CATALOG_SIGNING_KEY: \$\{\{ secrets\.CATALOG_SIGNING_KEY \}\}/);
    assert.match(sign, /^ {4}environment: publish$/m);
    assert.match(sign, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
    assert.match(sign, /sparse-checkout: \|\n {12}\/tools\/sign\.mjs\n {12}\/keys\/catalog-public-keys\.json\n {10}sparse-checkout-cone-mode: false\n/);
    assert.doesNotMatch(sign, /\bnpm\b|setup-node|node_modules|fetch-depth/, "no install, no other code");
    assert.deepEqual([...sign.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1]), ["node tools/sign.mjs site/v1/catalog.json"]);
    assert.doesNotMatch(build, /environment:|secrets|pages: write|id-token/);
    assert.match(build, /run: npm ci --ignore-scripts\n/);
    assert.match(build, /run: node tools\/catalog\.mjs --out site\/v1\n/, "not npm run, which puts node_modules/.bin first on PATH");
    assert.doesNotMatch(build, /npm run|cache:/);
    assert.match(deploy, /needs: sign/);
    assert.match(deploy, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
    assert.match(deploy, /name: github-pages/);
    assert.match(deploy, /pages: write\n {6}id-token: write/);
    assert.doesNotMatch(sign, /pages: write|id-token/);
  });

  test("actionsThatSeeTheKeyOrAWriteTokenArePinnedToCommits", () => {
    for (const name of ["publish.yml", "pr-label.yml"]) {
      const uses = [...workflow(name).matchAll(/uses: (\S+)(.*)$/gm)];
      assert.ok(uses.length > 0, name);
      for (const [, action, comment] of uses) {
        assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/, `${name}: ${action}`);
        assert.match(comment, /^ # v\d+\.\d+\.\d+$/, `${name}: ${action} names its version`);
      }
    }
  });
});
