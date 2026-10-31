#!/usr/bin/env node
// npm run new -- <id> --template <action|detector|capture-rule|job>
//
// Creates extensions/<id>/ from templates/<template>/: a manifest, src/index.ts, English and Turkish strings, a test
// that uses the fake host, a README and a CHANGELOG. It passes `npm run validate` and `npm test` right away.
//
//   --author <name>   the manifest's author: how you want to be credited, your name or your GitHub user name.
//                     Without it, the git user name (then "your-name") is used, and the output says which, so it can
//                     be changed in manifest.json.
//   --root <dir>      the repository to create it in (default: this repository)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ID_PATTERN } from "./lib/validate.mjs";

const TEMPLATES = ["action", "detector", "capture-rule", "job"];
const here = fileURLToPath(new URL("..", import.meta.url));

function titleOf(id) {
  const last = id.split(".").at(-1);
  return last.split("-").filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

/** The git user name of the repository at `root`, or "your-name"; with where it came from. */
function defaultAuthor(root) {
  const named = spawnSync("git", ["config", "user.name"], { encoding: "utf8", cwd: root });
  const name = named.status === 0 ? named.stdout.trim() : "";
  return name ? { name, from: "git" } : { name: "your-name", from: "placeholder" };
}

function copyTemplate(from, to, values) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTemplate(source, target, values);
    else {
      const text = fs.readFileSync(source, "utf8");
      fs.writeFileSync(target, text.replace(/\{\{(\w+)\}\}/g, (match, key) => (Object.hasOwn(values, key) ? values[key] : match)));
    }
  }
}

function main(argv) {
  let root = here;
  let template;
  let author;
  const ids = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--root") root = path.resolve(argv[++index] ?? ".");
    else if (argument === "--template") template = argv[++index];
    else if (argument === "--author") author = argv[++index];
    else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: npm run new -- <id> --template <${TEMPLATES.join("|")}>`);
      return 0;
    } else ids.push(argument);
  }
  if (ids.length !== 1 || !template) {
    console.log(`Usage: npm run new -- <id> --template <${TEMPLATES.join("|")}>`);
    return 1;
  }
  const [id] = ids;
  if (!ID_PATTERN.test(id)) {
    console.log(`"${id}" is not a reverse-domain id → fix: Use lowercase letters, digits and dashes separated by dots, e.g. "dev.yourname.tool".`);
    return 1;
  }
  if (!TEMPLATES.includes(template)) {
    console.log(`"${template}" is not a template → fix: Use one of: ${TEMPLATES.join(", ")}.`);
    return 1;
  }
  const target = path.join(root, "extensions", id);
  if (fs.existsSync(target)) {
    console.log(`extensions/${id} already exists → fix: Choose another id, or remove that folder first.`);
    return 1;
  }
  const credited = author ? { name: author, from: "flag" } : defaultAuthor(root);
  // The author lands inside a JSON string in manifest.json, so it is escaped the way JSON escapes it.
  copyTemplate(path.join(here, "templates", template), target, { id, name: titleOf(id), author: JSON.stringify(credited.name).slice(1, -1) });
  console.log(`Created extensions/${id} from the ${template} template.`);
  // The author is how the store credits you: say where an unasked-for one came from, so it can be changed.
  if (credited.from === "git") {
    console.log(`author: "${credited.name}", from git config user.name. It is how the store credits you, your name or your GitHub user name: change "author" in manifest.json, or pass --author <name>.`);
  } else if (credited.from === "placeholder") {
    console.log(`author: "your-name", a placeholder. Set "author" in manifest.json to your name or your GitHub user name, or pass --author <name>.`);
  }
  console.log(`
  npm test -- ${id}        run its tests
  npm run validate -- ${id}
  npm run dev -- ${id}     build, link into yabbistir and rebuild on every change
  npm run build -- ${id}   build, check and pack dist/${id}-<version>.yabext`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
