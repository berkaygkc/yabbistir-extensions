import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { cleanAnswer, isRefusal, stripEscapes, stripFence, stripPlaceholderSignature, stripPreamble, stripQuotes } from "../src/clean.ts";
import { looksLikeCode } from "../src/code.ts";
import { condenseDiff, looksLikeDiff, parseDiff } from "../src/diff.ts";
import { toBulletList, toChecklist, toCommitMessage, toPullRequestDescription, wrap } from "../src/format.ts";
import { detectLanguage, languageName, listedLanguages, sameLanguageRule, wordsOf } from "../src/language.ts";
import { markerFor } from "../src/prompt.ts";
import { latestMessage } from "../src/reply.ts";
import { head, sameText, shortenMiddle, splitIntoParts, stopsMidSentence, tail } from "../src/text.ts";
import { charactersFor, estimateTokens, pointWeight } from "../src/tokens.ts";
import { contentKeys, foldedWords, overlap } from "../src/words.ts";

const rejoin = (parts) => parts.map((part) => part.before + part.core + part.after).join("");

describe("splitting a long text", () => {
  test("partsJoinBackToTheText", () => {
    const samples = [
      "One. Two! Three? ".repeat(800),
      Array.from({ length: 30 }, (_, index) => `Paragraph ${index}. ${"word ".repeat(120)}`).join("\n\n"),
      "x".repeat(10_000),
      `${"line\n".repeat(3000)}`,
      "👨‍👩‍👧".repeat(3000),
    ];
    for (const sample of samples) {
      const parts = splitIntoParts(sample, 2400);
      assert.equal(rejoin(parts), sample);
      for (const part of parts) assert.ok(part.core.length <= 2401, `a part of ${part.core.length}`);
      assert.ok(parts.every((part) => part.core !== ""));
    }
  });

  test("cutsAtParagraphsFirst", () => {
    const text = `${"a ".repeat(500).trim()}\n\n${"b ".repeat(500).trim()}\n\n${"c ".repeat(500).trim()}`;
    const parts = splitIntoParts(text, 1500);
    assert.deepEqual(parts.map((part) => part.core[0]), ["a", "b", "c"]);
    assert.equal(parts[1].before, "\n\n");
  });

  test("neverSplitsAnEmoji", () => {
    const parts = splitIntoParts("👍🏽".repeat(2000), 2401);
    for (const part of parts) assert.ok(!part.core.startsWith("\u{1F3FD}"), "a skin tone never starts a part");
    assert.equal(head("ab👍🏽cd", 3), "ab");
    assert.equal(head("ab👍🏽cd", 6), "ab👍🏽");
  });

  test("headAndTailEndBetweenWords", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta";
    assert.equal(head(text, 20), "alpha beta gamma");
    assert.equal(tail(text, 15), "zeta eta theta");
    assert.equal(head("short", 10), "short");
  });

  test("shortenMiddleKeepsBothEnds", () => {
    const text = `START ${"middle ".repeat(2000)}END`;
    const short = shortenMiddle(text, 1000);
    assert.ok(short.length <= 1000);
    assert.ok(short.startsWith("START ") && short.endsWith("END"));
    assert.match(short, /\n\[…\]\n/);
    assert.equal(shortenMiddle("tiny", 1000), "tiny");
  });

  test("sameTextIsLetterForLetter", () => {
    assert.ok(sameText("The report is ready.", "The report is ready.  \n"));
    assert.ok(sameText("one  \r\ntwo", "one\ntwo"), "spaces at line ends and line end styles are set aside");
    assert.equal(sameText("the report is ready", "The report is ready"), false, "a capital is a change");
    assert.equal(sameText("The report is ready", "The report is ready."), false, "a full stop is a change");
    assert.equal(sameText("a  b", "a b"), false, "a double space fixed is a change");
    assert.equal(sameText("one\ntwo", "one two"), false);
  });

  test("anAnswerThatStopsMidSentence", () => {
    const part = "We ship on Friday. Ada sends the draft to the team by Thursday.";
    assert.ok(stopsMidSentence(part, "We ship on Friday. Ada sends the draft to"), "stops on a word");
    assert.ok(stopsMidSentence(part, "We ship on Friday. Ada sends the dra"), "stops inside a word");
    assert.ok(stopsMidSentence(part, "We ship on Friday. Ada sends the draft to the team,"), "stops on a comma");
    assert.ok(stopsMidSentence("The meeting is at 10:30.", "The meeting is at 10"), "stops on a digit");
    assert.ok(stopsMidSentence("请在明天的会议之前把报告发给我。", "请在明天的会议之前把"), "Chinese");
    assert.ok(stopsMidSentence("She said: \"We ship on Friday.\"", "She said: \"We ship on"), "past a closing quote");
    assert.ok(stopsMidSentence("Toplantı yarın saat onda başlıyor.", "Toplantı yarın saat"), "Turkish");
  });

  test("anAnswerThatEndsWhereItsTextDoesIsNotCutShort", () => {
    const part = "We ship on Friday. Ada sends the draft to the team by Thursday.";
    assert.equal(stopsMidSentence(part, "We ship on Friday."), false, "ends a sentence");
    assert.equal(stopsMidSentence(part, "We ship Friday; Ada sends the draft by Thursday!"), false);
    assert.equal(stopsMidSentence(part, "We ship on Friday. Ada sends the draft to the team by Thursday"), false, "only the full stop left off");
    assert.equal(stopsMidSentence(part, "We ship on Friday. Ada sends the draft by THURSDAY"), false, "the same last word, in capitals");
    assert.equal(stopsMidSentence(part, "We ship on Friday, see you there 🎉"), false, "an emoji can end a sentence");
    assert.equal(stopsMidSentence(part, "(We ship on Friday.)"), false, "a sentence in brackets");
    assert.equal(stopsMidSentence(part, "**We ship on Friday.**"), false, "a sentence in bold");
    assert.equal(stopsMidSentence("ship it friday, ada sends the draft", "Ship it Friday; Ada sends"), false, "the text ends no sentence itself");
    assert.equal(stopsMidSentence("- the draft\n- the slides", "- the draft"), false, "a list");
    assert.equal(stopsMidSentence(part, ""), false);
    assert.equal(stopsMidSentence("", "x"), false);
  });

  test("partsOfADenseTextAreCountedInTokens", () => {
    const text = "这是一个很长的句子，用来测试分段。".repeat(400);
    const measure = { tokens: 1400, weigh: (point) => pointWeight(point, 1 / 2) };
    const parts = splitIntoParts(text, 2400, measure);
    assert.equal(rejoin(parts), text);
    for (const part of parts) assert.ok(estimateTokens(part.core, 1 / 2) <= 1401, `a part of ${estimateTokens(part.core, 1 / 2)} tokens`);
    assert.ok(parts.every((part) => part.core.endsWith("。")), "cut at a sentence end");
    const english = "Every word here is a few characters long. ".repeat(200);
    const latin = { tokens: 1400, weigh: (point) => pointWeight(point, 1 / 3) };
    assert.deepEqual(splitIntoParts(english, 2400, latin), splitIntoParts(english, 2400), "English stays within its characters first");
  });
});

