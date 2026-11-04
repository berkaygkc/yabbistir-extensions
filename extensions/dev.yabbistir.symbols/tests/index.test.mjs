import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { sources, allSymbols, allKaomoji, markdownEscape, entityFor, langOf } from "../src/index.ts";
import { SYMBOL_GROUPS } from "../src/symbols-data.ts";
import { KAOMOJI_GROUPS } from "../src/kaomoji-data.ts";

const folder = new URL("..", import.meta.url);
const hostIn = (language = "en") => createFakeHost({ folder, sources, context: { language } });

const countIn = (groups, id) => {
  const group = groups.find((entry) => entry.id === id);
  return group.lines.split("\n").filter((line) => line.trim() !== "").length;
};

describe("symbols list", () => {
  test("hasAboutThreeHundredRowsInTheDocumentedGroups", async () => {
    const { rows } = await hostIn().list("symbols");
    assert.ok(rows.length >= 250 && rows.length <= 350, `rows: ${rows.length}`);
    assert.deepEqual(SYMBOL_GROUPS.map((group) => group.id), [
      "mac", "arrows", "typography", "math", "currency", "marks", "greek", "scripts", "fractions", "box", "legal",
    ]);
  });

  test("groupSizes", () => {
    const sizes = Object.fromEntries(SYMBOL_GROUPS.map((group) => [group.id, countIn(SYMBOL_GROUPS, group.id)]));
    assert.deepEqual(sizes, {
      mac: 26, arrows: 28, typography: 48, math: 47, currency: 22, marks: 45, greek: 48, scripts: 25, fractions: 19, box: 18, legal: 21,
    });
  });

  test("idsAreUniqueStableAndShort", async () => {
    const first = (await hostIn().list("symbols")).rows.map((row) => row.id);
    const second = (await hostIn("tr").list("symbols")).rows.map((row) => row.id);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length);
    assert.ok(first.every((id) => /^u-[0-9A-F]{4,6}(-[0-9A-F]{4,6})*$/.test(id)));
  });

  test("everySymbolHasEnglishAndTurkishNames", () => {
    for (const entry of allSymbols()) {
      assert.ok(entry.names.en.trim() !== "", `English name of ${entry.id}`);
      assert.ok(entry.names.tr.trim() !== "", `Turkish name of ${entry.id}`);
    }
  });

  test("everyEntryIsOneSymbolAndNoneIsRepeated", () => {
    const seen = new Set();
    for (const entry of allSymbols()) {
      assert.ok(entry.codePoints.length >= 1, entry.id);
      assert.ok(!seen.has(entry.text), `repeated ${entry.id}`);
      seen.add(entry.text);
    }
  });

  test("macKeysAndCurrencyAreThere", async () => {
    const { rows } = await hostIn().list("symbols");
    const byTitle = new Map(rows.map((row) => [row.title, row]));
    assert.equal(byTitle.get("⌘").subtitle, "Command · U+2318");
    assert.equal(byTitle.get("₺").subtitle, "Turkish lira · Türk lirası · U+20BA");
    for (const key of ["⌥", "⇧", "⌃", "⏎", "⌫", "€"]) assert.ok(byTitle.has(key), key);
    assert.ok(byTitle.has("’") && byTitle.has("—") && byTitle.has("…"));
  });

  test("subtitleLeadsWithTheAppsLanguageAndCarriesTheOtherNameToo", async () => {
    const turkish = (await hostIn("tr").list("symbols")).rows;
    assert.equal(turkish.find((row) => row.title === "⌘").subtitle, "Command · U+2318");
    assert.equal(turkish.find((row) => row.title === "₺").subtitle, "Türk lirası · Turkish lira · U+20BA");
    const other = (await hostIn("de").list("symbols")).rows.find((row) => row.title === "₺");
    assert.equal(other.subtitle, "Turkish lira · Türk lirası · U+20BA");
  });

  test("invisibleCharactersAreShownByName", async () => {
    const { rows } = await hostIn().list("symbols");
    const nbsp = rows.find((row) => row.id === "u-00A0");
    assert.equal(nbsp.title, "[Non-breaking space]");
    assert.equal(nbsp.subtitle, "Non-breaking space · Bölünmeyen boşluk · U+00A0");
    assert.equal(rows.find((row) => row.id === "u-200B").title, "[Zero-width space]");
    assert.equal(rows.find((row) => row.id === "u-00AD").title, "[Soft hyphen]");
    const turkish = (await hostIn("tr").list("symbols")).rows.find((row) => row.id === "u-00A0");
    assert.equal(turkish.title, "[Bölünmeyen boşluk]");
  });

  test("noRowHasABlankTitle", async () => {
    for (const language of ["en", "tr"]) {
      for (const row of (await hostIn(language).list("symbols")).rows) assert.ok(row.title.trim() !== "", row.id);
    }
  });

  test("listingIsFast", async () => {
    const host = hostIn();
    const started = performance.now();
    for (let i = 0; i < 50; i++) await host.list("symbols");
    for (let i = 0; i < 50; i++) await host.list("kaomoji");
    assert.ok((performance.now() - started) / 100 < 50, "each listing well inside its 10 seconds");
  });
});

