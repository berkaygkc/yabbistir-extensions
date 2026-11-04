// Entities, white space and escaping: the text between the tags.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { decodeEntities } from "../src/entities.ts";
import { displayWidth, escapeLineStart, escapeText } from "../src/markdown.ts";
import { htmlToMarkdown as md } from "../src/index.ts";

describe("entities", () => {
  test("theFiveEveryoneUses", () => {
    assert.equal(md("<p>&amp; &lt; &gt; &quot; &#39; &apos;</p>"), "& < > \" ' '");
  });

  test("named", () => {
    assert.equal(decodeEntities("&eacute;&ccedil;&uuml;&mdash;&hellip;&euro;&copy;&trade;&rsquo;&ldquo;&rdquo;&bull;&rarr;"), "éçü—…€©™’“”•→");
    assert.equal(decodeEntities("&Omega;&omega;&sigmaf;&Alpha;&pi;"), "ΩωςΑπ");
    assert.equal(decodeEntities("&nbsp;&iexcl;&divide;&yuml;&Yuml;&lang;&rang;"), "\u00a0¡÷ÿŸ⟨⟩");
  });

  test("theLatinOneRangeIsComplete", () => {
    // &nbsp; is U+00A0 and &yuml; U+00FF; the names in between are in order, one per code point.
    const names = ["nbsp", "copy", "reg", "deg", "plusmn", "micro", "frac12", "Agrave", "ETH", "times", "szlig", "eth", "divide", "thorn", "yuml"];
    const codes = [0xa0, 0xa9, 0xae, 0xb0, 0xb1, 0xb5, 0xbd, 0xc0, 0xd0, 0xd7, 0xdf, 0xf0, 0xf7, 0xfe, 0xff];
    assert.deepEqual(names.map((name) => decodeEntities(`&${name};`).codePointAt(0)), codes);
  });

  test("numbers", () => {
    assert.equal(decodeEntities("&#8217;&#x2014;&#X1F600;&#0065;"), "’—😀A");
  });

  test("windowsCodesAreReadAsTheStandardSays", () => {
    assert.equal(decodeEntities("&#146;&#150;&#128;&#153;"), "’–€™");
  });

  test("invalidNumbersBecomeTheReplacementCharacter", () => {
    assert.equal(decodeEntities("&#0;&#xD800;&#1114112;&#99999999999999;"), "\uFFFD".repeat(4));
  });

  test("oldNamesWithoutASemicolon", () => {
    assert.equal(decodeEntities("&copy 2026 &amp friends &notit;"), "© 2026 & friends ¬it;");
  });

  test("inAnAttributeANameRunningIntoTheQueryStays", () => {
    assert.equal(decodeEntities("?a=1&copy=2&amp;b=3&ampx", true), "?a=1&copy=2&b=3&ampx");
    assert.equal(decodeEntities("&ampx"), "&x");
  });

  test("unknownNamesStay", () => {
    assert.equal(decodeEntities("&bogus; & &; &#; &#x;"), "&bogus; & &; &#; &#x;");
    assert.equal(md("<p>&amp;bogus; &amp; more</p>"), "\\&bogus; & more");
  });
});

describe("white space", () => {
  test("runsCollapseToOneSpace", () => {
    assert.equal(md("<p>  Many   spaces\n\tand\ttabs  </p>"), "Many spaces and tabs");
  });

  test("betweenInlineElements", () => {
    assert.equal(md("<p><b>a</b> <i>b</i></p>"), "**a** *b*");
    assert.equal(md("<p>a <b> b</b></p>"), "a **b**");
    assert.equal(md("<p>a<b> </b>b</p>"), "a b");
  });

  test("nonBreakingSpacesAreSpaces", () => {
    assert.equal(md("<p>a&nbsp;&nbsp;b&nbsp;</p>"), "a b");
  });

  test("invisibleCharactersGo", () => {
    assert.equal(md("<p>a&#8203;b&#xFEFF;c</p>"), "abc");
  });

  test("newlinesInTheSourceAreSpaces", () => {
    assert.equal(md("<p>one\ntwo\r\nthree</p>"), "one two three");
  });

  test("whiteSpaceBetweenBlocksIsNothing", () => {
    assert.equal(md("<p>a</p>\n\n   <p>b</p>\n"), "a\n\nb");
    assert.equal(md("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>"), "- a\n- b");
  });

  test("afterALineBreak", () => {
    assert.equal(md("<p>a <br> b</p>"), "a  \nb");
  });
});

