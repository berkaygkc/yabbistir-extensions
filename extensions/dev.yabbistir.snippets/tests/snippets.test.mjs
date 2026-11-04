import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { fill, parseSnippets, sources } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const DIR = "/Users/deniz/Snippets";
const FILE = `${DIR}/snippets.md`;
// Local time, so the formatted values do not depend on the machine's time zone.
const NOW = new Date(2026, 10, 4, 9, 5);

/** A host whose chosen folder holds `files`; `markdown` is the content of snippets.md. */
function hostWith(markdown, { language = "en", preferences = {}, files = {}, now = NOW } = {}) {
  const all = { ...files };
  if (markdown !== undefined) all[FILE] = markdown;
  return createFakeHost({
    folder, sources, now, files: all,
    preferences: { folder: DIR, ...preferences },
    context: { language },
  });
}

const titles = (listing) => listing.rows.map((row) => row.title);
const idOf = async (host, title) => (await host.list("snippets")).rows.find((row) => row.title === title).id;
const pasted = async (host, title) => (await host.runSource("snippets", await idOf(host, title), "paste")).text;

const SAMPLE = `Notes before the first heading are ignored.

# Replies

## Thanks
Thank you for writing in!

We will answer within a day.

## Signature
Deniz
Support team

# Dev

## PR template
\`\`\`md
## Summary
# not a group
\`\`\`

Closes #1
`;

describe("parsing", () => {
  test("groupsAndSnippets", () => {
    const found = parseSnippets(SAMPLE);
    assert.deepEqual(found.map((s) => [s.group, s.title]), [["Replies", "Thanks"], ["Replies", "Signature"], ["Dev", "PR template"]]);
    assert.equal(found[0].body, "Thank you for writing in!\n\nWe will answer within a day.");
  });

  test("snippetsWithoutAGroup", () => {
    const found = parseSnippets("## One\nfirst\n## Two\nsecond\n");
    assert.deepEqual(found.map((s) => [s.group, s.title, s.body]), [["", "One", "first"], ["", "Two", "second"]]);
  });

  test("aGroupHeadingEndsTheBodyBeforeIt", () => {
    const found = parseSnippets("## One\nfirst\n# Later\nnot part of One\n## Two\nsecond");
    assert.deepEqual(found.map((s) => [s.group, s.title, s.body]), [["", "One", "first"], ["Later", "Two", "second"]]);
  });

  test("headingsInsideCodeFencesAreText", () => {
    const [snippet, ...rest] = parseSnippets("## Code\n```ts\n## not a heading\n# nor this\n```\nafter\n~~~\n## also text\n~~~\n");
    assert.equal(rest.length, 0);
    assert.equal(snippet.body, "```ts\n## not a heading\n# nor this\n```\nafter\n~~~\n## also text\n~~~");
  });

  test("aLongerFenceIsNotClosedByAShorterOne", () => {
    const found = parseSnippets("## A\n````\n```\n## inside\n````\n## B\nb");
    assert.deepEqual(found.map((s) => s.title), ["A", "B"]);
    assert.equal(found[0].body, "````\n```\n## inside\n````");
  });

  test("blankEdgesAreTrimmedAndTheRestIsKept", () => {
    const [snippet] = parseSnippets("## A\n\n  \n  indented\n\n\ttabbed  \n\n\n");
    assert.equal(snippet.body, "  indented\n\n\ttabbed  ");
  });

  test("crlfAndCrLineEndings", () => {
    const crlf = parseSnippets("# G\r\n## A\r\nline one\r\nline two\r\n## B\r\nb\r\n");
    assert.deepEqual(crlf.map((s) => [s.group, s.title, s.body]), [["G", "A", "line one\nline two"], ["G", "B", "b"]]);
    assert.equal(parseSnippets("## A\rone\rtwo")[0].body, "one\ntwo");
  });

  test("aByteOrderMarkIsIgnored", () => {
    assert.deepEqual(parseSnippets("\uFEFF# G\n## A\na").map((s) => s.group), ["G"]);
  });

  test("turkishAndEmojiTitles", () => {
    const found = parseSnippets("# Müşteri\n## İade talebi 🙏\nMerhaba, iade için teşekkürler.\n## Çözüm ✅\nTamamdır.");
    assert.deepEqual(found.map((s) => s.title), ["İade talebi 🙏", "Çözüm ✅"]);
    assert.equal(found[0].group, "Müşteri");
  });

  test("hashesWithoutASpaceAreText", () => {
    const [snippet] = parseSnippets("## Tags\n#hashtag\n###### deep\n##notAHeading");
    assert.equal(snippet.body, "#hashtag\n###### deep\n##notAHeading");
  });

  test("emptyBodiesAndBlankTitlesAreLeftOut", () => {
    const found = parseSnippets("## Empty\n\n\n## Blank\n   \n## Real\nbody\n##  \nx\n## \u00A0\nnbsp title");
    assert.deepEqual(found.map((s) => s.title), ["Real"]);
  });

  test("duplicateTitlesGetOwnStableIds", () => {
    const first = parseSnippets("# A\n## Same\none\n## Same\ntwo\n# B\n## Same\nthree");
    assert.equal(new Set(first.map((s) => s.id)).size, 3);
    // The same ids after an unrelated snippet is added in front, or a later duplicate is removed.
    const second = parseSnippets("## New\nnew\n# A\n## Same\none\n## Same\ntwo\n# B\n## Same\nthree");
    assert.deepEqual(second.slice(1).map((s) => s.id), first.map((s) => s.id));
    assert.ok(first.every((s) => s.id.length > 0 && s.id.length <= 256));
  });

  test("anEmptyOrHeadinglessFileHasNoSnippets", () => {
    assert.deepEqual(parseSnippets(""), []);
    assert.deepEqual(parseSnippets("just some notes\nno headings"), []);
  });
});