describe("the answer's wrapping", () => {
  test("aFenceAroundTheWholeAnswer", () => {
    assert.equal(stripFence("```markdown\n## Summary\nText\n```", "x"), "## Summary\nText");
    assert.equal(stripFence("```\nplain\n```", "x"), "plain");
    assert.equal(stripFence("```js\na\n```\nand\n```js\nb\n```", "x"), "```js\na\n```\nand\n```js\nb\n```", "two blocks stay");
    assert.equal(stripFence("```\ncode\n```", "```\ncode\n```"), "```\ncode\n```", "the person's own fence stays");
  });

  test("aRephrasedFirstLineOfThePersonsOwnStays", () => {
    assert.equal(stripPreamble("Here are my thoughts:\nWe should ship on Friday.", "my thoughts:\nship friday"), "Here are my thoughts:\nWe should ship on Friday.");
    assert.equal(stripPreamble("İşte toplantı planı:\nCuma günü yayınlıyoruz.", "toplantı planı:\ncuma yayın"), "İşte toplantı planı:\nCuma günü yayınlıyoruz.");
    assert.equal(stripPreamble("Here is the rewritten text:\nMy thoughts: ship on Friday.", "my thoughts: ship friday"), "My thoughts: ship on Friday.", "it names the answer");
    assert.equal(stripPreamble("Here's what this code does:\nIt adds two numbers.", "const sum = a + b;"), "It adds two numbers.", "nothing of the text is in it");
    assert.equal(stripPreamble("Sure, here is a shorter one:\nShip on Friday.", "we should probably ship on friday"), "Ship on Friday.");
  });

  test("aPreambleLine", () => {
    assert.equal(stripPreamble("Sure! Here's a friendlier version:\nHi there!", "hello"), "Hi there!");
    assert.equal(stripPreamble("Corrected text:\nHello.", "helo"), "Hello.");
    assert.equal(stripPreamble("Tabii, işte daha kısa hali:\nKısa.", "uzun"), "Kısa.");
    assert.equal(stripPreamble("Here's the plan:\n- a\n- b", "heres the plan:\n- a\n- b"), "Here's the plan:\n- a\n- b");
    assert.equal(stripPreamble("Here is the plan:", "x"), "Here is the plan:", "nothing after it: it is the answer");
    assert.equal(stripPreamble("This function adds two numbers:\nit returns their sum.", "x"), "This function adds two numbers:\nit returns their sum.");
  });

  test("quotesAroundTheWholeAnswer", () => {
    assert.equal(stripQuotes("«Bonjour.»", "x"), "Bonjour.");
    assert.equal(stripQuotes("„Hallo.“", "x"), "Hallo.");
    assert.equal(stripQuotes("\"a\" and \"b\"", "x"), "\"a\" and \"b\"");
    assert.equal(stripQuotes("'tis fine'", "x"), "tis fine");
  });

  test("markersTheModelEchoes", () => {
    assert.equal(cleanAnswer("<text-2>\nHello.\n</text-2>", "x", "text-2"), "Hello.");
    assert.equal(cleanAnswer("Line one\r\nLine two\r\n", "x", "text"), "Line one\nLine two");
  });

  test("aSignatureTheModelAdded", () => {
    const input = "hey team, the build is green again, so we can ship on thursday. please check the draft.";
    const answer = "Dear Team,\n\nThe build is green again, so we can ship on Thursday. Please review the draft.\n\nBest regards,\n[Your Name]";
    assert.equal(stripPlaceholderSignature(answer, input), "Dear Team,\n\nThe build is green again, so we can ship on Thursday. Please review the draft.");
    assert.equal(stripPlaceholderSignature("Sayın Ekip,\n\nDerleme yeşil.\n\nSaygılarımla,\n\n[İsminiz]", "selam ekip, derleme yeşil"), "Sayın Ekip,\n\nDerleme yeşil.");
    assert.equal(stripPlaceholderSignature("Thank you for your help.\n\nThanks,\n[Name]", "thanks for the help\n\nThanks,\nAda"), "Thank you for your help.\n\nThanks,", "the person's own sign-off stays");
    assert.equal(stripPlaceholderSignature(answer, "see [the draft] before thursday"), answer, "the person's own brackets: placeholders stay");
    assert.equal(stripPlaceholderSignature("[Your Name]", input), "[Your Name]", "nothing else");
    assert.equal(stripPlaceholderSignature("We ship [soon].", input), "We ship [soon].");
  });

  test("bracketsTheModelEscaped", () => {
    // The real model wrote a Swedish reply's placeholder this way.
    assert.equal(cleanAnswer("Hej \\[namn],\n\nTack för uppdateringen.", "hej allihop", "text"), "Hej [namn],\n\nTack för uppdateringen.");
    assert.equal(stripEscapes("See \\[1\\] and C:\\temp", "x"), "See [1] and C:\\temp", "only brackets");
    assert.equal(stripEscapes("a \\[b\\]", "a \\[b\\] in my own text"), "a \\[b\\]", "the person's own backslashes stay");
  });

  test("refusals", () => {
    assert.ok(isRefusal("I'm sorry, but I can't help with that.", "text"));
    assert.ok(isRefusal("I can’t assist with that request.", "text"));
    assert.ok(isRefusal("Üzgünüm, bu konuda yardımcı olamam.", "metin"));
    assert.equal(isRefusal("Sorry, I can't make it tomorrow.", "sorry i cant make it tomorow"), false);
    assert.equal(isRefusal("I'm sorry, but I can't help with that.", "Im sorry but I cant help with that"), false);
    assert.equal(isRefusal(`I'm sorry, but I can't help with that. ${"x ".repeat(400)}`, "text"), false, "a long answer is an answer");
  });

  test("aRewriteOfThePersonsOwnNoIsNoRefusal", () => {
    assert.equal(isRefusal("I'm sorry, but I am unable to do that this week, as I am fully booked.", "no i cant do that this week, im fully booked"), false);
    assert.equal(isRefusal("Maalesef bu hafta sonu taşınmana yardımcı olamam, çok üzgünüm!", "bu hafta sonu taşınmana yardım edemem"), false);
    assert.equal(isRefusal("Üzgünüm, bu hafta raporu yapamam.", "bu hafta raporu bitiremeyeceğim"), false, "\"yapamam\" alone is a Turkish no, not a refusal");
    assert.equal(isRefusal("I'm sorry, but I can't complete the report this week.", "the report wont be done this week"), false);
    assert.equal(isRefusal("I'm sorry, but I can't complete the report this week.", "report not done this week, sorry"), false);
    assert.equal(isRefusal("I'm sorry, but I can't complete the report by Friday.", "finishing the report by friday is not possible"), false, "most of the text's words are in it");
    assert.ok(isRefusal("I'm sorry, but I can't help with that request.", "write the quarterly numbers into the table"), "nothing of the text is in it");
    assert.ok(isRefusal("Üzgünüm, bu konuda yardımcı olamam.", "toplantı notlarını düzenle"));
  });
});

