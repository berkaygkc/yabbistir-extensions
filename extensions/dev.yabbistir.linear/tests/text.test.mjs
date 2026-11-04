import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { descriptionOf, escapeMarkdown, issueKeyOf, looksLikeCode, markdownLink, teamKeyOf, titleOf } from "../src/text.ts";
import { KEY, START, fakeLinear } from "./fake-linear.mjs";

const note = (limit) => `cut at ${limit}`;

describe("issue keys", () => {
  test("an identifier or a link to an issue names it", () => {
    assert.equal(issueKeyOf(" ENG-123\n"), "ENG-123");
    assert.equal(issueKeyOf("https://linear.app/ornek/issue/ENG-123/some-slug"), "ENG-123");
    assert.equal(issueKeyOf("https://linear.app/ornek/issue/ENG-123?x=1"), "ENG-123");
    assert.equal(issueKeyOf("https://linear.app/ornek/issue/ENG-123"), "ENG-123");
    for (const value of ["eng-123", "ENG-123 x", "https://linear.app/ornek/issue/ENG-123x", "https://linear.app/ornek/team/ENG", "", "ENG-1".repeat(500)]) {
      assert.equal(issueKeyOf(value), undefined, value.slice(0, 40));
    }
  });

  test("a team key is letters and digits, in capitals", () => {
    assert.equal(teamKeyOf(" eng "), "ENG");
    assert.equal(teamKeyOf("Web2"), "WEB2");
    for (const value of ["", "E NG", "ENG-1", "ENG_", "x".repeat(11), 7, null, undefined]) assert.equal(teamKeyOf(value), undefined, String(value));
  });
});

describe("Markdown links", () => {
  test("escape what Markdown would read", () => {
    assert.equal(escapeMarkdown("a [b] *c* _d_ `e` <f> \\ g"), "a \\[b\\] \\*c\\* \\_d\\_ \\`e\\` \\<f\\> \\\\ g");
  });

  test("keep the title on one line and the address unbroken", () => {
    assert.equal(markdownLink({ identifier: "ENG-1", title: "Two\nlines\t here", url: "https://linear.app/o/issue/ENG-1/a (b)" }), "[ENG-1: Two lines here](https://linear.app/o/issue/ENG-1/a%20%28b%29)");
  });
});

describe("a new issue's title", () => {
  test("is the first line with a word, without fences, headings or time stamps", () => {
    assert.equal(titleOf("\n\n```\n{\n  \"error\": \"boom\"\n}\n```"), "\"error\": \"boom\"");
    assert.equal(titleOf("## Crash on launch\nmore"), "Crash on launch");
    assert.equal(titleOf("[2026-11-04 08:12:03,120] WARN disk almost full"), "WARN disk almost full");
    assert.equal(titleOf("2026-11-04T08:12:03+03:00 boot"), "boot");
    assert.equal(titleOf("2026-11-04T08:12"), "2026-11-04T08:12", "a stamp alone stays");
    assert.equal(titleOf("{\n}"), "{", "with no word anywhere, the first line");
    assert.equal(titleOf("  lots   of\tspace  "), "lots of space");
  });

  test("is cut to a hundred characters, counted as a person sees them", () => {
    const long = "ğ".repeat(150);
    const title = titleOf(long);
    assert.equal(Array.from(title).length, 100);
    assert.ok(title.endsWith("…"));
    const words = titleOf(`${"word ".repeat(40)}end`);
    assert.ok(words.endsWith("word…"), words);
    assert.ok(Array.from(words).length <= 100);
    assert.equal(titleOf(`${"x".repeat(98)}, more words`), `${"x".repeat(98)}…`, "no comma before the ellipsis");
  });
});

