#!/usr/bin/env node
// npm run catalog -- --out <dir> [--sign-key-env <NAME>]
//
// Builds every extension and writes what the store publishes (site/v1 on GitHub Pages) into <dir>:
//   catalog.json                        every extension, sorted by id, as schema/catalog.schema.json describes it
//   catalog.json.sig                    the base64 Ed25519 signature of catalog.json's exact bytes, when $NAME holds
//                                       a PKCS#8 PEM private key; without one, no signature is written
//   packages/<id>-<version>.yabext      each package, byte for byte what npm run build writes
//   icons/<id>.png                      the icon of an extension that uses a file icon
//   catalog.schema.json, manifest.schema.json   the schemas, at the address their $id names
//
// The output is a function of the commit: an extension's updatedAt is the time of the last commit that changed its
// folder, and generatedAt is the time of the last commit that changed extensions/ (the newest updatedAt, or a later
// removal), or SOURCE_DATE_EPOCH when that is set; all in UTC, without fractions of a second. One extension that
// does not build stops the catalog: none is published without it.
//
//   --out <dir>            where to write (required); earlier output there is replaced
//   --sign-key-env <NAME>  the environment variable that holds the signing key
//   --root <dir>           the repository to read (default: this repository)

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildExtension } from "./lib/build.mjs";
import { checkSchema } from "./lib/json-schema.mjs";
import { MAX_CATALOG_BYTES, MAX_PACKAGE_BYTES } from "./lib/pr-checks.mjs";
import { formatIssue } from "./lib/validate.mjs";

const STORE = "https://berkaygkc.github.io/yabbistir-extensions/v1";
const REPOSITORY = "https://github.com/berkaygkc/yabbistir-extensions";
const SCHEMAS = ["catalog.schema.json", "manifest.schema.json"];
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const tools = path.dirname(fileURLToPath(import.meta.url));

class CatalogError extends Error {}
const fail = (message) => {
  throw new CatalogError(message);
};

/** A time as the catalog writes it: UTC, seconds, no fraction. */
const utc = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The time of the last commit that changed `pathspec`, or undefined when no commit did (or there is no git). */
function lastCommit(root, pathspec) {
  const result = spawnSync("git", ["log", "-1", "--format=%cI", "--", pathspec], { cwd: root, encoding: "utf8" });
  const text = result.status === 0 ? result.stdout.trim() : "";
  return text === "" ? undefined : utc(new Date(text));
}

/** The signing key named by `variable`: undefined when it is unset or empty. Never prints the key. */
function signingKey(variable) {
  const pem = process.env[variable];
  if (pem === undefined || pem.trim() === "") return undefined;
  let key;
  try {
    key = crypto.createPrivateKey(pem.includes("\\n") ? pem.replaceAll("\\n", "\n") : pem);
  } catch {
    fail(`$${variable} does not hold a private key → fix: Set it to the PKCS#8 PEM text of an Ed25519 key (openssl genpkey -algorithm ed25519).`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail(`$${variable} holds an ${key.asymmetricKeyType ?? "unknown"} key, not an Ed25519 one → fix: Use the store's Ed25519 signing key.`);
  }
  return key;
}

/** Removes what an earlier run wrote into `out`, and only that. */
function clean(out) {
  for (const file of ["catalog.json", "catalog.json.sig", ...SCHEMAS]) fs.rmSync(path.join(out, file), { force: true });
  for (const [folder, extension] of [["packages", ".yabext"], ["icons", ".png"]]) {
    const directory = path.join(out, folder);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) if (name.endsWith(extension)) fs.rmSync(path.join(directory, name), { force: true });
  }
}

/** Text by language, from every locales/*.json of the built extension in `folder` that has `key` as text. */
function localized(folder, id, key) {
  const texts = {};
  const directory = path.join(folder, "locales");
  for (const name of fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort()) {
    const language = name.slice(0, -".json".length);
    if (!LANGUAGE.test(language)) {
      fail(`extensions/${id}/locales/${name}: "${language}" is not a language code the store can list (expected a code such as en, tr or pt-BR) → fix: Rename the file.`);
    }
    const value = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8").replace(/^\uFEFF/, ""))[key];
    if (typeof value === "string" && value.trim() !== "") texts[language] = value;
  }
  return texts;
}