describe("shapes", () => {
  test("bulletList", () => {
    assert.equal(toBulletList("1. One\n2) Two\n\n  - Nested\nPlain line"), "- One\n- Two\n  - Nested\n- Plain line");
    assert.equal(toBulletList(toBulletList("• a\n• b")), "- a\n- b", "shaping twice changes nothing");
  });

  test("checklist", () => {
    assert.equal(toChecklist("Tasks:\n1. Send it\n[x] Call Ada\n☐ Call Ada\n- [ ] Book"), "- [ ] Send it\n- [ ] Call Ada\n- [ ] Book");
    assert.equal(toChecklist("NONE"), "");
    assert.equal(toChecklist("Yok."), "");
    assert.equal(toChecklist("- [ ] NONE"), "", "a NONE written as an item is still none");
    assert.equal(toChecklist("- None."), "");
    assert.equal(toChecklist("1. [ ] Yok"), "");
    assert.equal(toChecklist("- [ ] None of the slides need changes"), "- [ ] None of the slides need changes");
    assert.equal(toChecklist(toChecklist("- a\n- b")), "- [ ] a\n- [ ] b");
  });

  test("commitMessage", () => {
    assert.equal(toCommitMessage("FIX: handle an empty list."), "fix: handle an empty list");
    assert.equal(toCommitMessage("Subject: docs(readme): explain setup\nBody: Adds the steps."), "docs(readme): explain setup\n\nAdds the steps.");
    assert.equal(toCommitMessage("**refactor!: drop the old cache**\n\n\n- remove it\n\n"), "refactor!: drop the old cache\n\n- remove it");
    assert.equal(toCommitMessage("Update the readme"), "Update the readme", "no type is invented");
    const long = toCommitMessage(`feat: ${"word ".repeat(30)}`);
    assert.ok(long.length <= 72 && !long.endsWith(" "));
    assert.equal(toCommitMessage(""), "");
  });

  test("aCommitSummaryInTheImperative", () => {
    // What the real model wrote for a retry, a README and a date fix.
    assert.equal(toCommitMessage("feat: Added retry logic to the upload function"), "feat: add retry logic to the upload function");
    assert.equal(toCommitMessage("fix(date): Fixed the date difference calculation"), "fix(date): fix the date difference calculation");
    assert.equal(toCommitMessage("refactor: Simplifies the parser"), "refactor: simplify the parser");
    assert.equal(toCommitMessage("feat: Retries a failed upload"), "feat: retry a failed upload");
    assert.equal(toCommitMessage("feat: Xcode support for the build"), "feat: Xcode support for the build", "a name keeps its capital");
    assert.equal(toCommitMessage("feat: API keys in the settings"), "feat: API keys in the settings");
    assert.equal(toCommitMessage("Updated the readme"), "Updated the readme", "an untyped subject is left as it is");
  });

  test("aCommitTypeThatAgreesWithTheChange", () => {
    assert.equal(toCommitMessage("feat: Fixes the date calculation to use UTC"), "fix: fix the date calculation to use UTC", "a feat that only fixes");
    const readme = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # App\n+Install it with make.";
    assert.equal(toCommitMessage("feat: Add macOS installation instructions to README.md", readme), "docs: add macOS installation instructions to README.md");
    const docs = "diff --git a/docs/setup.txt b/docs/setup.txt\n@@ -1 +1 @@\n-a\n+b";
    assert.equal(toCommitMessage("fix(docs): correct a step", docs), "docs(docs): correct a step");
    const tests = "diff --git a/src/date.test.ts b/src/date.test.ts\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/tests/upload.py b/tests/upload.py\n@@ -1 +1 @@\n-a\n+b";
    assert.equal(toCommitMessage("feat: cover leap years", tests), "test: cover leap years");
    const mixed = `${readme}\ndiff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-a\n+b`;
    assert.equal(toCommitMessage("feat: add an install step", mixed), "feat: add an install step", "code changed too");
    assert.equal(toCommitMessage("revert: undo the README change", readme), "revert: undo the README change");
    assert.equal(toCommitMessage("feat: add an install step", "requirements.txt is no diff"), "feat: add an install step");
  });

  test("aCommitBodyThatCopiesTheDiffLosesTheCopy", () => {
    // What the real model wrote for a README change: the added lines again, code block and all.
    const readme = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -20,2 +20,6 @@\n-Run `make install`.\n+Run `make install`. On macOS you need the Xcode command line tools first:\n+\n+```sh\n+xcode-select --install\n+```";
    const answer = "docs(macOS): add Xcode command line tools to make install\n\nRun `make install`. On macOS you need the Xcode command line tools first:\n\n```sh\nxcode-select --install\n```";
    assert.equal(toCommitMessage(answer, readme), "docs(macOS): add Xcode command line tools to make install");
    const own = "docs: explain the install step\n\nThe README now says which tools macOS needs first.";
    assert.equal(toCommitMessage(own, readme), "docs: explain the install step\n\nThe README now says which tools macOS needs first.", "a body of its own stays");
  });

  test("wrapIndentsListItems", () => {
    assert.deepEqual(wrap(`- ${"word ".repeat(20).trim()}`, 30), ["- word word word word word", "  word word word word word", "  word word word word word", "  word word word word word"]);
    assert.deepEqual(wrap("x".repeat(100), 72), ["x".repeat(100)], "one long word stays whole");
  });

  test("pullRequestDescription", () => {
    assert.equal(toPullRequestDescription("## Summary\nAdds retries.\n## Changes\n1. Retry\n2. Log"), "## Summary\n\nAdds retries.\n\n## Changes\n\n- Retry\n- Log");
  });
});

