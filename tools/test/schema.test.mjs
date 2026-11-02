import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkSchema, unsupportedKeywords } from "../lib/json-schema.mjs";

const readSchema = (name) => JSON.parse(fs.readFileSync(new URL(`../../schema/${name}`, import.meta.url), "utf8"));
const manifestSchema = readSchema("manifest.schema.json");
const catalogSchema = readSchema("catalog.schema.json");
const fields = (errors) => errors.map((error) => error.field);

describe("the schema checker", () => {
  test("both schemas use only keywords the checker knows", () => {
    assert.deepEqual(unsupportedKeywords(manifestSchema), []);
    assert.deepEqual(unsupportedKeywords(catalogSchema), []);
    assert.deepEqual(unsupportedKeywords({ type: "object", properties: { a: { contains: {} } } }), ["properties.a.contains"]);
  });

  test("types", () => {
    const schema = { type: "object", properties: { s: { type: "string" }, n: { type: "integer" }, b: { type: "boolean" },
      a: { type: "array" }, o: { type: "object" }, either: { type: ["string", "null"] }, num: { type: "number" } } };
    assert.deepEqual(checkSchema(schema, { s: "x", n: 2, b: false, a: [], o: {}, either: null, num: 1.5 }), []);
    assert.deepEqual(fields(checkSchema(schema, { s: 1, n: 2.5, b: "no", a: {}, o: [], either: 3, num: "1" })),
      ["s", "n", "b", "a", "o", "either", "num"]);
    assert.deepEqual(fields(checkSchema(schema, { n: 1e20 })), ["n"], "an integer the app cannot hold");
    assert.deepEqual(checkSchema({ type: "object" }, null).map((error) => error.keyword), ["type"]);
  });

  test("required, additionalProperties and propertyNames", () => {
    const schema = { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } };
    assert.deepEqual(checkSchema(schema, { id: "x" }), []);
    const errors = checkSchema(schema, { extra: 1 });
    assert.deepEqual(errors.map((error) => [error.field, error.keyword]), [["id", "required"], ["extra", "additionalProperties"]]);
    const map = { type: "object", additionalProperties: { type: "string" }, propertyNames: { pattern: "^[a-z]{2}$" }, minProperties: 1 };
    assert.deepEqual(checkSchema(map, { en: "x", tr: "y" }), []);
    assert.deepEqual(fields(checkSchema(map, { en: 1, english: "x" })), ["en", "english"]);
    assert.deepEqual(checkSchema(map, {}).map((error) => error.keyword), ["minProperties"]);
  });

  test("strings, numbers and arrays", () => {
    const schema = { type: "object", properties: {
      p: { type: "string", pattern: "^a+$" }, l: { type: "string", minLength: 2 }, e: { enum: ["x", "y"] }, c: { const: 1 },
      m: { type: "integer", minimum: 1 }, list: { type: "array", minItems: 1, items: { type: "string" } }, u: { type: "array", uniqueItems: true } } };
    assert.deepEqual(checkSchema(schema, { p: "aa", l: "ab", e: "y", c: 1, m: 1, list: ["a"], u: [1, 2] }), []);
    assert.deepEqual(fields(checkSchema(schema, { p: "ab", l: "a", e: "z", c: 2, m: 0, list: [], u: [1, 1] })), ["p", "l", "e", "c", "m", "list", "u"]);
    assert.deepEqual(fields(checkSchema(schema, { list: ["a", 2] })), ["list[1]"]);
    const bounded = { type: "array", maxItems: 2 };
    assert.deepEqual(checkSchema(bounded, [1, 2]), []);
    assert.deepEqual(checkSchema(bounded, [1, 2, 3]).map((error) => [error.keyword, error.message]), [["maxItems", "must have at most 2 entries"]]);
  });

  test("a source's actions are one or two", () => {
    const manifest = (actions) => ({ id: "dev.example.sample", version: "1.0.0", apiVersion: 1, defaultLocale: "en", name: "n", description: "d",
      icon: "sf:x", author: "a", license: "MIT", contributes: { sources: [{ id: "vault", title: "t", actions }] } });
    const action = (id) => ({ id, kind: "text", title: "t", label: "l" });
    assert.deepEqual(checkSchema(manifestSchema, manifest([action("a"), action("b")])), []);
    assert.deepEqual(fields(checkSchema(manifestSchema, manifest([]))), ["contributes.sources[0].actions"]);
    assert.deepEqual(fields(checkSchema(manifestSchema, manifest([action("a"), action("b"), action("c")]))), ["contributes.sources[0].actions"]);
  });

  test("$ref and if/then", () => {
    const schema = { $defs: { item: { type: "object", required: ["kind"], properties: { kind: { enum: ["a", "b"] }, extra: { type: "string" } },
      if: { properties: { kind: { const: "b" } } }, then: { required: ["extra"] } } },
      type: "array", items: { $ref: "#/$defs/item" } };
    assert.deepEqual(checkSchema(schema, [{ kind: "a" }, { kind: "b", extra: "x" }]), []);
    // An "if" on a missing property holds, as JSON Schema says: the second item needs "extra" too.
    assert.deepEqual(fields(checkSchema(schema, [{ kind: "b" }, {}])), ["[0].extra", "[1].kind", "[1].extra"]);
  });

  test("fields are written the app's way", () => {
    const manifest = { id: "dev.example.sample", version: "1.0.0", apiVersion: 1, defaultLocale: "en", name: "n", description: "d", icon: "sf:x",
      author: "a", license: "MIT", contributes: { actions: [{ id: "a", title: "t", keywords: "k", input: "none", output: "text", hint: "yes" }] } };
    assert.deepEqual(fields(checkSchema(manifestSchema, manifest)), ["contributes.actions[0].hint"]);
  });

  test("an item action needs accepts", () => {
    const manifest = { id: "dev.example.sample", version: "1.0.0", apiVersion: 1, defaultLocale: "en", name: "n", description: "d", icon: "sf:x",
      author: "a", license: "MIT", contributes: { actions: [{ id: "a", title: "t", keywords: "k", input: "item", output: "text" }] } };
    assert.deepEqual(fields(checkSchema(manifestSchema, manifest)), ["contributes.actions[0].accepts"]);
  });
});