describe("listing", () => {
  test("rowsHaveTitleAndGroupedPreview", async () => {
    const { rows } = await hostWith(SAMPLE).list("snippets");
    assert.deepEqual(rows.map(({ title, subtitle }) => [title, subtitle]), [
      ["Thanks", "Replies · Thank you for writing in!"],
      ["Signature", "Replies · Deniz"],
      ["PR template", "Dev · ## Summary"],
    ]);
  });

  test("withoutAGroupThePreviewIsTheSubtitle", async () => {
    const { rows } = await hostWith("## One\nfirst line\nsecond line").list("snippets");
    assert.deepEqual(rows, [{ id: rows[0].id, title: "One", subtitle: "first line" }]);
  });

  test("aLongFirstLineIsShortened", async () => {
    const { rows } = await hostWith(`## Long\n${"word ".repeat(60)}`).list("snippets");
    assert.ok(Array.from(rows[0].subtitle).length <= 90);
    assert.ok(rows[0].subtitle.endsWith("…"));
  });

  test("aCutNeverSplitsAnEmoji", async () => {
    const { rows } = await hostWith(`## E\n${"🙏".repeat(200)}`).list("snippets");
    assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(rows[0].subtitle.replace("…", "")));
  });

  test("duplicateTitlesAreSeparateRows", async () => {
    const host = hostWith("## Same\none\n## Same\ntwo");
    const { rows } = await host.list("snippets");
    assert.equal(rows.length, 2);
    assert.deepEqual(await host.runSource("snippets", rows[0].id, "paste"), { text: "one" });
    assert.deepEqual(await host.runSource("snippets", rows[1].id, "paste"), { text: "two" });
  });

  test("idsStayTheSameBetweenListings", async () => {
    const host = hostWith(SAMPLE);
    assert.deepEqual(await host.list("snippets"), await host.list("snippets"));
  });

  test("aCodeFenceLineIsNotThePreview", async () => {
    const { rows } = await hostWith("## Code\n```ts\nconst a = 1;\n```").list("snippets");
    assert.equal(rows[0].subtitle, "const a = 1;");
  });

  test("aFileAnotherNameIsRead", async () => {
    const host = hostWith(undefined, { preferences: { file: "team.md" }, files: { [`${DIR}/team.md`]: "## Hi\nhello" } });
    assert.deepEqual(titles(await host.list("snippets")), ["Hi"]);
  });

  test("aBlankFileNameMeansTheDefault", async () => {
    assert.deepEqual(titles(await hostWith("## Hi\nhello", { preferences: { file: "  " } }).list("snippets")), ["Hi"]);
  });

  test("aTrailingSlashOnTheFolderIsFine", async () => {
    assert.deepEqual(titles(await hostWith("## Hi\nhello", { preferences: { folder: `${DIR}/` } }).list("snippets")), ["Hi"]);
  });

  test("aBigFileIsListedQuickly", async () => {
    let markdown = "";
    for (let group = 0; group < 20; group++) {
      markdown += `# Group ${group}\n`;
      for (let index = 0; index < 250; index++) markdown += `## Snippet ${group}-${index} 🙏\nHello {date},\n\nbody line ${index}\n\n`;
    }
    const host = hostWith(markdown);
    const started = performance.now();
    const { rows } = await host.list("snippets");
    const elapsed = performance.now() - started;
    assert.equal(rows.length, 5000);
    assert.equal(new Set(rows.map((row) => row.id)).size, 5000);
    assert.ok(elapsed < 1000, `took ${elapsed} ms`);
  });
});

