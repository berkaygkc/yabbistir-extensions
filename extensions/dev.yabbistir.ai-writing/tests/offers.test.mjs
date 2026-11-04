import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { actions, instantLimit, tasks } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
const host = createFakeHost({ folder });
const text = (value) => ({ kind: "text", text: value });
const code = (value) => ({ kind: "code", text: value });

const writingIds = ["fix", "shorter", "formal", "friendly", "bullets", "action-items", "reply", "explain"];
const diffIds = ["commit", "pr-description", "explain"];
const long = (ids) => ids.map((id) => `${id}-long`);

const shortDiff = [
  "diff --git a/src/greet.ts b/src/greet.ts",
  "index 83db48f..bf269f4 100644",
  "--- a/src/greet.ts",
  "+++ b/src/greet.ts",
  "@@ -1,3 +1,3 @@",
  " export function greet(name: string) {",
  "-  return `Hi ${name}`;",
  "+  return `Hello, ${name}`;",
  " }",
].join("\n");

describe("the manifest", () => {
  test("everyTaskIsAnActionAtOnceAndAJob", () => {
    const ids = manifest.contributes.actions.map((action) => action.id);
    assert.deepEqual(ids, tasks.flatMap((task) => [task.id, `${task.id}-long`]));
    assert.deepEqual(Object.keys(actions), ids);
    for (const action of manifest.contributes.actions) {
      const isJob = action.id.endsWith("-long");
      assert.equal(action.job === true, isJob, `${action.id}: only the -long action is a job`);
      assert.equal(action.hint, undefined, `${action.id}: yab.ai cannot run in a hint`);
      assert.equal(action.output, "text");
      if (isJob) assert.ok(en[action.failTitle], `${action.id} has a failTitle`);
    }
  });

  test("bothFormsReadTheSameInThePanel", () => {
    for (const task of tasks) {
      const [now, later] = [task.id, `${task.id}-long`].map((id) => manifest.contributes.actions.find((action) => action.id === id));
      for (const field of ["title", "subtitle", "keywords", "verb", "accepts"]) {
        if (field === "accepts") assert.deepEqual(now.accepts.kinds, later.accepts.kinds);
        else assert.equal(now[field], later[field], `${task.id}.${field}`);
      }
    }
  });

  test("needsNoPermission", () => {
    assert.equal(manifest.permissions, undefined);
    assert.equal(manifest.network, undefined);
    assert.equal(manifest.requires, undefined);
  });

  test("turkishHasEveryKeyEnglishHas", () => {
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) assert.equal(typeof tr[key], typeof value, key);
    // Every job names its state in both languages, the word its card shows while it works.
    for (const task of tasks) assert.ok(en[`${task.id}.working`] && tr[`${task.id}.working`], task.id);
  });

  test("titlesAreShortAndKeywordsLowercase", () => {
    for (const [key, value] of Object.entries(en)) {
      if (key.endsWith(".title")) assert.ok(value.length <= 32, `${key} is ${value.length} characters`);
      if (key.endsWith(".keywords")) for (const word of value) assert.equal(word, word.toLowerCase(), key);
    }
  });
});

