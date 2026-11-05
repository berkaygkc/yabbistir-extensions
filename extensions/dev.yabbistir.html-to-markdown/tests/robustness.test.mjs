// Malformed HTML and hostile input: the converter never throws, never recurses without bound, and stays linear.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, htmlToMarkdown as md } from "../src/index.ts";

const folder = new URL("..", import.meta.url);

describe("malformed HTML", () => {
  test("unclosedTags", () => {
    assert.equal(md("<p>One<p>Two"), "One\n\nTwo");
    assert.equal(md("<ul><li>a<li>b</ul>"), "- a\n- b");
    assert.equal(md("<b>bold <i>both"), "**bold *both***");
    assert.equal(md("<table><tr><td>a<td>b<tr><td>c<td>d</table>"), "| a   | b   |\n| --- | --- |\n| c   | d   |");
    assert.equal(md("<dl><dt>Term<dd>Meaning<dt>Next</dl>"), "Term\n\nMeaning\n\nNext");
  });

  test("misnestedFormattingCarriesOver", () => {
    assert.equal(md("<b>a<i>b</b>c</i>"), "**a*b***_c_");
    assert.equal(md("<p><b>bold</p><p>still bold</b> not</p>"), "**bold**\n\n**still bold** not");
  });

  test("cellsWithoutARowGetOne", () => {
    assert.equal(md("<table><td>a</td><td>b</td></table>"), "| a   | b   |\n| --- | --- |");
    assert.equal(md("<table><th>A</th><th>B</th><tr><td>1</td><td>2</td></tr></table>"), "| A   | B   |\n| --- | --- |\n| 1   | 2   |");
    assert.equal(md("<table><tbody><td>a<td>b</tbody></table>"), "| a   | b   |\n| --- | --- |");
    assert.equal(md("<table><caption>Prices</caption><td>a<td>b</table>"), "Prices\n\n| a   | b   |\n| --- | --- |");
    assert.equal(md("<td>alone</td>"), "alone");
  });

  test("contentOutsideTheCellsComesBeforeTheTable", () => {
    // A browser shows text and blocks that sit in a table but outside its cells just before the table.
    const table = "| a   | b   |\n| --- | --- |";
    assert.equal(md("<table>Note<tr><td>a</td><td>b</td></tr></table>"), `Note\n\n${table}`);
    assert.equal(md("<table><tr><td>a</td><td>b</td></tr><p>After</p></table>"), `After\n\n${table}`);
    assert.equal(md("<table><tr><div>Row note</div><td>a</td><td>b</td></tr></table>"), `Row note\n\n${table}`);
    assert.equal(md("<table><tr><div>Unclosed<td>a<td>b</table>"), `Unclosed\n\n${table}`);
    assert.equal(md("<table><div>Unclosed<tr><td>a<td>b</table>"), `Unclosed\n\n${table}`);
    assert.equal(md("<table><form><tr><td>a</td><td>b</td></tr></form></table>"), table);
    assert.equal(md("<b><table>Bold<tr><td>a</td><td>b</td></tr></table></b>"), `**Bold**\n\n${table}`);
    assert.equal(md("<table style='font-weight:bold'>Plain<tr><td>a</td><td>b</td></tr></table>"), `Plain\n\n${table}`);
  });

  test("whiteSpaceBetweenTablePartsIsNotContent", () => {
    assert.equal(md("<table>\n  <colgroup><col><col></colgroup>\n  <tr>\n    <td>a</td><td>b</td>\n  </tr>&nbsp;\n</table>"), "| a   | b   |\n| --- | --- |");
  });

  test("strayEndTags", () => {
    assert.equal(md("a</b></div></span>b"), "ab");
    assert.equal(md("a</p>b"), "a\n\nb");
    assert.equal(md("<p>x</li></ul></td></table></p>"), "x");
  });

  test("linksDoNotNest", () => {
    assert.equal(md('<a href="https://example.com/1">one <a href="https://example.com/2">two</a></a>'),
      "[one](https://example.com/1) [two](https://example.com/2)");
  });

  test("attributesInAnyQuoting", () => {
    assert.equal(md("<a href=https://example.com/x title='It\"s'>u</a>"), '[u](https://example.com/x "It\\"s")');
    assert.equal(md('<A HREF = "https://example.com" >Up</A>'), "[Up](https://example.com)");
    assert.equal(md("<img src=pic.png alt=Pic>"), "![Pic](pic.png)");
    assert.equal(md('<a href="https://example.com/1" href="https://example.com/2">first wins</a>'), "[first wins](https://example.com/1)");
    assert.equal(md('<a title="x > y" href="https://example.com">gt</a>'), '[gt](https://example.com "x > y")');
  });

  test("upperCaseTags", () => {
    assert.equal(md("<P><B>Hi</B> <EM>there</EM></P>"), "**Hi** *there*");
  });

  test("comments", () => {
    assert.equal(md("a<!-- <b>not</b> -->b"), "ab");
    assert.equal(md("<!-->a<!--->b"), "ab");
    assert.equal(md("x<!-- never closed <p>y</p>"), "x");
    assert.equal(md("<!--[if gte mso 9]><xml><w:WordDocument></w:WordDocument></xml><![endif]--><p>after</p>"), "after");
  });

  test("cdata", () => {
    assert.equal(md("<p><![CDATA[a < b && c]]></p>"), "a < b && c");
  });

  test("scriptsAndStylesWithMarkupInside", () => {
    const html = "<style>p { color: red } <b>x</b></style><script>if (a < b) document.write('<p>no</p>')</script><p>yes</p><noscript><p>no</p></noscript>";
    assert.equal(md(html), "yes");
    assert.equal(md("<p>a</p><script>var x = '</p>"), "a");
    assert.equal(md("<script>x</SCRIPT >y<textarea><b>t</b></textarea>"), "y");
  });

  test("theHeadIsLeftOut", () => {
    assert.equal(md("<!DOCTYPE html><html><head><meta charset=utf-8><title>T</title><link rel=stylesheet href=x></head><body><p>x</p></body></html>"), "x");
    assert.equal(md("<head><title>T</title><p>body text"), "body text");
  });

  test("processingInstructions", () => {
    assert.equal(md('<?xml version="1.0"?><p>x</p>'), "x");
  });

  test("theInputEndsInsideATag", () => {
    assert.equal(md('<p>keep</p><a href="unfinished'), "keep");
    assert.equal(md("<p>keep</p><div"), "keep");
  });

  test("lessThanSignsInText", () => {
    assert.equal(md("<p>1 < 2 and 3 <= 4 and 5 <> 6</p>"), "1 < 2 and 3 <= 4 and 5 <> 6");
  });

  test("nullCharacters", () => {
    assert.equal(md("<p>a\u0000b</p>"), "ab");
  });

  test("oldPreformattedElements", () => {
    assert.equal(md("<xmp><b>raw</b></xmp>"), "```\n<b>raw</b>\n```");
    assert.equal(md("<p>a</p><plaintext><i>rest</i>"), "a\n\n```\n<i>rest</i>\n```");
  });

  test("veryDeepNestingIsFlattenedNotCrashed", () => {
    assert.equal(md("<div>".repeat(100_000) + "deep"), "deep");
    assert.equal(md("<span><b>".repeat(50_000) + "deep"), "**deep**");
    const quotes = md("<blockquote>".repeat(5_000) + "x");
    assert.match(quotes, /^(> )+x$/);
    const lists = md("<ul><li>".repeat(5_000) + "x");
    assert.match(lists, /x$/);
  });
});

