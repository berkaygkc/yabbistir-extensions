// The manifest parity corpus: schema/fixtures/{valid,invalid}/*.json and schema/fixtures/expected.json.
//
// Each fixture describes one extension folder:
//
//   {
//     "about": "what the case shows",
//     "folder": "dev.example.sample",            the folder's name (the app compares it with the id)
//     "manifest": { … },                         written as manifest.json (any JSON value)
//     "manifestText": "…",                       or: manifest.json's exact text (used for text that is not JSON)
//     "locales": { "en": { … }, "tr": "…" },     locales/<language>.json: an object is written as JSON, a string as it is
//     "files": ["index.js"]                      more files, created empty
//   }
//
// With neither "manifest" nor "manifestText" there is no manifest.json. expected.json maps each fixture's path
// ("invalid/version-not-semver.json") to the sorted, distinct issue codes the app's validator reports for that folder:
// errors and warnings alike. Store-only rules (license, README.md, CHANGELOG.md, the en locale, unknown fields) are not
// part of the corpus; the app does not have them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const fixturesDirectory = fileURLToPath(new URL("../../schema/fixtures/", import.meta.url));

/** The fixture files, as paths relative to schema/fixtures ("valid/sample.json"), sorted. */
export function fixtureFiles(directory = fixturesDirectory) {
  return ["valid", "invalid"]
    .flatMap((group) => fs.readdirSync(path.join(directory, group)).filter((name) => name.endsWith(".json")).map((name) => `${group}/${name}`))
    .sort();
}

export function readFixture(file, directory = fixturesDirectory) {
  return JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
}

export function readExpected(directory = fixturesDirectory) {
  return JSON.parse(fs.readFileSync(path.join(directory, "expected.json"), "utf8"));
}

/** Writes the fixture's folder inside `parent` and returns its path. */
export function materialize(fixture, parent) {
  const folder = path.join(parent, fixture.folder);
  fs.mkdirSync(folder, { recursive: true });
  if (typeof fixture.manifestText === "string") fs.writeFileSync(path.join(folder, "manifest.json"), fixture.manifestText);
  else if ("manifest" in fixture) fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(fixture.manifest, null, 2));
  for (const [language, table] of Object.entries(fixture.locales ?? {})) {
    fs.mkdirSync(path.join(folder, "locales"), { recursive: true });
    fs.writeFileSync(path.join(folder, "locales", `${language}.json`), typeof table === "string" ? table : JSON.stringify(table, null, 2));
  }
  for (const file of fixture.files ?? []) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), "");
  }
  return folder;
}
