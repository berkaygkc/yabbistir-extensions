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

  test("theCatalogIsNeverSigned", () => {
    const root = store();
    const folder = path.join(root, "site/v1");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "catalog.json.sig"), "an old signature");
    const { status, out } = catalog(root);
    assert.equal(status, 0, out);
    assert.ok(!fs.existsSync(path.join(folder, "catalog.json.sig")), "an old signature never stays next to a new catalog");
    const asked = catalog(root, "site/v1", { args: ["--sign-key-env", "TEST_CATALOG_KEY"], env: { TEST_CATALOG_KEY: keyPair().pem } });
    assert.equal(asked.status, 2, "signing is tools/sign.mjs's alone");
    assert.match(asked.out, /Unknown argument: --sign-key-env/);
  });

  test("datesComeFromTheMainLine", () => {
    // A branch commit can carry any date; the merge on main is what dates the change.
    const root = store();
    git(root, ["checkout", "-q", "-b", "feature"]);
    fs.appendFileSync(path.join(root, "extensions", FIRST, "README.md"), "\nMore.\n");
    git(root, ["commit", "-q", "-am", "backdated"], "2030-01-01T00:00:00Z");
    git(root, ["checkout", "-q", "main"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "merge", "feature"], "2026-10-20T10:00:00Z");
    const { status, out, folder } = catalog(root);
    assert.equal(status, 0, out);
    assert.equal(entryOf(folder, FIRST).updatedAt, "2026-10-20T10:00:00Z");
    assert.equal(read(folder).generatedAt, "2026-10-20T10:00:00Z");
    assert.equal(entryOf(folder, SECOND).updatedAt, "2026-10-15T12:30:00Z");
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

describe("node tools/sign.mjs", () => {
  const signerSource = path.join(repo, "tools", "sign.mjs");

  /** A catalog from store(), and a folder holding nothing but a copy of tools/sign.mjs (and `keys`, when given). */
  function setUp({ keys } = {}) {
    const root = store();
    const built = catalog(root);
    assert.equal(built.status, 0, built.out);
    const alone = fs.mkdtempSync(path.join(root, "signer-"));
    fs.mkdirSync(path.join(alone, "tools"));
    fs.copyFileSync(signerSource, path.join(alone, "tools", "sign.mjs"));
    if (keys !== undefined) {
      fs.mkdirSync(path.join(alone, "keys"));
      fs.writeFileSync(path.join(alone, "keys", "catalog-public-keys.json"), typeof keys === "string" ? keys : JSON.stringify({ keys }));
    }
    return { folder: built.folder, catalogFile: path.join(built.folder, "catalog.json"), alone };
  }

  /** Runs the copy in `alone`, from `alone`, with `key` (PEM text, or undefined) as $CATALOG_SIGNING_KEY. */
  function sign(alone, catalogFile, key) {
    const { NODE_TEST_CONTEXT, CATALOG_SIGNING_KEY, ...inherited } = process.env;
    const result = spawnSync(process.execPath, [path.join(alone, "tools", "sign.mjs"), catalogFile], {
      cwd: alone, encoding: "utf8", env: { ...inherited, ...(key === undefined ? {} : { CATALOG_SIGNING_KEY: key }) },
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }
  const raw = (publicKey) => Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
  const signatureOf = (folder) => Buffer.from(fs.readFileSync(path.join(folder, "catalog.json.sig"), "utf8").trim(), "base64");

  test("itUsesOnlyNodesBuiltInModules", () => {
    const text = fs.readFileSync(signerSource, "utf8");
    const specifiers = [...text.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/g)].map((match) => match[1] ?? match[2]);
    assert.ok(specifiers.length > 0);
    assert.deepEqual(specifiers.filter((specifier) => !specifier.startsWith("node:")), [], "the publish job checks out this one file");
    assert.doesNotMatch(text, /\brequire\(|process\.env\[/, "and reads only CATALOG_SIGNING_KEY");
  });

  test("signatureVerifiesWithThePublicKey", () => {
    const { folder, catalogFile, alone } = setUp();
    const { pem, publicKey } = keyPair();
    const { status, out } = sign(alone, catalogFile, pem);
    assert.equal(status, 0, out);
    const bytes = fs.readFileSync(catalogFile);
    const signature = signatureOf(folder);
    assert.equal(signature.length, 64);
    assert.ok(crypto.verify(null, bytes, publicKey, signature));
    // The app holds the raw 32-byte key.
    const rebuilt = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw(publicKey), "base64").toString("base64url") }, format: "jwk" });
    assert.ok(crypto.verify(null, bytes, rebuilt, signature));
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 2] ^= 1;
    assert.ok(!crypto.verify(null, tampered, publicKey, signature));
    assert.ok(!crypto.verify(null, bytes, keyPair().publicKey, signature), "another key does not verify it");
    assert.match(out, /keys\/catalog-public-keys\.json/, "it says the app's keys were not checked");
    assert.ok(!out.includes(pem.split("\n")[1]), "the key is never printed");
  });

  test("theAppsKeysMustVerifyItWhenTheyAreCommitted", () => {
    const { pem, publicKey } = keyPair();
    const other = keyPair().publicKey;
    const known = setUp({ keys: [raw(other), raw(publicKey)] });
    const signed = sign(known.alone, known.catalogFile, pem);
    assert.equal(signed.status, 0, signed.out);
    assert.match(signed.out, /2 keys/);
    assert.ok(crypto.verify(null, fs.readFileSync(known.catalogFile), publicKey, signatureOf(known.folder)));

    const unknown = setUp({ keys: [raw(other)] });
    const refused = sign(unknown.alone, unknown.catalogFile, pem);
    assert.equal(refused.status, 1, refused.out);
    assert.match(refused.out, /none of the 1 key/);
    assert.ok(!fs.existsSync(path.join(unknown.folder, "catalog.json.sig")), "no signature the app would reject");

    for (const keys of ["{ nope", JSON.stringify({ keys: [] }), JSON.stringify({ keys: ["c2hvcnQ="] })]) {
      const broken = setUp({ keys });
      const result = sign(broken.alone, broken.catalogFile, pem);
      assert.equal(result.status, 1, `${keys}\n${result.out}`);
      assert.match(result.out, /keys\/catalog-public-keys\.json/);
      assert.ok(!fs.existsSync(path.join(broken.folder, "catalog.json.sig")));
    }
  });

  test("aMissingOrWrongKeyFails", () => {
    const { folder, catalogFile, alone } = setUp();
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
    for (const key of [undefined, "", rsa, "not a key"]) {
      const { status, out } = sign(alone, catalogFile, key);
      assert.equal(status, 1, out);
      assert.match(out, /CATALOG_SIGNING_KEY/);
      assert.ok(!fs.existsSync(path.join(folder, "catalog.json.sig")));
      if (key) assert.ok(!out.includes(key.split("\n")[1] ?? key), "the key is never printed");
    }
  });

  test("whatItSignsIsCheckedFirst", () => {
    const { pem } = keyPair();
    const cases = {
      "a package elsewhere": (catalog) => { catalog.extensions[0].package = "https://example.com/v1/packages/x-1.0.0.yabext"; },
      "a package path that climbs": (catalog) => { catalog.extensions[0].package = `${STORE}/packages/../../x.yabext`; },
      "a sha256 that is not hex": (catalog) => { catalog.extensions[0].sha256 = "Z".repeat(64); },
      "a size that differs": (catalog) => { catalog.extensions[0].size += 1; },
      "a hash that differs": (catalog) => { catalog.extensions[0].sha256 = "0".repeat(64); },
      "another format": (catalog) => { catalog.formatVersion = 2; },
      "an icon elsewhere": (catalog) => { catalog.extensions[1].icon = "https://example.com/icon.png"; },
      "a readme elsewhere": (catalog) => { catalog.extensions[0].readme = "https://example.com/readme"; },
    };
    for (const [name, change] of Object.entries(cases)) {
      const { folder, catalogFile, alone } = setUp();
      const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
      change(catalog);
      fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));
      fs.writeFileSync(path.join(folder, "catalog.json.sig"), "an old signature");
      const { status, out } = sign(alone, catalogFile, pem);
      assert.equal(status, 1, `${name}\n${out}`);
      assert.ok(!fs.existsSync(path.join(folder, "catalog.json.sig")), name);
    }
    const missing = setUp();
    fs.rmSync(path.join(missing.folder, "packages", `${FIRST}-1.0.0.yabext`));
    const result = sign(missing.alone, missing.catalogFile, pem);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, new RegExp(`${FIRST.replaceAll(".", "\\.")}-1\\.0\\.0\\.yabext`));
  });
});
