import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { hexDecode, hexEncode, htmlDecode, htmlEncode, rot13, unicodeEscape, unicodeUnescape, urlDecode, urlEncode } from "../src/codecs.ts";
import { namedEntities } from "../src/entities.ts";
import { punycodeDecode, punycodeEncode, domainToAscii, domainToUnicode } from "../src/punycode.ts";
import { decodeUtf8, utf8Bytes, wellFormed } from "../src/utf8.ts";

const adversarial = (unit, times = 50_000) => unit.repeat(times);
const timed = (fn) => {
  const started = Date.now();
  fn();
  return Date.now() - started;
};

describe("utf8", () => {
  test("decodesWhatItEncodes", () => {
    const text = "İstanbul çay ☕ 😀 ğüşiöç";
    assert.equal(decodeUtf8(utf8Bytes(text)), text);
  });
  test("refusesBadBytes", () => {
    for (const bad of [[0xff], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0x80]]) {
      assert.equal(decodeUtf8(bad), null, bad.join(","));
    }
  });
  test("loneSurrogatesBecomeTheReplacementCharacter", () => {
    assert.equal(wellFormed("a\ud800b\udc00c"), "a�b�c");
    assert.equal(wellFormed("😀"), "😀");
  });
});

describe("url", () => {
  test("encodesAComponent", () => {
    assert.equal(urlEncode("a b&c=d/é"), "a%20b%26c%3Dd%2F%C3%A9");
    assert.equal(urlEncode("Şişli 😀"), "%C5%9Ei%C5%9Fli%20%F0%9F%98%80");
  });
  test("aLoneSurrogateDoesNotThrow", () => {
    assert.equal(urlEncode("a\ud800"), "a%EF%BF%BD");
  });
  test("decodes", () => {
    assert.equal(urlDecode("a%20b%26c%3Dd%2F%C3%A9"), "a b&c=d/é");
    assert.equal(urlDecode("%C5%9Ei%C5%9Fli%20%F0%9F%98%80"), "Şişli 😀");
    assert.equal(urlDecode("https://example.com/search?q=caf%C3%A9+au+lait"), "https://example.com/search?q=café+au+lait");
  });
  test("roundTrips", () => {
    const text = "Ünïcödé ✓ / ? # & = + % 😀 \n tab\t";
    assert.equal(urlDecode(urlEncode(text)), text);
  });
  test("malformedSequencesStayAsWritten", () => {
    assert.equal(urlDecode("100%25 sure, 50% off %2"), "100% sure, 50% off %2");
    assert.equal(urlDecode("%FF%41"), "%FFA");
    assert.equal(urlDecode("%E2%82"), "%E2%82");
    assert.equal(urlDecode("%zz"), "%zz");
    assert.equal(urlDecode("%41%E2%82%AC%FF"), "A€%FF");
  });
  test("plusIsNotASpace", () => {
    assert.equal(urlDecode("a+b%20c"), "a+b c");
  });
  test("isLinear", () => {
    assert.ok(timed(() => urlDecode(adversarial("%C3%A9%"))) < 1500);
    assert.ok(timed(() => urlEncode(adversarial("é "))) < 1500);
  });
});

