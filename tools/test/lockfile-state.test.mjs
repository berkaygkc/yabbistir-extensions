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

/** A committed repository with this one's package.json and package-lock.json and one extension; `change` edits it first. */
function tree(change = () => {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yab-state-")));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(repo, file), path.join(root, file));
  fs.mkdirSync(path.join(root, "extensions", ID, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "extensions", ID, "src", "index.ts"), "export const actions = {};\n");
  change(root);
  git(root, "add", "-A", "-f");
  git(root, "commit", "-q", "-m", "tree");
  return root;
}
const editLock = (root, edit) => {
  const file = path.join(root, "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(lock.packages, lock);
  fs.writeFileSync(file, JSON.stringify(lock, null, 2));
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

  test("anAliasMustNameItsTarget", () => {
    const alias = (name, spec) => (dir) => editLock(dir, (packages) => {
      packages[""].devDependencies.zip = spec;
      packages["node_modules/zip"] = { ...packages["node_modules/fflate"], name };
    });
    assert.equal(check(tree(alias("fflate", "npm:fflate@0.8.3"))).status, 0, "npm writes an alias's own name");
    const other = check(tree(alias("fflate", "npm:is-number@7.0.0")));
    assert.equal(other.status, 1, other.out);
    assert.match(other.out, /node_modules\/zip: .*alias/);
    const undeclared = check(tree((dir) => editLock(dir, (packages) => { packages["node_modules/zip"] = { ...packages["node_modules/fflate"], name: "fflate" }; })));
    assert.equal(undeclared.status, 1, "a name no npm: alias asks for");
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
  });

  test("itImportsOnlyNodesBuiltInModules", () => {
    const text = fs.readFileSync(TOOL, "utf8");
    const specifiers = [...text.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/g)].map((match) => match[1] ?? match[2]);
    assert.ok(specifiers.length > 0);
    assert.deepEqual(specifiers.filter((specifier) => !specifier.startsWith("node:")), []);
  });
});