describe("the catalog schema", () => {
  const entry = () => ({
    id: "dev.example.tool",
    version: "1.2.0",
    apiVersion: 1,
    minAppVersion: null,
    name: { en: "Tool", tr: "Araç" },
    description: { en: "Does a thing", tr: "Bir şey yapar" },
    author: "example",
    categories: ["developer"],
    icon: "sf:hammer",
    permissions: ["network"],
    networkHosts: ["api.example.com"],
    tools: [],
    sha256: "a".repeat(64),
    size: 2048,
    updatedAt: "2026-10-31T09:30:00+03:00",
    readme: "https://github.com/berkaygkc/yabbistir-extensions/tree/main/extensions/dev.example.tool",
    package: "https://berkaygkc.github.io/yabbistir-extensions/v1/packages/dev.example.tool-1.2.0.yabext",
  });
  const catalog = (...entries) => ({ formatVersion: 1, generatedAt: "2026-10-31T06:30:00Z", extensions: entries });

  test("a catalog validates", () => {
    const second = { ...entry(), id: "dev.example.icon", minAppVersion: "0.3.0", tools: ["yt-dlp"], permissions: ["exec"], networkHosts: [],
      icon: "https://berkaygkc.github.io/yabbistir-extensions/v1/icons/dev.example.icon.png" };
    assert.deepEqual(checkSchema(catalogSchema, catalog(entry(), second)), []);
    assert.deepEqual(checkSchema(catalogSchema, catalog()), []);
    assert.deepEqual(checkSchema(catalogSchema, catalog({ ...entry(), sensitive: true })), [], "sensitive is optional");
  });

  test("it rejects what the app could not read", () => {
    const cases = {
      "extensions[0].sha256": { sha256: "ABC" },
      "extensions[0].updatedAt": { updatedAt: "2026-10-31T06:30:00.123Z" },
      "extensions[0].name.en": { name: { tr: "Araç" } },
      "extensions[0].size": { size: 0 },
      "extensions[0].package": { package: "http://example.com/x.yabext" },
      "extensions[0].minAppVersion": { minAppVersion: "1.0" },
      "extensions[0].icon": { icon: "hammer" },
      "extensions[0].networkHosts[0]": { networkHosts: ["https://api.example.com"] },
      "extensions[0].permissions[0]": { permissions: ["teleport"] },
      "extensions[0].extra": { extra: true },
      "extensions[0].sensitive": { sensitive: "yes" },
    };
    for (const [field, change] of Object.entries(cases)) {
      assert.deepEqual(fields(checkSchema(catalogSchema, catalog({ ...entry(), ...change }))), [field], JSON.stringify(change));
    }
    assert.deepEqual(fields(checkSchema(catalogSchema, { ...catalog(), formatVersion: 2 })), ["formatVersion"]);
    assert.deepEqual(fields(checkSchema(catalogSchema, { ...catalog(), generatedAt: "yesterday" })), ["generatedAt"]);
  });
});
