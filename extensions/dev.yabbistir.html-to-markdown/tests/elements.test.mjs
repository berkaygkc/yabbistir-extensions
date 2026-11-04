// One fixture per kind of element, with the Markdown it becomes.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { htmlToMarkdown as md } from "../src/index.ts";

describe("headings", () => {
  test("allSixLevels", () => {
    assert.equal(md("<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>"),
      "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six");
  });

  test("aHeadingThatIsBoldAllThroughIsJustAHeading", () => {
    assert.equal(md("<h2><strong>Release notes</strong></h2>"), "## Release notes");
    assert.equal(md("<h2>Release <strong>notes</strong></h2>"), "## Release **notes**");
  });

  test("staysOnOneLine", () => {
    assert.equal(md("<h1>Two<br>lines</h1>"), "# Two lines");
    assert.equal(md("<h1><div>Block</div><div>inside</div></h1>"), "# Block inside");
  });

  test("anEmptyHeadingIsLeftOut", () => {
    assert.equal(md("<h1> </h1><p>Text</p>"), "Text");
  });

  test("closingHashesAreKept", () => {
    assert.equal(md("<h3>C# and F #</h3>"), "### C# and F \\#");
  });
});

describe("paragraphs and line breaks", () => {
  test("paragraphsAreSeparatedByABlankLine", () => {
    assert.equal(md("<p>One</p><p>Two</p>"), "One\n\nTwo");
    assert.equal(md("<div>One</div><div>Two</div>"), "One\n\nTwo");
  });

  test("aLineBreakIsAHardBreak", () => {
    assert.equal(md("<p>Line one<br>Line two</p>"), "Line one  \nLine two");
  });

  test("twoLineBreaksStartANewParagraph", () => {
    assert.equal(md("<p>One<br><br>Two<br><br><br>Three</p>"), "One\n\nTwo\n\nThree");
  });

  test("lineBreaksAtTheEdgesAreDropped", () => {
    assert.equal(md("<p><br>Text<br></p>"), "Text");
  });

  test("inlineContentWithoutABlock", () => {
    assert.equal(md("Just <b>text</b>"), "Just **text**");
  });
});

describe("inline formatting", () => {
  test("bold", () => {
    assert.equal(md("<b>a</b> and <strong>b</strong>"), "**a** and **b**");
  });

  test("italic", () => {
    assert.equal(md("<i>a</i>, <em>b</em>, <cite>c</cite>"), "*a*, *b*, *c*");
  });

  test("strikethrough", () => {
    assert.equal(md("<s>a</s>, <del>b</del>, <strike>c</strike>"), "~~a~~, ~~b~~, ~~c~~");
  });

  test("nested", () => {
    assert.equal(md("<b>bold <i>both</i></b>"), "**bold *both***");
    assert.equal(md("<s><b>bold strike</b> strike</s>"), "~~**bold strike** strike~~");
  });

  test("spacesMoveOutsideTheDelimiters", () => {
    assert.equal(md("<p><b>bold </b>text and<i> italic</i></p>"), "**bold** text and *italic*");
  });

  test("runsWithTheSameFormattingJoin", () => {
    assert.equal(md("<b>Hel</b><b>lo</b> <i>wor</i><i>ld</i>"), "**Hello** *world*");
    // Only a space between two bold runs: one run, which reads the same.
    assert.equal(md("<b>two</b> <strong>words</strong>"), "**two words**");
  });

  test("insideAWord", () => {
    assert.equal(md("un<b>believ</b>able"), "un**believ**able");
  });

  test("inlineCode", () => {
    assert.equal(md("<p>Run <code>npm test</code> or <kbd>Cmd</kbd> <samp>out</samp> <tt>tt</tt></p>"),
      "Run `npm test` or `Cmd` `out` `tt`");
  });

  test("inlineCodeWithBackticks", () => {
    assert.equal(md("<code>a`b</code>"), "``a`b``");
    assert.equal(md("<code>`x`</code>"), "`` `x` ``");
  });

  test("codeIsNotEscaped", () => {
    assert.equal(md("<code>*a* _b_ [c]</code>"), "`*a* _b_ [c]`");
  });

  test("codeInsideBold", () => {
    assert.equal(md("<b><code>x</code></b>"), "**`x`**");
  });

  test("formattingMarkdownCannotShowIsPlainText", () => {
    assert.equal(md("<u>u</u> <mark>m</mark> x<sup>2</sup> H<sub>2</sub>O <small>s</small>"), "u m x2 H2O s");
  });
});