describe("diffs", () => {
  const diff = [
    "commit 1234567",
    "Author: Ada <ada@example.com>",
    "",
    "    Add retries",
    "",
    "diff --git a/src/upload.ts b/src/upload.ts",
    "index 1111111..2222222 100644",
    "--- a/src/upload.ts",
    "+++ b/src/upload.ts",
    "@@ -1,4 +1,5 @@ export async function upload()",
    " import { send } from \"./send.ts\";",
    "-await send();",
    "+await retry(send, 3);",
    "+log(\"sent\");",
    "\\ No newline at end of file",
    "diff --git a/assets/logo.png b/assets/logo.png",
    "new file mode 100644",
    "Binary files /dev/null and b/assets/logo.png differ",
    "diff --git a/old.txt b/new.txt",
    "similarity index 100%",
    "rename from old.txt",
    "rename to new.txt",
  ].join("\n");

  test("readsFilesAndCounts", () => {
    const { preamble, files } = parseDiff(diff);
    assert.match(preamble, /^commit 1234567/);
    assert.deepEqual(files.map((file) => [file.path, file.added, file.removed, file.binary]), [
      ["src/upload.ts", 2, 1, false],
      ["assets/logo.png", 0, 0, true],
      ["new.txt", 0, 0, false],
    ]);
  });

  test("aSmallDiffIsKeptWhole", () => {
    const condensed = condenseDiff(diff, 6000);
    assert.match(condensed, /Files changed: 3\n- src\/upload\.ts \(\+2 -1\)\n- assets\/logo\.png \(\+0 -0, binary\)\n- new\.txt \(\+0 -0\)/);
    assert.match(condensed, / import \{ send \}/);
    assert.match(condensed, /rename from old\.txt/);
    assert.doesNotMatch(condensed, /^index /m);
    assert.doesNotMatch(condensed, /No newline/);
  });

  test("aLongDiffLosesContextThenSharesTheRoom", () => {
    const big = Array.from({ length: 30 }, (_, index) => [
      `diff --git a/f${index}.ts b/f${index}.ts`,
      "@@ -1,100 +1,100 @@",
      ...Array.from({ length: 100 }, (_, line) => (line % 2 ? ` context ${line}` : `+added ${index} ${line}`)),
    ].join("\n")).join("\n");
    const condensed = condenseDiff(big, 6000);
    assert.ok(condensed.length <= 6000, `${condensed.length}`);
    assert.doesNotMatch(condensed, / context /);
    for (let index = 0; index < 30; index++) assert.match(condensed, new RegExp(`\\+added ${index} 0\\n`), `file ${index} keeps a line`);
    assert.match(condensed, /\[\d+ more lines\]/);
  });

  test("aMultiFileDiffThatGitDidNotMake", () => {
    // `diff -ruN` and `svn diff`: no `diff --git` line, a date after a tab, and each file starting with `---`/`+++`.
    const plain = [
      "diff -ruN old/one.txt new/one.txt",
      "--- old/one.txt\t2026-05-03 10:00:00.000000000 +0200",
      "+++ new/one.txt\t2026-05-03 10:05:00.000000000 +0200",
      "@@ -1,3 +1,3 @@",
      "-old one",
      "+new one",
      " same",
      " also same",
      "diff -ruN old/two.txt new/two.txt",
      "--- old/two.txt\t2026-05-03 10:00:00.000000000 +0200",
      "+++ new/two.txt\t2026-05-03 10:05:00.000000000 +0200",
      "@@ -1 +1,2 @@",
      " keep",
      "+added",
      "--- /dev/null",
      "+++ b/three.txt",
      "@@ -0,0 +1 @@",
      "+brand new",
    ].join("\n");
    const { preamble, files } = parseDiff(plain);
    assert.equal(preamble, "diff -ruN old/one.txt new/one.txt");
    assert.deepEqual(files.map((file) => [file.path, file.added, file.removed]), [
      ["new/one.txt", 1, 1],
      ["new/two.txt", 1, 0],
      ["three.txt", 1, 0],
    ]);
    assert.match(condenseDiff(plain, 6000), /Files changed: 3\n- new\/one\.txt \(\+1 -1\)\n- new\/two\.txt \(\+1 -0\)\n- three\.txt \(\+1 -0\)/);
    const deleted = parseDiff("--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye");
    assert.deepEqual(deleted.files.map((file) => [file.path, file.added, file.removed]), [["gone.txt", 0, 1]]);
  });

  test("changedLinesThatLookLikeFileHeadersStayInTheirHunk", () => {
    // A removed SQL comment and an added line starting "++" inside a hunk whose header still counts them.
    const sql = "diff --git a/q.sql b/q.sql\n@@ -1,2 +1,2 @@\n--- old note\n+++ new note\n select 1;";
    assert.deepEqual(parseDiff(sql).files.map((file) => [file.path, file.added, file.removed]), [["q.sql", 1, 1]]);
  });

  test("hunksWithoutHeadersAndNoDiffAtAll", () => {
    assert.equal(condenseDiff("@@ -1 +1 @@\n-a\n+b", 100), "@@ -1 +1 @@\n-a\n+b");
    assert.equal(condenseDiff("just words", 4), "just");
    assert.equal(looksLikeDiff("text\n@@ -1,2 +1,2 @@\n-a"), true);
    assert.equal(looksLikeDiff("talk about @@ -1 +1 @@ inline"), false);
    assert.equal(looksLikeDiff(`${"a".repeat(5000)}\ndiff --git a/x b/x`), false, "only the first 4,000 characters are looked at");
  });

  test("veryLongLinesAreCut", () => {
    const minified = `diff --git a/app.js b/app.js\n@@ -1 +1 @@\n-${"a".repeat(50_000)}\n+${"b".repeat(50_000)}`;
    const condensed = condenseDiff(minified, 6000);
    assert.ok(condensed.length < 1000);
    assert.match(condensed, /\n\+b{299}…\n?/);
  });
});

