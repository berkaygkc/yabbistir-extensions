import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { cleaned, codeDoc, cutAt, draftOf, looksLikeCode, proseDoc, summaryOf } from "../src/draft.ts";
import { actions, issuesOf, markdownLink, siteHost } from "../src/index.ts";

const folder = new URL("..", import.meta.url);

describe("what looks like code or a log", () => {
  const code = [
    ["a Python traceback", 'Traceback (most recent call last):\n  File "app.py", line 3, in <module>\n    main()\nValueError: bad'],
    ["a JavaScript stack", "TypeError: x is undefined\n    at render (app.js:1:2)"],
    ["a stack copied without its indentation", "TypeError: x is undefined\nat render (app.js:1:2)"],
    ["a Java stack", 'Exception in thread "main" java.lang.IllegalStateException: closed\n\tat com.example.Shop.run(Shop.java:12)'],
    ["a Go panic", "panic: runtime error\n\ngoroutine 1 [running]:\nmain.main()"],
    ["a Rust panic", "thread 'main' panicked at src/main.rs:2:5:\nindex out of bounds"],
    ["a macOS crash report", "Thread 0 Crashed:\n0   libsystem_kernel.dylib        0x000000018b2f5a60 __pthread_kill + 8"],
    ["an lldb backtrace", "* thread #1\n  * frame #0: 0x0000000100003f40 demo`main"],
    ["a gdb backtrace", "#0  0x00007ffff7a42428 in raise ()\n#1  0x00007ffff7a4402a in abort ()"],
    ["two timestamped log lines", "2026-03-02 09:00:01 started\n2026-03-02T09:00:02Z stopped"],
    ["two leveled log lines", "[ERROR] connection refused\n[WARN] retrying in 5 s"],
    ["npm's errors", "npm ERR! code ERESOLVE\nnpm ERR! could not resolve"],
    ["lines of code", "const total = items.reduce((sum, item) => sum + item.price, 0);\nif (total > 100) {\n  ship();\n}"],
    ["Python", "def handler(event):\n    return event"],
    ["a shell session", "$ npm test\n$ npm run build"],
    ["HTML", "<div class=\"row\">\n  <span>Name</span>\n</div>"],
    ["a JSON document", '{"status": "error", "code": 42}'],
    ["a JSON list", "[1, 2, 3]"],
    ["tab-indented lines", "Config:\n\tport 8080\n\thost local"],
  ];
  for (const [name, text] of code) {
    test(name, () => assert.equal(looksLikeCode(text, "text"), true));
  }

  const prose = [
    ["a bug report", "Login fails on Safari\n\nSteps: open the page, press Log in.\nExpected: the dialog opens.\nActual: nothing happens."],
    ["a list", "Release checklist\n- update the changelog\n- tag the version\n- tell the team"],
    ["an error named once in a report", "Error: the page is blank\nIt started after the last deploy.\nOnly Safari shows it.\nChrome is fine."],
    ["one timestamp among sentences", "2026-03-02 09:00 meeting notes\nWe agreed to ship on Friday.\nDeniz writes the notes."],
    ["a sentence with brackets", "Please check the (new) settings page and the [beta] flag."],
    ["a short note", "Rotate the staging certificates before Friday."],
  ];
  for (const [name, text] of prose) {
    test(name, () => assert.equal(looksLikeCode(text, "text"), false));
  }

  test("an item the app marked as code is code", () => {
    assert.equal(looksLikeCode("Rotate the staging certificates", "code"), true);
  });
});

describe("the description", () => {
  test("a code block holds the text as it is", () => {
    assert.deepEqual(codeDoc("a\n  b"), { version: 1, type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "a\n  b" }] }] });
  });

  test("paragraphs never hold an empty text node", () => {
    const doc = proseDoc("\n\n  \nOne\n \t \nTwo\nThree  \n\n");
    assert.deepEqual(doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "One" }] },
      { type: "paragraph", content: [{ type: "text", text: "Two" }, { type: "hardBreak" }, { type: "text", text: "Three" }] },
    ]);
    const texts = JSON.stringify(doc).match(/"text":"[^"]*"/g);
    assert.ok(texts.every((node) => node !== '"text":""'));
  });

  test("control characters, terminal colors and broken surrogates are left out", () => {
    assert.equal(cleaned("a\u0000b\u0007c\u001B[31mred\u001B[0m\td\r\ne\rf\u2028g\uD800h\uDC00"), "abcred\td\ne\nf\ng\uFFFDh\uFFFD");
    assert.equal(cleaned("emoji 😀 stays"), "emoji 😀 stays");
  });

  test("a cut never splits a surrogate pair", () => {
    assert.equal(cutAt("a😀b", 2), "a");
    assert.equal(cutAt("a😀b", 3), "a😀");
    assert.equal(cutAt("abc", 5), "abc");
  });

  test("the summary is one line of at most 254 characters", () => {
    assert.equal(summaryOf("  Fix\tthe   login  "), "Fix the login");
    const long = summaryOf("x".repeat(300));
    assert.equal(long.length, 254);
    assert.ok(long.endsWith("…"));
    const emoji = summaryOf(`${"x".repeat(252)}😀😀`);
    assert.ok(emoji.length <= 254);
    assert.ok(!/[\uD800-\uDBFF]…$/.test(emoji), "no half emoji before the ellipsis");
  });

  test("a single line that fits has no description; anything more keeps the whole text", () => {
    assert.deepEqual(draftOf("  Fix the login  \n\n", "text"), { summary: "Fix the login", cut: false });
    const two = draftOf("Fix the login\nOn Safari only", "text");
    assert.equal(two.summary, "Fix the login");
    assert.deepEqual(two.description.content, [{ type: "paragraph", content: [{ type: "text", text: "Fix the login" }, { type: "hardBreak" }, { type: "text", text: "On Safari only" }] }]);
    assert.equal(draftOf("{\n}\n", "code"), undefined);
    assert.equal(draftOf("", "text"), undefined);
  });

  test("the first line with words is the summary, and the code keeps its first indentation", () => {
    const draft = draftOf("\n\n   {\n     \"a\": 1\n   }\n", "code");
    assert.equal(draft.summary, "\"a\": 1");
    assert.deepEqual(draft.description.content[0].content[0].text, "   {\n     \"a\": 1\n   }");
  });
});

