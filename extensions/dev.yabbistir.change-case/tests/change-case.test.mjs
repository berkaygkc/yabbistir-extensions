import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, convert, variants } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const item = (text, kind = "text") => ({ id: 1, kind, text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const hostFor = (options = {}) => createFakeHost({ folder, ...options });
const host = hostFor();
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

/** What picking `variant` pastes. */
async function pick(text, variant, options) {
  const result = await (options ? hostFor(options) : host).run(actions.changeCase, item(text), { variant });
  return result.text;
}

describe("identifier cases", () => {
  const cases = {
    camel: "httpServerError",
    pascal: "HttpServerError",
    snake: "http_server_error",
    constant: "HTTP_SERVER_ERROR",
    kebab: "http-server-error",
    dot: "http.server.error",
    slug: "http-server-error",
  };
  for (const [variant, expected] of Object.entries(cases)) {
    test(`${variant}FromAnAcronymIdentifier`, async () => {
      assert.equal(await pick("HTTPServerError", variant), expected);
    });
  }

  test("everyVariantReadsEverySeparator", async () => {
    for (const source of ["hello world", "hello_world", "hello-world", "hello.world", "helloWorld", "HelloWorld", "HELLO_WORLD", "  hello -- world  "]) {
      assert.equal((await pick(source, "snake")).trim(), "hello_world", source);
      assert.equal((await pick(source, "kebab")).trim(), "hello-world", source);
      assert.equal((await pick(source, "camel")).trim(), "helloWorld", source);
    }
  });

  test("punctuationSeparatesWords", async () => {
    assert.equal(await pick("foo, bar; baz/qux (quux)", "snake"), "foo_bar_baz_qux_quux");
  });

  test("digitsStayWithTheirLetters", async () => {
    assert.equal(await pick("base64Encode", "snake"), "base64_encode");
    assert.equal(await pick("HTTP2Server", "kebab"), "http2-server");
    assert.equal(await pick("version 2 beta", "camel"), "version2Beta");
    assert.equal(await pick("item10", "constant"), "ITEM10");
    assert.equal(await pick("3d model", "pascal"), "3dModel");
    assert.equal(await pick("v2Beta", "snake"), "v2_beta");
  });

  test("anApostropheInsideAWordIsDropped", async () => {
    assert.equal(await pick("don't stop", "snake"), "dont_stop");
    assert.equal(await pick("it’s here", "kebab"), "its-here");
  });

  test("leadingAndTrailingSeparatorsAreIgnored", async () => {
    assert.equal(await pick("__private_name__", "camel"), "privateName");
    assert.equal(await pick("--flag-name", "pascal"), "FlagName");
  });

  test("aLineWithoutWordsIsLeftAlone", async () => {
    assert.equal(await pick("---", "snake"), "---");
    assert.equal(await pick("a\n***\nb c", "snake"), "a\n***\nb_c");
  });

  test("keepsAccentedLetters", async () => {
    assert.equal(await pick("çalışma dosyası", "camel", { context: { language: "en" } }), "çalışmaDosyası");
  });
});

describe("text cases", () => {
  test("upperAndLower", async () => {
    assert.equal(await pick("Hello, World! 42", "upper"), "HELLO, WORLD! 42");
    assert.equal(await pick("Hello, World! 42", "lower"), "hello, world! 42");
  });

  test("titleCaseEnglishKeepsShortWordsSmall", async () => {
    assert.equal(await pick("the lord of the rings and a tale in the dark", "title"), "The Lord of the Rings and a Tale in the Dark");
    assert.equal(await pick("TO BE OR NOT TO BE", "title"), "To Be or Not to Be");
    assert.equal(await pick("of mice and men", "title"), "Of Mice and Men");
  });

  test("titleCaseAfterAColonStartsAgain", async () => {
    assert.equal(await pick("part one: the beginning", "title"), "Part One: The Beginning");
  });

  test("titleCaseTurkish", async () => {
    const options = { context: { language: "tr" } };
    assert.equal(await pick("istanbul ve ankara ile izmir veya bursa", "title", options), "İstanbul ve Ankara ile İzmir veya Bursa");
    assert.equal(await pick("ve başlangıç", "title", options), "Ve Başlangıç");
    assert.equal(await pick("ışık ve ılık gece", "title", options), "Işık ve Ilık Gece");
  });

  test("titleCaseKeepsPunctuationAndSpacing", async () => {
    assert.equal(await pick("well-known, hello  world!", "title"), "Well-Known, Hello  World!");
    assert.equal(await pick("don't stop", "title"), "Don't Stop");
  });

  test("aSingleIdentifierIsSplitForTitleAndSentence", async () => {
    assert.equal(await pick("helloWorld", "title"), "Hello World");
    assert.equal(await pick("my_var-name", "title"), "My Var Name");
    assert.equal(await pick("helloWorldAgain", "sentence"), "Hello world again");
    assert.equal(await pick("state-of-the-art", "title"), "State of the Art");
  });

  test("sentenceCase", async () => {
    assert.equal(await pick("HELLO WORLD. THIS IS FINE! really? yes", "sentence"), "Hello world. This is fine! Really? Yes");
    assert.equal(await pick("version 3.14 is out", "sentence"), "Version 3.14 is out");
    assert.equal(await pick("e.g. this one", "sentence"), "E.g. this one");
  });

  test("sentenceCaseFixesTheEnglishPronoun", async () => {
    assert.equal(await pick("THINK I KNOW. i'm sure i can", "sentence"), "Think I know. I'm sure I can");
    const turkish = await pick("i̇ç i", "sentence", { preferences: { casing: "tr" } });
    assert.equal(turkish.endsWith(" i"), true);
  });
});

describe("Turkish casing rules", () => {
  test("upperCaseMapsDottedAndDotlessI", async () => {
    assert.equal(await pick("istanbul", "upper", { context: { language: "tr" } }), "İSTANBUL");
    assert.equal(await pick("ışık", "upper", { context: { language: "tr" } }), "IŞIK");
    assert.equal(await pick("istanbul", "upper", { context: { language: "en" } }), "ISTANBUL");
  });

  test("lowerCaseMapsDottedAndDotlessI", async () => {
    assert.equal(await pick("IŞIK", "lower", { context: { language: "tr" } }), "ışık");
    assert.equal(await pick("İSTANBUL", "lower", { context: { language: "tr" } }), "istanbul");
    assert.equal(await pick("IŞIK", "lower", { context: { language: "en" } }), "işik");
    // English rules never leave a loose combining dot behind.
    assert.equal(await pick("İSTANBUL", "lower", { context: { language: "en" } }), "istanbul");
  });

  test("autoFollowsTheAppsLanguage", async () => {
    assert.equal(await pick("istanbul", "upper", { context: { language: "tr-TR" } }), "İSTANBUL");
    assert.equal(await pick("istanbul", "upper", { context: { language: "de" } }), "ISTANBUL");
  });

  test("thePreferenceOverridesTheLanguage", async () => {
    assert.equal(await pick("istanbul", "upper", { context: { language: "en" }, preferences: { casing: "tr" } }), "İSTANBUL");
    assert.equal(await pick("istanbul", "upper", { context: { language: "tr" }, preferences: { casing: "en" } }), "ISTANBUL");
    assert.equal(await pick("istanbul", "upper", { context: { language: "tr" }, preferences: { casing: "auto" } }), "İSTANBUL");
    assert.equal(await pick("istanbul", "upper", { context: { language: "tr" }, preferences: { casing: "klingon" } }), "İSTANBUL");
  });

  test("identifierCasesFollowTheRulesToo", async () => {
    const tr = { context: { language: "tr" } };
    assert.equal(await pick("istanbul şehri", "constant", tr), "İSTANBUL_ŞEHRİ");
    assert.equal(await pick("istanbul şehri", "pascal", tr), "İstanbulŞehri");
    assert.equal(await pick("IŞIK ilk", "camel", tr), "ışıkİlk");
    assert.equal(await pick("istanbul", "pascal", { context: { language: "en" } }), "Istanbul");
  });

  test("theManifestDeclaresTheChoice", () => {
    const preference = manifest.preferences.find((entry) => entry.id === "casing");
    assert.equal(preference.type, "choice");
    assert.equal(preference.default, "auto");
    assert.deepEqual(preference.options.map((option) => option.id), ["auto", "tr", "en"]);
  });
});

describe("slug", () => {
  test("transliteratesTurkishLetters", async () => {
    assert.equal(await pick("Çalışma Dosyası: Öğrenci Şükrü İstanbul", "slug", { context: { language: "tr" } }), "calisma-dosyasi-ogrenci-sukru-istanbul");
    assert.equal(await pick("Çalışma Dosyası: Öğrenci Şükrü İstanbul", "slug", { context: { language: "en" } }), "calisma-dosyasi-ogrenci-sukru-istanbul");
    assert.equal(await pick("IŞIK ğüş", "slug", { context: { language: "tr" } }), "isik-gus");
    assert.equal(await pick("IŞIK", "slug", { context: { language: "en" } }), "isik");
  });

  test("transliteratesOtherDiacritics", async () => {
    assert.equal(await pick("Crème Brûlée à la façon de Zoë Müller", "slug"), "creme-brulee-a-la-facon-de-zoe-muller");
    assert.equal(await pick("Straße Œuvre Ærø Łódź", "slug"), "strasse-oeuvre-aero-lodz");
    assert.equal(await pick("école", "slug"), "ecole");
  });

  test("collapsesSeparators", async () => {
    assert.equal(await pick("  Hello   --  World__!!  ", "slug"), "  hello-world  ");
    assert.equal(await pick("a---b___c...d", "slug"), "a-b-c-d");
  });

  test("keepsOnlyUrlSafeCharacters", async () => {
    assert.equal(await pick("Hello 世界 👍 World", "slug"), "hello-world");
    assert.equal(await pick("100% sure & 50/50", "slug"), "100-sure-50-50");
  });

  test("nothingUrlSafeSaysSo", async () => {
    assert.deepEqual(await host.run(actions.changeCase, item("世界 👍"), { variant: "slug" }), {
      none: true,
      message: "Nothing in this text can go into a slug.",
    });
    assert.deepEqual(await host.run(actions.changeCase, item("---"), { variant: "slug" }), {
      none: true,
      message: "Nothing in this text can go into a slug.",
    });
    const turkish = hostFor({ context: { language: "tr" } });
    assert.equal((await turkish.run(actions.changeCase, item("世界"), { variant: "slug" })).message, "Bu metinden bir slug çıkmıyor.");
  });

  test("eachLineIsItsOwnSlug", async () => {
    assert.equal(await pick("First Post\nİkinci Yazı", "slug"), "first-post\nikinci-yazi");
  });
});

describe("emoji and CJK", () => {
  test("passThroughTheTextCases", async () => {
    assert.equal(await pick("hello 👍 world 世界", "upper"), "HELLO 👍 WORLD 世界");
    assert.equal(await pick("世界 hello", "title"), "世界 Hello");
    assert.equal(await pick("日本語", "sentence"), "日本語");
  });

  test("stayInsideIdentifiers", async () => {
    assert.equal(await pick("世界 hello world", "snake"), "世界_hello_world");
    assert.equal(await pick("party 🎉 time", "kebab"), "party-🎉-time");
    assert.equal(await pick("👍", "camel"), "👍");
    assert.equal(await pick("👨‍👩‍👧 family", "snake"), "👨‍👩‍👧_family");
  });
});

describe("lines", () => {
  test("everyLineOnItsOwnWithBreaksKept", async () => {
    assert.equal(await pick("helloWorld\nfoo-bar\r\nBaz Qux\rlast one", "snake"), "hello_world\nfoo_bar\r\nbaz_qux\rlast_one");
  });

  test("edgeWhitespaceOfEachLineIsKept", async () => {
    assert.equal(await pick("  hello world  \n\tfoo bar\t\n\n   \nend ", "snake"), "  hello_world  \n\tfoo_bar\t\n\n   \nend ");
    assert.equal(await pick("  hello world  ", "upper"), "  HELLO WORLD  ");
    assert.equal(await pick("  the end  ", "title"), "  The End  ");
  });

  test("sentenceCaseStartsEveryLine", async () => {
    assert.equal(await pick("FIRST LINE\nsecond LINE", "sentence"), "First line\nSecond line");
  });

  test("titleCaseStartsEveryLine", async () => {
    assert.equal(await pick("a tale\nthe end", "title"), "A Tale\nThe End");
  });
});

describe("empty input", () => {
  test("emptyAndWhitespaceOnlyReturnNone", async () => {
    for (const text of ["", " ", " \n\t\r\n ", " "]) {
      for (const variant of variants) {
        assert.deepEqual(await host.run(actions.changeCase, item(text), { variant }), { none: true, message: "There’s no text to change." });
      }
    }
    assert.deepEqual(await host.run(actions.changeCase, { id: 1, kind: "text", tags: [], copiedAt: "2026-01-01T00:00:00Z" }, { variant: "camel" }), {
      none: true,
      message: "There’s no text to change.",
    });
  });

  test("theMessageIsTurkishInTurkish", async () => {
    const turkish = hostFor({ context: { language: "tr" } });
    assert.equal((await turkish.run(actions.changeCase, item(" "), { variant: "camel" })).message, "Değiştirilecek metin yok.");
  });
});

describe("hints", () => {
  test("theHintIsWhatIsPasted", async () => {
    const samples = ["HTTPServerError", "the lord of the rings. i am\n  second_line  ", "İstanbul ve IŞIK çalışma", "hello 👍 世界", "  padded text  "];
    for (const options of [{}, { context: { language: "tr" } }, { preferences: { casing: "tr" } }]) {
      const withOptions = hostFor(options);
      for (const sample of samples) {
        for (const variant of variants) {
          const hinted = await withOptions.hint(actions.changeCase, item(sample), { variant });
          const pasted = await withOptions.run(actions.changeCase, item(sample), { variant });
          assert.deepEqual(hinted, pasted, `${variant}: ${sample}`);
        }
      }
    }
  });

  test("theActionAsksForAHint", () => {
    const action = manifest.contributes.actions.find((entry) => entry.id === "changeCase");
    assert.equal(action.hint, true);
    assert.deepEqual(action.variants.map((variant) => variant.id), [...variants]);
  });

  test("anUnknownOrMissingVariantFallsBackToTitleCase", async () => {
    assert.deepEqual(await host.run(actions.changeCase, item("hello world"), {}), { text: "Hello World" });
    assert.deepEqual(await host.run(actions.changeCase, item("hello world"), { variant: "nope" }), { text: "Hello World" });
  });
});

describe("offering", () => {
  test("isOfferedOnTextAndCodeOnly", () => {
    assert.deepEqual(host.offers({ kind: "text", text: "hello" }), ["changeCase"]);
    assert.deepEqual(host.offers({ kind: "code", text: "let fooBar = 1" }), ["changeCase"]);
    assert.deepEqual(host.offers({ kind: "link", url: "https://example.com" }), []);
  });

  test("codeItemsAreConverted", async () => {
    const result = await host.run(actions.changeCase, item("const myValue = 1", "code"), { variant: "constant" });
    assert.deepEqual(result, { text: "CONST_MY_VALUE_1" });
  });

  test("needsNoPermissionAndMakesNoCalls", async () => {
    assert.deepEqual(manifest.permissions ?? [], []);
    const quiet = hostFor();
    await quiet.run(actions.changeCase, item("hello world"), { variant: "camel" });
    assert.deepEqual(quiet.calls.filter((call) => ["exec", "http.fetch", "ai.generate", "translate"].includes(call.api)), []);
  });
});

describe("limits", () => {
  const long = (unit, count) => unit.repeat(count);
  const adversarial = [
    long("a", 60000),
    long("aB", 30000),
    long("A", 60000),
    long("AAAAAAAAAa", 6000),
    long(" ", 60000) + "x" + long(" ", 60000),
    long("a_", 30000),
    long("a1", 30000),
    long("é", 60000),
    long("😀 ", 20000),
    long("it's ", 12000),
    long("word. Sentence! ", 4000),
    long("x\n", 30000),
  ];

  test("longInputsFitTheTimeLimit", () => {
    for (const text of adversarial) {
      for (const variant of variants) {
        const started = performance.now();
        const result = convert(text, variant, "tr");
        const elapsed = performance.now() - started;
        assert.equal(typeof result, "string");
        assert.ok(elapsed < 400, `${variant} took ${Math.round(elapsed)} ms on ${text.slice(0, 12)}…`);
      }
    }
  });

  test("timeGrowsLinearly", () => {
    for (const variant of ["camel", "title", "slug"]) {
      const time = (count) => {
        const started = performance.now();
        convert("fooBar baz_qux ".repeat(count), variant, "en");
        return performance.now() - started;
      };
      time(1000);
      const small = Math.max(time(5000), 1);
      const large = time(40000);
      assert.ok(large < small * 40, `${variant}: ${small} ms then ${large} ms`);
    }
  });
});

describe("privacy", () => {
  test("theTextNeverReachesALogOrAMessage", async () => {
    const secret = "gh" + "p_" + "a".repeat(36);
    const quiet = hostFor();
    const result = await quiet.run(actions.changeCase, item(secret), { variant: "snake" });
    assert.equal(result.text, "ghp_" + "a".repeat(36));
    assert.deepEqual(quiet.logs, []);
    const empty = await quiet.run(actions.changeCase, item(" "), { variant: "snake" });
    assert.equal(empty.message.includes("ghp"), false);
    const noSlug = await quiet.run(actions.changeCase, item("世" + secret.replace(/[a-z0-9_]/g, "")), { variant: "slug" });
    assert.equal(JSON.stringify(noSlug).includes("ghp"), false);
  });
});