describe("the newest message of a mail", () => {
  test("cutsAtTheReplyHeader", () => {
    assert.equal(latestMessage("Thanks!\n\nOn Tue, 4 Nov 2026 at 09:12, Ada <ada@example.com> wrote:\n> Here it is."), "Thanks!");
    assert.equal(latestMessage("Teşekkürler.\n\n4 Kas 2026 Sal 09:12 tarihinde Ada <ada@example.com> şunu yazdı:\n> Buyur."), "Teşekkürler.");
    assert.equal(latestMessage("Sure.\n-----Original Message-----\nFrom: Ada"), "Sure.");
    assert.equal(latestMessage("Sure.\nFrom: Ada <ada@example.com>\nSent: Tuesday\nOld text"), "Sure.");
    assert.equal(latestMessage("From: the team, with thanks.\nSee you."), "From: the team, with thanks.\nSee you.");
  });

  test("aWrappedAttributionLine", () => {
    const mail = "Sounds good, see you then.\n\nOn Mon, May 3, 2026 at 10:00 AM Ada Lovelace <\nada@example.com> wrote:\nEarlier text without quotes.\n> Quoted";
    assert.equal(latestMessage(mail), "Sounds good, see you then.");
    const turkish = "Olur.\n\n3 May 2026 Pzt 10:00 tarihinde Ada Lovelace\n<ada@example.com> şunu yazdı:\nEski metin";
    assert.equal(latestMessage(turkish), "Olur.");
    assert.equal(latestMessage("On Monday we ship.\nAs Ada wrote:\nthe plan holds."), "On Monday we ship.\nAs Ada wrote:\nthe plan holds.", "a sentence of the person's own");
  });

  test("dropsQuotedLinesAndKeepsAnAllQuotedText", () => {
    assert.equal(latestMessage("Yes, let's.\n> Shall we?\n>> Earlier"), "Yes, let's.");
    assert.equal(latestMessage("> only a quote"), "> only a quote");
  });
});

