import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";
import fs from "node:fs";
import { actions, sources } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
// Built at runtime so no token-shaped literal sits in the file.
const TOKEN = "gh" + "p_" + "a".repeat(36);
const START = Date.parse("2026-01-01T09:00:00Z");

let helpers = 0;
/** The extension's exports as a newly started helper has them: a module of its own, so nothing is cached. */
async function newHelper() {
  return await import(`../src/index.ts?helper=${++helpers}`);
}

const pr = (repo, number, title, extra = {}) => ({ url: `https://github.com/${repo}/pull/${number}`, title, ...extra });
const issue = (repo, number, title) => ({ url: `https://github.com/${repo}/issues/${number}`, title });

const REVIEW = [pr("ornek/uygulama", 12, "Fix the panel flicker"), pr("ornek/arac", 7, "Add `--dry-run`")];
const MINE = [pr("ornek/uygulama", 15, "Speed up search", { isDraft: false }), pr("ornek/uygulama", 16, "WIP: new column", { isDraft: true })];
const ASSIGNED = [issue("ornek/arac", 3, "Crash on empty input")];

/** A fake gh: answers `gh search prs|issues` by its flags, `gh gist create` by its arguments. */
function fakeGh(changes = {}) {
  const state = {
    review: REVIEW, mine: MINE, assigned: ASSIGNED,
    exit: 0, groupExit: {}, stderr: "", raw: undefined, gist: undefined, gistExit: 0, gistStderr: "", ...changes,
  };
  const gh = (args, { host, workDir }) => {
    if (args[0] === "search") {
      const which = args.includes("--review-requested=@me") ? "review" : args[1] === "prs" ? "mine" : "assigned";
      if (state.groupExit[which] !== undefined) return { exitCode: state.groupExit[which], stdout: "", stderr: "HTTP 502: ornek" };
      if (state.exit !== 0) return { exitCode: state.exit, stdout: "", stderr: state.stderr };
      const group = args.includes("--review-requested=@me") ? "review" : args[1] === "prs" ? "mine" : "assigned";
      const answer = state.raw?.[group] ?? JSON.stringify(state[group]);
      return { exitCode: 0, stdout: answer, stderr: "" };
    }
    if (args[0] === "gist") {
      state.gistFiles = args.filter((arg) => arg.startsWith(workDir)).map((path) => ({ path, text: new TextDecoder().decode(host.files.get(path)) }));
      if (state.gistExit !== 0) return { exitCode: state.gistExit, stdout: "", stderr: state.gistStderr };
      return { exitCode: 0, stdout: state.gist ?? "https://gist.github.com/ornek/0123456789abcdef\n", stderr: "- Creating gist clipboard.txt\n" };
    }
    return { exitCode: 1, stdout: "", stderr: "unknown" };
  };
  return Object.assign(gh, { state });
}

function hostWith(exports, gh, extra = {}) {
  return createFakeHost({ folder, sources: exports.sources, exec: { gh }, now: START, ...extra });
}
const searches = (host) => host.calls.filter((call) => call.api === "exec" && call.args[1][0] === "search").map((call) => call.args[1]);

