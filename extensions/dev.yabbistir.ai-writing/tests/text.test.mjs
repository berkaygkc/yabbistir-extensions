import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { cleanAnswer, isRefusal, stripFence, stripPreamble, stripQuotes } from "../src/clean.ts";
import { condenseDiff, looksLikeDiff, parseDiff } from "../src/diff.ts";
import { toBulletList, toChecklist, toCommitMessage, toPullRequestDescription, wrap } from "../src/format.ts";
import { detectLanguage, languageName } from "../src/language.ts";
import { markerFor } from "../src/prompt.ts";
import { latestMessage } from "../src/reply.ts";
import { head, sameText, shortenMiddle, splitIntoParts, tail } from "../src/text.ts";

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

  test("sameTextIgnoresSpacingCaseAndAFinalStop", () => {
    assert.ok(sameText("The report is ready", "the  report is\nready."));
    assert.equal(sameText("The report is ready", "The report is done."), false);
  });
});

describe("the answer's wrapping", () => {
  test("aFenceAroundTheWholeAnswer", () => {
    assert.equal(stripFence("```markdown\n## Summary\nText\n```", "x"), "## Summary\nText");
    assert.equal(stripFence("```\nplain\n```", "x"), "plain");
    assert.equal(stripFence("```js\na\n```\nand\n```js\nb\n```", "x"), "```js\na\n```\nand\n```js\nb\n```", "two blocks stay");
    assert.equal(stripFence("```\ncode\n```", "```\ncode\n```"), "```\ncode\n```", "the person's own fence stays");
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

  test("refusals", () => {
    assert.ok(isRefusal("I'm sorry, but I can't help with that.", "text"));
    assert.ok(isRefusal("I can’t assist with that request.", "text"));
    assert.ok(isRefusal("Üzgünüm, bu konuda yardımcı olamam.", "metin"));
    assert.equal(isRefusal("Sorry, I can't make it tomorrow.", "sorry i cant make it tomorow"), false);
    assert.equal(isRefusal("I'm sorry, but I can't help with that.", "Im sorry but I cant help with that"), false);
    assert.equal(isRefusal(`I'm sorry, but I can't help with that. ${"x ".repeat(400)}`, "text"), false, "a long answer is an answer");
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
    assert.equal(detectLanguage("Kannst du mir den Bericht schicken?"), null);
    assert.equal(detectLanguage("Puedes ver el informe en la oficina de ventas?"), null);
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
        isRefusal(sample, "x");
        toBulletList(sample);
        toChecklist(sample);
        toCommitMessage(sample);
        toPullRequestDescription(sample);
        sameText(sample, sample);
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
