// What Google Docs, Notion, Word, Outlook, Safari, Chrome and code editors put on the clipboard, in the shapes they
// are documented to have. Every name, address and text here is made up.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { htmlToMarkdown as md } from "../src/index.ts";

/** Google Docs wraps the whole copy in a <b> that is not bold, and styles every run of text inline. */
const docs = (body) => `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0a1b2c3d-7fff-1234-5678-9abcdef01234">${body}</b><br class="Apple-interchange-newline">`;
const span = (style, text) => `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;${style}font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">${text}</span>`;
const plain = (text) => span("font-weight:400;font-style:normal;", text);
const para = (...spans) => `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${spans.join("")}</p>`;
const mono = (text) => `<span style="font-size:10pt;font-family:'Courier New',monospace;color:#000000;font-weight:400;white-space:pre;white-space:pre-wrap;">${text}</span>`;

describe("Google Docs", () => {
  test("theOuterBoldIsNotBold", () => {
    assert.equal(md(docs(para(plain("Just text")))), "Just text");
  });

  test("boldItalicAndStrikethroughFromInlineStyles", () => {
    const html = docs(para(
      span("font-weight:700;font-style:normal;", "Bold"), plain(", "),
      span("font-weight:400;font-style:italic;", "italic"), plain(" and "),
      `<span style="font-weight:400;text-decoration:line-through;">gone</span>`));
    assert.equal(md(html), "**Bold**, *italic* and ~~gone~~");
  });

  test("emptyLinesBetweenParagraphsAreLineBreaks", () => {
    assert.equal(md(docs(para(plain("One")) + "<br>" + para(plain("Two")))), "One\n\nTwo");
  });

  test("headingsAreNotBold", () => {
    const html = docs(`<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;">${span("font-size:20pt;font-weight:400;", "Plan")}</h1>`);
    assert.equal(md(html), "# Plan");
  });

  test("nestedListsAreSiblingsOfTheirParentItem", () => {
    const item = (level, text) => `<li dir="ltr" style="list-style-type:disc;font-size:11pt;" aria-level="${level}"><p dir="ltr" role="presentation">${plain(text)}</p></li>`;
    const list = (tag, ...items) => `<${tag} style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${items.join("")}</${tag}>`;
    const html = docs(list("ol", item(1, "First"), list("ol", item(2, "First, a"), item(2, "First, b")), item(1, "Second"),
      list("ul", item(2, "A bullet"), list("ul", item(3, "Deeper")))));
    assert.equal(md(html), "1. First\n   1. First, a\n   2. First, b\n2. Second\n   - A bullet\n     - Deeper");
  });

  test("checklists", () => {
    const box = '<img src="data:image/png;base64,iVBORw0KGgo" width="17.6px" height="17.6px" alt="unchecked" aria-roledescription="checkbox">';
    const item = (checked, text) => `<li dir="ltr" role="checkbox" aria-checked="${checked}" style="list-style-type:none;" aria-level="1">${box}<p dir="ltr" role="presentation" style="display:inline-block;">${plain(text)}</p></li>`;
    assert.equal(md(docs(`<ul style="margin-top:0;">${item("true", "Book the room")}${item("false", "Send the agenda")}</ul>`)),
      "- [x] Book the room\n- [ ] Send the agenda");
  });

  test("links", () => {
    const html = docs(para(plain("See "), `<a href="https://example.com/notes" style="text-decoration:none;"><span style="color:#1155cc;text-decoration:underline;font-weight:400;">the notes</span></a>`));
    assert.equal(md(html), "See [the notes](https://example.com/notes)");
  });

  test("tables", () => {
    const cell = (text, style = "font-weight:400;") => `<td style="border-left:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;">${para(span(style, text))}</td>`;
    const html = docs(`<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="301"><col width="301"></colgroup><tbody>`
      + `<tr style="height:0pt">${cell("Name", "font-weight:700;")}${cell("Role", "font-weight:700;")}</tr>`
      + `<tr style="height:0pt">${cell("Ada")}${cell("Engineer")}</tr></tbody></table></div>`);
    assert.equal(md(html), "| Name | Role     |\n| ---- | -------- |\n| Ada  | Engineer |");
  });

  test("codeInATableCellIsOneLine", () => {
    // Lines of code in a cell join with one space; the spaces inside a line stay.
    const cell = (...paragraphs) => `<td>${paragraphs.join("")}</td>`;
    const html = docs(`<table><tbody><tr>${cell(para(plain("Step")))}${cell(para(plain("Command")))}</tr>`
      + `<tr>${cell(para(plain("Build")))}${cell(para(mono("make  all")), "<br>", para(mono("    --quiet")))}</tr></tbody></table>`);
    assert.equal(md(html), "| Step  | Command             |\n| ----- | ------------------- |\n| Build | `make  all --quiet` |");
  });

  test("monospacedParagraphsAreACodeBlock", () => {
    const html = docs(para(plain("Run this:")) + para(mono("if (ready) {")) + para(mono("    start();")) + "<br>"
      + para(mono("}")) + para(plain("Then "), mono("npm test"), plain(" again.")));
    assert.equal(md(html), "Run this:\n\n```\nif (ready) {\n    start();\n\n}\n```\n\nThen `npm test` again.");
  });

  test("aCopyAllInOneMonospacedFontIsText", () => {
    // A screenplay, or a note someone keeps in Courier: the font is the document's, not a sign of code.
    assert.equal(md(docs(para(mono("INT. KITCHEN - DAY")) + para(mono("She opens the window.")))), "INT. KITCHEN - DAY\n\nShe opens the window.");
  });
});

