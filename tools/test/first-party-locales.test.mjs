import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Each translation task appends its language code here.
export const FIRST_PARTY_LANGUAGES = ["en", "tr", "de", "es", "zh-Hans", "ko", "fr", "ja", "zh-Hant"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionsDir = path.join(root, "extensions");
const ids = fs
  .readdirSync(extensionsDir)
  .filter((name) => name.startsWith("dev.yabbistir."))
  .sort();

const readLocale = (id, code) =>
  JSON.parse(fs.readFileSync(path.join(extensionsDir, id, "locales", `${code}.json`), "utf8"));
const localeFiles = (id) =>
  fs
    .readdirSync(path.join(extensionsDir, id, "locales"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("first-party locale files", () => {
  test("there are first-party extensions", () => assert.ok(ids.length > 0));

  for (const id of ids) {
    describe(id, () => {
      test("hasEveryRequiredLanguage", () => {
        const present = localeFiles(id);
        for (const code of FIRST_PARTY_LANGUAGES.filter((c) => c !== "tr")) {
          assert.ok(present.includes(code), `locales/${code}.json is missing`);
        }
      });

      test("keysMatchEnglish", () => {
        const en = readLocale(id, "en");
        const enKeys = Object.keys(en).sort();
        for (const code of localeFiles(id)) {
          const data = readLocale(id, code);
          assert.deepEqual(Object.keys(data).sort(), enKeys, `${code}.json keys differ from en.json`);
          if ("keywords" in data) {
            assert.ok(
              Array.isArray(data.keywords) && data.keywords.length > 0,
              `${code}.json keywords must be a non-empty array`,
            );
          }
        }
      });

      test("placeholdersMatchEnglish", () => {
        const en = readLocale(id, "en");
        for (const code of localeFiles(id)) {
          const data = readLocale(id, code);
          for (const key of Object.keys(en)) {
            if (typeof en[key] !== "string") continue;
            assert.deepEqual(
              placeholders(data[key]),
              placeholders(en[key]),
              `${code}.json "${key}" placeholders differ from en.json`,
            );
          }
        }
      });
    });
  }
});
