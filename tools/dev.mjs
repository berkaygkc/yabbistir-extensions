#!/usr/bin/env node
// npm run dev -- <id>
//
// Builds extensions/<id> into dist/<id>/, links ~/Library/Application Support/yabbistir/Extensions/<id> to it (the
// app lists a link as a "development" extension and reloads it when the folder changes), then rebuilds whenever
// something in the extension's src/, locales/ or manifest.json changes. Stop with Ctrl-C.
//
// It replaces a link of its own kind and nothing else: if the target is a real folder (an installed copy), it stops.
//
//   --once         build and link, then exit (no watching)
//   --root <dir>   the repository whose extensions/ to read (default: this repository)
// HOME is read from the environment.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildExtension } from "./lib/build.mjs";

function show(result) {
  for (const message of result.messages) console.log(message);
}

function link(target, folder) {
  let existing;
  try {
    existing = fs.lstatSync(target);
  } catch {
    existing = undefined;
  }
  if (existing && !existing.isSymbolicLink()) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (existing) fs.unlinkSync(target);
  fs.symlinkSync(folder, target);
  return true;
}

async function main(argv) {
  let root = fileURLToPath(new URL("..", import.meta.url));
  let once = false;
  const ids = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--once") once = true;
    else if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm run dev -- <id> [--once]");
      return 0;
    } else ids.push(argument.replace(/\/+$/, "").replace(/^extensions\//, ""));
  }
  if (ids.length !== 1) {
    console.log("Usage: npm run dev -- <id> [--once]");
    return 1;
  }
  const [id] = ids;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes("..")) {
    console.log(`${id} is not an extension id.`);
    return 1;
  }

  const home = process.env.HOME || os.homedir();
  const target = path.join(home, "Library", "Application Support", "yabbistir", "Extensions", id);
  const shown = target.startsWith(home) ? `~${target.slice(home.length)}` : target;
  try {
    if (!fs.lstatSync(target).isSymbolicLink()) {
      console.log(`${shown} is a real folder (an installed copy of ${id}), so dev leaves it alone. Uninstall that copy in yabbistir's settings first, then run this again.`);
      return 1;
    }
  } catch {
    // Nothing there yet.
  }

  const first = await buildExtension(root, id, { package: false });
  show(first);
  const built = fs.existsSync(path.join(first.folder, "index.js"));
  if (!built) {
    console.log(`build failed: ${id}`);
    return 1;
  }
  // The app lists a problem in a development extension instead of refusing it, so a link is made even then.
  if (!link(target, fs.realpathSync(first.folder))) {
    console.log(`${shown} is a real folder, so dev leaves it alone.`);
    return 1;
  }
  console.log(`${first.ok ? "built" : "built with problems"} ${path.relative(root, first.folder)}, linked ${shown}`);
  if (once) return 0;

  console.log(`watching extensions/${id}; Ctrl-C to stop`);
  const source = path.join(root, "extensions", id);
  let timer;
  let running = false;
  let again = false;
  const rebuild = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    do {
      again = false;
      const result = await buildExtension(root, id, { package: false });
      show(result);
      console.log(`${new Date().toLocaleTimeString()}  ${result.ok ? "rebuilt" : fs.existsSync(path.join(result.folder, "index.js")) ? "rebuilt with problems" : "build failed"}: ${id}`);
    } while (again);
    running = false;
  };
  for (const entry of ["src", "locales", "manifest.json"]) {
    const watched = path.join(source, entry);
    if (!fs.existsSync(watched)) continue;
    fs.watch(watched, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 80);
    });
  }
  await new Promise(() => {});
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
