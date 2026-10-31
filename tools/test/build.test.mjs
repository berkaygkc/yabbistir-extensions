import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";

import { repo, run, scratchRoot, sha256 } from "./helpers.mjs";

const roots = [];
const fresh = (template = "action", id = "dev.example.sample") => {
  const root = scratchRoot();
  roots.push(root);
  assert.equal(run("new", [id, "--template", template], { root }).status, 0);
  return root;
};
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const ID = "dev.example.sample";

describe("npm run build", () => {
  test("buildIsDeterministic", () => {
    const root = fresh();
    const archive = path.join(root, "dist", `${ID}-1.0.0.yabext`);
    assert.equal(run("build", [ID], { root }).status, 0);
    const first = sha256(archive);
    const firstJS = sha256(path.join(root, "dist", ID, "index.js"));
    fs.rmSync(path.join(root, "dist"), { recursive: true });
    const second = run("build", [ID], { root });
    assert.equal(second.status, 0, second.out);
    assert.equal(sha256(archive), first, "the same input gives the same bytes");
    assert.equal(sha256(path.join(root, "dist", ID, "index.js")), firstJS);
    // Another run later, over the old dist, still gives the same bytes.
    assert.equal(run("build", [ID], { root }).status, 0);
    assert.equal(sha256(archive), first);
  });

  test("aLinkIsRefusedBeforeAnythingIsCopied", () => {
    const root = fresh();
    const outside = path.join(root, "outside.png");
    fs.writeFileSync(outside, "whatever the link points at");
    fs.symlinkSync(outside, path.join(root, "extensions", ID, "icon.png"));
    const result = run("build", [ID], { root });
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, new RegExp(`extensions/${ID.replaceAll(".", "\\.")}/icon\\.png: it is a symbolic link`));
    assert.ok(!fs.existsSync(path.join(root, "dist", ID, "icon.png")), "the link's target is never copied");
    assert.ok(!fs.existsSync(path.join(root, "dist", `${ID}-1.0.0.yabext`)));
  });

  test("theArchiveHoldsTheFolderWithFixedDates", () => {
    const root = fresh();
    assert.equal(run("build", [ID], { root }).status, 0);
    const bytes = fs.readFileSync(path.join(root, "dist", `${ID}-1.0.0.yabext`));
    const names = Object.keys(unzipSync(new Uint8Array(bytes)));
    assert.deepEqual(names, [...names].sort(), "entries are sorted");
    assert.deepEqual(names, [
      `${ID}/CHANGELOG.md`, `${ID}/README.md`, `${ID}/index.js`, `${ID}/locales/en.json`, `${ID}/locales/tr.json`, `${ID}/manifest.json`,
    ]);
    // The DOS date of every entry (central directory: time at +12, date at +14) is 1980-01-01 00:00.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let found = 0;
    for (let at = 0; at + 46 <= bytes.length; at++) {
      if (view.getUint32(at, true) !== 0x02014b50) continue;
      assert.equal(view.getUint16(at + 12, true), 0, "time");
      assert.equal(view.getUint16(at + 14, true), (0 << 9) | (1 << 5) | 1, "date is 1980-01-01");
      found++;
    }
    assert.equal(found, names.length);
  });

  test("theArchiveUnpacksWithDittoAsTheAppDoes", { skip: process.platform !== "darwin" }, () => {
    const root = fresh();
    assert.equal(run("build", [ID], { root }).status, 0);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "yab-ditto-"));
    roots.push(target);
    const result = spawnSync("/usr/bin/ditto", ["-x", "-k", path.join(root, "dist", `${ID}-1.0.0.yabext`), target]);
    assert.equal(result.status, 0);
    assert.ok(fs.existsSync(path.join(target, ID, "manifest.json")));
    assert.ok(fs.existsSync(path.join(target, ID, "index.js")));
    assert.equal(fs.statSync(path.join(target, ID, "index.js")).mode & 0o777, 0o644);
  });

  test("buildProducesTheShapeTheAppRuns", () => {
    const root = fresh();
    const made = run("build", [ID], { root });
    assert.equal(made.status, 0, made.out);
    const dist = path.join(root, "dist", ID);
    assert.deepEqual(fs.readdirSync(dist).sort(), ["CHANGELOG.md", "README.md", "index.js", "locales", "manifest.json"]);
    const source = fs.readFileSync(path.join(dist, "index.js"), "utf8");
    assert.match(source, /exports|module\.exports/, "a CommonJS bundle with the extension's exports, like the app's own builder");
    assert.doesNotMatch(source, /^import |\brequire\(/m);
    assert.match(made.out, /validated|ok/i);
  });

  test("nodeBuiltinsFailTheBuild", () => {
    for (const code of [
      `import { readFileSync } from "node:fs";\nexport const actions = { a: { run: () => ({ text: String(readFileSync) }) } };\n`,
      `import path from "path";\nexport const actions = { a: { run: () => ({ text: path.sep }) } };\n`,
    ]) {
      const root = fresh();
      fs.writeFileSync(path.join(root, "extensions", ID, "src", "index.ts"), code);
      const failed = run("build", [ID], { root });
      assert.equal(failed.status, 1, failed.out);
      assert.match(failed.out, /docs\/errors\.md#node-builtins/);
      assert.match(failed.out, /fs|path/);
      assert.ok(!fs.existsSync(path.join(root, "dist", `${ID}-1.0.0.yabext`)), "no archive is made");
    }
  });

  test("nodeGlobalsFailTheBuildToo", () => {
    for (const [name, code] of [
      ["process", `export const actions = { a: { run: () => ({ text: process.platform }) } };\n`],
      ["Buffer", `export const actions = { a: { run: () => ({ text: Buffer.from("a").toString() }) } };\n`],
      ["require", `export const actions = { a: { run: () => ({ text: String(require("x")) }) } };\n`],
    ]) {
      const root = fresh();
      fs.writeFileSync(path.join(root, "extensions", ID, "src", "index.ts"), `declare const ${name}: any;\n${code}`);
      const failed = run("build", [ID], { root });
      assert.equal(failed.status, 1, `${name}: ${failed.out}`);
      assert.match(failed.out, new RegExp(`\\b${name}\\b`));
      assert.match(failed.out, /docs\/errors\.md#node-builtins/);
    }
  });

  test("aLocalNamedLikeAGlobalIsFine", () => {
    const root = fresh();
    fs.writeFileSync(path.join(root, "extensions", ID, "src", "index.ts"),
      `export const actions = { a: { run: () => { const process = (x: number) => x + 1; const Buffer = "b"; return { text: String(process(1)) + Buffer }; } } };\n`);
    const built = run("build", [ID], { root });
    assert.equal(built.status, 0, built.out);
  });

  test("aTypeErrorOrASyntaxErrorFailsWithAMessage", () => {
    const root = fresh();
    fs.writeFileSync(path.join(root, "extensions", ID, "src", "index.ts"), "export const actions = {\n");
    const failed = run("build", [ID], { root });
    assert.equal(failed.status, 1);
    assert.match(failed.out, /index\.ts/);
  });

  test("buildFailsWhenTheValidatorFindsAnError", () => {
    const root = fresh();
    const file = path.join(root, "extensions", ID, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.license = "GPL-3.0";
    fs.writeFileSync(file, JSON.stringify(manifest));
    const failed = run("build", [ID], { root });
    assert.equal(failed.status, 1);
    assert.match(failed.out, /license/);
    assert.ok(!fs.existsSync(path.join(root, "dist", `${ID}-1.0.0.yabext`)));
  });

  test("buildAnUnknownIdFails", () => {
    const root = fresh();
    const failed = run("build", ["dev.example.missing"], { root });
    assert.equal(failed.status, 1);
    assert.match(failed.out, /no such extension/i);
  });
});

describe("npm run dev", () => {
  const home = () => {
    const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yab-home-")));
    roots.push(folder);
    return folder;
  };
  const extensions = (folder) => path.join(folder, "Library", "Application Support", "yabbistir", "Extensions");

  test("devRefusesToReplaceARealFolder", () => {
    const root = fresh();
    const HOME = home();
    const target = path.join(extensions(HOME), ID);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "manifest.json"), "{}");
    const refused = run("dev", [ID, "--once"], { root, env: { HOME } });
    assert.equal(refused.status, 1, refused.out);
    assert.match(refused.out, /installed copy|real folder/i);
    assert.ok(!fs.lstatSync(target).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(target, "manifest.json"), "utf8"), "{}", "the folder is untouched");
    assert.deepEqual(fs.readdirSync(target), ["manifest.json"]);
  });

  test("devLinksTheBuiltFolder", () => {
    const root = fresh();
    const HOME = home();
    const linked = run("dev", [ID, "--once"], { root, env: { HOME } });
    assert.equal(linked.status, 0, linked.out);
    const target = path.join(extensions(HOME), ID);
    assert.ok(fs.lstatSync(target).isSymbolicLink());
    assert.equal(fs.realpathSync(target), fs.realpathSync(path.join(root, "dist", ID)));
    assert.ok(fs.existsSync(path.join(target, "index.js")));
    // Running it again replaces the link, never a real folder.
    assert.equal(run("dev", [ID, "--once"], { root, env: { HOME } }).status, 0);
    assert.ok(fs.lstatSync(target).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(root, "dist", `${ID}-1.0.0.yabext`)), "dev does not package");
  });

  test("devStillLinksWhenTheManifestHasProblems", () => {
    const root = fresh();
    const HOME = home();
    const file = path.join(root, "extensions", ID, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.license = "GPL-3.0";
    fs.writeFileSync(file, JSON.stringify(manifest));
    const linked = run("dev", [ID, "--once"], { root, env: { HOME } });
    assert.equal(linked.status, 0, linked.out);
    assert.match(linked.out, /license/);
    assert.ok(fs.lstatSync(path.join(extensions(HOME), ID)).isSymbolicLink());
  });
});