describe("Notion", () => {
  test("toDoLists", () => {
    const html = '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Pick up milk</span></li></ul>'
      + '<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Call the plumber</span></li></ul>';
    assert.equal(md(html), "- [x] Pick up milk\n- [ ] Call the plumber");
  });

  test("eachItemInAListOfItsOwn", () => {
    const html = '<ol type="1" class="numbered-list" start="1"><li>First</li></ol><ol type="1" class="numbered-list" start="2"><li>Second</li></ol>'
      + '<ul class="bulleted-list"><li style="list-style-type:disc">Bullet</li></ul><ul class="bulleted-list"><li style="list-style-type:disc">Another</li></ul>';
    assert.equal(md(html), "1. First\n2. Second\n\n- Bullet\n- Another");
  });

  test("codeBlocksNameTheirLanguage", () => {
    assert.equal(md('<pre class="code"><code class="language-JavaScript">let x = 1;</code></pre>'), "```javascript\nlet x = 1;\n```");
    assert.equal(md('<pre class="code"><code class="language-Plain Text">just text</code></pre>'), "```\njust text\n```");
  });

  test("boldIsWeight600", () => {
    assert.equal(md('<p>Text with <span style="font-weight:600">semibold</span> and <code>inline</code>.</p>'),
      "Text with **semibold** and `inline`.");
  });

  test("togglesAndCallouts", () => {
    const html = '<ul class="toggle"><li><details open=""><summary>Details</summary><p>Inside</p></details></li></ul>'
      + '<figure class="callout"><div>💡</div><div>Remember</div></figure>';
    assert.equal(md(html), "- Details\n\n  Inside\n\n💡\n\nRemember");
  });
});