describe("code blocks", () => {
  test("theLanguageOfTheCodeElement", () => {
    assert.equal(md('<pre><code class="language-python">print(1)\n</code></pre>'), "```python\nprint(1)\n```");
    assert.equal(md('<pre><code class="hljs language-ts">let a: number</code></pre>'), "```ts\nlet a: number\n```");
  });

  test("theLanguageOfThePre", () => {
    assert.equal(md('<pre class="lang-rust"><code>fn main() {}</code></pre>'), "```rust\nfn main() {}\n```");
    assert.equal(md('<pre data-lang="go">x := 1</pre>'), "```go\nx := 1\n```");
  });

  test("theLanguageOfARenderedReadme", () => {
    const html = '<div class="highlight highlight-source-js notranslate"><pre><span class="pl-k">const</span> a <span class="pl-c1">=</span> 1;</pre></div>';
    assert.equal(md(html), "```js\nconst a = 1;\n```");
  });

  test("noLanguage", () => {
    assert.equal(md("<pre>plain\n  indented</pre>"), "```\nplain\n  indented\n```");
    assert.equal(md('<pre><code class="language-plaintext">x</code></pre>'), "```\nx\n```");
    assert.equal(md('<pre><code class="language-a b">x</code></pre>'), "```a\nx\n```");
  });

  test("theFenceIsLongerThanAnyBackticksInside", () => {
    assert.equal(md("<pre>a\n```\nb</pre>"), "````\na\n```\nb\n````");
  });

  test("theNewlineAfterPreIsDropped", () => {
    assert.equal(md("<pre>\nfirst\n\n</pre>"), "```\nfirst\n```");
  });

  test("keepsMarkupCharactersAsTheyAre", () => {
    assert.equal(md("<pre>a * b _c_ &lt;tag&gt; &amp;</pre>"), "```\na * b _c_ <tag> &\n```");
  });

  test("lineBreaksAndLinesInside", () => {
    assert.equal(md("<pre>a<br>b</pre>"), "```\na\nb\n```");
    assert.equal(md("<pre><div>one</div><div>two</div></pre>"), "```\none\ntwo\n```");
  });

  test("anEmptyBlockIsLeftOut", () => {
    assert.equal(md("<pre> </pre><p>x</p>"), "x");
  });
});

describe("links", () => {
  test("withATitle", () => {
    assert.equal(md('<a href="https://example.com" title="Example">site</a>'), '[site](https://example.com "Example")');
    assert.equal(md('<a href="https://example.com" title=\'Say "hi"\'>x</a>'), '[x](https://example.com "Say \\"hi\\"")');
  });

  test("relativeLinksStayAsTheyAre", () => {
    assert.equal(md('<a href="/docs/intro">Intro</a> <a href="#setup">Setup</a> <a href="../a.html">A</a>'),
      "[Intro](/docs/intro) [Setup](#setup) [A](../a.html)");
  });

  test("addressesWithSpacesOrUnpairedParentheses", () => {
    assert.equal(md('<a href="my file.html">f</a>'), "[f](<my file.html>)");
    assert.equal(md('<a href="https://example.com/wiki/Foo_(bar)">Foo</a>'), "[Foo](https://example.com/wiki/Foo_(bar))");
    assert.equal(md('<a href="https://example.com/a)">x</a>'), "[x](<https://example.com/a)>)");
  });

  test("anAddressWrittenAsItself", () => {
    assert.equal(md('<a href="https://example.com/">https://example.com/</a>'), "<https://example.com/>");
    assert.equal(md('<a href="mailto:ada@example.com">ada@example.com</a>'), "<ada@example.com>");
    assert.equal(md('<a href="mailto:ada@example.com">Write</a>'), "[Write](mailto:ada@example.com)");
  });

  test("scriptLinksKeepOnlyTheirText", () => {
    assert.equal(md('<a href="javascript:alert(1)">Click</a> <a href=" JavaScript:x">Here</a> <a href="vbscript:x">VB</a>'),
      "Click Here VB");
  });

  test("anchorsWithoutAnAddress", () => {
    assert.equal(md('<a name="top">Top</a> <a href="">Empty</a> <a href="#">Hash</a>'), "Top Empty Hash");
  });

  test("anEmptyLinkIsLeftOut", () => {
    assert.equal(md('<h2>Title<a href="#title" aria-hidden="true"><svg><path d="M0"/></svg></a></h2>'), "## Title");
  });

  test("formattingInside", () => {
    assert.equal(md('<a href="https://example.com"><b>bold</b> link</a>'), "[**bold** link](https://example.com)");
    assert.equal(md('<b><a href="https://example.com">link</a> bold</b>'), "**[link](https://example.com) bold**");
  });

  test("anExclamationMarkBeforeALinkStaysText", () => {
    assert.equal(md('Wow!<a href="https://example.com">link</a>'), "Wow\\![link](https://example.com)");
  });

  test("anImageInsideALink", () => {
    assert.equal(md('<a href="https://example.com"><img src="https://example.com/logo.png" alt="Logo"></a>'),
      "[![Logo](https://example.com/logo.png)](https://example.com)");
  });

  test("theQueryKeepsItsAmpersands", () => {
    assert.equal(md('<a href="https://example.com/?a=1&copy=2&amp;b=3">q</a>'), "[q](https://example.com/?a=1&copy=2&b=3)");
  });

  test("twoLinksToOneAddressStayTwo", () => {
    assert.equal(md('<a href="https://example.com">a</a> <a href="https://example.com">b</a>'),
      "[a](https://example.com) [b](https://example.com)");
  });

  test("brokenSquareBracketsInTheText", () => {
    assert.equal(md('<a href="https://example.com/cite">[1]</a>'), "[\\[1\\]](https://example.com/cite)");
  });
});