describe("safety and cwd independence", () => {
  test("buildRefusesAPathLikeId", () => {
    const root = fresh();
    for (const id of ["../templates/action", "..", "a/b", ".hidden"]) {
      const failed = run("build", [id], { root });
      assert.equal(failed.status, 1, id);
      assert.match(failed.out, /not an extension id|no such extension/, id);
    }
    assert.ok(fs.existsSync(path.join(root, "extensions", ID, "src", "index.ts")));
  });

  test("pruneNeverTouchesAnythingOutsideDist", async () => {
    const { pruneExcept } = await import("../lib/build.mjs");
    const root = fresh();
    const outside = path.join(root, "extensions", ID);
    assert.throws(() => pruneExcept(outside, new Set(), "", root), /not inside dist/);
    assert.throws(() => pruneExcept(path.join(root, "dist"), new Set(), "", root), /not inside dist/);
    assert.ok(fs.existsSync(path.join(outside, "src", "index.ts")));
  });

  test("buildIsTheSameFromAnyWorkingDirectory", () => {
    const root = fresh();
    const archive = path.join(root, "dist", `${ID}-1.0.0.yabext`);
    const build = (cwd) => spawnSync(process.execPath, [path.join(repo, "tools", "build.mjs"), "--root", root, ID], { cwd, encoding: "utf8" });
    assert.equal(build(root).status, 0);
    const first = sha256(archive);
    fs.rmSync(path.join(root, "dist"), { recursive: true });
    assert.equal(build(os.tmpdir()).status, 0);
    assert.equal(sha256(archive), first);
  });
});