describe("html", () => {
  test("encodesTheFiveAndNonAscii", () => {
    assert.equal(htmlEncode(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
    assert.equal(htmlEncode("café Şişli 😀"), "caf&#233; &#350;i&#351;li &#128512;");
  });
  test("decodesNamedAndNumeric", () => {
    assert.equal(htmlDecode("&lt;p&gt;Tom &amp; Jerry&#39;s &quot;show&quot; &apos;x&apos;&lt;/p&gt;"), `<p>Tom & Jerry's "show" 'x'</p>`);
    assert.equal(htmlDecode("caf&eacute; &copy; &euro; &hellip; &mdash; &nbsp;|"), "café © € … —  |");
    assert.equal(htmlDecode("&#233; &#xE9; &#XE9; &#128512; &#x1F600;"), "é é é 😀 😀");
    assert.equal(htmlDecode("&alpha;&Omega;&sigmaf;&Sigma;&Rho;"), "αΩςΣΡ");
  });
  test("theTableIsComplete", () => {
    assert.equal(namedEntities.get("nbsp"), 0xa0);
    assert.equal(namedEntities.get("yuml"), 0xff);
    assert.equal(namedEntities.get("divide"), 0xf7);
    assert.equal(namedEntities.get("Agrave"), 0xc0);
    assert.equal(namedEntities.get("thorn"), 0xfe);
    assert.equal(namedEntities.get("Omega"), 0x3a9);
    assert.equal(namedEntities.get("omega"), 0x3c9);
    assert.equal(namedEntities.get("Sigma"), 0x3a3);
    assert.equal(namedEntities.get("sigma"), 0x3c3);
    assert.equal(namedEntities.get("pi"), 0x3c0);
    assert.ok(namedEntities.size >= 250);
  });
  test("windows1252NumbersMeanTheirCharacters", () => {
    assert.equal(htmlDecode("a&#150;b &#128;"), "a–b €");
  });
  test("unknownAndBrokenReferencesStayAsWritten", () => {
    assert.equal(htmlDecode("&nosuchthing; &#0; &#1114112; &#xD800; &amp &#; &;"), "&nosuchthing; &#0; &#1114112; &#xD800; &amp &#; &;");
  });
  test("decodesOnlyOnce", () => {
    assert.equal(htmlDecode("&amp;lt;"), "&lt;");
  });
  test("roundTrips", () => {
    const text = `<div class="a">Şişli’de "çay" & 'kahve' ☕ 😀</div>`;
    assert.equal(htmlDecode(htmlEncode(text)), text);
  });
  test("isLinear", () => {
    assert.ok(timed(() => htmlDecode(adversarial("&aaaaaaaaaaaa"))) < 1500);
    assert.ok(timed(() => htmlDecode(adversarial("&#1234567890", 30_000))) < 1500);
    assert.ok(timed(() => htmlEncode(adversarial("é<&"))) < 1500);
  });
});

describe("unicode escapes", () => {
  test("escapesNonAsciiWithSurrogatePairs", () => {
    assert.equal(unicodeEscape("Şişli"), "\\u015ei\\u015fli");
    assert.equal(unicodeEscape("a😀\n"), "a\\ud83d\\ude00\n");
    assert.equal(unicodeEscape("plain ASCII <>"), "plain ASCII <>");
  });
  test("unescapesAllThreeForms", () => {
    assert.equal(unicodeUnescape("\\u015ei\\u015fli"), "Şişli");
    assert.equal(unicodeUnescape("\\ud83d\\ude00"), "😀");
    assert.equal(unicodeUnescape("\\u{1F600} \\u{e9} \\u{0041}"), "😀 é A");
    assert.equal(unicodeUnescape("caf\\xe9 \\x41"), "café A");
    assert.equal(unicodeUnescape("\\u00E9\\u00e9"), "éé");
  });
  test("roundTrips", () => {
    const text = "İstanbul çay ☕ 😀 ğüşiöç\ttab";
    assert.equal(unicodeUnescape(unicodeEscape(text)), text);
  });
  test("anEscapedBackslashIsNotDecoded", () => {
    assert.equal(unicodeUnescape("\\\\u0041 \\u0041"), "\\\\u0041 A");
  });
  test("malformedEscapesStayAsWritten", () => {
    for (const bad of ["\\u12", "\\u12G4", "\\uZZZZ", "\\u{}", "\\u{110000}", "\\u{12", "\\x4", "\\xZZ", "\\ud800", "\\udc00", "\\u{d800}", "trailing\\"]) {
      assert.equal(unicodeUnescape(bad), bad, bad);
    }
  });
  test("aLoneSurrogateEscapeStaysButItsNeighboursAreDecoded", () => {
    assert.equal(unicodeUnescape("\\ud800\\u0041"), "\\ud800A");
  });
  test("isLinear", () => {
    assert.ok(timed(() => unicodeUnescape(adversarial("\\u12"))) < 1500);
    assert.ok(timed(() => unicodeUnescape(adversarial("\\ud83d\\u"))) < 1500);
    assert.ok(timed(() => unicodeUnescape(adversarial("\\u{1", 30_000))) < 1500);
    assert.ok(timed(() => unicodeEscape(adversarial("é😀"))) < 1500);
  });
});

describe("hex", () => {
  test("encodesUtf8Bytes", () => {
    assert.equal(hexEncode("abc"), "616263");
    assert.equal(hexEncode("Şi😀"), "c59e69f09f9880");
    assert.equal(hexEncode(""), "");
  });
  test("decodes", () => {
    assert.deepEqual(hexDecode("616263"), { ok: true, text: "abc" });
    assert.deepEqual(hexDecode("c5 9e 69:f0:9f:98:80"), { ok: true, text: "Şi😀" });
    assert.deepEqual(hexDecode("0x48656C6C6F"), { ok: true, text: "Hello" });
    assert.deepEqual(hexDecode("48 65\n6c 6c 6f"), { ok: true, text: "Hello" });
  });
  test("roundTrips", () => {
    const text = "İstanbul çay ☕ 😀\n";
    assert.deepEqual(hexDecode(hexEncode(text)), { ok: true, text });
  });
  test("refusesBadInput", () => {
    assert.deepEqual(hexDecode("abc"), { ok: false, reason: "invalid" });
    assert.deepEqual(hexDecode("zz"), { ok: false, reason: "invalid" });
    assert.deepEqual(hexDecode(""), { ok: false, reason: "invalid" });
    assert.deepEqual(hexDecode("0x"), { ok: false, reason: "invalid" });
    assert.deepEqual(hexDecode("ff"), { ok: false, reason: "notText" });
    assert.deepEqual(hexDecode("c080"), { ok: false, reason: "notText" });
  });
  test("isLinear", () => {
    assert.ok(timed(() => hexDecode(adversarial("4a ", 100_000))) < 1500);
    assert.ok(timed(() => hexEncode(adversarial("é😀"))) < 1500);
  });
});

describe("rot13", () => {
  test("rotatesLettersOnly", () => {
    assert.equal(rot13("Hello, World! 123 çay"), "Uryyb, Jbeyq! 123 çnl");
  });
  test("isItsOwnInverse", () => {
    const text = "The Quick Brown Fox ÇŞĞ 😀";
    assert.equal(rot13(rot13(text)), text);
    assert.equal(rot13("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"), "nopqrstuvwxyzabcdefghijklmNOPQRSTUVWXYZABCDEFGHIJKLM");
  });
});

// RFC 3492, section 7.1 sample strings.
const samples = [
  ["Arabic (Egyptian)", [0x644, 0x64a, 0x647, 0x645, 0x627, 0x628, 0x62a, 0x643, 0x644, 0x645, 0x648, 0x634, 0x639, 0x631, 0x628, 0x64a, 0x61f], "egbpdaj6bu4bxfgehfvwxn"],
  ["Chinese (simplified)", [0x4ed6, 0x4eec, 0x4e3a, 0x4ec0, 0x4e48, 0x4e0d, 0x8bf4, 0x4e2d, 0x6587], "ihqwcrb4cv8a8dqg056pqjye"],
  ["Chinese (traditional)", [0x4ed6, 0x5011, 0x7232, 0x4ec0, 0x9ebd, 0x4e0d, 0x8aaa, 0x4e2d, 0x6587], "ihqwctvzc91f659drss3x8bo0yb"],
  ["Czech", "Pročprostěnemluvíčesky", "Proprostnemluvesky-uyb24dma41a"],
  ["Russian", "почемужеонинеговорятпорусски", "b1abfaaepdrnnbgefbadotcwatmq2g4l"],
  ["Spanish", "PorquénopuedensimplementehablarenEspañol", "PorqunopuedensimplementehablarenEspaol-fmd56a"],
  ["Japanese 3<nen>B<gumi>", [0x33, 0x5e74, 0x42, 0x7d44, 0x91d1, 0x516b, 0x5148, 0x751f], "3B-ww4c5e180e575a65lsy2b"],
  ["all ASCII with a hyphen", "-> $1.00 <-", "-> $1.00 <--"],
];

describe("punycode", () => {
  for (const [name, input, expected] of samples) {
    const text = typeof input === "string" ? input : String.fromCodePoint(...input);
    test(`rfc3492 ${name}`, () => {
      assert.equal(punycodeEncode(text), expected);
      assert.equal(punycodeDecode(expected), text);
    });
  }

  test("domainsToAscii", () => {
    assert.deepEqual(domainToAscii("bücher.example"), { ok: true, text: "xn--bcher-kva.example", changed: true });
    assert.deepEqual(domainToAscii("BÜCHER.Example"), { ok: true, text: "xn--bcher-kva.Example", changed: true });
    assert.deepEqual(domainToAscii("münchen.de"), { ok: true, text: "xn--mnchen-3ya.de", changed: true });
    assert.deepEqual(domainToAscii("例え.テスト"), { ok: true, text: "xn--r8jz45g.xn--zckzah", changed: true });
    assert.deepEqual(domainToAscii("www.bücher.example"), { ok: true, text: "www.xn--bcher-kva.example", changed: true });
  });

  test("linksKeepEverythingButTheHost", () => {
    assert.deepEqual(domainToAscii("https://bücher.example:8080/path/ü?q=ü#frag"), {
      ok: true,
      text: "https://xn--bcher-kva.example:8080/path/ü?q=ü#frag",
      changed: true,
    });
    assert.deepEqual(domainToAscii("https://user:pw@bücher.example/"), { ok: true, text: "https://user:pw@xn--bcher-kva.example/", changed: true });
  });

  test("domainsToUnicode", () => {
    assert.deepEqual(domainToUnicode("xn--bcher-kva.example"), { ok: true, text: "bücher.example", changed: true });
    assert.deepEqual(domainToUnicode("https://XN--BCHER-KVA.example/a?b#c"), { ok: true, text: "https://bücher.example/a?b#c", changed: true });
    assert.deepEqual(domainToUnicode("www.xn--r8jz45g.xn--zckzah"), { ok: true, text: "www.例え.テスト", changed: true });
  });

  test("roundTrips", () => {
    for (const name of ["bücher.example", "İstanbul-şehir.com.tr", "çay.example", "😀.example", "пример.рф", "例え.jp"]) {
      const ascii = domainToAscii(name);
      assert.ok(ascii.ok && /^[\x00-\x7f]*$/.test(ascii.text), name);
      const back = domainToUnicode(ascii.text);
      assert.deepEqual(back, { ok: true, text: name.normalize("NFC").toLowerCase(), changed: true }, name);
    }
  });

  test("ideographicDotsSeparateLabels", () => {
    assert.deepEqual(domainToAscii("bücher。example"), { ok: true, text: "xn--bcher-kva.example", changed: true });
  });

  test("plainAsciiIsUnchanged", () => {
    assert.deepEqual(domainToAscii("example.com"), { ok: true, text: "example.com", changed: false });
    assert.deepEqual(domainToUnicode("example.com"), { ok: true, text: "example.com", changed: false });
  });

  test("badInput", () => {
    assert.deepEqual(domainToUnicode("xn--"), { ok: false, reason: "invalid" });
    assert.deepEqual(domainToUnicode("xn--!!!.example"), { ok: false, reason: "invalid" });
    assert.deepEqual(domainToUnicode("xn--" + "a".repeat(70) + ".example"), { ok: false, reason: "tooLong" });
    assert.deepEqual(domainToAscii("ü".repeat(70) + ".example"), { ok: false, reason: "tooLong" });
    assert.deepEqual(domainToAscii("two words ü"), { ok: false, reason: "notDomain" });
    assert.deepEqual(domainToAscii("/path/ü"), { ok: false, reason: "notDomain" });
    assert.equal(punycodeDecode("abé"), null);
    assert.equal(punycodeDecode("99999999999999999"), null);
    assert.equal(punycodeDecode("a-9999999999"), null);
  });

  test("isLinear", () => {
    assert.ok(timed(() => domainToAscii("ü".repeat(60_000))) < 1500);
    assert.ok(timed(() => domainToAscii("a".repeat(60_000) + "@" + "ü".repeat(60_000))) < 1500);
    assert.ok(timed(() => domainToUnicode("xn--" + "a-".repeat(30_000))) < 1500);
    assert.ok(timed(() => domainToAscii("https://" + "ü.".repeat(30_000))) < 1500);
    assert.ok(timed(() => domainToAscii("/".repeat(60_000))) < 1500);
  });
});