describe("states", () => {
  const settings = "Settings › Extensions › Snippets";

  test("noFolderChosen", async () => {
    const host = createFakeHost({ folder, sources, files: { [FILE]: "## A\na" } });
    const listing = await host.list("snippets");
    assert.deepEqual(listing, { locked: true, message: `Choose a folder in ${settings}.` });
  });

  test("aDefaultFolderAloneGrantsNothing", async () => {
    // Not chosen in Settings: the host refuses the read, and the person is told what to do.
    const host = createFakeHost({ folder, sources, files: { [FILE]: "## A\na" }, manifest: { preferences: [
      { id: "folder", type: "folder", title: "folder.title", default: DIR }, { id: "file", type: "text", title: "file.title", default: "snippets.md" }] } });
    const listing = await host.list("snippets");
    assert.equal(listing.locked, true);
    assert.match(listing.message, /There is no snippets\.md|could not be read/);
  });

  test("fileMissing", async () => {
    const listing = await hostWith(undefined).list("snippets");
    assert.equal(listing.locked, true);
    assert.equal(listing.message, `There is no snippets.md in that folder. Create it there, or pick another folder in ${settings}.`);
    assert.equal(listing.command, undefined);
  });

  test("fileEmpty", async () => {
    for (const content of ["", "\n\n", "no headings here", "## Only a title\n"]) {
      const listing = await hostWith(content).list("snippets");
      assert.deepEqual(listing, { locked: true, message: "snippets.md has no snippets yet. Start one with a line like ## Thanks." });
    }
  });

  test("theMissingFileNamesTheChosenOne", async () => {
    const listing = await hostWith(undefined, { preferences: { file: "team.md" } }).list("snippets");
    assert.match(listing.message, /There is no team\.md/);
  });

  test("aFileNameThatLeavesTheFolderIsRefused", async () => {
    for (const file of ["../secret.md", "a/b.md", "..", "."]) {
      const host = hostWith("## A\na", { preferences: { file } });
      const listing = await host.list("snippets");
      assert.equal(listing.locked, true, file);
      assert.match(listing.message, /plain name/);
    }
  });

  test("turkish", async () => {
    const host = hostWith(undefined, { language: "tr" });
    assert.equal((await host.list("snippets")).message, "Bu klasörde snippets.md yok. Orada oluştur ya da Ayarlar › Eklentiler › Snippets içinden başka bir klasör seç.");
    assert.match((await hostWith("", { language: "tr" }).list("snippets")).message, /henüz metin yok/);
    assert.match((await createFakeHost({ folder, sources, context: { language: "tr" } }).list("snippets")).message, /klasör seç/);
  });

  test("aSnippetGoneFromTheFileSaysSo", async () => {
    const host = hostWith("## A\na");
    await assert.rejects(host.runSource("snippets", "0000000000000000", "paste"), { message: "This snippet is no longer in the file." });
  });

  test("runWithoutAFolderOrFileSaysWhatToDo", async () => {
    await assert.rejects(hostWith(undefined).runSource("snippets", "x", "paste"), /There is no snippets\.md/);
    await assert.rejects(createFakeHost({ folder, sources }).runSource("snippets", "x", "paste"), /Choose a folder/);
  });

});