describe("telling code from prose", () => {
  test("traces, logs and code are code", () => {
    for (const value of [
      "TypeError: x is undefined",
      "java.lang.IllegalStateException: closed",
      "Error: ENOENT: no such file",
      "panic: runtime error: index out of range",
      "Traceback (most recent call last):\n  File \"app.py\", line 3, in <module>\n    main()\nKeyError: 'id'",
      "2026-11-04 08:12:03 INFO started\n2026-11-04 08:12:04 ERROR failed",
      "[ERROR] build failed",
      "{\n  \"id\": 1,\n  \"name\": \"x\"\n}",
      "def main():\n    print('hi')\n    return 0",
      "$ npm test\n> node --test",
      "const x = 1;",
      "if (a && b) {",
      "#0 0x00007fff in main\n#1 0x00007ffe in start",
    ]) assert.equal(looksLikeCode(value), true, value);
  });

  test("prose is prose", () => {
    for (const value of [
      "",
      "   ",
      "The save button overlaps the footer on small screens",
      "Error messages are hard to read",
      "Steps:\n1. Open the panel\n2. Press return twice\n3. Nothing happens",
      "Hi team,\n\nThe export (CSV) is missing the date column.\nCould someone look?\n\nThanks",
      "Info: we meet at 3",
    ]) assert.equal(looksLikeCode(value), false, value);
  });

  test("one log line in a long message doesn't make it code", () => {
    const message = "Checkout fails for some people.\nIt started after Tuesday's release.\nWe saw this in the console:\nTypeError: price is undefined\nCan we roll back?";
    assert.equal(looksLikeCode(message), false);
  });
});

describe("a new issue's description", () => {
  test("drops blank lines at the ends and trailing spaces, keeps the rest", () => {
    assert.equal(descriptionOf("\n\n  indented\n\nlast   \n\n", false, note), "  indented\n\nlast");
    assert.equal(descriptionOf("a\r\nb\rc", true, note), "```\na\nb\nc\n```");
  });

  test("never cuts inside a character", () => {
    const description = descriptionOf("a" + "😀".repeat(40_000), false, note);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(description.replace(/\n\n_cut at 50000_$/, "")));
    assert.ok(description.endsWith("\n\n_cut at 50000_"));
  });
});

describe("long and hostile copies stay fast", () => {
  // The action has 10 seconds; these must take a small part of that whatever the copy holds.
  const hostile = [
    "a".repeat(200_000),
    " ".repeat(200_000) + "x",
    "\t".repeat(100_000) + "at",
    ";".repeat(100_000),
    "Error".repeat(40_000),
    "x".repeat(100_000) + "Error",
    "[".repeat(200_000),
    "\"".repeat(200_000) + ":",
    "File \"".repeat(30_000),
    "2026-11-04T08:12:03".repeat(10_000),
    "import ".repeat(30_000),
    "#".repeat(200_000) + " x",
    "`".repeat(200_000),
    "~~~".repeat(60_000),
    "x\n".repeat(100_000),
    "\r\n".repeat(100_000) + "y",
    "ENG-1".repeat(40_000),
    "https://linear.app/" + "a".repeat(200_000) + "/issue/ENG-1",
    "-".repeat(100_000) + "x",
    "    at ".repeat(30_000),
  ];

  test("the text helpers", () => {
    for (const value of hostile) {
      const started = performance.now();
      looksLikeCode(value);
      titleOf(value);
      descriptionOf(value, true, note);
      issueKeyOf(value);
      teamKeyOf(value);
      const took = performance.now() - started;
      assert.ok(took < 250, `${JSON.stringify(value.slice(0, 12))}… took ${Math.round(took)} ms`);
    }
  });

  test("the whole create action on a large copy", async () => {
    const module = await import(`../src/index.ts?helper=text-${Date.now()}`);
    const fake = fakeLinear();
    const host = createFakeHost({ folder: new URL("..", import.meta.url), sources: module.sources, http: fake.http, now: START, secrets: { apiKey: KEY }, preferences: { team: "ENG" } });
    const copy = Array.from({ length: 20_000 }, (_, index) => `2026-11-04 08:12:03 ERROR request ${index} failed: ${"x".repeat(40)}`).join("\n");
    const started = performance.now();
    const result = await host.run(module.actions.create, { kind: "text", text: copy });
    const took = performance.now() - started;
    assert.equal(result.text, "https://linear.app/ornek/issue/ENG-124/new-issue");
    assert.ok(took < 1000, `took ${Math.round(took)} ms`);
    assert.ok(fake.created[0].description.length < 50_100);
  });
});
