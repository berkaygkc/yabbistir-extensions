import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

import { checkSchema } from "../lib/json-schema.mjs";
import { repo, run, scratchRoot } from "./helpers.mjs";

const STORE = "https://berkaygkc.github.io/yabbistir-extensions/v1";
const FIRST = "dev.example.first";
const SECOND = "dev.example.second";
const catalogSchema = JSON.parse(fs.readFileSync(path.join(repo, "schema", "catalog.schema.json"), "utf8"));
// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function git(root, args, date) {
  const dates = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {};
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...dates } });
  assert.equal(result.status, 0, result.stderr);
}

/**
 * A repository with two committed extensions: FIRST (an action with an SF Symbol) at 2026-10-01 12:00 +03:00, and
 * SECOND (a detector with a file icon and a minAppVersion) at 2026-10-15 08:30 -04:00.
 */
function store() {
  const root = scratchRoot("yab-catalog-");
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  assert.equal(run("new", [FIRST, "--template", "action", "--author", "first-author"], { root }).status, 0);
  git(root, ["add", "extensions"]);
  git(root, ["commit", "-q", "-m", "first"], "2026-10-01T12:00:00+03:00");

  assert.equal(run("new", [SECOND, "--template", "detector", "--author", "second-author"], { root }).status, 0);
  const file = path.join(root, "extensions", SECOND, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...manifest, minAppVersion: "9.0.0", icon: "icon.png" }, null, 2));
  fs.writeFileSync(path.join(root, "extensions", SECOND, "icon.png"), PNG);
  git(root, ["add", "extensions"]);
  git(root, ["commit", "-q", "-m", "second"], "2026-10-15T08:30:00-04:00");
  return root;
}

/** Runs npm run catalog against `root`, writing into <root>/<out>. */
function catalog(root, out = "site/v1", { args = [], env = {} } = {}) {
  const result = run("catalog", ["--out", path.join(root, out), ...args], { root, env: { SOURCE_DATE_EPOCH: "", ...env } });
  return { ...result, folder: path.join(root, out) };
}

const read = (folder) => JSON.parse(fs.readFileSync(path.join(folder, "catalog.json"), "utf8"));
const entryOf = (folder, id) => read(folder).extensions.find((entry) => entry.id === id);
const keyPair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }), publicKey };
};