describe("the column's helpers", () => {
  test("search answers become issues", () => {
    assert.deepEqual(issuesOf('{"issues":[{"key":"ENG-1","fields":{"summary":"A","status":{"name":"To Do"},"project":{"key":"ENG","name":"Engineering"}}}]}'), [
      { key: "ENG-1", summary: "A", status: "To Do", project: "Engineering" },
    ]);
    assert.equal(issuesOf("[]"), undefined);
    assert.equal(issuesOf(undefined), undefined);
  });

  test("a Markdown link without a summary is the key alone", () => {
    assert.equal(markdownLink("ENG-1", "", "https://your-domain.atlassian.net/browse/ENG-1"), "[ENG-1](https://your-domain.atlassian.net/browse/ENG-1)");
  });
});

/** The slowest of `runs` calls of `work`, in milliseconds. */
function slowest(work, runs = 3) {
  let worst = 0;
  for (let index = 0; index < runs; index++) {
    const started = performance.now();
    work();
    worst = Math.max(worst, performance.now() - started);
  }
  return worst;
}

describe("time", () => {
  // Inputs built to make a backtracking pattern take quadratic time or worse. Each must stay far inside the action's
  // 10 seconds (and the hint's 500 ms); the bound is loose so a busy machine does not fail it.
  const BOUND = 400;
  const adversarial = {
    "one long word": "a".repeat(100_000),
    "spaces then a letter": `${" ".repeat(100_000)}x`,
    "tabs then a letter": `${"\t".repeat(100_000)}x`,
    "a long frame header": `   ${"at ".repeat(33_000)}`,
    "addresses without frames": `1 ${"x0x".repeat(33_000)}`,
    "an open file name": `File "${"a".repeat(100_000)}`,
    "an open thread name": `thread '${"a".repeat(100_000)}`,
    "error words": "Error".repeat(20_000),
    "brackets": "[".repeat(100_000),
    "deep JSON": `${"[".repeat(50_000)}${"]".repeat(50_000)}`,
    "broken JSON": `{${'"a":'.repeat(25_000)}}`,
    "tags without ends": `<a${"-".repeat(100_000)}`,
    "semicolons and spaces": `;${" ".repeat(50_000)};`.repeat(2),
    "many short lines": "a;\n".repeat(33_000),
    "many blank lines": `${"\n".repeat(99_999)}x`,
    "terminal codes": "\u001B[".repeat(33_000) + "1;2;3",
    "surrogate halves": "\uD800".repeat(50_000),
    "colons and digits": "1:".repeat(50_000),
    "dates": "2026-03-02 ".repeat(9_000),
  };
  for (const [name, text] of Object.entries(adversarial)) {
    test(`a new issue's draft: ${name}`, () => {
      assert.ok(slowest(() => draftOf(text, "text")) < BOUND);
      assert.ok(slowest(() => draftOf(`Summary\n${text}`, "text")) < BOUND);
    });
  }

  test("the site check, the Markdown escape and the search answer", () => {
    assert.ok(slowest(() => siteHost(`https://${"a-".repeat(1_000)}.atlassian.net`)) < BOUND);
    assert.ok(slowest(() => siteHost("x".repeat(100_000))) < BOUND);
    assert.ok(slowest(() => markdownLink("ENG-1", "[]*_`<>&~|\\".repeat(10_000), "https://your-domain.atlassian.net/browse/ENG-1")) < BOUND);
    const answer = JSON.stringify({ issues: Array.from({ length: 20_000 }, () => ({ key: "x".repeat(20) })) });
    assert.ok(slowest(() => issuesOf(answer)) < BOUND);
  });

  test("the hint on a long text", async () => {
    const host = createFakeHost({ folder, preferences: { site: "your-domain.atlassian.net" } });
    for (const text of ["A".repeat(100_000), `ENG-${"1".repeat(100_000)}`, `${" ".repeat(100_000)}ENG-1`]) {
      const started = performance.now();
      await host.hint(actions.keyLink, { kind: "text", text });
      assert.ok(performance.now() - started < BOUND);
    }
  });
});