describe("list", () => {
  test("three groups, each with its own subtitle", async () => {
    const host = hostWith(await newHelper(), fakeGh());
    const listing = await host.list("work");
    assert.deepEqual(listing.rows.map((row) => [row.title, row.subtitle]), [
      ["Fix the panel flicker", "Review requested · ornek/uygulama #12"],
      ["Add `--dry-run`", "Review requested · ornek/arac #7"],
      ["Speed up search", "Your pull request · ornek/uygulama #15"],
      ["WIP: new column", "Your draft pull request · ornek/uygulama #16"],
      ["Crash on empty input", "Assigned to you · ornek/arac #3"],
    ]);
    assert.deepEqual(host.logs, []);
  });

  test("the searches ask for open items of the signed-in user, newest update first, capped", async () => {
    const host = hostWith(await newHelper(), fakeGh());
    await host.list("work");
    const calls = searches(host);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((args) => args.slice(0, 3)), [
      ["search", "prs", "--review-requested=@me"],
      ["search", "prs", "--author=@me"],
      ["search", "issues", "--assignee=@me"],
    ]);
    for (const args of calls) {
      assert.ok(args.includes("--state=open") && args.includes("--sort=updated") && args.includes("--limit=25"));
      assert.ok(args.includes("--archived=false"));
    }
    assert.deepEqual(calls.map((args) => args.find((arg) => arg.startsWith("--json="))), ["--json=url,title", "--json=url,title,isDraft", "--json=url,title"]);
  });

  test("empty groups give no rows, and nothing at all gives an empty list", async () => {
    const some = hostWith(await newHelper(), fakeGh({ review: [], mine: [] }));
    assert.deepEqual((await some.list("work")).rows.map((row) => row.title), ["Crash on empty input"]);
    const none = hostWith(await newHelper(), fakeGh({ review: [], mine: [], assigned: [] }));
    assert.deepEqual(await none.list("work"), { rows: [] });
  });

  test("a group is capped even when gh sends more", async () => {
    const many = Array.from({ length: 40 }, (_, index) => pr("ornek/uygulama", 100 + index, `Change ${index}`));
    const host = hostWith(await newHelper(), fakeGh({ review: many, mine: [], assigned: [] }));
    assert.equal((await host.list("work")).rows.length, 25);
  });

  test("odd titles stay readable, and a row id is the link alone", async () => {
    const long = "Uzun başlık ".repeat(40);
    const host = hostWith(await newHelper(), fakeGh({
      review: [pr("ornek/uygulama", 1, "  Line\nbreak\tand   spaces  "), pr("ornek/uygulama", 2, "İşlem: çok güzel ✨ 日本語"), pr("ornek/uygulama", 3, long)],
      mine: [], assigned: [],
    }));
    const rows = (await host.list("work")).rows;
    assert.equal(rows[0].title, "Line break and spaces");
    assert.equal(rows[1].title, "İşlem: çok güzel ✨ 日本語");
    assert.ok(rows[2].title.length <= 256);
    for (const row of rows) assert.ok(row.id.length <= 256 && row.id.startsWith("https://github.com/"));
    assert.equal(rows[2].id, "https://github.com/ornek/uygulama/pull/3");
  });

  test("bad entries are skipped: a foreign link, an empty title, a wrong type", async () => {
    const host = hostWith(await newHelper(), fakeGh({
      review: [pr("ornek/uygulama", 1, "Good"), { url: "https://evil.example/ornek/uygulama/pull/2", title: "Foreign" }, pr("ornek/uygulama", 3, "   "), { url: 5, title: "x" }, null, "text"],
      mine: [], assigned: [],
    }));
    assert.deepEqual((await host.list("work")).rows.map((row) => row.title), ["Good"]);
  });

  test("an item in two groups is listed once", async () => {
    const same = pr("ornek/uygulama", 9, "Both");
    const host = hostWith(await newHelper(), fakeGh({ review: [same], mine: [same], assigned: [] }));
    assert.equal((await host.list("work")).rows.length, 1);
  });

  test("not signed in is a locked listing with the login command", async () => {
    for (const bad of [{ exit: 4, stderr: "" }, { exit: 1, stderr: "To get started with GitHub CLI, please run:  gh auth login\n" }]) {
      const host = hostWith(await newHelper(), fakeGh(bad));
      const listing = await host.list("work");
      assert.deepEqual(listing, { locked: true, message: "Not signed in to GitHub", command: "gh auth login" });
    }
  });

  test("after the cache has expired, a locked listing and a new sign-in list afresh", async () => {
    const exports = await newHelper();
    const gh = fakeGh();
    assert.equal((await hostWith(exports, gh, { now: START }).list("work")).rows.length, 5);
    gh.state.exit = 4;
    assert.equal((await hostWith(exports, gh, { now: START + 120_000 }).list("work")).locked, true);
    gh.state.exit = 0;
    gh.state.review = [];
    assert.equal((await hostWith(exports, gh, { now: START + 121_000 }).list("work")).rows.length, 3);
  });

  test("one or two failed searches list the groups that worked, and are asked again", async () => {
    const exports = await newHelper();
    const gh = fakeGh({ groupExit: { review: 1, mine: 1 } });
    const first = hostWith(exports, gh, { now: START });
    assert.deepEqual((await first.list("work")).rows.map((row) => row.title), ["Crash on empty input"]);
    assert.deepEqual(first.logs, []);
    gh.state.groupExit = {};
    const second = hostWith(exports, gh, { now: START + 1000 });
    assert.equal((await second.list("work")).rows.length, 5, "a partial listing is not cached");
    gh.state.groupExit = { assigned: 1 };
    const third = hostWith(await newHelper(), gh);
    assert.equal((await third.list("work")).rows.length, 4);
  });

  test("every search failing is an error", async () => {
    const host = hostWith(await newHelper(), fakeGh({ groupExit: { review: 1, mine: 1, assigned: 1 } }));
    await assert.rejects(host.list("work"), { message: "gh could not list your pull requests and issues." });
  });

  test("malformed JSON in one group leaves the others", async () => {
    const host = hostWith(await newHelper(), fakeGh({ raw: { review: "oops", mine: JSON.stringify(MINE), assigned: "[]" } }));
    assert.equal((await host.list("work")).rows.length, 2);
  });

  test("one auth failure among partial ones still locks", async () => {
    const host = hostWith(await newHelper(), fakeGh({ groupExit: { review: 1, mine: 4 } }));
    assert.equal((await host.list("work")).locked, true);
  });

  test("a row keeps its id when the pull request is retitled", async () => {
    const exports = await newHelper();
    const gh = fakeGh();
    const before = (await hostWith(exports, gh, { now: START }).list("work")).rows[0];
    gh.state.review = [pr("ornek/uygulama", 12, "A new title"), REVIEW[1]];
    const after = (await hostWith(exports, gh, { now: START + 120_000 }).list("work")).rows[0];
    assert.equal(after.id, before.id);
    assert.notEqual(after.title, before.title);
  });

  test("the missing tool is the standard path", async () => {
    const host = createFakeHost({ folder, sources, exec: {} });
    await assert.rejects(host.list("work"), { code: "toolMissing" });
  });

  test("gh failing is a plain error without its output", async () => {
    const host = hostWith(await newHelper(), fakeGh({ exit: 1, stderr: `HTTP 500: internal ornek-secret-detail ${TOKEN}` }));
    await assert.rejects(host.list("work"), (error) => {
      assert.equal(error.message, "gh could not list your pull requests and issues.");
      assert.ok(!error.message.includes("ornek-secret-detail") && !error.message.includes(TOKEN));
      return true;
    });
    assert.deepEqual(host.logs, []);
  });

  test("malformed JSON, or JSON of the wrong shape, fails the listing", async () => {
    for (const raw of ["not json", "{}", "", "null"]) {
      const host = hostWith(await newHelper(), fakeGh({ raw: { review: raw, mine: raw, assigned: raw } }));
      await assert.rejects(host.list("work"), { message: "gh could not list your pull requests and issues." });
    }
  });

  test("a slow gh is cancelled with the call", async () => {
    const host = createFakeHost({ folder, sources, exec: { gh: () => new Promise(() => {}) } });
    const running = host.list("work");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("rows are reused for a minute", async () => {
    const exports = await newHelper();
    const gh = fakeGh();
    const first = hostWith(exports, gh, { now: START });
    await first.list("work");
    const soon = hostWith(exports, gh, { now: START + 30_000 });
    await soon.list("work");
    assert.equal(searches(soon).length, 0);
    const late = hostWith(exports, gh, { now: START + 61_000 });
    await late.list("work");
    assert.equal(searches(late).length, 3);
  });
});

describe("row actions", () => {
  async function firstRows(changes = {}) {
    const host = hostWith(await newHelper(), fakeGh(changes));
    return { host, rows: (await host.list("work")).rows };
  }

  test("link, Markdown link", async () => {
    const { host, rows } = await firstRows();
    assert.deepEqual(await host.runSource("work", rows[0].id, "link"), { text: "https://github.com/ornek/uygulama/pull/12" });
    assert.deepEqual(await host.runSource("work", rows[0].id, "markdown"), {
      text: "[ornek/uygulama#12: Fix the panel flicker](https://github.com/ornek/uygulama/pull/12)",
    });
    assert.deepEqual(await host.runSource("work", rows[4].id, "markdown"), {
      text: "[ornek/arac#3: Crash on empty input](https://github.com/ornek/arac/issues/3)",
    });
  });

  const markdownOf = async (title) => {
    const { host, rows } = await firstRows({ review: [pr("ornek/uygulama", 4, title)], mine: [], assigned: [] });
    return (await host.runSource("work", rows[0].id, "markdown")).text;
  };
  const ESCAPES = [["\\", "\\\\"], ["[", "\\["], ["]", "\\]"], ["<", "\\<"], [">", "\\>"], ["&", "\\&"], ["*", "\\*"], ["_", "\\_"]];
  for (const [character, escaped] of ESCAPES) {
    test(`${character} in a title is escaped in the Markdown link`, async () => {
      assert.equal(await markdownOf(`a${character}b`), `[ornek/uygulama#4: a${escaped}b](https://github.com/ornek/uygulama/pull/4)`);
    });
  }

  test("a backtick code span in a title is kept", async () => {
    assert.equal(await markdownOf("Add `--dry-run` flag"), "[ornek/uygulama#4: Add `--dry-run` flag](https://github.com/ornek/uygulama/pull/4)");
  });

  test("inside a code span nothing is escaped; outside it everything is", async () => {
    assert.equal(await markdownOf("`foo_bar` fix"), "[ornek/uygulama#4: `foo_bar` fix](https://github.com/ornek/uygulama/pull/4)");
    assert.equal(await markdownOf("`a<b>` and a<b> and `x_y` z_w"), "[ornek/uygulama#4: `a<b>` and a\\<b\\> and `x_y` z\\_w](https://github.com/ornek/uygulama/pull/4)");
    assert.equal(await markdownOf("``a`b_c`` d_e"), "[ornek/uygulama#4: ``a`b_c`` d\\_e](https://github.com/ornek/uygulama/pull/4)");
  });

  test("an unclosed backtick is plain text and the rest is escaped", async () => {
    assert.equal(await markdownOf("it`s a_b <c>"), "[ornek/uygulama#4: it`s a\\_b \\<c\\>](https://github.com/ornek/uygulama/pull/4)");
    assert.equal(await markdownOf("`a_b ``c_d``"), "[ornek/uygulama#4: `a\\_b ``c_d``](https://github.com/ornek/uygulama/pull/4)");
  });

  test("a mixed title", async () => {
    assert.equal(await markdownOf("[WIP] Fix <Foo> & a\\b"), "[ornek/uygulama#4: \\[WIP\\] Fix \\<Foo\\> \\& a\\\\b](https://github.com/ornek/uygulama/pull/4)");
  });

  test("after a helper restart the link still pastes and the Markdown link has no title", async () => {
    const host = hostWith(await newHelper(), fakeGh());
    const id = "https://github.com/ornek/uygulama/pull/12";
    assert.deepEqual(await host.runSource("work", id, "link"), { text: id });
    assert.deepEqual(await host.runSource("work", id, "markdown"), { text: `[ornek/uygulama#12](${id})` });
  });

  test("the copy action is the link's, with its notice", () => {
    const [link] = manifest.contributes.sources[0].actions;
    assert.equal(link.id, "link");
    assert.equal(link.copyTitle, "link.copyTitle");
  });

  test("no gh runs for a row action", async () => {
    const { host, rows } = await firstRows();
    const before = host.calls.length;
    await host.runSource("work", rows[0].id, "link");
    assert.equal(host.calls.length, before);
  });

  test("an id that is not one of the listing's is refused", async () => {
    const host = hostWith(await newHelper(), fakeGh());
    for (const id of ["1", "", "https://evil.example/o/r/pull/1", "https://github.com/o/r/pull/1 Title", "https://github.com/o/r/tree/1", "https://github.com/o/r/pull/1/files"]) {
      await assert.rejects(host.runSource("work", id, "link"), { message: "This row no longer holds a GitHub link." }, id);
    }
  });
});

describe("short reference", () => {
  test("is offered on pull request and issue links only", () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(host.offers({ kind: "link", url: "https://github.com/ornek/uygulama/pull/12", text: "https://github.com/ornek/uygulama/pull/12" }), ["reference"]);
    assert.deepEqual(host.offers({ kind: "link", url: "https://github.com/ornek/arac/issues/3#issuecomment-1", text: "https://github.com/ornek/arac/issues/3#issuecomment-1" }), ["reference"]);
    assert.deepEqual(host.offers({ kind: "link", url: "https://github.com/ornek/arac", text: "https://github.com/ornek/arac" }), []);
    assert.deepEqual(host.offers({ kind: "link", url: "https://example.com/ornek/arac/pull/3", text: "https://example.com/ornek/arac/pull/3" }), []);
  });

  test("owner/repo#number, from a link with a tail", async () => {
    const host = createFakeHost({ folder });
    for (const url of ["https://github.com/ornek/uygulama/pull/12", "https://github.com/ornek/uygulama/pull/12/files", "https://github.com/ornek/uygulama/pull/12?diff=split#top"]) {
      assert.deepEqual(await host.run(actions.reference, { kind: "link", url, text: url }), { text: "ornek/uygulama#12" });
    }
    assert.deepEqual(await host.run(actions.reference, { kind: "link", url: "https://github.com/ornek/arac/issues/3", text: "" }), { text: "ornek/arac#3" });
  });

  test("a link that is neither says so", async () => {
    const host = createFakeHost({ folder });
    const result = await host.run(actions.reference, { kind: "link", url: "https://github.com/ornek/arac", text: "https://github.com/ornek/arac" });
    assert.deepEqual(result, { none: true, message: "This link is not a pull request or an issue." });
  });

  test("the hint is the real answer", async () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(await host.hint(actions.reference, { kind: "link", url: "https://github.com/ornek/arac/pull/3", text: "https://github.com/ornek/arac/pull/3" }), { text: "ornek/arac#3" });
  });
});

