// Builds extensions/<id>/ into dist/<id>/, the folder the app runs: manifest.json, index.js (one file, ES2022),
// locales/, and the icon and README it ships with; then checks that folder with the store's rules and packs it.
import { build } from "esbuild";
import { builtinModules } from "node:module";
import fs from "node:fs";
import path from "node:path";

import { formatIssue, validateExtension } from "./validate.mjs";
import { zipFolder } from "./zip.mjs";

export const NODE_DOCS = "docs/errors.md#node-builtins";

// Extensions run in JavaScriptCore, not Node. These names exist there only if the extension itself defines them.
const NODE_GLOBALS = ["process", "Buffer", "require", "__dirname", "__filename", "global"];
const SENTINEL = "__yabbistir_node_global_";

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const isBuiltin = (specifier) => specifier.startsWith("node:") || builtins.has(specifier) || builtins.has(specifier.split("/")[0]);

/** Fails the build, with a pointer to the docs, for an import of a Node built-in module. */
const noNodeBuiltins = {
  name: "no-node-builtins",
  setup(esbuild) {
    esbuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (!isBuiltin(args.path)) return undefined;
      return {
        errors: [{
          text: `"${args.path}" is a Node.js module, and extensions do not run in Node. Use the \`yab\` API or a web standard instead (see ${NODE_DOCS}).`,
          location: null,
        }],
      };
    });
  },
};

/** The messages of an esbuild failure, one string each. */
function describeFailure(error) {
  const messages = Array.isArray(error?.errors) && error.errors.length > 0 ? error.errors : [{ text: String(error?.message ?? error) }];
  return messages.map((message) => {
    const where = message.location ? `${message.location.file}:${message.location.line}:${message.location.column + 1}: ` : "";
    return `${where}${message.text}`;
  });
}

/**
 * Compiles `source` (src/index.ts) to `outfile`. Node's globals are replaced by a marker while compiling, and a marker
 * left in the output means the extension used one it did not define itself (a local named `process` is untouched).
 * @returns {Promise<{ ok: true } | { ok: false, messages: string[] }>}
 */
export async function compile(source, outfile) {
  let result;
  try {
    result = await build({
      entryPoints: [source],
      outfile: "index.js",
      write: false,
      bundle: true,
      format: "cjs",
      platform: "neutral",
      target: "es2022",
      minify: false,
      legalComments: "none",
      logLevel: "silent",
      mainFields: ["module", "main"],
      conditions: ["module"],
      define: Object.fromEntries(NODE_GLOBALS.map((name) => [name, `${SENTINEL}${name}`])),
      plugins: [noNodeBuiltins],
    });
  } catch (error) {
    return { ok: false, messages: describeFailure(error) };
  }
  const code = result.outputFiles[0].text;
  const used = NODE_GLOBALS.filter((name) => code.includes(`${SENTINEL}${name}`));
  if (used.length > 0) {
    return {
      ok: false,
      messages: used.map((name) =>
        `\`${name}\` is a Node.js global, and extensions do not run in Node. Use the \`yab\` API or a web standard instead (see ${NODE_DOCS}).`),
    };
  }
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, code);
  return { ok: true };
}

const COPIED_FILES = ["manifest.json", "README.md", "CHANGELOG.md", "icon.png"];

/** Copies `from` to `to` only when the bytes differ, so a watching app sees a change only when there is one. */
function writeIfChanged(from, to) {
  const bytes = fs.readFileSync(from);
  if (fs.existsSync(to) && Buffer.compare(fs.readFileSync(to), bytes) === 0) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, bytes);
}

function pruneExcept(directory, keep, prefix = "") {
  for (const entry of fs.readdirSync(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      pruneExcept(directory, keep, relative);
      if (fs.readdirSync(path.join(directory, relative)).length === 0) fs.rmdirSync(path.join(directory, relative));
    } else if (!keep.has(relative)) fs.rmSync(path.join(directory, relative));
  }
}

/**
 * Builds extension `id` of the repository at `root`. dist/<id>/ is updated in place (never removed as a whole, so an
 * app that watches it through a link keeps watching).
 * @param {{ package?: boolean }} options  package: also write dist/<id>-<version>.yabext (default true)
 * @returns {Promise<{ ok: boolean, messages: string[], issues: object[], folder: string, archive?: string }>}
 */
export async function buildExtension(root, id, { package: pack = true } = {}) {
  const source = path.join(root, "extensions", id);
  const folder = path.join(root, "dist", id);
  const fail = (...messages) => ({ ok: false, messages, issues: [], folder });
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return fail(`extensions/${id}: there is no such extension folder → fix: Create it with npm run new -- ${id}, or check the id.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8").replace(/^﻿/, ""));
  } catch {
    return fail(`extensions/${id}/manifest.json: it is missing or is not valid JSON → fix: Make manifest.json a valid JSON object.`);
  }
  const entry = path.join(source, "src", "index.ts");
  const alternative = path.join(source, "src", "index.js");
  const input = fs.existsSync(entry) ? entry : fs.existsSync(alternative) ? alternative : undefined;
  if (!input) return fail(`extensions/${id}/src/index.ts: it is missing → fix: Add src/index.ts, which exports actions, detectors and/or captureRules.`);

  fs.mkdirSync(folder, { recursive: true });
  const compiled = await compile(input, path.join(folder, "index.js"));
  if (!compiled.ok) return fail(...compiled.messages.map((message) => `extensions/${id}: ${message}`));

  const keep = new Set(["index.js"]);
  for (const file of COPIED_FILES) {
    if (!fs.existsSync(path.join(source, file))) continue;
    writeIfChanged(path.join(source, file), path.join(folder, file));
    keep.add(file);
  }
  const locales = path.join(source, "locales");
  if (fs.existsSync(locales)) {
    for (const name of fs.readdirSync(locales).filter((file) => file.endsWith(".json")).sort()) {
      writeIfChanged(path.join(locales, name), path.join(folder, "locales", name));
      keep.add(`locales/${name}`);
    }
  }
  pruneExcept(folder, keep);

  const { issues } = validateExtension(folder, { store: true, relativeTo: root });
  const messages = issues.map(formatIssue);
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) return { ok: false, messages, issues, folder };

  let archive;
  if (pack) {
    archive = path.join(root, "dist", `${manifest.id}-${manifest.version}.yabext`);
    fs.writeFileSync(archive, zipFolder(folder, path.basename(folder)));
  }
  return { ok: true, messages, issues, folder, archive };
}
