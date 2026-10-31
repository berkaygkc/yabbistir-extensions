import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkICUPattern, isValidICUPattern } from "../lib/icu-regex.mjs";

// The app compiles accepts.pattern with NSRegularExpression (ICU), not JavaScript: "(?i)abc" and "a++" are fine there,
// while "{" and "" are not. The table holds what NSRegularExpression answered for each pattern.
const { patterns } = JSON.parse(fs.readFileSync(new URL("./fixtures/icu-patterns.json", import.meta.url), "utf8"));

// Patterns NSRegularExpression compiles that the check rejects on purpose: a character name, or a property spelled in a
// way icu-properties.json does not list. The check cannot verify them, so it does not pass them; stricter is the safe side.
const stricterOnPurpose = new Set([
  "\\N{LATIN SMALL LETTER A}", "\\N{latin small letter a}", "[\\N{LATIN SMALL LETTER A}]", "(?<=\\N{LATIN SMALL LETTER A})x", "\\N{SPACE}",
  "\\N{space}", "\\N{LATIN CAPITAL LETTER A WITH DIAERESIS}", "\\N{GRINNING FACE}", "\\p{Name=LATIN SMALL LETTER A}",
  "\\p{East_Asian_Width=Wide}", "\\p{Line_Break=Alphabetic}", "\\p{Numeric_Value=1}", "\\p{Age=6.0}", "\\p{Bidi_Class=L}", "\\p{bc=AL}",
  "\\p{general category = letter}", "\\p{ L }", "[[:ALPHA:]]", "\\p{IsLatin}", "\\p{IsL}", "\\p{all}", "\\p{javaLowerCase}",
  "\\p{javaJavaIdentifierStart}",
]);

test("nothing NSRegularExpression refuses passes", () => {
  assert.deepEqual(patterns.filter(([pattern, valid]) => !valid && isValidICUPattern(pattern)).map(([pattern]) => pattern), []);
});

test("what NSRegularExpression compiles passes, apart from constructs the check cannot verify", () => {
  const wrong = patterns.filter(([pattern, valid]) => valid && !stricterOnPurpose.has(pattern) && !isValidICUPattern(pattern))
    .map(([pattern]) => pattern);
  assert.deepEqual(wrong, []);
  for (const pattern of stricterOnPurpose) {
    assert.equal(patterns.find(([candidate]) => candidate === pattern)?.[1], true, pattern);
    assert.equal(checkICUPattern(pattern).reason, "unverifiable", pattern);
  }
});

test("unverifiable constructs are rejected, not guessed", () => {
  const cases = [
    ["\\p{Block=Bogus}", "\\p{Block=Bogus}"],
    ["\\p{ccc=zzz}", "\\p{ccc=zzz}"],
    ["\\N{NOT A REAL NAME}", "\\N{NOT A REAL NAME}"],
    ["[\\N{BOGUS NAME}]", "\\N{BOGUS NAME}"],
    ["\\p{InHan}", "\\p{InHan}"],
    ["\\p{InLatin}", "\\p{InLatin}"],
    ["[[:foo:]]", "[:foo:]"],
  ];
  for (const [pattern, construct] of cases) {
    assert.deepEqual(checkICUPattern(pattern), { valid: false, reason: "unverifiable", construct }, pattern);
    assert.equal(patterns.find(([candidate]) => candidate === pattern)?.[1], false, `${pattern} is refused by NSRegularExpression too`);
  }
});

test("verified properties and plain syntax pass", () => {
  for (const pattern of ["\\p{L}", "\\p{Lu}+", "\\P{Nd}", "\\p{Latin}", "\\p{Script=Latin}", "\\p{sc=Latn}", "\\p{gc=Lu}", "\\p{scx=Grek}",
    "\\p{Block=Basic_Latin}", "\\p{InBasicLatin}", "\\p{InGreek_And_Coptic}", "[[:alpha:]]", "[\\p{Emoji}a-z]", "\\p{White_Space}", "(?i)^\\s*https?://\\S+$"]) {
    assert.deepEqual(checkICUPattern(pattern), { valid: true }, pattern);
  }
  assert.deepEqual(checkICUPattern("("), { valid: false, reason: "invalid" });
});

test("the table covers both answers", () => {
  assert.ok(patterns.filter(([, valid]) => valid).length > 100);
  assert.ok(patterns.filter(([, valid]) => !valid).length > 100);
});