/** Word and Outlook write a whole document: Office namespaces, a stylesheet, conditional comments, <o:p>. */
const word = (body) => `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta http-equiv=Content-Type content="text/html; charset=utf-8">
<style><!-- p.MsoNormal, li.MsoNormal {margin:0in; font-size:12.0pt;} @list l0:level1 {mso-level-number-format:bullet;} --></style>
<!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit" spidmax="1026" /></xml><![endif]--></head>
<body lang=EN-US style='tab-interval:.5in;word-wrap:break-word'><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
const bullet = (level, marker, text, cls = "MsoListParagraphCxSpMiddle") => `<p class=${cls} style='margin-left:${level * 0.5}in;text-indent:-.25in;mso-list:l0 level${level} lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol'><span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>${text}<o:p></o:p></p>`;

describe("Word", () => {
  test("paragraphsAndFormatting", () => {
    const html = word("<p class=MsoNormal><b>Bold</b>, <i>italic</i> and <s>struck</s><o:p></o:p></p>\n<p class=MsoNormal><o:p>&nbsp;</o:p></p>\n<p class=MsoNormal>Next<o:p></o:p></p>");
    assert.equal(md(html), "**Bold**, *italic* and ~~struck~~\n\nNext");
  });

  test("bidiWeightIsNotTheWeight", () => {
    // mso-bidi-font-weight is for right-to-left text; the <b> is still bold.
    const html = word("<p class=MsoNormal><b style='mso-bidi-font-weight:normal'>Still bold</b> <i style='mso-bidi-font-style:normal'>still italic</i></p>");
    assert.equal(md(html), "**Still bold** *still italic*");
  });

  test("bulletedListsWithLevels", () => {
    const html = word(bullet(1, "·", "First", "MsoListParagraphCxSpFirst") + bullet(2, "o", "Nested") + bullet(3, "§", "Deeper")
      + bullet(1, "·", "Second", "MsoListParagraphCxSpLast"));
    assert.equal(md(html), "- First\n  - Nested\n    - Deeper\n- Second");
  });

  test("numberedLists", () => {
    const html = word(bullet(1, "1.", "Step one") + bullet(2, "a.", "Detail") + bullet(1, "2.", "Step two")
      + "<p class=MsoNormal>Between<o:p></o:p></p>" + bullet(1, "4)", "Fourth"));
    assert.equal(md(html), "1. Step one\n   1. Detail\n2. Step two\n\nBetween\n\n4. Fourth");
  });

  test("multiLevelNumbers", () => {
    // Legal-style numbering: the last part of `1.2.` or `2.1)` is the item's number in its sub-list.
    const html = word(bullet(1, "1.", "Scope") + bullet(2, "1.1.", "Terms") + bullet(2, "1.2", "Parties") + bullet(1, "2.", "Fees")
      + bullet(2, "2.1)", "Rates") + bullet(3, "2.1.1", "Hourly"));
    assert.equal(md(html), "1. Scope\n   1. Terms\n   2. Parties\n2. Fees\n   1. Rates\n      1. Hourly");
  });

  test("aSubListThatCarriesOnItsNumbering", () => {
    assert.equal(md(word(bullet(1, "1.", "One") + bullet(2, "3.", "Three"))), "1. One\n\n   3. Three");
    assert.equal(md(word(bullet(1, "1.", "One") + bullet(2, "1.3.", "Third"))), "1. One\n\n   3. Third");
  });

  test("aListMarkerWithoutConditionalComments", () => {
    const html = word("<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><span style='mso-list:Ignore'>1.<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp; </span></span>Only<o:p></o:p></p>");
    assert.equal(md(html), "1. Only");
  });

  test("theTitleStyleIsAHeading", () => {
    assert.equal(md(word("<p class=MsoTitle>Quarterly plan<o:p></o:p></p><h1>Goals<o:p></o:p></h1>")), "# Quarterly plan\n\n# Goals");
  });

  test("sourceLineWrapsAndSpacesAreNotText", () => {
    const html = word("<p class=MsoNormal>A long paragraph that Word wrapped\nin its source.<span style='mso-spacerun:yes'>&nbsp; </span>Next sentence.<span style='mso-tab-count:1'>&nbsp;&nbsp;&nbsp; </span>Tab.</p>");
    assert.equal(md(html), "A long paragraph that Word wrapped in its source. Next sentence. Tab.");
  });

  test("tablesWithoutTheSpacerRow", () => {
    const html = word("<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;mso-yfti-tbllook:1184'>"
      + "<tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'><td width=312 valign=top><p class=MsoNormal><b>Name<o:p></o:p></b></p></td><td width=312 valign=top><p class=MsoNormal><b>Age<o:p></o:p></b></p></td></tr>"
      + "<tr><td><p class=MsoNormal>Ada<o:p></o:p></p></td><td><p class=MsoNormal>36<o:p></o:p></p></td></tr>"
      + "<![if !supportMisalignedColumns]><tr height=0><td width=312 style='border:none'></td><td width=312 style='border:none'></td></tr><![endif]></table>");
    assert.equal(md(html), "| Name | Age |\n| ---- | --- |\n| Ada  | 36  |");
  });

  test("courierParagraphsAreCode", () => {
    const html = word("<p class=MsoNormal>Install it:<o:p></o:p></p><p class=MsoNormal><span style='font-family:\"Courier New\"'>npm install<o:p></o:p></span></p>"
      + "<p class=MsoNormal><span style='font-family:Consolas'>&nbsp;&nbsp;--save<o:p></o:p></span></p>");
    assert.equal(md(html), "Install it:\n\n```\nnpm install\n  --save\n```");
  });

  test("hiddenTextAndShapesAreLeftOut", () => {
    const html = word("<p class=MsoNormal>Shown<span style='display:none;mso-hide:all'>hidden</span><o:p></o:p></p><v:shape style='width:10pt'><v:imagedata src='x.png'/></v:shape>"
      + "<p class=MsoNormal><![if !supportEmptyParas]>&nbsp;<![endif]><o:p></o:p></p>");
    assert.equal(md(html), "Shown");
  });

  test("namespaceDeclarationsAreLeftOut", () => {
    assert.equal(md('<?xml:namespace prefix = "o" ns = "urn:schemas-microsoft-com:office:office" /><p class=MsoNormal>Text<o:p></o:p></p>'), "Text");
  });

  test("smartQuotesAsWindowsCodes", () => {
    assert.equal(md("<p class=MsoNormal>It&#146;s &#147;quoted&#148; &#150; done&#133;</p>"), "It’s “quoted” – done…");
  });
});

describe("Outlook", () => {
  test("aReplyWithItsHeader", () => {
    const html = word("<div class=WordSection1><p class=MsoNormal>Hi Ada,<o:p></o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>Thanks<o:p></o:p></p>"
      + "<div><div style='border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in'><p class=MsoNormal><b>From:</b> Deniz &lt;deniz@example.com&gt;<br><b>Sent:</b> Monday<o:p></o:p></p></div></div></div>");
    assert.equal(md(html), "Hi Ada,\n\nThanks\n\n**From:** Deniz \\<deniz@example.com>  \n**Sent:** Monday");
  });

  test("aHiddenPreviewLineIsLeftOut", () => {
    assert.equal(md("<div style='display:none;max-height:0px;overflow:hidden;mso-hide:all'>Preview text</div><p>Body</p>"), "Body");
  });
});

describe("Safari", () => {
  test("convertedSpacesAndTheInterchangeNewline", () => {
    const html = '<meta charset="UTF-8"><br class="Apple-interchange-newline"><h2 style="caret-color: rgb(0, 0, 0); font-family: -apple-system; font-weight: 700;">Section</h2>'
      + '<p style="margin: 0px;">One<span class="Apple-converted-space">&nbsp;</span><b>two</b><span class="Apple-tab-span" style="white-space:pre">\t</span>three</p><br class="Apple-interchange-newline">';
    assert.equal(md(html), "## Section\n\nOne **two** three");
  });

  test("inlineStylesForBoldAndItalic", () => {
    const html = '<span style="caret-color: rgb(0, 0, 0); font-family: Helvetica; font-size: 12px; font-style: normal; font-weight: 400; text-decoration: none; display: inline !important; float: none;">Plain and </span>'
      + '<span style="font-family: Helvetica; font-weight: bold;">bold</span><span style="font-style: italic;"> and italic</span>';
    assert.equal(md(html), "Plain and **bold** *and italic*");
  });
});

describe("Chrome", () => {
  test("interchangeStylesDoNotUndoTags", () => {
    const html = "<meta charset='utf-8'><span style=\"color: rgb(32, 33, 36); font-family: Roboto, Arial; font-size: 14px; font-style: normal; font-weight: 400; display: inline !important; float: none;\">Plain </span>"
      + '<strong style="color: rgb(32, 33, 36); font-family: Roboto, Arial; font-weight: 700;">strong</strong><span style="font-weight: 400;"> then </span><em style="font-style: italic;">em</em>';
    assert.equal(md(html), "Plain **strong** then *em*");
  });

  test("aStyleCanTurnBoldOff", () => {
    assert.equal(md('<strong style="font-weight: 400">not bold</strong> <span style="font-weight: 700 !important">bold</span>'), "not bold **bold**");
  });

  test("aCopiedItemWithoutItsList", () => {
    assert.equal(md('<meta charset="utf-8"><li style="color: rgb(0, 0, 0);">First</li><li>Second</li>'), "- First\n- Second");
  });

  test("monospacedFontsOnWebPagesAreNotCode", () => {
    // Only Office documents write code as a font; a web page's font may be its body font.
    assert.equal(md('<span style="font-family: &quot;IBM Plex Mono&quot;, monospace;">x = 1</span> is set'), "x = 1 is set");
  });

  test("startAndEndFragmentMarkers", () => {
    assert.equal(md("<html><body><!--StartFragment--><p>Copied</p><!--EndFragment--></body></html>"), "Copied");
  });
});

describe("code editors", () => {
  test("anEditorCopiesLinesAsDivs", () => {
    const html = "<meta charset='utf-8'><div style=\"color: #cccccc;background-color: #1f1f1f;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;\">"
      + '<div><span style="color: #569cd6;">const</span><span style="color: #cccccc;"> a = </span><span style="color: #b5cea8;">1</span><span style="color: #cccccc;">;</span></div>'
      + '<br><div><span style="color: #cccccc;">    </span><span style="color: #dcdcaa;">log</span><span style="color: #cccccc;">(a &lt; 2);</span></div></div>';
    assert.equal(md(html), "```\nconst a = 1;\n\n    log(a < 2);\n```");
  });

  test("anIdeCopiesAPre", () => {
    const html = "<pre style=\"background-color:#2b2b2b;color:#a9b7c6;font-family:monospace;font-size:9.8pt;\"><span style=\"color:#cc7832;\">val </span>x = <span style=\"color:#6897bb;\">1</span></pre>";
    assert.equal(md(html), "```\nval x = 1\n```");
  });
});