describe("images", () => {
  test("altSourceAndTitle", () => {
    assert.equal(md('<img src="https://example.com/cat.png" alt="A cat" title="Cat">'), '![A cat](https://example.com/cat.png "Cat")');
    assert.equal(md('<img src="pic.png">'), "![](pic.png)");
  });

  test("anImageInsideTheCopyKeepsOnlyItsDescription", () => {
    assert.equal(md('<p>Hi <img src="data:image/png;base64,AAAA" alt="😀"></p>'), "Hi 😀");
    assert.equal(md('<p><img src="data:image/gif;base64,R0lG"></p><p>x</p>'), "x");
  });

  test("trackingPixelsAreLeftOut", () => {
    assert.equal(md('<img src="https://example.com/t.gif" width="1" height="1">Text'), "Text");
  });

  test("aLazyImageUsesItsRealSource", () => {
    assert.equal(md('<img src="data:image/gif;base64,R0lG" data-src="https://example.com/real.jpg" alt="Real">'),
      "![Real](https://example.com/real.jpg)");
  });

  test("bracketsInTheAltText", () => {
    assert.equal(md('<img src="a.png" alt="[1] figure">'), "![\\[1\\] figure](a.png)");
  });
});

describe("lists", () => {
  test("bulleted", () => {
    assert.equal(md("<ul><li>One</li><li>Two</li></ul>"), "- One\n- Two");
  });

  test("numberedFromItsStart", () => {
    assert.equal(md('<ol start="3"><li>c</li><li>d</li></ol>'), "3. c\n4. d");
    assert.equal(md("<ol><li>a</li><li>b</li></ol>"), "1. a\n2. b");
  });

  test("nested", () => {
    assert.equal(md("<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>"), "- a\n  - b\n    1. c\n- d");
    assert.equal(md("<ol><li>a<ul><li>b</li></ul></li></ol>"), "1. a\n   - b");
  });

  test("aNestedListThatCannotInterruptItsItemsTextStartsAfterABlankLine", () => {
    // CommonMark reads `1. Step\n   3. sub` as the one paragraph "Step 3. sub": right after a line of text, only a
    // bulleted list or a numbered one from 1 can start, and only with something after its first marker.
    assert.equal(md('<ol><li>Step<ol start="3"><li>sub</li></ol></li></ol>'), "1. Step\n\n   3. sub");
    assert.equal(md('<ul><li>a<ol start="2"><li>b</li></ol></li></ul>'), "- a\n\n  2. b");
    assert.equal(md("<ul><li>a<ul><li></li></ul></li></ul>"), "- a\n\n  -");
    assert.equal(md("<ul><li>a<ul><li><ul><li>deep</li></ul></li></ul></li></ul>"), "- a\n\n  -\n    - deep");
    assert.equal(md('<ul><li>a<ol start="1"><li>b</li></ol></li></ul>'), "- a\n  1. b");
  });

  test("continuationLinesFollowTheMarkersWidth", () => {
    assert.equal(md("<ol start=9><li><p>x</p><p>more</p></li><li><p>y</p><p>more</p></li></ol>"),
      "9. x\n\n   more\n10. y\n\n    more");
  });

  test("itemsWithOneParagraphStayTight", () => {
    assert.equal(md("<ul><li><p>a</p></li><li><p>b</p></li></ul>"), "- a\n- b");
  });

  test("anItemWithTwoParagraphs", () => {
    assert.equal(md("<ul><li><p>a</p><p>b</p></li></ul>"), "- a\n\n  b");
  });

  test("aListRightInsideAListBelongsToTheItemBefore", () => {
    assert.equal(md("<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>"), "- a\n  - b\n- c");
  });

  test("listsNextToEachOtherJoin", () => {
    assert.equal(md("<ul><li>a</li></ul><ul><li>b</li></ul>"), "- a\n- b");
    assert.equal(md('<ol><li>a</li></ol><ol start="2"><li>b</li></ol>'), "1. a\n2. b");
  });

  test("aNumberedListThatStartsOverStaysApart", () => {
    assert.equal(md("<ol><li>a</li></ol><ol><li>b</li></ol>"), "1. a\n\n1) b");
  });

  test("listsWithTextBetweenStayApart", () => {
    assert.equal(md("<ul><li>a</li></ul><p>mid</p><ul><li>b</li></ul>"), "- a\n\nmid\n\n- b");
  });

  test("emptyItems", () => {
    assert.equal(md("<ul><li></li><li>b</li></ul>"), "-\n- b");
    assert.equal(md("<ul><li><ul><li>deep</li></ul></li></ul>"), "-\n  - deep");
  });

  test("anItemOutsideAList", () => {
    assert.equal(md("<li>a</li><li>b</li>"), "- a\n- b");
  });

  test("aCodeBlockInAnItem", () => {
    assert.equal(md("<ul><li>Run:<pre>npm test</pre></li></ul>"), "- Run:\n\n  ```\n  npm test\n  ```");
  });

  test("textThatLooksLikeAMarker", () => {
    assert.equal(md("<ul><li>1. not nested</li></ul>"), "- 1\\. not nested");
  });
});

