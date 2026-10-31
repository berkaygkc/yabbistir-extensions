import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { isValidICUPattern } from "../lib/icu-regex.mjs";

// The app compiles accepts.pattern with NSRegularExpression (ICU), not JavaScript: "(?i)abc" and "a++" are fine there,
// while "{" and "" are not. The table holds what NSRegularExpression answered for each pattern.
const { patterns } = JSON.parse(fs.readFileSync(new URL("./fixtures/icu-patterns.json", import.meta.url), "utf8"));

// Unicode character names are not looked up, so a made-up name passes here and fails in the app.
const knownDifferences = new Set(["\\N{FOO BAR}", "\\N{EMOJI}", "[\\N{FOO}]", "\\p{na=foo}"]);

test("ICU patterns compile where NSRegularExpression compiles them", () => {
  const wrong = patterns.filter(([pattern, valid]) => !knownDifferences.has(pattern) && isValidICUPattern(pattern) !== valid)
    .map(([pattern, valid]) => `${JSON.stringify(pattern)}: ICU says ${valid ? "valid" : "invalid"}`);
  assert.deepEqual(wrong, []);
});

test("the known differences are still differences", () => {
  for (const pattern of knownDifferences) {
    assert.equal(patterns.find(([candidate]) => candidate === pattern)?.[1], false, pattern);
    assert.equal(isValidICUPattern(pattern), true, pattern);
  }
});

test("the table covers both answers", () => {
  assert.ok(patterns.filter(([, valid]) => valid).length > 100);
  assert.ok(patterns.filter(([, valid]) => !valid).length > 100);
});
