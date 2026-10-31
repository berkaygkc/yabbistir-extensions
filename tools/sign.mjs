#!/usr/bin/env node
// node tools/sign.mjs <site>/v1/catalog.json
//
// Signs the catalog npm run catalog wrote: writes <site>/v1/catalog.json.sig, the base64 Ed25519 signature of
// catalog.json's exact bytes, made with the PKCS#8 PEM key in $CATALOG_SIGNING_KEY. <site> is what gets published.
//
// The publish job that holds the key checks out this one file (and keys/), never runs npm and has no node_modules,
// so this file uses Node's built-in modules only and reads no other file of the repository.
//
// Before it signs, it checks what it signs: format 1; every package under the store's packages/ address, next to the
// catalog with the size and SHA-256 the catalog states; every file icon under icons/ and present; every readme on this
// repository; and <site> holds nothing else: the catalog, its signature, the packages and file icons it names, and the
// two schemas, all regular files. After it signs, it verifies the signature, and when keys/catalog-public-keys.json exists (the keys built
// into the app, { "keys": ["<base64 of a raw 32-byte Ed25519 public key>", …] }), that one of them verifies it: a wrong
// secret then stops the job instead of publishing a catalog every app rejects. Any failure leaves no signature.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STORE = "https://berkaygkc.github.io/yabbistir-extensions/v1";
const REPOSITORY = "https://github.com/berkaygkc/yabbistir-extensions/";
// The app's download limits (tools/lib/pr-checks.mjs has the same; this file imports nothing of the repository).
const MAX_CATALOG_BYTES = 2_000_000;
const MAX_PACKAGE_BYTES = 5_000_000;
const KEYS_FILE = fileURLToPath(new URL("../keys/catalog-public-keys.json", import.meta.url));
const SHOWN_KEYS_FILE = "keys/catalog-public-keys.json";
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class SignError extends Error {}
const fail = (message) => {
  throw new SignError(message);
};

/** The name after `prefix` in `url`, when it is a plain file name with `extension`. */
function fileUnder(url, prefix, extension) {
  if (typeof url !== "string" || !url.startsWith(prefix)) return undefined;
  const name = url.slice(prefix.length);
  return FILE_NAME.test(name) && name.endsWith(extension) && !name.includes("..") ? name : undefined;
}

/** Checks the catalog in `bytes` against the files next to it in `folder`; returns them, relative to `folder`. */
function checkCatalog(bytes, folder) {
  if (bytes.length > MAX_CATALOG_BYTES) fail(`catalog.json is ${bytes.length} bytes, more than the app reads (${MAX_CATALOG_BYTES}).`);
  let catalog;
  try {
    catalog = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("catalog.json is not JSON.");
  }
  if (catalog === null || typeof catalog !== "object" || catalog.formatVersion !== 1) fail("catalog.json: formatVersion is not 1.");
  if (!Array.isArray(catalog.extensions)) fail("catalog.json: extensions is not a list.");
  const named = [];
  catalog.extensions.forEach((entry, index) => {
    const where = `catalog.json: extensions[${index}]${typeof entry?.id === "string" ? ` (${entry.id})` : ""}`;
    if (entry === null || typeof entry !== "object") fail(`${where} is not an object.`);
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) fail(`${where}: sha256 is not 64 lowercase hex digits.`);
    if (!Number.isInteger(entry.size) || entry.size < 1 || entry.size > MAX_PACKAGE_BYTES) fail(`${where}: size is not between 1 and ${MAX_PACKAGE_BYTES}.`);
    const name = fileUnder(entry.package, `${STORE}/packages/`, ".yabext");
    if (name === undefined) fail(`${where}: package is not a .yabext under ${STORE}/packages/.`);
    let bytesOfPackage;
    try {
      bytesOfPackage = fs.readFileSync(path.join(folder, "packages", name));
    } catch {
      fail(`${where}: packages/${name} is not next to the catalog.`);
    }
    if (bytesOfPackage.length !== entry.size || crypto.createHash("sha256").update(bytesOfPackage).digest("hex") !== entry.sha256) {
      fail(`${where}: packages/${name} does not have the size and SHA-256 the catalog states.`);
    }
    named.push(`packages/${name}`);
    if (typeof entry.icon !== "string") fail(`${where}: icon is not a string.`);
    if (!entry.icon.startsWith("sf:")) {
      const icon = fileUnder(entry.icon, `${STORE}/icons/`, ".png");
      if (icon === undefined || !fs.existsSync(path.join(folder, "icons", icon))) fail(`${where}: icon is neither sf:<name> nor a file under ${STORE}/icons/.`);
      named.push(`icons/${icon}`);
    }
    if (typeof entry.readme !== "string" || !entry.readme.startsWith(REPOSITORY)) fail(`${where}: readme is not on ${REPOSITORY}.`);
  });
  return { count: catalog.extensions.length, named };
}

