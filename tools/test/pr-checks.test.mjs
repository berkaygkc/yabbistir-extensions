import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_INDEX_BYTES, MAX_PACKAGE_BYTES, authorToMention, changedFiles, checkScope, lockfileProblems, packageProblems, permissionChanges,
  readabilityProblems, runChecks, sizeProblems,
} from "../lib/pr-checks.mjs";
import { copyPackageFiles, repo } from "./helpers.mjs";

const ID = "dev.example.tool";
const OTHER = "dev.example.other";
/** A well-formed sha512 integrity made from `seed`. */
const sri = (seed) => `sha512-${crypto.createHash("sha512").update(seed).digest("base64")}`;
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
    const { extensions, problems } = checkScope([`extensions/${ID}/src/index.ts`, "README.md", "docs/publishing.md"]);
    assert.deepEqual(extensions, [ID]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /README\.md/);
    assert.match(problems[0], /docs\/publishing\.md/);
  });

  test("theLockfileAndTheGeneratedDocsMayChangeWithAnExtension", () => {
    // The video-download manifest is the manifest reference's example, so changing it regenerates these.
    const files = [`extensions/${ID}/manifest.json`, "package-lock.json", "docs/manifest.md", "docs/api.md", "llms-full.txt"];
    assert.deepEqual(checkScope(files), { extensions: [ID], problems: [] });
  });

  test("aPullRequestWithoutAnExtensionPasses", () => {
    assert.deepEqual(checkScope(["docs/publishing.md", "README.md", "llms-full.txt"]), { extensions: [], problems: [] });
    assert.deepEqual(checkScope([]), { extensions: [], problems: [] });
  });

  test("whatOnlyTheMaintainerChangesFails", () => {
    const reserved = [".github/workflows/pr.yml", ".github/workflows/static.yml", ".GitHub/workflows/x.yml", "tools/build.mjs", "tools/lib/static-rules.mjs",
      "packages/api/index.d.ts", "templates/action/src/index.ts", "schema/catalog.schema.json", "package.json", "package-lock.json", "tsconfig.json",
      "jsconfig.json", ".gitattributes", "docs/.gitattributes", "keys/catalog-public-keys.json",
      // What editors and coding agents read and run, wherever it sits.
      ".claude/settings.json", ".claude/skills/yabbistir-extension/SKILL.md", ".mcp.json", "CLAUDE.md", "AGENTS.md", ".vscode/settings.json",
      ".idea/workspace.xml", "docs/CLAUDE.md", "docs/.vscode/tasks.json", `extensions/${ID}/AGENTS.md`, `extensions/${ID}/.claude/settings.json`];
    for (const file of reserved) {
      const { problems } = checkScope([file]);
      assert.equal(problems.length, 1, file);
      assert.ok(problems[0].includes(file) && /needs a maintainer-authored pull request/.test(problems[0]), problems[0]);
    }
    assert.match(checkScope([`extensions/${ID}/.gitattributes`]).problems[0], /maintainer-authored/, "in an extension folder too");
    // Beside one extension, the lockfile may change (its rules then allow that extension's own libraries only).
    assert.deepEqual(checkScope([`extensions/${ID}/package.json`, "package-lock.json"]).problems, []);
    assert.ok(checkScope([`extensions/${ID}/package.json`, `extensions/${OTHER}/package.json`, "package-lock.json"]).problems.some((problem) => /package-lock\.json, and a change there needs a maintainer-authored/.test(problem)));
  });

  test("aFileDirectlyInExtensionsIsOutsideTheFolder", () => {
    const { extensions, problems } = checkScope([`extensions/${ID}/README.md`, "extensions/README.md"]);
    assert.deepEqual(extensions, [ID]);
    assert.match(problems[0], /extensions\/README\.md/);
    // And only the maintainer puts a file there: esbuild and editors read a tsconfig.json or jsconfig.json above the source.
    for (const file of ["extensions/tsconfig.json", "extensions/jsconfig.json", "extensions/package.json", "extensions/README.md"]) {
      const alone = checkScope(["docs/recipes/number-check.js", file]).problems;
      assert.equal(alone.length, 1, file);
      assert.ok(alone[0].includes(file) && /maintainer-authored/.test(alone[0]), alone[0]);
    }
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

  test("itIsNamedAfterTheExtension", () => {
    // npm links a workspace under its package name: an extension called fflate would stand in for the tools' fflate.
    for (const name of ["fflate", "dev.example.other", undefined]) {
      const problems = packageProblems(ID, JSON.stringify({ name, private: true, main: "src/shim.js" }));
      assert.equal(problems.length, 1, String(name));
      assert.match(problems[0], new RegExp(`its name is ${JSON.stringify(name) ?? "undefined"}, not the extension's id`));
    }
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
  test("registryVersionsRangesAndTagsPass", () => {
    const specs = { a: "1.2.3", b: "^1.0.0", c: "~1.2", d: ">=1.0.0 <2.0.0", e: "latest", f: "*", g: "", h: "1.x || 2.x", k: "1.0.0-beta.2" };
    assert.deepEqual(packageProblems(ID, JSON.stringify({ name: ID, dependencies: specs })), []);
  });

  test("gitFileLinkAndUrlDependenciesAreRefused", () => {
    const refused = ["git+https://github.com/someone/lib.git", "git://github.com/someone/lib", "github:someone/lib", "someone/lib",
      "someone/lib#main", "gitlab:someone/lib", "file:../lib", "link:../lib", "../lib", "./lib", "~/lib", "/tmp/lib",
      "https://example.com/lib.tgz", "http://example.com/lib.tgz", "workspace:*", "npm:other@git+https://github.com/someone/lib.git",
      "npm:other@file:../lib", "npm:other@someone/lib", "lib.tgz", "lib-1.0.0.tar", "lib.tar.gz", "LIB.TGZ", "npm:other@lib.tgz", "npm:lib.tgz",
      // npm: aliases install another package under the name: none at all.
      "npm:other@^1.0.0", "npm:@scope/other@1.0.0", "npm:kind-of@6.0.3", "NPM:other@1.0.0"];
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
      integrity: sri("left-pad"), dependencies: { tiny: "^1.0.0" } };
    lock.packages["node_modules/tiny"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/tiny/-/tiny-1.0.0.tgz", integrity: sri("tiny") };
    change(lock);
    return JSON.stringify(lock, null, 2);
  };

  test("theExtensionsOwnLibrariesMayChange", () => {
    assert.deepEqual(lockfileProblems(base, lockfile(), { extension: ID }), []);
    assert.deepEqual(lockfileProblems(lockfile(), base, { extension: ID }), [], "and go away");
    const updated = lockfile((lock) => {
      Object.assign(lock.packages["node_modules/tiny"], { version: "1.0.1", resolved: "https://registry.npmjs.org/tiny/-/tiny-1.0.1.tgz", integrity: sri("tiny 1.0.1") });
    });
    assert.deepEqual(lockfileProblems(lockfile(), updated, { extension: ID }), []);
  });

  test("theToolsPackagesMayNotChange", () => {
    const swapped = lockfile((lock) => { lock.packages["node_modules/@esbuild/linux-x64"].integrity = tweak(lock.packages["node_modules/@esbuild/linux-x64"].integrity); });
    const problems = lockfileProblems(base, swapped, { extension: ID });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /node_modules\/@esbuild\/linux-x64/);
    // The recipe that works with npm 11: the library in the extension's package.json, then npm install at the root.
    assert.match(problems[0], /→ fix: [^\n]*list each in extensions\/dev\.example\.tool\/package\.json at an exact version, run npm install at the repository's root/);
    assert.doesNotMatch(problems[0], / -w /);
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
    const aliased = lockfileProblems(base, lockfile((lock) => { lock.packages[""].devDependencies.fflate = "npm:q@0.8.3"; }), { extension: ID });
    assert.ok(aliased.some((problem) => problem.includes("not from the npm registry as npm writes it: the root entry (it asks for npm: aliases")), aliased.join("\n"));
    assert.match(lockfileProblems(base, lockfile((lock) => { lock.lockfileVersion = 2; }), { extension: ID })[0], /lockfileVersion/);
    assert.match(lockfileProblems(base, "{ nope", { extension: ID })[0], /not valid JSON/);
  });

  test("anEntryNothingNeedsMayNotBeAdded", () => {
    const orphan = lockfile((lock) => {
      lock.packages["node_modules/stray"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/stray/-/stray-1.0.0.tgz", integrity: sri("stray") };
    });
    assert.ok(lockfileProblems(base, orphan, { extension: ID }).some((problem) => /node_modules\/stray.*outside/.test(problem)));
  });

  test("anotherExtensionsLibrariesMayNotChange", () => {
    const withOther = structuredClone(real);
    withOther.packages[`extensions/${OTHER}`] = { name: OTHER, version: "1.0.0", dependencies: { other: "1.0.0" } };
    withOther.packages["node_modules/other"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/other/-/other-1.0.0.tgz", integrity: sri("other") };
    // The extension uses the same library, so only "it is another workspace's too" keeps it out.
    const uses = (lock) => { lock.packages[`extensions/${ID}`].dependencies.other = "1.0.0"; };
    const changed = lockfile((lock) => { uses(lock); lock.packages["node_modules/other"].integrity = sri("changed"); }, withOther);
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

  test("anExtensionLibraryHoldsItsOwnPackagesTarball", () => {
    const borrowed = lockfile((lock) => {
      lock.packages["node_modules/tiny"].resolved = "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz";
      lock.packages["node_modules/tiny"].integrity = sri("is-number");
    });
    assert.ok(lockfileProblems(base, borrowed, { extension: ID }).some((problem) => /node_modules\/tiny \(it does not come from its own tarball/.test(problem)));
    const aliased = (target) => lockfile((lock) => {
      lock.packages[`extensions/${ID}`].dependencies.pad = `npm:left-pad@1.3.0`;
      lock.packages["node_modules/pad"] = { ...lock.packages["node_modules/left-pad"], name: target };
    });
    // No alias passes, even one whose entry names the package it asks for.
    for (const target of ["left-pad", "is-number"]) {
      const problems = lockfileProblems(base, aliased(target), { extension: ID });
      assert.ok(problems.some((problem) => new RegExp(`node_modules/pad \\(it installs ${target} under the name pad: an alias`).test(problem)), problems.join("\n"));
      assert.ok(problems.some((problem) => /extensions\/dev\.example\.tool \(it asks for npm: aliases/.test(problem)), problems.join("\n"));
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
      entry.integrity = tweak(entry.integrity);
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

  test("anEntryHoldsItsOwnPackagesTarball", () => {
    // A no-op spec change asks for fflate; the entry then carries another package's tarball and integrity.
    const pinned = edit((lock) => {
      lock.packages[""].devDependencies.fflate = "=0.8.3";
      lock.packages["node_modules/fflate"].resolved = "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz";
      lock.packages["node_modules/fflate"].integrity = sri("is-number");
    });
    const problems = lockfileProblems(JSON.stringify(real), pinned, { manifests: manifests((root) => { root.devDependencies.fflate = "=0.8.3"; }) });
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /node_modules\/fflate \(it does not come from its own tarball on the npm registry, https:\/\/registry\.npmjs\.org\/fflate\/-\/fflate-0\.8\.3\.tgz\)/);
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
    copyPackageFiles(root);
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
  /** extensions/<id>/package.json asking for fflate, with the lockfile entries npm writes for it; `extra` adds fields. */
  const library = (root, id, extra = {}) => {
    fs.mkdirSync(path.join(root, "extensions", id), { recursive: true });
    fs.writeFileSync(path.join(root, "extensions", id, "package.json"), JSON.stringify({ name: id, private: true, dependencies: { fflate: "0.8.3" }, ...extra }));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    lock.packages[`extensions/${id}`] = { dependencies: { fflate: "0.8.3" } };
    lock.packages[`node_modules/${id}`] = { resolved: `extensions/${id}`, link: true };
    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock, null, 2));
  };

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
    assert.equal((await runChecks({ root, files: ["docs/publishing.md"], exec })).ok, true);
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
    const plain = setUp();
    library(plain.root, ID);
    const passing = await runChecks({ root: plain.root, files: [`extensions/${ID}/package.json`], exec: plain.exec });
    assert.equal(passing.ok, true, JSON.stringify(passing.results.filter((result) => !result.ok)));
    const scripted = setUp();
    library(scripted.root, OTHER, { scripts: { postinstall: "node x.js" } });
    const { ok, results } = await runChecks({ root: scripted.root, files: [`extensions/${ID}/src/index.ts`], exec: scripted.exec });
    assert.equal(ok, false);
    assert.deepEqual(failed(results), ["no install scripts, programs or project files in extension folders"], "every extension's, not only the changed one");
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
    assert.match(docsOnly.results.find((result) => result.name.startsWith("one extension folder")).problems[0], /package-lock\.json, and a change there needs a maintainer-authored/);
    assert.match(docsOnly.results.find((result) => result.name.startsWith("package-lock.json")).problems[0], /without a package\.json change: node_modules\/@esbuild\/linux-x64/);
  });

  test("nodeModulesCommittedInAnExtensionFail", async () => {
    const { root, exec } = setUp();
    const tracked = () => [`extensions/${ID}/src/index.ts`, `extensions/${ID}/node_modules/lib/index.js`, "node_modules/.package-lock.json"];
    const { ok, results } = await runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec, tracked });
    assert.equal(ok, false);
    assert.equal(failed(results).length, 1);
    assert.match(failed(results)[0], /install state/);
    assert.match(results.find((result) => !result.ok).problems[0], new RegExp(`extensions/${ID.replaceAll(".", "\\.")}/node_modules/lib/index\\.js`));
  });

  test("aShrinkwrapOrAnNpmrcFailsEveryPullRequest", async () => {
    for (const file of ["npm-shrinkwrap.json", ".npmrc"]) {
      const { root, exec } = setUp({ extra: { [file]: "{}\n" } });
      const { ok, results } = await runChecks({ root, files: ["docs/review-checklist.md", file], exec });
      assert.equal(ok, false, file);
      const state = results.find((result) => result.name.startsWith("the install state"));
      assert.ok(state.problems.some((problem) => problem.startsWith(`${file}: `)), state.problems.join("\n"));
    }
  });

  test("pathsThatDifferOnlyByCaseFail", async () => {
    const { root, exec } = setUp();
    const tracked = () => [`extensions/${ID}/src/index.ts`, `extensions/${ID}/src/Index.ts`];
    const { results } = await runChecks({ root, files: [`extensions/${ID}/src/Index.ts`], exec, tracked });
    const state = results.find((result) => result.name.startsWith("the install state"));
    assert.equal(state.ok, false);
    assert.match(state.problems.join("\n"), new RegExp(`extensions/${ID.replaceAll(".", "\\.")}/src/Index\\.ts and extensions/${ID.replaceAll(".", "\\.")}/src/index\\.ts`));
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

describe("node tools/static-checks.mjs", () => {
  const files = ["tools/static-checks.mjs", "tools/lib/static-rules.mjs", "tools/lockfile-state.mjs"];

  test("itRunsWithNothingInstalled", () => {
    // The static job checks out these three files from the base branch and nothing else.
    for (const file of files) {
      const text = fs.readFileSync(path.join(repo, file), "utf8");
      const specifiers = [...text.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/g)].map((match) => match[1] ?? match[2]);
      const local = specifiers.filter((specifier) => !specifier.startsWith("node:"))
        .map((specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
      assert.deepEqual(local.filter((target) => !files.includes(target)), [], `${file} imports only Node and these files`);
    }
  });

  /** The three checker files, copied apart as the static workflow checks them out. */
  const checker = () => {
    const folder = scratch();
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.copyFileSync(path.join(repo, file), path.join(folder, file));
    }
    return folder;
  };
  /**
   * A repository whose main holds this one's package files, and whose branch "pr" is main plus what `change` does.
   * main is checked out again at the end, so the disk holds main and only git holds the pull request.
   */
  const pullRequest = (change, { add = true } = {}) => {
    const pr = scratch();
    git(pr, "init", "-q", "-b", "main");
    copyPackageFiles(pr);
    git(pr, "add", "-A");
    git(pr, "commit", "-q", "-m", "base");
    git(pr, "checkout", "-q", "-b", "pr");
    change(pr);
    if (add) git(pr, "add", "-A", "-f");
    git(pr, "commit", "-q", "--allow-empty", "-m", "pull request");
    git(pr, "checkout", "-q", "-f", "main");
    return pr;
  };
  /** Runs the copied checker as static.yml does: --root <the pull request's repository> --base main --head pr. */
  const runChecker = (pr, env = {}) => {
    const { NODE_TEST_CONTEXT, ...inherited } = process.env;
    const run = spawnSync(process.execPath, [path.join(checker(), "tools", "static-checks.mjs"), "--root", pr, "--base", "main", "--head", "pr"],
      { encoding: "utf8", env: { ...inherited, GITHUB_ACTIONS: "", ...env } });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  };
  /** Adds `file` with `text` to the index only: names a disk could not hold (newlines, twins) reach git this way. */
  const stage = (root, file, text) => {
    fs.writeFileSync(path.join(root, ".staged"), text);
    const blob = spawnSync("git", ["hash-object", "-w", ".staged"], { cwd: root, encoding: "utf8" }).stdout.trim();
    fs.rmSync(path.join(root, ".staged"));
    git(root, "update-index", "--add", "--cacheinfo", `100644,${blob},${file}`);
  };

  test("itChecksThePullRequestsCommitThroughGitNotTheDisk", () => {
    // The pull request pins fflate to another package's tarball; the disk holds main, which passes.
    const swapped = runChecker(pullRequest((pr) => {
      const lock = JSON.parse(fs.readFileSync(path.join(pr, "package-lock.json"), "utf8"));
      lock.packages["node_modules/fflate"].resolved = "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz";
      fs.writeFileSync(path.join(pr, "package-lock.json"), JSON.stringify(lock, null, 2));
    }));
    assert.equal(swapped.status, 1, swapped.out);
    assert.match(swapped.out, /node_modules\/fflate: it does not come from its own tarball/);
    assert.match(swapped.out, /static checks failed/);
    const docs = runChecker(pullRequest((pr) => {
      fs.mkdirSync(path.join(pr, "docs"));
      fs.writeFileSync(path.join(pr, "docs", "x.md"), "A fix.\n");
    }));
    assert.equal(docs.status, 0, docs.out);
    assert.match(docs.out, /All 3 static checks passed/);
  });

  test("aLinkInThePullRequestFails", () => {
    // attack Q: the lockfile is a link to a copy, which a check and npm in different folders would read differently.
    const { status, out } = runChecker(pullRequest((pr) => {
      fs.writeFileSync(path.join(pr, "docs.md"), "typo\n");
      fs.renameSync(path.join(pr, "package-lock.json"), path.join(pr, "foo.json"));
      fs.symlinkSync("foo.json", path.join(pr, "package-lock.json"));
    }));
    assert.equal(status, 1, out);
    assert.match(out, /symbolic links or submodules, not regular files: package-lock\.json →/);
    assert.match(out, /^ {8}package-lock\.json: it is a symbolic link/m);
  });

  test("aPullRequestThatEditsAWorkflowFails", () => {
    for (const file of [".github/workflows/pr.yml", ".github/workflows/static.yml", "tools/lib/static-rules.mjs"]) {
      const { status, out } = runChecker(pullRequest((pr) => {
        fs.mkdirSync(path.dirname(path.join(pr, file)), { recursive: true });
        fs.writeFileSync(path.join(pr, file), "run: node checker/tools/static-checks.mjs || true\n");
      }));
      assert.equal(status, 1, `${file}\n${out}`);
      assert.ok(out.includes(`the pull request changes ${file}, and a change there needs a maintainer-authored pull request`), out);
    }
  });

  test("aTsconfigOrJsconfigInAnExtensionFolderFails", () => {
    for (const file of [`extensions/${ID}/tsconfig.json`, `extensions/${ID}/src/jsconfig.json`]) {
      const { status, out } = runChecker(pullRequest((pr) => {
        fs.mkdirSync(path.dirname(path.join(pr, file)), { recursive: true });
        fs.writeFileSync(path.join(pr, file), JSON.stringify({ compilerOptions: { paths: { fflate: ["../../docs/n.js"] } } }));
      }));
      assert.equal(status, 1, `${file}\n${out}`);
      assert.ok(out.includes(`${file}: a TypeScript or JavaScript project file`), out);
    }
  });

  test("everyLineStartsWithFixedText", () => {
    // Paths a pull request names, starting with "::": as a link, in node_modules, and as case twins.
    const pr = pullRequest((root) => {
      fs.symlinkSync("README.md", path.join(root, "::stop-commands::x"));
      stage(root, "extensions/::warning::a/node_modules/x.js", "x\n");
      stage(root, "::notice::b/x.md", "x\n");
      stage(root, "extensions/dev.x.y/src/A.ts", "x\n");
      stage(root, "extensions/dev.x.y/src/a.ts", "x\n");
      git(root, "--literal-pathspecs", "add", "::stop-commands::x"); // a leading ":" is pathspec magic otherwise
    }, { add: false });
    const { status, out } = runChecker(pr, { GITHUB_ACTIONS: "true" });
    assert.equal(status, 1, out);
    const lines = out.split("\n").map((line) => line.trimStart()).filter((line) => line.startsWith("::"));
    assert.ok(lines.length >= 3, out);
    for (const line of lines) assert.match(line, /^::error title=[^:]*::/, line);
    // The same names through tools/lockfile-state.mjs on the checkout, as publishing runs it.
    git(pr, "checkout", "-q", "-f", "pr");
    const state = spawnSync(process.execPath, [path.join(repo, "tools", "lockfile-state.mjs"), "--root", pr], { encoding: "utf8" });
    assert.equal(state.status, 1, state.stdout);
    for (const line of state.stdout.split("\n")) assert.doesNotMatch(line.trimStart(), /^::/, line);
  });

  test("pullRequestTextCannotWriteWorkflowCommands", () => {
    const id = "dev.x:y,z";
    const file = "tools/x\n::notice::injected %25 a:b,c.mjs";
    const { status, out } = runChecker(pullRequest((pr) => {
      stage(pr, `extensions/${id}/README.md`, "# x\n");
      stage(pr, file, "x\n");
    }, { add: false }), { GITHUB_ACTIONS: "true" });
    assert.equal(status, 1, out);
    const commands = out.split("\n").map((line) => line.trimStart()).filter((line) => line.startsWith("::"));
    assert.ok(commands.length > 0, out);
    for (const command of commands) assert.match(command, /^::error title=[^:]*::/, command);
    const scope = commands.find((command) => command.includes("maintainer-authored"));
    assert.ok(scope.includes("tools/x%0A::notice::injected %2525 a:b,c.mjs"), scope);
    assert.ok(scope.startsWith("::error title=one extension folder per pull request%2C and nothing only the maintainer changes (extensions/dev.x%3Ay%2Cz/)::"), scope);
    assert.ok(out.includes("tools/x\\u000a::notice::injected %25 a:b,c.mjs"), "the plain log shows the newline as \\u000a");
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
    assert.match(text, /node-version: 24\n/, "npm 11: npm 10 runs a git dependency's prepare even with --ignore-scripts");
    const { checks, ...others } = jobsOf(text);
    assert.deepEqual(Object.keys(others), [], "the static checks are static.yml's, where the pull request cannot change them");
    assert.match(checks, /run: npm ci --ignore-scripts\n/, "no install script of the pull request runs before the checks");
    assert.doesNotMatch(text, /run: npm ci\n/);
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

  test("theStaticWorkflowRunsTheBaseBranchsCheckerOnThePullRequestAsData", () => {
    const text = workflow("static.yml");
    const code = text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
    // pull_request_target: the workflow file and the checker come from the base branch, whatever the pull request edits.
    // Pull requests to main only: a status from a run against another base branch could otherwise mark a head commit.
    assert.match(code, /^on:\n {2}pull_request_target:\n {4}branches: \[main\]\n {4}types: \[opened, reopened, synchronize, edited\]\n\n/m);
    assert.doesNotMatch(text, /^ {2}pull_request:/m);
    assert.match(text, /^permissions:\n {2}contents: read\n {2}statuses: write\n(?! )/m, "read the repository, set commit statuses, nothing more");
    assert.doesNotMatch(text, /^ {4}permissions:/m, "no job asks for more");
    assert.doesNotMatch(code, /secrets\.|\bnpm\b|setup-node|node_modules|cache|\benvironment:/, "no secret, nothing installed, no cache");
    const jobs = jobsOf(text);
    assert.deepEqual(Object.keys(jobs), ["static"]);
    assert.match(jobs.static, /^ {4}name: Static checks$/m);
    const steps = jobs.static.split(/(?<=\n) {6}- /).slice(1);
    assert.equal(steps.length, 4, jobs.static);
    assert.match(steps[0], /^uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}with:\n {10}ref: \$\{\{ github\.sha \}\}\n {10}path: checker\n {10}sparse-checkout: \|\n {12}\/tools\/lockfile-state\.mjs\n {12}\/tools\/static-checks\.mjs\n {12}\/tools\/lib\/static-rules\.mjs\n {10}sparse-checkout-cone-mode: false\n {10}persist-credentials: false\n/);
    assert.match(steps[1], /^uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}with:\n {10}ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n {10}path: pr\n {10}fetch-depth: 0\n {10}persist-credentials: false\n {10}allow-unsafe-pr-checkout: true\n/,
      "actions/checkout v7 refuses a fork's head under pull_request_target without the flag");
    // That step only: the checker's checkout, and every other workflow, keep checkout's guard.
    assert.equal(code.match(/allow-unsafe-pr-checkout/g)?.length, 1);
    for (const name of ["pr.yml", "pr-label.yml", "publish.yml"]) assert.doesNotMatch(workflow(name), /allow-unsafe-pr-checkout/, name);
    // The base branch's checker, and only it, runs; its exit code is what the status reports.
    assert.equal(steps[2], [
      "name: Static checks",
      "        id: checker",
      "        env:",
      "          BASE_SHA: ${{ github.sha }}",
      "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
      "        run: |",
      "          code=0",
      "          node checker/tools/static-checks.mjs --root pr --base \"$BASE_SHA\" --head \"$HEAD_SHA\" || code=$?",
      "          echo \"exit-code=$code\" >> \"$GITHUB_OUTPUT\"",
      "          exit \"$code\"",
      "",
    ].join("\n"));
    // The status: always posted, from the checker's result alone, under the one context branch protection requires.
    assert.match(steps[3], /^name: Post the commit status\n {8}if: always\(\) && github\.event\.pull_request\.base\.ref == 'main'\n {8}uses: actions\/github-script@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}env:\n {10}OUTCOME: \$\{\{ steps\.checker\.outcome \}\}\n {10}EXIT_CODE: \$\{\{ steps\.checker\.outputs\.exit-code \}\}\n {8}with:\n {10}script: \|\n/);
    assert.equal(steps[3].match(/context: "([^"]+)"/)?.[1], "store/static-checks");
    assert.match(steps[3], /sha: context\.payload\.pull_request\.head\.sha,/);
    assert.doesNotMatch(steps[3], /require\(|import\(|\bexec|child_process|\bfs\b|readFile|\bpr\//, "it reads nothing of the pull request and runs nothing");
    assert.equal(code.match(/^\s*(?:- )?run:/gm)?.length, 1, "one shell step: the checker");
    // Commit SHAs, the pull request's number and the checker's result only: no text the pull request writes.
    const expressions = [...new Set(text.match(/\$\{\{.*?\}\}/g))].sort();
    assert.deepEqual(expressions, ["${{ github.event.pull_request.head.sha }}", "${{ github.event.pull_request.number }}", "${{ github.sha }}",
      "${{ steps.checker.outcome }}", "${{ steps.checker.outputs.exit-code }}"]);
  });

  test("theStaticWorkflowPostsSuccessOnlyWhenTheCheckerPassed", async () => {
    const text = workflow("static.yml");
    const script = text.slice(text.indexOf("script: |\n") + "script: |\n".length).split("\n").map((line) => line.slice(12)).join("\n");
    const AsyncFunction = (async () => {}).constructor;
    const post = async (outcome, exitCode) => {
      const posted = [];
      const github = { rest: { repos: { createCommitStatus: async (status) => posted.push(status) } } };
      const context = { repo: { owner: "owner", repo: "store" }, serverUrl: "https://github.com", runId: 42,
        payload: { pull_request: { head: { sha: "c0ffee" }, base: { sha: "base" } } } };
      const saved = { OUTCOME: process.env.OUTCOME, EXIT_CODE: process.env.EXIT_CODE };
      Object.assign(process.env, { OUTCOME: outcome, EXIT_CODE: exitCode });
      try {
        await new AsyncFunction("github", "context", "core", script)(github, context, {});
      } finally {
        for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      assert.equal(posted.length, 1);
      assert.equal(posted[0].context, "store/static-checks");
      assert.equal(posted[0].sha, "c0ffee", "on the pull request's head commit");
      assert.equal(posted[0].target_url, "https://github.com/owner/store/actions/runs/42");
      return posted[0].state;
    };
    assert.equal(await post("success", "0"), "success");
    for (const [outcome, exitCode] of [["failure", "1"], ["failure", "2"], ["success", ""], ["success", "1"], ["failure", "0"], ["cancelled", ""], ["skipped", ""], ["", ""]]) {
      assert.equal(await post(outcome, exitCode), "failure", `${outcome} / ${exitCode}`);
    }
  });

  test("publishingStopsOnALockfileStateProblemBeforeInstalling", () => {
    const { build } = jobsOf(workflow("publish.yml"));
    const runs = [...build.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(runs.slice(0, 2), ["node tools/lockfile-state.mjs", "npm ci --ignore-scripts"]);
  });

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
    assert.match(build, /node-version: 24\n/, "npm 11, which keeps --ignore-scripts for git dependencies too");
    assert.match(build, /run: node tools\/catalog\.mjs --out site\/v1\n/, "not npm run, which puts node_modules/.bin first on PATH");
    assert.doesNotMatch(build, /npm run|(?<![\w-])cache:/);
    assert.match(deploy, /needs: sign/);
    assert.match(deploy, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
    assert.match(deploy, /name: github-pages/);
    assert.match(deploy, /pages: write\n {6}id-token: write/);
    assert.doesNotMatch(sign, /pages: write|id-token/);
  });

  test("publishingUsesNoNpmCache", () => {
    // npm takes a cached package by its integrity alone, whatever address the lockfile names: publish starts cold.
    const text = workflow("publish.yml");
    assert.doesNotMatch(text, /^\s*cache:|actions\/cache|cache-dependency-path/m);
    const setups = text.split("- uses: ").filter((step) => step.startsWith("actions/setup-node@"));
    assert.equal(setups.length, 1);
    assert.match(setups[0], /\n {10}package-manager-cache: false\n/, "setup-node caches by itself when package.json names npm as its packageManager");
  });

  test("everyActionIsPinnedToACommit", () => {
    const names = fs.readdirSync(path.join(repo, ".github", "workflows")).filter((name) => name.endsWith(".yml")).sort();
    assert.deepEqual(names, ["pr-label.yml", "pr.yml", "publish.yml", "static.yml"]);
    for (const name of names) {
      const uses = [...workflow(name).matchAll(/^\s*(?:- )?uses: (\S+)(.*)$/gm)];
      assert.ok(uses.length > 0, name);
      for (const [, action, comment] of uses) {
        assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/, `${name}: ${action}`);
        assert.match(comment, /^ # v\d+\.\d+\.\d+$/, `${name}: ${action} names its version`);
      }
    }
  });
});