const block = '<h2>Section</h2><p>Some <b>bold</b>, <i>italic</i>, <a href="https://example.com/a?b=1&amp;c=2">a link</a> and <code>code</code> &amp; entities &mdash; text.</p>'
  + "<ul><li>One<ul><li>Nested <s>gone</s></li></ul></li><li>Two</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>"
  + '<pre><code class="language-js">const a = 1;\nconsole.log(a);</code></pre><blockquote><p>Quote</p></blockquote>';
const repeat = (part, length) => part.repeat(Math.ceil(length / part.length));
const timed = async (run) => {
  const started = performance.now();
  const result = await run();
  return { result, ms: performance.now() - started };
};

describe("size and time", () => {
  test("aLargeCopyAsAHintWellInsideItsHalfSecond", async () => {
    // The app hands an extension rich text of up to 256 KB; a hint has 500 ms.
    const host = createFakeHost({ folder });
    const item = { kind: "text", text: "x", richText: { html: repeat(block, 256 * 1024) } };
    const { result, ms } = await timed(() => host.hint(actions.markdown, item));
    assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
    assert.match(result.text, /^## Section\n\nSome \*\*bold\*\*/);
    assert.equal(result.text.split("## Section").length - 1, Math.ceil(256 * 1024 / block.length));
  });

  test("aHugeDocumentWellInsideTheTenSecondLimit", async () => {
    const host = createFakeHost({ folder });
    const { result, ms } = await timed(() => host.run(actions.markdown, { kind: "text", text: "x", richText: { html: repeat(block, 5 * 1024 * 1024) } }));
    assert.ok(ms < 5_000, `took ${ms.toFixed(0)} ms`);
    assert.ok(result.text.length > 1_000_000);
  });

  test("hostileInputStaysLinear", () => {
    const n = 60_000;
    const inputs = {
      lessThan: "<".repeat(n),
      openTags: "<a".repeat(n),
      unclosedQuote: '<a href="' + "x".repeat(n),
      unclosedComment: "<!--" + "-".repeat(n),
      nestedBold: "<b>".repeat(n / 3) + "x",
      nestedLists: "<ul><li>".repeat(n / 8) + "x",
      nestedQuotes: "<blockquote>".repeat(n / 12) + "x",
      unmatchedEnds: "</b>".repeat(n / 4),
      ampersands: "&".repeat(n),
      entityLetters: "&" + "a".repeat(n),
      entityDigits: "&#" + "9".repeat(n),
      misnested: "<b><i><u><s>x</b></i></u></s>".repeat(n / 30),
      paragraphsInBold: "<b>x<p>y".repeat(n / 8),
      alternatingFormats: "<b>a</b><i>b</i>".repeat(n / 16),
      crossingFormats: "<b>a<i>b</b>c</i>".repeat(n / 18),
      underscores: "<p>" + "_a".repeat(n / 2) + "</p>",
      dashes: "<p>" + "-".repeat(n) + "x</p>",
      hashes: "<h1>" + "#".repeat(n) + " x</h1>",
      wideRow: "<table><tr>" + "<td>x</td>".repeat(n / 10) + "</tr></table>",
      spans: "<table>" + "<tr><td colspan=1000 rowspan=1000>x</td><td>y</td></tr>".repeat(n / 50) + "</table>",
      lineBreaks: "<p>" + "a<br>".repeat(n / 5) + "</p>",
      whiteSpace: "<p>" + " \n\t".repeat(n) + "x</p>",
      backticks: "<p><code>" + "`".repeat(n) + "</code></p>",
      parentheses: `<a href="${"(".repeat(n)}">x</a>`,
      emailLike: `<a href="mailto:${"a".repeat(n)}@${"b-".repeat(n / 2)}">${"a".repeat(n)}@${"b-".repeat(n / 2)}</a>`,
      items: "<li>".repeat(n / 4) + "x",
      wordLevels: "<p style='mso-list:l0 level1 lfo1'>x</p><p style='mso-list:l0 level9 lfo1'>y</p>".repeat(n / 90),
      attributes: "<span " + "a=b ".repeat(n / 4) + ">x</span>",
      styles: `<span style="${"font-weight:700;".repeat(n / 16)}">x</span>`,
      important: `<span style="font-weight:700${"!".repeat(n)}important">x</span>`,
      tildes: "<p>" + "~".repeat(n) + "</p>",
      conditionals: "<![if !supportLists]>".repeat(n / 22),
      conditionalSpaces: "<p>a</p><![if" + " ".repeat(n) + "x>",
      headings: "<h1>a<h2>b".repeat(n / 12),
      codeLines: "<pre>" + "<div>a</div>".repeat(n / 12) + "</pre>",
      codeSpaces: "<pre>" + " ".repeat(n) + "x</pre>",
      monoLines: `<b id="docs-internal-guid-1">${"<p><span style=\"font-family:Courier New\">x</span></p><br>".repeat(n / 60)}<p>text</p></b>`,
      monoSpaces: `<b id="docs-internal-guid-1"><p>text</p><p><span style="font-family:Consolas">${" ".repeat(n)}x</span></p></b>`,
      monoCellSpaces: `<b id="docs-internal-guid-1"><p>text</p><table><tr><td><p><span style="font-family:Consolas">${" ".repeat(n)}x</span></p></td>`
        + "<td>y</td></tr><tr><td>1</td><td>2</td></tr></table></b>",
      // Many blank monospaced lines: each line break once looked back over every line before it.
      monoBlankLines: `<b id="docs-internal-guid-1"><p>text</p><p>${"<span style=\"font-family:Courier New\"> </span><br>".repeat(n / 6)}</p></b>`,
      entityRun: "<p>" + "&amp;lt;".repeat(n / 8) + "</p>",
      tableRuleLine: "<p>a<br>" + "-|".repeat(n / 2) + "</p>",
      tableRuleSpaces: "<p>a<br>|" + " ".repeat(n) + "-</p>",
      cellsWithoutRows: "<table>" + "<td>x".repeat(n / 5) + "</table>",
      fosteredText: "<table>" + "x<tr><td>y</td></tr>".repeat(n / 20) + "</table>",
      multiLevelMarker: "<p style='mso-list:l0 level1 lfo1'><![if !supportLists]>" + "1.".repeat(n / 2) + "<![endif]>t</p>",
    };
    for (const [name, html] of Object.entries(inputs)) {
      const started = performance.now();
      const markdown = md(html);
      const ms = performance.now() - started;
      assert.equal(typeof markdown, "string", name);
      assert.ok(ms < 500, `${name} took ${ms.toFixed(0)} ms`);
    }
  });
});
