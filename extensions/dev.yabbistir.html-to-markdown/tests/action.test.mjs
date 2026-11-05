import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const rich = (html, text = "plain text", kind = "text") => ({ kind, text, richText: { html } });

describe("paste as Markdown", () => {
  test("turnsTheRichTextIntoMarkdown", async () => {
    const host = createFakeHost({ folder });
    const item = rich('<meta charset="utf-8"><h2>Notes</h2><p>Read <a href="https://example.com/guide">the guide</a> <b>today</b>.</p>');
    assert.deepEqual(await host.run(actions.markdown, item), { text: "## Notes\n\nRead [the guide](https://example.com/guide) **today**." });
  });

  test("theReadmeExample", async () => {
    const host = createFakeHost({ folder });
    const html = '<p><b>Release notes</b></p><ul><li>Faster search, see <a href="https://example.com/guide">the guide</a></li><li>Fixed a crash in <code>sync</code></li></ul>';
    assert.deepEqual(await host.run(actions.markdown, rich(html)),
      { text: "**Release notes**\n\n- Faster search, see [the guide](https://example.com/guide)\n- Fixed a crash in `sync`" });
  });

  test("readsTheRichTextNotThePlainText", async () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(await host.run(actions.markdown, rich("<i>from the HTML</i>", "from the plain text")), { text: "*from the HTML*" });
  });

  test("theHintIsWhatIsPasted", async () => {
    // A hint runs before the row is picked, without effects; the result on the row is the result pasted.
    const host = createFakeHost({ folder });
    const item = rich("<ul><li>One</li><li>Two</li></ul>");
    const hint = await host.hint(actions.markdown, item);
    assert.deepEqual(hint, { text: "- One\n- Two" });
    assert.deepEqual(await host.run(actions.markdown, item), hint);
  });

  test("worksOnCodeItems", async () => {
    const host = createFakeHost({ folder });
    const item = rich('<pre><code class="language-sh">npm test</code></pre>', "npm test", "code");
    assert.deepEqual(await host.run(actions.markdown, item), { text: "```sh\nnpm test\n```" });
  });

  test("plainTextHasNothingToConvert", async () => {
    const host = createFakeHost({ folder });
    const message = { none: true, message: "This copy has no formatting to turn into Markdown" };
    assert.deepEqual(await host.run(actions.markdown, { kind: "text", text: "Just words" }), message);
    assert.deepEqual(await host.run(actions.markdown, rich("")), message);
    assert.deepEqual(await host.run(actions.markdown, rich(" \n\t ")), message);
    assert.deepEqual(await host.run(actions.markdown, { kind: "text", text: "x", richText: {} }), message);
    assert.deepEqual(await host.run(actions.markdown, { kind: "text", text: "x", richText: { html: 42 } }), message);
    // The hint says so on the row, before the person picks it.
    assert.deepEqual(await host.hint(actions.markdown, { kind: "text", text: "Just words" }), message);
  });

  test("formattingWithoutTextSaysSo", async () => {
    const host = createFakeHost({ folder });
    const message = { none: true, message: "There’s no text in this copy to turn into Markdown" };
    assert.deepEqual(await host.run(actions.markdown, rich("<meta charset='utf-8'><style>p{color:red}</style><script>x()</script>")), message);
    assert.deepEqual(await host.run(actions.markdown, rich('<p><img src="data:image/png;base64,AAAA"></p><p>&nbsp;</p><br>')), message);
  });

  test("speaksTurkish", async () => {
    const host = createFakeHost({ folder, context: { language: "tr" } });
    assert.deepEqual(await host.run(actions.markdown, { kind: "text", text: "x" }),
      { none: true, message: "Bu kopyada Markdown’a çevrilecek biçimlendirme yok" });
    assert.deepEqual(await host.run(actions.markdown, rich("<p> </p>")),
      { none: true, message: "Bu kopyada Markdown’a çevrilecek metin yok" });
  });

  test("everyStringIsTranslated", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  });

  test("anUnexpectedFailureKeepsTheCopyOutOfTheLog", async () => {
    // Make the conversion throw, with the copy's text in the error, and check that only the error's kind is logged.
    const secret = "sk" + "_live_" + "q".repeat(24);
    const host = createFakeHost({ folder });
    const original = String.prototype.replace;
    String.prototype.replace = function (...args) {
      if (this.includes(secret)) throw new TypeError(`cannot read ${secret}`);
      return original.apply(this, args);
    };
    let result;
    try {
      result = await host.run(actions.markdown, rich(`<p>${secret}</p>`));
    } finally {
      String.prototype.replace = original;
    }
    assert.deepEqual(result, { none: true, message: "Couldn’t read the formatting of this copy" });
    assert.deepEqual(host.logs, ["Couldn’t convert: TypeError"]);
    assert.equal(JSON.stringify(host.logs).includes(secret), false);
  });

  test("logsNothingAndCallsNothing", async () => {
    const host = createFakeHost({ folder });
    await host.run(actions.markdown, rich("<p>Token: <code>" + "gh" + "p_" + "a".repeat(36) + "</code></p>"));
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.calls, []);
    assert.deepEqual(host.notifications, []);
  });
});

describe("the manifest", () => {
  test("isOfferedOnTextAndCodeOnly", () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(host.offers({ kind: "text", text: "hello" }), ["markdown"]);
    assert.deepEqual(host.offers({ kind: "code", text: "let x = 1" }), ["markdown"]);
    assert.deepEqual(host.offers({ kind: "link", url: "https://example.com" }), []);
    assert.deepEqual(host.offers({ kind: "color", color: { hex: "#336699", r: 51, g: 102, b: 153, a: 1 } }), []);
  });

  test("asksForNothingAndShowsAHint", () => {
    assert.equal(manifest.permissions, undefined);
    const [action] = manifest.contributes.actions;
    assert.equal(action.hint, true);
    assert.equal(action.output, "text");
    assert.equal(action.job, undefined);
  });
});