describe("symbols run", () => {
  test("pastesTheSymbol", async () => {
    const host = hostIn();
    assert.deepEqual(await host.runSource("symbols", "u-2318", "paste"), { text: "⌘" });
    assert.deepEqual(await host.runSource("symbols", "u-20BA", "paste"), { text: "₺" });
    assert.deepEqual(await host.runSource("symbols", "u-200B", "paste"), { text: "\u200b" });
    assert.deepEqual(await host.runSource("symbols", "u-1F310", "paste"), { text: "\u{1F310}" });
  });

  test("entityFormsUseNamesWhereTheStandardHasThem", async () => {
    const host = hostIn();
    const entity = (id) => host.runSource("symbols", id, "entity");
    assert.deepEqual(await entity("u-00A9"), { text: "&copy;" });
    assert.deepEqual(await entity("u-2014"), { text: "&mdash;" });
    assert.deepEqual(await entity("u-20AC"), { text: "&euro;" });
    assert.deepEqual(await entity("u-00A0"), { text: "&nbsp;" });
    assert.deepEqual(await entity("u-03B1"), { text: "&alpha;" });
    assert.deepEqual(await entity("u-03A9"), { text: "&Omega;" });
    assert.deepEqual(await entity("u-03C2"), { text: "&sigmaf;" });
    assert.deepEqual(await entity("u-0026"), { text: "&amp;" });
  });

  test("entityFormsFallBackToHexReferences", async () => {
    const host = hostIn();
    assert.deepEqual(await host.runSource("symbols", "u-2318", "entity"), { text: "&#x2318;" });
    assert.deepEqual(await host.runSource("symbols", "u-20BA", "entity"), { text: "&#x20BA;" });
    assert.deepEqual(await host.runSource("symbols", "u-1F310", "entity"), { text: "&#x1F310;" });
    assert.equal(entityFor("A\u0301"), "&#x41;&#x301;");
  });

  test("everySymbolHasAWellFormedEntity", () => {
    for (const entry of allSymbols()) {
      assert.match(entityFor(entry.text), /^(&[A-Za-z][A-Za-z0-9]*;|&#x[0-9A-F]+;)+$/, entry.id);
    }
  });

  test("greekLettersAreTheRealGreekBlock", () => {
    const greek = allSymbols().filter((entry) => entry.group === "greek");
    assert.ok(greek.every((entry) => entry.codePoints[0] >= 0x391 && entry.codePoints[0] <= 0x3c9), "no look-alike letters");
  });

  test("aSpaceCannotBePastedButItsEntityCan", async () => {
    const host = hostIn();
    for (const id of ["u-00A0", "u-2002", "u-2003", "u-2009", "u-202F"]) {
      await assert.rejects(host.runSource("symbols", id, "paste"), { message: "A space can’t be pasted from a column. Press ⇧↵ for its HTML form." });
      assert.ok((await host.runSource("symbols", id, "entity")).text.startsWith("&"));
    }
    await assert.rejects(hostIn("tr").runSource("symbols", "u-00A0", "paste"), { message: "Boşluk bir sütundan yapıştırılamaz. HTML karşılığı için ⇧↵ bas." });
  });

  test("anUnknownRowSaysSo", async () => {
    await assert.rejects(hostIn().runSource("symbols", "u-FFFF", "paste"), { message: "This symbol is no longer in the list." });
    await assert.rejects(hostIn("tr").runSource("symbols", "nope", "entity"), { message: "Bu sembol artık listede yok." });
  });
});

describe("kaomoji", () => {
  test("hasAboutOneAndAHalfHundredRowsInTwelveGroups", async () => {
    const { rows } = await hostIn().list("kaomoji");
    assert.ok(rows.length >= 140 && rows.length <= 180, `rows: ${rows.length}`);
    assert.deepEqual(KAOMOJI_GROUPS.map((group) => group.id), [
      "happy", "love", "sad", "angry", "surprised", "shrug", "tableflip", "bear", "cat", "music", "sleepy", "greeting",
    ]);
    for (const group of KAOMOJI_GROUPS) assert.ok(countIn(KAOMOJI_GROUPS, group.id) >= 10, group.id);
  });

  test("idsAreUniqueAndStable", async () => {
    const first = (await hostIn().list("kaomoji")).rows.map((row) => row.id);
    assert.deepEqual(first, (await hostIn("tr").list("kaomoji")).rows.map((row) => row.id));
    assert.equal(new Set(first).size, first.length);
    assert.equal(first[0], "happy-1");
  });

  test("everyKaomojiHasWordsInBothLanguagesAndIsUnique", () => {
    const seen = new Set();
    for (const entry of allKaomoji()) {
      assert.ok(entry.words.en.trim() !== "" && entry.words.tr.trim() !== "", entry.id);
      assert.ok(entry.text.trim() !== "" && !entry.text.includes("\n"), entry.id);
      assert.ok(!seen.has(entry.text), `repeated ${entry.text}`);
      seen.add(entry.text);
    }
  });

  test("subtitleHasTheGroupAndWordsInTheAppsLanguage", async () => {
    const english = (await hostIn().list("kaomoji")).rows.find((row) => row.title === "¯\\_(ツ)_/¯");
    assert.equal(english.subtitle, "Shrug · shrug, whatever, idk · omuz silkme, her neyse, bilmem");
    const turkish = (await hostIn("tr").list("kaomoji")).rows.find((row) => row.title === "¯\\_(ツ)_/¯");
    assert.equal(turkish.subtitle, "Omuz silkme · omuz silkme, her neyse, bilmem · shrug, whatever, idk");
  });

  test("pastesTheKaomojiAsItIs", async () => {
    const host = hostIn();
    const shrug = (await host.list("kaomoji")).rows.find((row) => row.title === "¯\\_(ツ)_/¯");
    assert.deepEqual(await host.runSource("kaomoji", shrug.id, "paste"), { text: "¯\\_(ツ)_/¯" });
  });

  test("markdownFormKeepsBackslashesAndUnderscores", async () => {
    const host = hostIn();
    const shrug = (await host.list("kaomoji")).rows.find((row) => row.title === "¯\\_(ツ)_/¯");
    assert.deepEqual(await host.runSource("kaomoji", shrug.id, "markdown"), { text: "¯\\\\\\_(ツ)\\_/¯" });
    assert.equal(markdownEscape("a*b`c_d\\e"), "a\\*b\\`c\\_d\\\\e");
    assert.equal(markdownEscape("(＾▽＾)"), "(＾▽＾)");
  });

  test("markdownFormEscapesTildesSoTheyCannotStrikeThrough", () => {
    assert.equal(markdownEscape("(^_^)ﾉ~~ and ~~"), "(^\\_^)ﾉ\\~\\~ and \\~\\~");
    const wave = allKaomoji().find((entry) => entry.text.includes("ﾉ~~"));
    assert.ok(wave && !markdownEscape(wave.text).includes("~~"));
  });

  test("kaomojiIdsArePinned", () => {
    const byId = new Map(allKaomoji().map((entry) => [entry.id, entry.text]));
    assert.equal(byId.get("shrug-1"), "¯\\_(ツ)_/¯");
    assert.equal(byId.get("happy-1"), allKaomoji().find((entry) => entry.group === "happy").text);
    assert.equal(allKaomoji().filter((entry) => entry.group === "shrug")[0].id, "shrug-1");
  });

  test("namedEntitiesMatchTheHtmlStandard", () => {
    // Checked once against the standard's entities.json (all 179 table entries and the Greek letters agree);
    // these pin the ones people paste most, so an edit of the table cannot slip by.
    const expected = { 0xa9: "&copy;", 0xae: "&reg;", 0x2122: "&trade;", 0x2026: "&hellip;", 0xa0: "&nbsp;", 0x3b5: "&epsilon;", 0x3c6: "&phi;", 0x3c2: "&sigmaf;", 0x20ac: "&euro;", 0x2190: "&larr;" };
    for (const [point, entity] of Object.entries(expected)) assert.equal(entityFor(String.fromCodePoint(Number(point))), entity);
    assert.equal(entityFor("₺"), "&#x20BA;");
  });

  test("markdownFormOfEveryKaomojiOnlyAddsBackslashes", () => {
    for (const entry of allKaomoji()) {
      const escaped = markdownEscape(entry.text);
      assert.equal(escaped.replace(/\\([\\_*`~])/g, "$1"), entry.text, entry.id);
    }
  });

  test("anUnknownRowSaysSo", async () => {
    await assert.rejects(hostIn().runSource("kaomoji", "happy-99", "paste"), { message: "This kaomoji is no longer in the list." });
    await assert.rejects(hostIn("tr").runSource("kaomoji", "x", "markdown"), { message: "Bu kaomoji artık listede yok." });
  });
});

describe("the extension", () => {
  test("languageIsTurkishOnlyForTurkish", () => {
    assert.equal(langOf("tr"), "tr");
    assert.equal(langOf("tr-TR"), "tr");
    assert.equal(langOf("en"), "en");
    assert.equal(langOf("fr"), "en");
  });

  test("keepsNothingAndLogsNothing", async () => {
    const host = hostIn();
    await host.list("symbols");
    await host.list("kaomoji");
    await host.runSource("symbols", "u-2318", "paste");
    await host.runSource("kaomoji", "happy-1", "markdown");
    assert.deepEqual(host.logs, []);
  });

  test("everyLocaleKeyHasATurkishVersion", () => {
    const en = JSON.parse(readFileSync(new URL("locales/en.json", folder), "utf8"));
    const tr = JSON.parse(readFileSync(new URL("locales/tr.json", folder), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  });
});