describe("task lists", () => {
  test("checkboxesFromARenderedReadme", () => {
    const html = '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> Done</li>'
      + '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> Todo</li></ul>';
    assert.equal(md(html), "- [x] Done\n- [ ] Todo");
  });

  test("dataChecked", () => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Shipped</p></div></li>'
      + '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Next</p></div></li></ul>';
    assert.equal(md(html), "- [x] Shipped\n- [ ] Next");
  });

  test("dataList", () => {
    assert.equal(md('<ul><li data-list="checked">a</li><li data-list="unchecked">b</li></ul>'), "- [x] a\n- [ ] b");
  });

  test("numbered", () => {
    assert.equal(md('<ol><li><input type="checkbox"> a</li></ol>'), "1. [ ] a");
  });

  test("aCheckboxAfterTheTextIsNotATask", () => {
    assert.equal(md('<ul><li>Agree <input type="checkbox"></li></ul>'), "- Agree");
  });
});

describe("blockquotes", () => {
  test("paragraphs", () => {
    assert.equal(md("<blockquote><p>One</p><p>Two</p></blockquote>"), "> One\n>\n> Two");
  });

  test("nested", () => {
    assert.equal(md("<blockquote>a<blockquote>b</blockquote></blockquote>"), "> a\n>\n> > b");
  });

  test("aListInAQuote", () => {
    assert.equal(md("<blockquote><ul><li>x</li><li>y</li></ul></blockquote>"), "> - x\n> - y");
  });

  test("anEmptyQuoteIsLeftOut", () => {
    assert.equal(md("<blockquote> </blockquote><p>x</p>"), "x");
  });
});

describe("horizontal rules", () => {
  test("betweenParagraphs", () => {
    assert.equal(md("<p>a</p><hr><p>b</p>"), "a\n\n---\n\nb");
    assert.equal(md('<p>a</p><hr size=2 width="100%" align=center><p>b</p>'), "a\n\n---\n\nb");
  });
});