describe("escaping", () => {
  test("markdownAtTheStartOfALine", () => {
    const cases = {
      "# Not a heading": "\\# Not a heading",
      "#hashtag": "#hashtag",
      "> not a quote": "\\> not a quote",
      "- not a bullet": "\\- not a bullet",
      "+ not a bullet": "\\+ not a bullet",
      "* not a bullet": "\\* not a bullet",
      "1. not a list": "1\\. not a list",
      "2026) not a list": "2026\\) not a list",
      "---": "\\---",
      "===": "\\===",
      "2.5 stays": "2.5 stays",
    };
    for (const [text, expected] of Object.entries(cases)) assert.equal(md(`<p>${text.replace(">", "&gt;")}</p>`), expected, text);
  });

  test("everyLineOfAParagraph", () => {
    assert.equal(md("<p>Intro<br># two<br>- three</p>"), "Intro  \n\\# two  \n\\- three");
  });

  test("aLineShapedLikeATableRule", () => {
    // GFM reads "a | b" over "-- | --" as a table.
    assert.equal(md("<p>a | b<br>-- | --</p>"), "a | b  \n\\-- | --");
    assert.equal(md("<p>Name|Age<br>|:--|--:|</p>"), "Name|Age  \n\\|:--|--:|");
    assert.equal(md("<p>Total<br>:-: |</p>"), "Total  \n\\:-: |");
    assert.equal(md("<p>a | b<br>-- | x</p>"), "a | b  \n-- | x");
    assert.equal(md("<p>1 - 2 | 3 -- 4</p>"), "1 - 2 | 3 -- 4");
  });

  test("markdownInsideALine", () => {
    assert.equal(md("<p>2*3 = 6, `x`, [link](url), &lt;div&gt;, a &lt; b, AT&amp;T</p>"),
      "2\\*3 = 6, \\`x\\`, \\[link\\](url), \\<div>, a < b, AT&T");
  });

  test("underscoresInsideWordsStay", () => {
    assert.equal(md("<p>snake_case and _emphasis_ and __init__</p>"), "snake_case and \\_emphasis\\_ and \\_\\_init\\_\\_");
  });

  test("backslashesOnlyWhereTheyEscape", () => {
    assert.equal(md("<p>C:\\Users\\ada and \\*star\\</p>"), "C:\\Users\\ada and \\\\\\*star\\\\");
  });

  test("entitiesWrittenOut", () => {
    assert.equal(md("<p>&amp;copy; and &amp;#169;</p>"), "\\&copy; and \\&#169;");
  });

  test("aSingleTildeStays", () => {
    assert.equal(md("<p>About ~5 minutes in ~/Documents</p>"), "About \\~5 minutes in \\~/Documents");
    assert.equal(md("<p>About ~5 minutes</p>"), "About ~5 minutes");
  });

  test("thePieces", () => {
    assert.equal(escapeText("a_b *c* [d] `e` <f & g;", false), "a_b \\*c\\* \\[d\\] \\`e\\` \\<f & g;");
    assert.equal(escapeLineStart("###### six"), "\\###### six");
    assert.equal(escapeLineStart("####### seven"), "####### seven");
    assert.equal(escapeLineStart("| --- | :-: |"), "\\| --- | :-: |");
    assert.equal(escapeLineStart("-|-"), "\\-|-");
    assert.equal(escapeLineStart("|"), "|");
    assert.equal(escapeLineStart("| a | -- |"), "| a | -- |");
  });
});

describe("emphasis", () => {
  test("formatsThatCrossAreClosedAndOpenedAgain", () => {
    assert.equal(md("<b>a<i>b</b>c</i>"), "**a*b***_c_");
  });

  test("runsSideBySide", () => {
    assert.equal(md("<i>a</i><b>b</b>"), "*a***b**");
    assert.equal(md("<b>a</b><i>b</i>"), "**a***b*");
    assert.equal(md("<i>a</i><b><i>b</i>c</b>"), "*a**b***__c__");
    assert.equal(md("<b><i>a</i></b><b>b</b>"), "***a*b**");
  });

  test("theLongestRunOpensFirst", () => {
    assert.equal(md("<b>x<i>y</i></b>z"), "**x*y***z");
    assert.equal(md("<i>x<b>y</b></i>z"), "*x**y***z");
  });
});

describe("display width", () => {
  test("wideAndZeroWidth", () => {
    assert.equal(displayWidth("abc"), 3);
    assert.equal(displayWidth("日本"), 4);
    assert.equal(displayWidth("é"), 1);
    assert.equal(displayWidth("e\u0301"), 1);
    assert.equal(displayWidth("😀"), 2);
  });
});