/** The catalog entry of extension `id`, built; its package and icon are written into `out`. */
async function entryFor(root, id, out) {
  const built = await buildExtension(root, id);
  for (const message of built.messages) console.log(message);
  if (!built.ok) fail(`extensions/${id}: the build failed, so there is no catalog → fix: Run npm run build -- ${id} and fix what it reports.`);

  const manifest = JSON.parse(fs.readFileSync(path.join(built.folder, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  const updatedAt = lastCommit(root, `extensions/${id}`);
  if (updatedAt === undefined) {
    fail(`extensions/${id}: no commit has it, and an extension is dated by its last commit → fix: Commit the extension first.`);
  }

  const bytes = fs.readFileSync(built.archive);
  if (bytes.length > MAX_PACKAGE_BYTES) {
    fail(`${path.relative(root, built.archive)}: the package is ${bytes.length} bytes (expected at most ${MAX_PACKAGE_BYTES}, the app's limit) → fix: Make the extension smaller.`);
  }
  const packageName = `${manifest.id}-${manifest.version}.yabext`;
  fs.mkdirSync(path.join(out, "packages"), { recursive: true });
  fs.writeFileSync(path.join(out, "packages", packageName), bytes);

  let icon = manifest.icon;
  if (!icon.startsWith("sf:")) {
    const file = path.join(built.folder, "icon.png");
    const png = icon === "icon.png" && fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    if (png === undefined || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      fail(`extensions/${id}/manifest.json: icon: a file icon must be a PNG named icon.png next to manifest.json (expected "icon.png" or "sf:<SF Symbol name>") → fix: Add icon.png, or use an SF Symbol.`);
    }
    fs.mkdirSync(path.join(out, "icons"), { recursive: true });
    fs.writeFileSync(path.join(out, "icons", `${manifest.id}.png`), png);
    icon = `${STORE}/icons/${manifest.id}.png`;
  }

  return {
    id: manifest.id,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    minAppVersion: manifest.minAppVersion ?? null,
    name: localized(built.folder, id, manifest.name),
    description: localized(built.folder, id, manifest.description),
    author: manifest.author,
    categories: manifest.categories ?? [],
    icon,
    permissions: manifest.permissions ?? [],
    networkHosts: manifest.network?.domains ?? [],
    tools: (manifest.requires?.tools ?? []).map((tool) => tool.name),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    updatedAt,
    readme: `${REPOSITORY}/tree/main/extensions/${manifest.id}`,
    package: `${STORE}/packages/${packageName}`,
  };
}

/** generatedAt: SOURCE_DATE_EPOCH (seconds) when set, else the last commit that changed extensions/. */
function generatedAt(root) {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined && epoch !== "") {
    if (!/^\d+$/.test(epoch)) fail(`SOURCE_DATE_EPOCH: "${epoch}" is not a number of seconds → fix: Unset it, or set it to a Unix time.`);
    return utc(new Date(Number(epoch) * 1000));
  }
  return lastCommit(root, "extensions") ?? fail("extensions/: no commit has it, so the catalog has no date → fix: Commit the extensions first, or set SOURCE_DATE_EPOCH.");
}

async function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  let out;
  let keyVariable;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--out") out = argv[++index];
    else if (argument === "--sign-key-env") keyVariable = argv[++index];
    else if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm run catalog -- --out <dir> [--sign-key-env <NAME>]");
      return 0;
    } else {
      console.log(`Unknown argument: ${argument}. Usage: npm run catalog -- --out <dir> [--sign-key-env <NAME>]`);
      return 2;
    }
  }
  if (!out || (keyVariable !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyVariable))) {
    console.log("Usage: npm run catalog -- --out <dir> [--sign-key-env <NAME>]");
    return 2;
  }
  out = path.resolve(out);

  try {
    fs.mkdirSync(out, { recursive: true });
    clean(out);
    const key = keyVariable === undefined ? undefined : signingKey(keyVariable);

    const directory = path.join(root, "extensions");
    const ids = fs.existsSync(directory)
      ? fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort()
      : [];
    const extensions = [];
    for (const id of ids) {
      const entry = await entryFor(root, id, out);
      console.log(`${entry.id} ${entry.version}: ${entry.size} bytes, sha256 ${entry.sha256}, changed ${entry.updatedAt}`);
      extensions.push(entry);
    }

    const catalog = { formatVersion: 1, generatedAt: generatedAt(root), extensions };
    const schema = JSON.parse(fs.readFileSync(path.join(tools, "..", "schema", "catalog.schema.json"), "utf8"));
    const errors = checkSchema(schema, catalog);
    if (errors.length > 0) {
      for (const error of errors) {
        console.log(formatIssue({ path: "catalog.json", field: error.field, level: "error", message: error.message, expected: error.expected }));
      }
      fail("catalog.json does not match schema/catalog.schema.json → fix: Correct the manifest or locale each line above names.");
    }
    const bytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
    if (bytes.length > MAX_CATALOG_BYTES) fail(`catalog.json is ${bytes.length} bytes, more than the app reads (${MAX_CATALOG_BYTES}).`);

    for (const name of SCHEMAS) fs.copyFileSync(path.join(tools, "..", "schema", name), path.join(out, name));
    fs.writeFileSync(path.join(out, "catalog.json"), bytes);
    const relative = path.relative(process.cwd(), out);
    const shown = relative === "" ? "." : relative.startsWith("..") || path.isAbsolute(relative) ? out : relative;
    console.log(`wrote ${path.join(shown, "catalog.json")}: ${extensions.length} extension${extensions.length === 1 ? "" : "s"}, generated at ${catalog.generatedAt}`);
    if (key) {
      fs.writeFileSync(path.join(out, "catalog.json.sig"), crypto.sign(null, bytes, key).toString("base64"));
      console.log(`signed it: ${path.join(shown, "catalog.json.sig")}`);
    } else if (keyVariable !== undefined) {
      console.log(`not signed: $${keyVariable} is not set, so there is no catalog.json.sig`);
    }
    return 0;
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    console.log(error.message);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