describe("npm run catalog", () => {
  test("catalogValidatesAgainstItsSchema", () => {
    const root = store();
    const { status, out, folder } = catalog(root);
    assert.equal(status, 0, out);
    const data = read(folder);
    assert.deepEqual(checkSchema(catalogSchema, data), []);
    assert.equal(data.formatVersion, 1);
    assert.deepEqual(data.extensions.map((entry) => entry.id), [FIRST, SECOND]);

    const first = entryOf(folder, FIRST);
    assert.deepEqual(Object.keys(first), ["id", "version", "apiVersion", "minAppVersion", "name", "description", "author", "categories",
      "icon", "permissions", "networkHosts", "tools", "sha256", "size", "updatedAt", "readme", "package"]);
    assert.deepEqual(first.name, { en: "First", tr: "First" });
    assert.deepEqual(first.description, { en: "Turns the text you copied around.", tr: "Kopyaladığın metni tersine çevirir." });
    assert.equal(first.author, "first-author");
    assert.deepEqual(first.categories, ["text"]);
    assert.equal(first.icon, "sf:arrow.left.arrow.right");
    assert.deepEqual([first.permissions, first.networkHosts, first.tools], [[], [], []]);
    assert.equal(first.readme, `https://github.com/berkaygkc/yabbistir-extensions/tree/main/extensions/${FIRST}`);
    assert.equal(first.package, `${STORE}/packages/${FIRST}-1.0.0.yabext`);

    // The package is exactly what npm run build writes, and the catalog describes those bytes.
    const bytes = fs.readFileSync(path.join(folder, "packages", `${FIRST}-1.0.0.yabext`));
    assert.deepEqual(bytes, fs.readFileSync(path.join(root, "dist", `${FIRST}-1.0.0.yabext`)));
    assert.equal(first.size, bytes.length);
    assert.equal(first.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    const names = Object.keys(unzipSync(new Uint8Array(bytes)));
    assert.ok(names.length > 0 && names.every((name) => name.startsWith(`${FIRST}/`)), "one folder at the root, named after the id");
    assert.ok(names.every((name) => !name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX")), names.join(", "));
  });

  test("datesAreTheLastCommitsInUTC", () => {
    const root = store();
    const { status, out, folder } = catalog(root);
    assert.equal(status, 0, out);
    assert.equal(entryOf(folder, FIRST).updatedAt, "2026-10-01T09:00:00Z");
    assert.equal(entryOf(folder, SECOND).updatedAt, "2026-10-15T12:30:00Z");
    assert.equal(read(folder).generatedAt, "2026-10-15T12:30:00Z", "the newest change");

    const epoch = catalog(root, "epoch", { env: { SOURCE_DATE_EPOCH: "1793000000" } });
    assert.equal(epoch.status, 0, epoch.out);
    assert.equal(read(epoch.folder).generatedAt, "2026-10-26T07:33:20Z");
    assert.equal(entryOf(epoch.folder, FIRST).updatedAt, "2026-10-01T09:00:00Z");
  });

  test("fileIconsArePublishedNextToTheCatalog", () => {
    const root = store();
    const { status, out, folder } = catalog(root);
    assert.equal(status, 0, out);
    assert.equal(entryOf(folder, SECOND).icon, `${STORE}/icons/${SECOND}.png`);
    assert.deepEqual(fs.readFileSync(path.join(folder, "icons", `${SECOND}.png`)), PNG);
    assert.deepEqual(fs.readdirSync(path.join(folder, "icons")), [`${SECOND}.png`]);
  });

  test("catalogIsDeterministic", () => {
    const root = store();
    const one = catalog(root, "one");
    const two = catalog(root, "two");
    assert.equal(one.status, 0, one.out);
    assert.equal(two.status, 0, two.out);
    const files = (folder) => fs.readdirSync(folder, { recursive: true }).filter((name) => fs.statSync(path.join(folder, name)).isFile()).sort();
    assert.deepEqual(files(one.folder), files(two.folder));
    for (const name of files(one.folder)) {
      assert.deepEqual(fs.readFileSync(path.join(one.folder, name)), fs.readFileSync(path.join(two.folder, name)), name);
    }
    // Over an earlier output: the same bytes, and a package no longer in the catalog is gone.
    const before = fs.readFileSync(path.join(one.folder, "catalog.json"));
    fs.writeFileSync(path.join(one.folder, "packages", "dev.example.gone-1.0.0.yabext"), "old");
    assert.equal(catalog(root, "one").status, 0);
    assert.deepEqual(fs.readFileSync(path.join(one.folder, "catalog.json")), before);
    assert.ok(!fs.existsSync(path.join(one.folder, "packages", "dev.example.gone-1.0.0.yabext")));
  });

  test("signatureVerifiesWithThePublicKey", () => {
    const root = store();
    const { pem, publicKey } = keyPair();
    const { status, out, folder } = catalog(root, "site/v1", { args: ["--sign-key-env", "TEST_CATALOG_KEY"], env: { TEST_CATALOG_KEY: pem } });
    assert.equal(status, 0, out);
    const bytes = fs.readFileSync(path.join(folder, "catalog.json"));
    const signature = Buffer.from(fs.readFileSync(path.join(folder, "catalog.json.sig"), "utf8").trim(), "base64");
    assert.equal(signature.length, 64);
    assert.ok(crypto.verify(null, bytes, publicKey, signature));
    // The app holds the raw 32-byte key.
    const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
    assert.equal(raw.length, 32);
    const rebuilt = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
    assert.ok(crypto.verify(null, bytes, rebuilt, signature));
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 2] ^= 1;
    assert.ok(!crypto.verify(null, tampered, publicKey, signature));
    assert.ok(!crypto.verify(null, bytes, keyPair().publicKey, signature), "another key does not verify it");
    assert.ok(!out.includes(pem.split("\n")[1]), "the key is never printed");
  });

  test("noKeyMeansNoSignatureFile", () => {
    const root = store();
    const { pem } = keyPair();
    const signed = catalog(root, "site/v1", { args: ["--sign-key-env", "TEST_CATALOG_KEY"], env: { TEST_CATALOG_KEY: pem } });
    assert.equal(signed.status, 0, signed.out);
    const signature = path.join(signed.folder, "catalog.json.sig");
    assert.ok(fs.existsSync(signature));

    const empty = catalog(root, "site/v1", { args: ["--sign-key-env", "TEST_CATALOG_KEY"], env: { TEST_CATALOG_KEY: "" } });
    assert.equal(empty.status, 0, empty.out);
    assert.ok(!fs.existsSync(signature), "an old signature never stays next to a new catalog");
    assert.match(empty.out, /TEST_CATALOG_KEY/);
    assert.match(empty.out, /not signed/);

    const unasked = catalog(root);
    assert.equal(unasked.status, 0, unasked.out);
    assert.ok(fs.existsSync(path.join(unasked.folder, "catalog.json")));
    assert.ok(!fs.existsSync(signature));
  });

  test("aKeyThatIsNotEd25519IsRefused", () => {
    const root = store();
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
    for (const key of [rsa, "not a key"]) {
      const { status, out, folder } = catalog(root, "site/v1", { args: ["--sign-key-env", "TEST_CATALOG_KEY"], env: { TEST_CATALOG_KEY: key } });
      assert.equal(status, 1, out);
      assert.match(out, /TEST_CATALOG_KEY/);
      assert.ok(!fs.existsSync(path.join(folder, "catalog.json.sig")));
      assert.ok(!fs.existsSync(path.join(folder, "catalog.json")), "no unsigned catalog is left for a publish to pick up");
      assert.ok(!out.includes(key.split("\n")[1] ?? key), "the key is never printed");
    }
  });

  test("incompatibleFieldsArePassedThrough", () => {
    const root = store();
    const { status, out, folder } = catalog(root);
    assert.equal(status, 0, out);
    assert.equal(entryOf(folder, SECOND).minAppVersion, "9.0.0", "an older app lists it but does not install it");
    assert.equal(entryOf(folder, FIRST).minAppVersion, null);
    assert.equal(entryOf(folder, SECOND).apiVersion, 1);
  });

  test("permissionsHostsAndToolsComeFromTheManifest", () => {
    const root = store();
    const file = path.join(root, "extensions", FIRST, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...manifest, permissions: ["network", "exec"], network: { domains: ["example.com"] },
      requires: { tools: [{ name: "yt-dlp", install: "brew install yt-dlp" }] } }, null, 2));
    git(root, ["commit", "-q", "-am", "permissions"], "2026-10-20T10:00:00Z");
    const { status, out, folder } = catalog(root);
    assert.equal(status, 0, out);
    const first = entryOf(folder, FIRST);
    assert.deepEqual([first.permissions, first.networkHosts, first.tools], [["network", "exec"], ["example.com"], ["yt-dlp"]]);
    assert.equal(first.updatedAt, "2026-10-20T10:00:00Z");
  });

  test("anExtensionThatDoesNotBuildFailsTheCatalog", () => {
    const root = store();
    fs.writeFileSync(path.join(root, "extensions", FIRST, "src", "index.ts"), "import fs from \"node:fs\";\nexport const actions = { a: { run: () => ({ text: String(fs) }) } };\n");
    git(root, ["commit", "-q", "-am", "broken"], "2026-10-20T10:00:00Z");
    const { status, out, folder } = catalog(root);
    assert.equal(status, 1);
    assert.match(out, new RegExp(FIRST.replaceAll(".", "\\.")));
    assert.ok(!fs.existsSync(path.join(folder, "catalog.json")), "never a catalog without one of the extensions");
  });

  test("anUncommittedExtensionIsRefused", () => {
    const root = store();
    assert.equal(run("new", ["dev.example.third", "--template", "action"], { root }).status, 0);
    const { status, out } = catalog(root);
    assert.equal(status, 1);
    assert.match(out, /dev\.example\.third/);
    assert.match(out, /commit/);
  });

  test("aFileIconMustBeAPngNamedIconPng", () => {
    const root = store();
    fs.writeFileSync(path.join(root, "extensions", SECOND, "icon.png"), "not a png");
    git(root, ["commit", "-q", "-am", "not a png"], "2026-10-20T10:00:00Z");
    const { status, out } = catalog(root);
    assert.equal(status, 1);
    assert.match(out, /icon\.png/);
  });
});