describe("tables", () => {
  test("headerAndRows", () => {
    assert.equal(md("<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apple</td><td>3</td></tr></table>"),
      "| Name  | Qty |\n| ----- | --- |\n| Apple | 3   |");
    assert.equal(md("<table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Apple</td><td>3</td></tr></tbody></table>"),
      "| Name  | Qty |\n| ----- | --- |\n| Apple | 3   |");
  });

  test("withoutHeaderCellsTheFirstRowIsTheHeader", () => {
    assert.equal(md("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>"),
      "| a   | b   |\n| --- | --- |\n| c   | d   |");
  });

  test("alignment", () => {
    const html = '<table><tr><th align="left">L</th><th style="text-align:center">C</th><th align="right">R</th></tr>'
      + "<tr><td>1</td><td>2</td><td>3</td></tr></table>";
    assert.equal(md(html), "| L   |  C  |   R |\n| --- | :-: | --: |\n| 1   |  2  |   3 |");
  });

  test("alignmentSharedByTheCellsOfAColumn", () => {
    const html = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td align="right">1</td></tr><tr><td align="right">22</td></tr></tbody></table>';
    assert.equal(md(html), "|   A |\n| --: |\n|   1 |\n|  22 |");
  });

  test("pipesAndLineBreaksInACell", () => {
    assert.equal(md("<table><tr><th>Expr</th></tr><tr><td>a | b<br>c</td></tr></table>"),
      "| Expr        |\n| ----------- |\n| a \\| b<br>c |");
    assert.equal(md("<table><tr><th>A</th></tr><tr><td><code>x|y</code></td></tr></table>"),
      "| A      |\n| ------ |\n| `x\\|y` |");
  });

  test("paragraphsInACellAreLines", () => {
    assert.equal(md("<table><tr><th>A</th></tr><tr><td><p>one</p><p>two</p></td></tr></table>"),
      "| A          |\n| ---------- |\n| one<br>two |");
  });

  test("aBoldHeaderIsJustAHeader", () => {
    assert.equal(md("<table><tr><td><b>Name</b></td><td><b>Age</b></td></tr><tr><td><b>Ada</b></td><td>36</td></tr></table>"),
      "| Name    | Age |\n| ------- | --- |\n| **Ada** | 36  |");
  });

  test("columnSpans", () => {
    assert.equal(md('<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td colspan="2">wide</td><td>z</td></tr></table>'),
      "| a    | b   | c   |\n| ---- | --- | --- |\n| wide |     | z   |");
  });

  test("rowSpans", () => {
    assert.equal(md('<table><tr><th>k</th><th>v</th></tr><tr><td rowspan="2">x</td><td>1</td></tr><tr><td>2</td></tr></table>'),
      "| k   | v   |\n| --- | --- |\n| x   | 1   |\n|     | 2   |");
  });

  test("shortRowsAreFilledIn", () => {
    assert.equal(md("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>"),
      "| a   | b   |\n| --- | --- |\n| c   |     |");
  });

  test("aCaption", () => {
    assert.equal(md("<table><caption>Prices</caption><tr><th>a</th></tr><tr><td>1</td></tr></table>"),
      "Prices\n\n| a   |\n| --- |\n| 1   |");
  });

  test("wideCharactersTakeTwoColumns", () => {
    assert.equal(md("<table><tr><th>名前</th><th>x</th></tr><tr><td>a</td><td>y</td></tr></table>"),
      "| 名前 | x   |\n| ---- | --- |\n| a    | y   |");
  });

  test("longCellsAreNotPadded", () => {
    const long = "word ".repeat(15).trim();
    assert.equal(md(`<table><tr><th>A</th><th>B</th></tr><tr><td>${long}</td><td>b</td></tr></table>`),
      `| A | B |\n| --- | --- |\n| ${long} | b |`);
  });

  test("aTableOfOneCellIsItsContent", () => {
    assert.equal(md("<table><tr><td><p>Hello</p><p>World</p></td></tr></table>"), "Hello\n\nWorld");
  });

  test("aTableHoldingListsOrHeadingsIsItsContent", () => {
    assert.equal(md("<table><tr><td><ul><li>a</li></ul></td><td><h2>T</h2></td></tr></table>"), "- a\n\n## T");
    assert.equal(md("<table><tr><td><table><tr><td>x</td><td>y</td></tr></table></td><td>z</td></tr></table>"),
      "| x   | y   |\n| --- | --- |\n\nz");
  });

  test("anEmptyTableIsLeftOut", () => {
    assert.equal(md("<table><tr></tr></table><p>x</p>"), "x");
  });
});

describe("other blocks", () => {
  test("definitionLists", () => {
    assert.equal(md("<dl><dt>Term</dt><dd>Meaning</dd></dl>"), "Term\n\nMeaning");
  });

  test("detailsAndFigures", () => {
    assert.equal(md("<details><summary>More</summary><p>Hidden</p></details>"), "More\n\nHidden");
    assert.equal(md('<figure><img src="a.png" alt="A"><figcaption>Caption</figcaption></figure>'), "![A](a.png)\n\nCaption");
  });

  test("formsAndMediaAreLeftOut", () => {
    assert.equal(md('<p>Text</p><form><input value="x"><select><option>o</option></select><button>Go</button></form><video>v</video><svg><text>s</text></svg>'), "Text");
  });

  test("hiddenContentIsLeftOut", () => {
    assert.equal(md('<p>shown<span hidden>hidden</span><span style="display: none">gone</span></p>'), "shown");
  });
});