describe("languages", () => {
  test("detectsTurkishAndEnglish", () => {
    assert.equal(detectLanguage("Yarın toplantıdan önce raporu gönderebilir misin?"), "Turkish");
    assert.equal(detectLanguage("İyi akşamlar, bu dosyayı inceler misin"), "Turkish");
    assert.equal(detectLanguage("Can you send the report to the team before the meeting?"), "English");
    assert.equal(detectLanguage("I met Doğan and Ayşe at the station, and we talked about the plan for the week."), "English", "a Turkish name or two");
    assert.equal(detectLanguage("hey"), null);
    assert.equal(detectLanguage("build yeşil, yarın deploy ederiz ama önce testleri koşalım"), "Turkish", "with English words in it");
    assert.equal(detectLanguage("so i was like, will it work in the CI or not"), "English");
  });

  test("detectsEveryLanguageTheModelSpeaks", () => {
    const samples = {
      German: "der build ist wieder grün, nachdem wir den test repariert haben, also denke ich, dass wir am donnerstag veröffentlichen können, wenn niemand etwas dagegen hat.",
      Dutch: "de build is weer groen nadat we de uploadtest hebben gerepareerd, dus ik denk dat we donderdag kunnen uitbrengen als niemand bezwaar heeft.",
      French: "le build est de nouveau vert depuis qu'on a corrigé le test d'envoi instable, donc je pense qu'on peut publier jeudi si personne ne s'y oppose.",
      Spanish: "la compilación vuelve a estar en verde después de arreglar la prueba de subida inestable, así que creo que podemos publicar el jueves si nadie se opone.",
      Italian: "la build è di nuovo verde dopo che abbiamo sistemato il test di caricamento instabile, quindi penso che possiamo pubblicare giovedì se nessuno è contrario.",
      Portuguese: "o build voltou a ficar verde depois que corrigimos o teste de envio instável, então acho que podemos publicar na quinta se ninguém se opuser.",
      Swedish: "bygget är grönt igen efter att vi fixade det instabila uppladdningstestet, så jag tror att vi kan släppa på torsdag om ingen har något emot det.",
      Vietnamese: "bản dựng đã xanh trở lại sau khi chúng ta sửa bài kiểm tra tải lên không ổn định, nên tôi nghĩ chúng ta có thể phát hành vào thứ năm.",
      Japanese: "不安定なアップロードテストを直したので、ビルドはまた正常に戻りました。反対がなければ木曜日にリリースできると思います。",
      Korean: "불안정한 업로드 테스트를 고친 뒤 빌드가 다시 정상이 되었습니다. 반대가 없으면 목요일에 출시할 수 있을 것 같습니다.",
      Chinese: "我们修复了不稳定的上传测试之后，构建又恢复正常了，如果没有人反对，我想我们可以在周四发布。",
    };
    for (const [name, sample] of Object.entries(samples)) assert.equal(detectLanguage(sample), name, name);
    assert.equal(detectLanguage("我們修復了不穩定的上傳測試之後，建置又恢復正常了，謝謝！"), "Chinese", "traditional characters");
    assert.equal(detectLanguage("Kannst du mir den Bericht morgen schicken?"), "German", "German over Swedish: \"du\" and \"den\" are shared");
    assert.equal(detectLanguage("Was hast du gesagt? Ich will das nicht machen."), "German", "not English: was, will");
    assert.equal(detectLanguage("We hebben het rapport gisteren gestuurd, maar het is nog niet klaar en dat was de bedoeling niet."), "Dutch", "not English: we, is, was");
  });

  test("namesTwoLanguagesThatAreAboutAsLikely", () => {
    const danish = "buildet er grønt igen, efter at vi har rettet den ustabile upload-test, så jeg tror, vi kan udgive på torsdag, hvis ingen har noget imod det.";
    const norwegian = "bygget er grønt igjen etter at vi fikset den ustabile opplastingstesten, så jeg tror vi kan publisere på torsdag hvis ingen har noe imot det.";
    assert.match(detectLanguage(danish), /^(?:Danish or Norwegian|Norwegian or Danish)$/);
    assert.match(detectLanguage(norwegian), /^(?:Norwegian or Danish|Danish or Norwegian)$/);
    assert.equal(detectLanguage("Ich habe die Datei. The meeting is at noon and the room is booked."), "German or English", "half and half");
    assert.equal(sameLanguageRule("Danish or Norwegian"), "You MUST write in the language of the text, Danish or Norwegian, whichever it is. NEVER translate it.");
  });

  test("namesNoLanguageWithoutClearEvidence", () => {
    assert.equal(detectLanguage("Sabah görüşə gələ bilməyəcəyəm, işim çoxdur."), null, "Azerbaijani has ə");
    assert.equal(detectLanguage("Mâine nu pot veni la şedinţă, am mult de lucru."), null, "Romanian with cedillas");
    assert.equal(detectLanguage("Bon dia, em pots enviar l'informe abans de la reunió? Moltes gràcies per tot."), null, "Catalan is not Spanish or French");
    assert.equal(detectLanguage("Hei, voitko lähettää raportin ennen kokousta? Kiitos paljon."), null, "Finnish is not Swedish");
    assert.equal(detectLanguage("Привет, можешь прислать отчёт до встречи?"), null);
    assert.equal(detectLanguage("Moim zdaniem to jest bardzo dobry pomysł, ale nie wiem."), null);
    assert.equal(detectLanguage("for (const item of this.items) { if (item.price > 0) total += item.price; }"), null, "code is not English");
    assert.equal(detectLanguage("The OP said the ES module build on the MIT repo was broken, so we will fix it in CI."), "English", "dev words are no other language");
    assert.equal(detectLanguage("thanks!"), null, "too little to tell");
    assert.equal(detectLanguage("Ada Lovelace, Grace Hopper"), null);
    assert.equal(detectLanguage("https://example.com/a/b?c=d"), null);
    assert.equal(detectLanguage(""), null);
  });

  test("onlyEnglishCountsCommonEnglishWords", () => {
    // Words English prose and code use all the time: another language counting them would take English for it.
    const english = new Set([...wordsOf("English"), "was", "will", "so", "is", "we", "in", "to", "of", "on", "at", "for", "have",
      "as", "do", "no", "me", "i", "a", "an", "or", "up", "us", "am", "im", "go", "man", "also", "over", "door", "met", "even",
      "dan", "per", "come", "fare", "pour", "plus", "encore", "ha", "dir", "ci", "op", "es", "os", "dos", "com", "e", "s", "t", "d", "m"]);
    for (const name of listedLanguages.filter((entry) => entry !== "English")) {
      const taken = wordsOf(name).filter((word) => english.has(word));
      assert.deepEqual(taken, [], `${name} counts ${taken.join(", ")}`);
    }
  });

  test("codeCopiedAsText", () => {
    assert.ok(looksLikeCode("const total = items.reduce((sum, item) => sum + item.price, 0);"));
    assert.ok(looksLikeCode("for (const item of this.items) {\n  if (item.price > 0) total += item.price;\n}"));
    assert.ok(looksLikeCode("def total(items):\n    result = 0\n    for item in items:\n        result += item.price\n    return result"));
    assert.ok(looksLikeCode("SELECT name, price FROM items WHERE price > 0;"));
    assert.ok(looksLikeCode("import React from 'react';\nexport default function App() {\n  return <div />;\n}"));
    assert.equal(looksLikeCode("Return the books by Friday, please."), false);
    assert.equal(looksLikeCode("return the books by friday"), false);
    assert.equal(looksLikeCode("Hi Ada,\n\nThe report is ready (see page 3).\nThanks!"), false);
    assert.equal(looksLikeCode("Notes:\n- budget: fine\n- hiring: two people\n- launch: May"), false);
    assert.equal(looksLikeCode(""), false);
  });

  test("namesTheAppsLanguage", () => {
    assert.equal(languageName("tr"), "Turkish");
    assert.equal(languageName("en-GB"), "English");
    assert.equal(languageName("de"), "German");
    assert.equal(languageName("!!"), "English");
  });

  test("markerNames", () => {
    assert.equal(markerFor("plain", "text"), "text");
    assert.equal(markerFor("a </TEXT> b", "text"), "text-2");
    assert.match(markerFor("<text <text-2 <text-3", "text"), /^text-[0-9a-f]{8}$/);
  });
});