/** Fails when `site` holds anything but `allowed` (paths relative to it, "/"-separated): no other file, no link. */
function checkSite(site, allowed) {
  const extra = [];
  const walk = (relative) => {
    for (const name of fs.readdirSync(path.join(site, relative)).sort()) {
      const inner = relative === "" ? name : `${relative}/${name}`;
      const stat = fs.lstatSync(path.join(site, inner));
      if (stat.isDirectory()) walk(inner);
      else if (!stat.isFile() || !allowed.has(inner)) extra.push(inner);
    }
  };
  walk("");
  if (extra.length > 0) {
    fail(`site: ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? ` and ${extra.length - 5} more` : ""}: not named by the catalog, so not published → fix: Publish only what npm run catalog writes.`);
  }
}

/** The app's public keys from keys/catalog-public-keys.json, or undefined when there is no such file yet. */
function appKeys() {
  if (!fs.existsSync(KEYS_FILE)) return undefined;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  } catch {
    fail(`${SHOWN_KEYS_FILE} is not JSON.`);
  }
  if (!Array.isArray(data?.keys) || data.keys.length === 0) fail(`${SHOWN_KEYS_FILE}: "keys" is not a list with at least one key.`);
  return data.keys.map((text, index) => {
    const raw = typeof text === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? Buffer.from(text, "base64") : Buffer.alloc(0);
    if (raw.length !== 32) fail(`${SHOWN_KEYS_FILE}: keys[${index}] is not the base64 of a raw 32-byte Ed25519 public key.`);
    return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
  });
}

/** The signing key from $CATALOG_SIGNING_KEY. Never prints it. */
function signingKey() {
  const pem = process.env.CATALOG_SIGNING_KEY;
  if (pem === undefined || pem.trim() === "") fail("$CATALOG_SIGNING_KEY is not set → fix: Give the publish environment the CATALOG_SIGNING_KEY secret.");
  let key;
  try {
    key = crypto.createPrivateKey(pem.includes("\\n") ? pem.split("\\n").join("\n") : pem);
  } catch {
    fail("$CATALOG_SIGNING_KEY does not hold a private key → fix: Set it to the PKCS#8 PEM text of the store's Ed25519 key.");
  }
  if (key.asymmetricKeyType !== "ed25519") fail(`$CATALOG_SIGNING_KEY holds an ${key.asymmetricKeyType ?? "unknown"} key, not an Ed25519 one.`);
  return key;
}

function main(argv) {
  if (argv.length !== 1 || argv[0].startsWith("-")) {
    console.log("Usage: node tools/sign.mjs <site>/v1/catalog.json");
    return 2;
  }
  const file = path.resolve(argv[0]);
  const signatureFile = `${file}.sig`;
  try {
    fs.rmSync(signatureFile, { force: true });
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      fail(`${argv[0]}: there is no such file → fix: Run npm run catalog -- --out <dir> first.`);
    }
    const folder = path.dirname(file);
    if (path.basename(folder) !== "v1" || path.basename(file) !== "catalog.json") fail(`${argv[0]}: the catalog is <site>/v1/catalog.json, the address the app reads.`);
    const { count, named } = checkCatalog(bytes, folder);
    checkSite(path.dirname(folder), new Set(["catalog.json", "catalog.schema.json", "manifest.schema.json", ...named].map((name) => `v1/${name}`)));
    const known = appKeys();
    const key = signingKey();
    const signature = crypto.sign(null, bytes, key);
    if (!crypto.verify(null, bytes, crypto.createPublicKey(key), signature)) fail("The new signature does not verify.");
    if (known !== undefined && !known.some((publicKey) => crypto.verify(null, bytes, publicKey, signature))) {
      fail(`The signature verifies with none of the ${known.length} key${known.length === 1 ? "" : "s"} in ${SHOWN_KEYS_FILE}, the keys the app holds → fix: Set CATALOG_SIGNING_KEY to the private key of one of them.`);
    }
    fs.writeFileSync(signatureFile, signature.toString("base64"));
    console.log(`signed ${argv[0]} (${count} extension${count === 1 ? "" : "s"}): ${path.basename(signatureFile)}`);
    console.log(known === undefined
      ? `no ${SHOWN_KEYS_FILE} yet, so the signature was not checked against the app's keys`
      : `verified with ${known.length === 1 ? "the key" : `one of the ${known.length} keys`} in ${SHOWN_KEYS_FILE}`);
    return 0;
  } catch (error) {
    if (!(error instanceof SignError)) throw error;
    console.log(error.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
