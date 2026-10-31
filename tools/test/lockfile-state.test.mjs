import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { repo } from "./helpers.mjs";

const TOOL = path.join(repo, "tools", "lockfile-state.mjs");
const ID = "dev.example.tool";
const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function git(root, ...args) {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8", input: args.includes("--stdin") ? "content\n" : undefined });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function check(root) {
  const result = spawnSync(process.execPath, [TOOL, "--root", root], { encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** This repository's package files and one extension, in `root`. */
function fill(root) {
  for (const file of ["package.json", "package-lock.json", "packages/api/package.json"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  fs.mkdirSync(path.join(root, "extensions", ID, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "extensions", ID, "src", "index.ts"), "export const actions = {};\n");
}

/** A committed repository with this one's package files and one extension; `change` edits it first. */
function tree(change = () => {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yab-state-")));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  fill(root);
  change(root);
  git(root, "add", "-A", "-f");
  git(root, "commit", "-q", "-m", "tree");
  return root;
}
const editJson = (root, file, edit) => {
  const value = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  edit(value);
  fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2));
};
const editLock = (root, edit) => editJson(root, "package-lock.json", (lock) => edit(lock.packages, lock));
/** extensions/<ID> with a package.json that asks for fflate, and the lockfile entries npm writes for it. */
const withLibrary = (root, { manifest = {}, entry = {} } = {}) => {
  fs.writeFileSync(path.join(root, "extensions", ID, "package.json"), JSON.stringify({ name: ID, private: true, dependencies: { fflate: "0.8.3" }, ...manifest }));
  editLock(root, (packages) => {
    packages[`extensions/${ID}`] = { dependencies: { fflate: "0.8.3" }, ...entry };
    packages[`node_modules/${ID}`] = { resolved: `extensions/${ID}`, link: true };
  });
};
const sri = (seed) => `sha512-${crypto.createHash("sha512").update(seed).digest("base64")}`;

describe("node tools/lockfile-state.mjs", () => {
  test("itPassesOnThisRepository", () => {
    const { status, out } = check(repo);
    assert.equal(status, 0, out);
    assert.match(out, /lockfile state: ok/);
    assert.equal(check(tree()).status, 0);
  });

  test("aTarballOfAnotherPackageFails", () => {
    // The fflate entry with another package's tarball and integrity, as a no-op spec change would carry it.
    const root = tree((dir) => editLock(dir, (packages) => {
      packages["node_modules/fflate"].resolved = "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz";
      packages["node_modules/fflate"].integrity = sri("is-number");
    }));
    const { status, out } = check(root);
    assert.equal(status, 1, out);
    assert.match(out, /node_modules\/fflate: .*https:\/\/registry\.npmjs\.org\/fflate\/-\/fflate-0\.8\.3\.tgz/);
    const scoped = check(tree((dir) => editLock(dir, (packages) => {
      packages["node_modules/@esbuild/linux-x64"].resolved = "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.28.2.tgz";
    })));
    assert.equal(scoped.status, 1);
    assert.match(scoped.out, /node_modules\/@esbuild\/linux-x64/);
  });

  test("aMissingOrWeakIntegrityFails", () => {
    for (const integrity of [undefined, "sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=", "sha512-short"]) {
      const { status, out } = check(tree((dir) => editLock(dir, (packages) => {
        if (integrity === undefined) delete packages["node_modules/typescript"].integrity;
        else packages["node_modules/typescript"].integrity = integrity;
      })));
      assert.equal(status, 1, `${integrity}\n${out}`);
      assert.match(out, /node_modules\/typescript: .*sha512/);
    }
  });

  test("noAliasesAtAll", () => {
    // An entry whose name is not its folder installs one package under another's name: refused whatever asks for it.
    const alias = (spec) => (dir) => {
      editJson(dir, "package.json", (manifest) => { manifest.devDependencies.zip = spec; });
      editLock(dir, (packages) => {
        packages[""].devDependencies.zip = spec;
        packages["node_modules/zip"] = { ...packages["node_modules/fflate"], name: "fflate" };
      });
    };
    for (const spec of ["npm:fflate@0.8.3", "npm:is-number@7.0.0"]) {
      const { status, out } = check(tree(alias(spec)));
      assert.equal(status, 1, out);
      assert.match(out, /node_modules\/zip: it installs fflate under the name zip: an alias/, spec);
      assert.match(out, /^package\.json: devDependencies\.zip: an npm: alias/m, spec);
      assert.match(out, /the root entry: it asks for npm: aliases \(devDependencies\.zip\)/, spec);
    }
    const undeclared = check(tree((dir) => editLock(dir, (packages) => { packages["node_modules/zip"] = { ...packages["node_modules/fflate"], name: "fflate" }; })));
    assert.equal(undeclared.status, 1, "an alias nothing asks for");
    // attack M: package.json asks for is-number, and only the lockfile turns it into another package.
    const lockfileOnly = check(tree((dir) => withLibrary(dir, {
      manifest: { dependencies: { "is-number": "^6.0.0" } },
      entry: { dependencies: { "is-number": "npm:kind-of@6.0.3" } },
    }) || editLock(dir, (packages) => {
      packages["node_modules/is-number"] = { name: "kind-of", version: "6.0.3", resolved: "https://registry.npmjs.org/kind-of/-/kind-of-6.0.3.tgz", integrity: sri("kind-of") };
    })));
    assert.equal(lockfileOnly.status, 1, lockfileOnly.out);
    assert.match(lockfileOnly.out, /node_modules\/is-number: it installs kind-of under the name is-number/);
    assert.match(lockfileOnly.out, new RegExp(`extensions/${ID.replaceAll(".", "\\.")}: it asks for npm: aliases`));
    assert.match(lockfileOnly.out, new RegExp(`extensions/${ID.replaceAll(".", "\\.")}/package\\.json: its dependencies differ from package-lock\\.json's entry`));
  });

  test("theRootAndEveryWorkspaceAskForWhatTheirPackageJsonAsks", () => {
    assert.equal(check(tree((dir) => withLibrary(dir))).status, 0, "an extension with a library, as npm writes it");
    const cases = {
      "a workspace entry asks for another version": [(dir) => withLibrary(dir, { entry: { dependencies: { fflate: "0.8.2" } } }), /extensions\/dev\.example\.tool\/package\.json: its dependencies differ/],
      "the root entry asks for another version": [(dir) => editLock(dir, (packages) => { packages[""].devDependencies.typescript = "7.0.1"; }), /^package\.json: its devDependencies differ from package-lock\.json's entry for the root/m],
      "the root's workspaces differ": [(dir) => editLock(dir, (packages) => { packages[""].workspaces = ["packages/*", "extensions/*", "tools"]; }), /^package\.json: its workspaces differ/m],
      "a workspace without its package.json": [(dir) => withLibrary(dir) || fs.rmSync(path.join(dir, "extensions", ID, "package.json")), /package\.json: it is missing, but package-lock\.json has an entry for extensions\/dev\.example\.tool/],
      "a package.json without its workspace entry": [(dir) => fs.writeFileSync(path.join(dir, "extensions", ID, "package.json"), JSON.stringify({ name: ID, private: true })), /package-lock\.json has no entry for extensions\/dev\.example\.tool/],
    };
    for (const [name, [change, expected]] of Object.entries(cases)) {
      const { status, out } = check(tree(change));
      assert.equal(status, 1, `${name}\n${out}`);
      assert.match(out, expected, name);
    }
  });

  test("anExtensionsPackageIsNamedAfterItsId", () => {
    // attack R: the extension's package calls itself fflate, and npm links node_modules/fflate to the extension.
    const { status, out } = check(tree((dir) => {
      fs.writeFileSync(path.join(dir, "extensions", ID, "package.json"), JSON.stringify({ name: "fflate", version: "0.8.3", private: true, main: "src/shim.js" }));
      editLock(dir, (packages) => {
        packages[`extensions/${ID}`] = { name: "fflate", version: "0.8.3" };
        packages["node_modules/fflate"] = { resolved: `extensions/${ID}`, link: true };
      });
    }));
    assert.equal(status, 1, out);
    assert.match(out, /extensions\/dev\.example\.tool: it names its package fflate, but an extension's package is named after its id/);
    assert.match(out, /extensions\/dev\.example\.tool\/package\.json: its name is "fflate", not the extension's id/);
    assert.match(out, /node_modules\/fflate: it links extensions\/dev\.example\.tool under another name than its package's/);
    // A link that leaves the workspace folders through "..".
    const parent = check(tree((dir) => editLock(dir, (packages) => {
      packages["extensions/.."] = { name: "x" };
      packages["node_modules/x"] = { resolved: "extensions/..", link: true };
    })));
    assert.equal(parent.status, 1, parent.out);
    assert.match(parent.out, /extensions\/\.\.: it has an empty, "\." or "\.\." part/);
    assert.match(parent.out, /node_modules\/x: it links somewhere other than a workspace folder/);
  });

  test("linksAreRefused", () => {
    // attack Q: the lockfile is a link, which a check and npm in another folder would follow to different files.
    const lockLink = check(tree((dir) => {
      fs.renameSync(path.join(dir, "package-lock.json"), path.join(dir, "foo.json"));
      fs.symlinkSync(path.join(dir, "foo.json"), path.join(dir, "package-lock.json"));
    }));
    assert.equal(lockLink.status, 1, lockLink.out);
    assert.match(lockLink.out, /^package-lock\.json: it is a symbolic link/m);
    for (const file of ["package.json", ".npmrc", "docs/x.md"]) {
      const { status, out } = check(tree((dir) => {
        fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
        if (file === "package.json") fs.renameSync(path.join(dir, file), path.join(dir, "real.json"));
        fs.symlinkSync(file === "package.json" ? path.join(dir, "real.json") : "/nonexistent/file", path.join(dir, file));
      }));
      assert.equal(status, 1, `${file}\n${out}`);
      assert.ok(out.includes(`${file}: a symbolic link or a submodule`), `${file}\n${out}`);
    }
    // Outside git, from the disk itself: a link to a lockfile that would pass is still refused.
    const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yab-state-")));
    roots.push(plain);
    fill(plain);
    fs.renameSync(path.join(plain, "package-lock.json"), path.join(plain, "real.json"));
    fs.symlinkSync("real.json", path.join(plain, "package-lock.json"));
    const disk = check(plain);
    assert.equal(disk.status, 1, disk.out);
    assert.match(disk.out, /^package-lock\.json: it is a symbolic link/m);
  });

  test("oneIntegrityForTwoPackagesFails", () => {
    // npm takes a cached package by its integrity: the same hash for typescript would install the cached fflate.
    const { status, out } = check(tree((dir) => editLock(dir, (packages) => { packages["node_modules/typescript"].integrity = packages["node_modules/fflate"].integrity; })));
    assert.equal(status, 1, out);
    assert.match(out, /node_modules\/typescript: it has the same integrity hash as fflate@0\.8\.3/);
    assert.match(out, /node_modules\/fflate: it has the same integrity hash as typescript@7\.0\.2/);
  });

  test("aBundledEntryIsRefused", () => {
    const { status, out } = check(tree((dir) => editLock(dir, (packages) => {
      packages["node_modules/esbuild/node_modules/inner"] = { version: "1.0.0", inBundle: true, license: "MIT" };
    })));
    assert.equal(status, 1, out);
    assert.match(out, /node_modules\/esbuild\/node_modules\/inner/);
  });

  test("aShrinkwrapOrAnNpmrcFails", () => {
    for (const file of ["npm-shrinkwrap.json", ".npmrc"]) {
      const { status, out } = check(tree((dir) => fs.writeFileSync(path.join(dir, file), file === ".npmrc" ? "registry=https://example.com/\n" : "{}\n")));
      assert.equal(status, 1, `${file}\n${out}`);
      assert.ok(out.includes(`${file}:`), out);
    }
  });

  test("committedNodeModulesFail", () => {
    const { status, out } = check(tree((dir) => {
      fs.mkdirSync(path.join(dir, "extensions", ID, "node_modules", "lib"), { recursive: true });
      fs.writeFileSync(path.join(dir, "extensions", ID, "node_modules", "lib", "index.js"), "module.exports = 1;\n");
    }));
    assert.equal(status, 1, out);
    assert.match(out, new RegExp(`extensions/${ID.replaceAll(".", "\\.")}/node_modules/lib/index\\.js`));
    // Directly under extensions/ too, where no extension folder holds it.
    const top = check(tree((dir) => {
      fs.mkdirSync(path.join(dir, "extensions", "node_modules", "lib"), { recursive: true });
      fs.writeFileSync(path.join(dir, "extensions", "node_modules", "lib", "index.js"), "module.exports = 1;\n");
    }));
    assert.equal(top.status, 1, top.out);
    assert.match(top.out, /extensions\/node_modules\/lib\/index\.js: node_modules is committed/);
  });

  test("pathsThatDifferOnlyByCaseFail", () => {
    // Added to the index directly: a case-insensitive disk cannot hold both, which is the point.
    const root = tree();
    const blob = git(root, "hash-object", "-w", "--stdin");
    git(root, "update-index", "--add", "--cacheinfo", `100644,${blob},extensions/${ID}/src/Index.ts`);
    git(root, "update-index", "--add", "--cacheinfo", `100644,${blob},extensions/${ID}/SRC/more.ts`);
    git(root, "commit", "-q", "-m", "case");
    const { status, out } = check(root);
    assert.equal(status, 1, out);
    assert.match(out, /src\/Index\.ts/);
    assert.match(out, /SRC/);
    // The same name in two Unicode normalizations (é as one character, and as e with a combining accent).
    const twins = tree();
    const text = git(twins, "hash-object", "-w", "--stdin");
    // A Mac's git would turn the second name into the first (core.precomposeUnicode), as its disk would.
    git(twins, "-c", "core.precomposeUnicode=false", "update-index", "--add", "--cacheinfo", `100644,${text},extensions/${ID}/src/caf\u00e9.ts`);
    git(twins, "-c", "core.precomposeUnicode=false", "update-index", "--add", "--cacheinfo", `100644,${text},extensions/${ID}/src/cafe\u0301.ts`);
    git(twins, "commit", "-q", "-m", "twins");
    const nfc = check(twins);
    assert.equal(nfc.status, 1, nfc.out);
    assert.match(nfc.out, /differ only in letter case or Unicode normalization/);
  });

  test("itImportsOnlyNodesBuiltInModules", () => {
    const text = fs.readFileSync(TOOL, "utf8");
    const specifiers = [...text.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/g)].map((match) => match[1] ?? match[2]);
    assert.ok(specifiers.length > 0);
    assert.deepEqual(specifiers.filter((specifier) => !specifier.startsWith("node:")), []);
  });
});