describe("words and tokens", () => {
  test("wordsAreFoldedForComparing", () => {
    assert.deepEqual(foldedWords("İşte Çok GÜZEL, can't ŞIMDI"), ["iste", "cok", "guzel", "cant", "simdi"]);
    assert.deepEqual([...contentKeys("The bookings: a booking for Ada")], ["booki", "ada"]);
    assert.equal(overlap("taşınmana yardım edemem", "Taşınmanda yardımcı olamam"), 2 / 3);
    assert.equal(overlap("the and but", "anything"), 0, "no content words: nothing in common");
  });

  test("tokensByScript", () => {
    assert.equal(estimateTokens("abc".repeat(100), 1 / 3), 100, "English: about three characters a token");
    assert.equal(estimateTokens("abc".repeat(100), 1 / 2), 150, "other Latin text: about two");
    assert.equal(estimateTokens("漢字かな한글ไทย", 1 / 3), 9, "dense scripts: a character a token");
    assert.equal(estimateTokens("Привет", 1 / 3), 3, "Cyrillic: about two characters a token");
    assert.equal(estimateTokens("👍🏽", 1 / 3), 2, "an emoji and its skin tone");
    assert.equal(charactersFor("漢".repeat(5000), 2800, 1 / 2), 2800);
    assert.equal(charactersFor("word ".repeat(1000), 2800, 1 / 3), 5000, "a text that fits keeps its length");
  });
});