describe("placeholders", () => {
  const values = (language) => ({ language, now: NOW });

  test("englishDates", () => {
    assert.equal(fill("{date}", values("en")), "November 4, 2026");
    assert.match(fill("{time}", values("en")), /^9:05\s?AM$/);
    assert.equal(fill("{weekday}", values("en")), "Wednesday");
    assert.match(fill("{datetime}", values("en")), /^November 4, 2026 at 9:05\s?AM$/);
  });

  test("turkishDates", () => {
    assert.equal(fill("{date}", values("tr")), "4 Kasım 2026");
    assert.equal(fill("{time}", values("tr")), "09:05");
    assert.equal(fill("{weekday}", values("tr")), "Çarşamba");
    assert.match(fill("{datetime}", values("tr")), /^4 Kasım 2026 .*09:05$/);
  });

  test("throughTheAppsLanguage", async () => {
    const files = { [FILE]: "## When\n{weekday}, {date}" };
    const english = createFakeHost({ folder, sources, now: NOW, files, preferences: { folder: DIR }, context: { language: "en" } });
    const turkish = createFakeHost({ folder, sources, now: NOW, files, preferences: { folder: DIR }, context: { language: "tr" } });
    const [{ id }] = (await english.list("snippets")).rows;
    assert.deepEqual(await english.runSource("snippets", id, "paste"), { text: "Wednesday, November 4, 2026" });
    assert.deepEqual(await turkish.runSource("snippets", id, "paste"), { text: "Çarşamba, 4 Kasım 2026" });
  });

  test("clipboardIsNotAPlaceholder", async () => {
    assert.equal(fill("a {clipboard} b {{clipboard}}", values("en")), "a {clipboard} b {clipboard}");
    assert.equal(await pasted(hostWith("## Q\nlast: [{clipboard}]"), "Q"), "last: [{clipboard}]");
  });

  test("doubledBracesAreLiteral", () => {
    assert.equal(fill("{{date}} and {{ and }} and {{{date}}}", values("en")), "{date} and { and } and {November 4, 2026}");
    assert.equal(fill("a }} b {{ c", values("en")), "a } b { c");
  });

  test("unknownPlaceholdersStayAsTheyAre", () => {
    assert.equal(fill("{name} {Date} {date } { date} {} {datetime2} {1}", values("en")), "{name} {Date} {date } { date} {} {datetime2} {1}");
  });

  test("everyPlaceholderTwiceAndMixed", () => {
    assert.equal(fill("{date}/{date} {weekday}", values("en")), "November 4, 2026/November 4, 2026 Wednesday");
  });

  test("codeKeepsItsBracesWhenTheyAreNotPlaceholders", () => {
    assert.equal(fill("const a = { b: 1 };", values("en")), "const a = { b: 1 };");
  });

  test("theBodyIsPastedExactly", async () => {
    const host = hostWith("## Sig\n  Deniz  \n\n    Support\n\n\nEnd");
    assert.equal(await pasted(host, "Sig"), "  Deniz  \n\n    Support\n\n\nEnd");
  });
});

describe("permissions", () => {
  test("theExtensionAsksForNone", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));
    assert.equal(manifest.permissions, undefined);
  });

  test("aFileNameErrorNeverQuotesTheFileContent", async () => {
    const secret = "secret-" + "x".repeat(10);
    const host = hostWith(`## Q\n${secret}`, { preferences: { file: "../x" } });
    const listing = JSON.stringify(await host.list("snippets"));
    assert.ok(!listing.includes(secret));
    await assert.rejects(host.runSource("snippets", "x", "paste"), (error) => !String(error.message).includes(secret));
    assert.ok(!JSON.stringify(host.logs).includes(secret));
  });
});