describe("gist", () => {
  const gist = (args) => args.slice(args.indexOf("create") + 1);

  test("offered on text and code, not on links", () => {
    const host = createFakeHost({ folder });
    assert.ok(host.offers({ kind: "text", text: "hello" }).includes("gist"));
    assert.ok(host.offers({ kind: "code", text: "let x = 1" }).includes("gist"));
    assert.ok(!host.offers({ kind: "link", url: "https://example.com", text: "https://example.com" }).includes("gist"));
  });

  test("writes the item into a file and creates a secret gist; the URL is the result", async () => {
    const gh = fakeGh();
    const host = createFakeHost({ folder, exec: { gh } });
    const result = await host.run(actions.gist, { kind: "text", text: "merhaba dünya\n" }, { variant: "secret" });
    assert.deepEqual(result, { text: "https://gist.github.com/ornek/0123456789abcdef" });
    const call = host.calls.find((entry) => entry.api === "exec");
    const args = call.args[1];
    assert.deepEqual(args.slice(0, 2), ["gist", "create"]);
    assert.ok(!args.includes("--desc"), "no description");
    assert.ok(!args.includes("--public"), "secret is gh's default and nothing asks for public");
    assert.match(args.at(-1), /\/clipboard\.txt$/);
    assert.deepEqual(gh.state.gistFiles, [{ path: args.at(-1), text: "merhaba dünya\n" }]);
    assert.equal(args.length, 3);
    assert.ok(gist(args).every((arg) => !arg.includes("merhaba")), "the content is never an argument");
  });

  test("the public variant adds --public and nothing else", async () => {
    const host = createFakeHost({ folder, exec: { gh: fakeGh() } });
    await host.run(actions.gist, { kind: "text", text: "x" }, { variant: "public" });
    const args = host.calls.find((entry) => entry.api === "exec").args[1];
    assert.deepEqual(args.slice(0, 3), ["gist", "create", "--public"]);
    assert.equal(args.length, 4);
  });

  test("a missing variant is secret", async () => {
    const host = createFakeHost({ folder, exec: { gh: fakeGh() } });
    await host.run(actions.gist, { kind: "text", text: "x" });
    assert.ok(!host.calls.find((entry) => entry.api === "exec").args[1].includes("--public"));
  });

  test("the file extension follows the kind and a few signs", async () => {
    const cases = [
      [{ kind: "text", text: "{\"a\":1}" }, "txt"],
      [{ kind: "code", text: "{\"a\": [1, 2]}" }, "json"],
      [{ kind: "code", text: "{ not json }" }, "txt"],
      [{ kind: "code", text: "#!/bin/bash\necho hi" }, "sh"],
      [{ kind: "code", text: "#!/usr/bin/env python3\nprint(1)" }, "py"],
      [{ kind: "code", text: "#!/usr/bin/env node\nconsole.log(1)" }, "js"],
      [{ kind: "code", text: "<!DOCTYPE html><html></html>" }, "html"],
      [{ kind: "code", text: "<?xml version=\"1.0\"?><a/>" }, "xml"],
      [{ kind: "code", text: "import SwiftUI\nstruct A: View {}" }, "swift"],
      [{ kind: "code", text: "package main\n\nfunc main() {\n\tx := 1\n}" }, "txt"],
      [{ kind: "code", text: "import kotlinx.coroutines.*\n\nfun main() = runBlocking {}" }, "txt"],
      [{ kind: "code", text: "fn main() {\n    let x = 5;\n    let f = |a| a;\n}" }, "txt"],
      [{ kind: "code", text: "<?php\n$a = ['x' => 1];" }, "php"],
      [{ kind: "code", text: "<h1><?php echo $a; ?></h1>" }, "php"],
      [{ kind: "code", text: "import java.util.List;\n\nclass A {}" }, "txt"],
      [{ kind: "code", text: "struct Point { x: i32 }\nlet p = Point { x: 1 };" }, "txt"],
      [{ kind: "code", text: "{ a => 1 }" }, "txt"],
      [{ kind: "code", text: "import React from \"react\";\nexport default A;" }, "js"],
      [{ kind: "code", text: "def f(x):\n    return x" }, "py"],
      [{ kind: "code", text: "export interface A { b: string }\nexport const a = 1" }, "ts"],
      [{ kind: "code", text: "const a = (x) => 1;" }, "js"],
      [{ kind: "code", text: "just some words here" }, "txt"],
    ];
    for (const [item, extension] of cases) {
      const host = createFakeHost({ folder, exec: { gh: fakeGh() } });
      await host.run(actions.gist, item);
      const path = host.calls.find((entry) => entry.api === "exec").args[1].at(-1);
      assert.ok(path.endsWith(`/clipboard.${extension}`), `${item.text} -> ${path}`);
    }
  });

  test("empty text creates nothing", async () => {
    const host = createFakeHost({ folder, exec: { gh: fakeGh() } });
    assert.deepEqual(await host.run(actions.gist, { kind: "text", text: " \n" }), { none: true, message: "There is no text to share." });
    assert.deepEqual(host.calls.filter((entry) => entry.api === "exec"), []);
  });

  test("not signed in is a notice that names the command", async () => {
    for (const bad of [{ gistExit: 4 }, { gistExit: 1, gistStderr: "To get started with GitHub CLI, please run:  gh auth login\n" }]) {
      const host = createFakeHost({ folder, exec: { gh: fakeGh(bad) } });
      assert.deepEqual(await host.run(actions.gist, { kind: "text", text: "x" }), { none: true, message: "Not signed in to GitHub. Run gh auth login in Terminal." });
    }
  });

  test("a failing gh is a notice without its output, and nothing is logged", async () => {
    const host = createFakeHost({ folder, exec: { gh: fakeGh({ gistExit: 1, gistStderr: `HTTP 422: ornek-secret-detail ${TOKEN}` }) } });
    const result = await host.run(actions.gist, { kind: "text", text: "ornek-secret-content" });
    assert.deepEqual(result, { none: true, message: "gh could not create the gist." });
    assert.deepEqual(host.logs, []);
    assert.ok(!JSON.stringify(result).includes("ornek-secret") && !JSON.stringify(result).includes(TOKEN));
  });

  test("success without a gist URL is a failure", async () => {
    const host = createFakeHost({ folder, exec: { gh: fakeGh({ gist: "done\n" }) } });
    assert.deepEqual(await host.run(actions.gist, { kind: "text", text: "x" }), { none: true, message: "gh could not create the gist." });
  });

  test("the URL is found on the last matching line", async () => {
    const host = createFakeHost({ folder, exec: { gh: fakeGh({ gist: "note\nhttps://gist.github.com/ornek/abc123\n\n" }) } });
    assert.deepEqual(await host.run(actions.gist, { kind: "text", text: "x" }), { text: "https://gist.github.com/ornek/abc123" });
  });

  test("the missing tool is the standard path, and a cancel gets through", async () => {
    const missing = createFakeHost({ folder, exec: {} });
    await assert.rejects(missing.run(actions.gist, { kind: "text", text: "x" }), { code: "toolMissing" });
    const slow = createFakeHost({ folder, exec: { gh: () => new Promise(() => {}) } });
    const running = slow.run(actions.gist, { kind: "text", text: "x" });
    setTimeout(() => slow.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });
});

describe("manifest", () => {
  test("asks only for exec, with gh", () => {
    assert.deepEqual(manifest.permissions, ["exec"]);
    assert.deepEqual(manifest.requires.tools.map((tool) => tool.name), ["gh"]);
    assert.equal(manifest.network, undefined);
  });

  test("the reference pattern", () => {
    const accepts = manifest.contributes.actions.find((action) => action.id === "reference").accepts;
    assert.equal(acceptsMatch(accepts, { kind: "link", url: "https://github.com/a/b/pull/1", text: "https://github.com/a/b/pull/1" }), true);
    assert.equal(acceptsMatch(accepts, { kind: "link", url: "https://github.com/a/b/pulls", text: "https://github.com/a/b/pulls" }), false);
  });
});