describe("hostile texts stay fast", () => {
  // The at-once action has 10 seconds in all; none of this may take more than a sliver of it.
  const time = (label, work) => {
    const started = performance.now();
    work();
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1000, `${label}: ${elapsed.toFixed(0)} ms`);
  };
  const hostile = [
    " ".repeat(60_000),
    "\n".repeat(60_000),
    "`".repeat(60_000),
    "\"".repeat(60_000),
    ".".repeat(60_000),
    "-".repeat(60_000),
    "- ".repeat(30_000),
    `Here is ${"x".repeat(60_000)}:`,
    `I'm sorry, ${"but ".repeat(15_000)}`,
    `feat(${"(".repeat(60_000)}`,
    `${"1".repeat(60_000)}. x`,
    "<text".repeat(12_000),
    "On ".repeat(20_000),
    `${"a".repeat(299)}\n`.repeat(200),
  ];

  test("cleaningAndShaping", () => {
    for (const sample of hostile) {
      time(`clean ${JSON.stringify(sample.slice(0, 10))}`, () => {
        cleanAnswer(sample, "x", "text");
        cleanAnswer("Here are my thoughts:\nx", sample, "text");
        isRefusal(sample, "x");
        isRefusal("I'm sorry, but I can't help with that.", sample);
        toBulletList(sample);
        toChecklist(sample);
        toCommitMessage(sample);
        toPullRequestDescription(sample);
        sameText(sample, sample);
        stopsMidSentence(sample, sample);
        stopsMidSentence(`${sample}.`, `x${sample}`);
        stripPlaceholderSignature(`x\n${sample}`, "x");
        stripEscapes(`\\${sample}`, "x");
        toCommitMessage(`feat: ${sample}`, sample);
      });
    }
  });

  test("readingTheInput", () => {
    for (const sample of hostile) {
      time(`input ${JSON.stringify(sample.slice(0, 10))}`, () => {
        splitIntoParts(sample, 2400);
        shortenMiddle(sample, 5000);
        latestMessage(sample);
        detectLanguage(sample);
        looksLikeCode(sample);
        estimateTokens(sample, 1 / 2);
        overlap(sample, sample);
        markerFor(sample, "text");
        looksLikeDiff(sample);
        condenseDiff(sample, 6000);
      });
    }
  });

  test("aDiffOfAMillionCharacters", () => {
    const big = `diff --git a/a b/a\n@@ -1 +1 @@\n${"+line of code\n".repeat(80_000)}`;
    time("condense", () => assert.ok(condenseDiff(big, 6000).length <= 6000));
  });
});