describe("where the actions are offered", () => {
  test("shortTextGetsTheActionsThatRunAtOnce", () => {
    assert.deepEqual(host.offers(text("hey can u check this before the meeting")), writingIds);
  });

  test("longTextGetsTheJobs", () => {
    const paragraph = "This is a longer note about the plan for next week. ".repeat(10);
    assert.deepEqual(host.offers(text(paragraph)), long(writingIds));
  });

  test("theLimitIsFourHundredCharactersOfTrimmedText", () => {
    assert.equal(instantLimit, 400);
    assert.deepEqual(host.offers(text("a".repeat(400))), writingIds);
    assert.deepEqual(host.offers(text(`  \n${"a".repeat(400)}\n\n`)), writingIds);
    assert.deepEqual(host.offers(text("a".repeat(401))), long(writingIds));
    // Characters, not UTF-16 units: an emoji is one, as in the app's ICU matching.
    assert.deepEqual(host.offers(text(`${"ğ".repeat(390)}${"👍".repeat(10)}`)), writingIds);
  });

  test("exactlyOneFormOfEachTaskIsOffered", () => {
    for (const length of [1, 399, 400, 401, 5000]) {
      const ids = host.offers(text("x".repeat(length)));
      for (const task of tasks) {
        const both = ids.filter((id) => id === task.id || id === `${task.id}-long`);
        assert.ok(both.length <= 1, `${task.id} at ${length}`);
      }
    }
  });

  test("codeGetsOnlyExplain", () => {
    assert.deepEqual(host.offers(code("const total = items.reduce((sum, item) => sum + item.price, 0);")), ["explain"]);
    assert.deepEqual(host.offers(code("x".repeat(500))), ["explain-long"]);
  });

  test("aGitDiffGetsTheCommitAndPullRequestActionsFirst", () => {
    assert.deepEqual(host.offers(code(shortDiff)), diffIds);
    assert.deepEqual(host.offers(text(shortDiff)), diffIds, "a diff copied as text is still a diff");
    const longDiff = `${shortDiff}\n${" // a comment line".repeat(30)}`;
    assert.deepEqual(host.offers(code(longDiff)), long(diffIds));
  });

  test("hunksWithoutAGitHeaderAreADiffToo", () => {
    assert.deepEqual(host.offers(text("@@ -12,7 +12,8 @@ function load()\n-  old();\n+  next();")), diffIds);
    assert.deepEqual(host.offers(text("@@ -1 +1 @@\n-a\n+b")), diffIds);
    assert.deepEqual(host.offers(text("Some notes first\n\n@@ -3,2 +3,2 @@\n-x\n+y")), diffIds);
  });

  test("textThatOnlyMentionsADiffIsText", () => {
    assert.deepEqual(host.offers(text("Run git diff --git to see it, or look for @@ markers")), writingIds);
    assert.deepEqual(host.offers(text("@@ hello everyone @@")), writingIds);
    assert.deepEqual(host.offers(text("see the note:diff --git a/x b/x")), writingIds);
  });

  test("nothingWithoutLetters", () => {
    assert.deepEqual(host.offers(text("12345 678")), []);
    assert.deepEqual(host.offers(text("👍🎉")), []);
    assert.deepEqual(host.offers(text("   ")), []);
    assert.deepEqual(host.offers({ kind: "link", url: "https://example.com/a" }), []);
    assert.deepEqual(host.offers({ kind: "color", color: { hex: "#336699", r: 51, g: 102, b: 153, a: 1 } }), []);
  });

  test("turkishTextIsText", () => {
    assert.deepEqual(host.offers(text("Yarın toplantıdan önce raporu gönderebilir misin?")), writingIds);
  });
});

describe("the patterns stay fast", () => {
  // The app matches every pattern on the selected item while the panel is open, so each must be linear.
  const patterns = manifest.contributes.actions.map((action) => action.accepts);
  const hostile = [
    "a".repeat(100_000),
    "\n".repeat(100_000),
    " ".repeat(100_000),
    `@@ -${"1".repeat(50_000)}`,
    "\n@@ -1,".repeat(20_000),
    "\ndiff --gi".repeat(10_000),
    "1 ".repeat(50_000),
    `${"a".repeat(400)}\n`.repeat(250),
  ];

  test("onHostileTextsOfAHundredThousandCharacters", () => {
    for (const sample of hostile) {
      const started = performance.now();
      for (const accepts of patterns) {
        acceptsMatch(accepts, { kind: "text", text: sample, tags: [] });
        acceptsMatch(accepts, { kind: "code", text: sample, tags: [] });
      }
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 500, `${elapsed.toFixed(0)} ms for 40 matches on ${JSON.stringify(sample.slice(0, 12))}…`);
    }
  });

  test("everyLoopIsBounded", () => {
    // ICU keeps a backtracking frame for each step of a lazy loop, so an unbounded one over a huge item could run
    // out of stack in the app. Every repeat in the patterns has an upper bound; escaped characters aside.
    for (const { pattern } of patterns) {
      const bare = pattern.replace(/\\./g, "");
      assert.doesNotMatch(bare, /[*+]|\{\d+,\}/, pattern);
      for (const [, upper] of bare.matchAll(/\{\d+,(\d+)\}/g)) assert.ok(Number(upper) <= 4000, pattern);
    }
  });

  test("aDiffHeaderIsLookedForInTheFirstFourThousandCharacters", () => {
    const preamble = "commit message line\n".repeat(150);
    assert.ok(preamble.length < 4000);
    assert.deepEqual(host.offers(code(`${preamble}diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b`)), long(diffIds));
    const farAway = `${"commit message line\n".repeat(250)}diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b`;
    assert.deepEqual(host.offers(text(farAway)), long(writingIds), "past that, it reads as text");
  });
});
