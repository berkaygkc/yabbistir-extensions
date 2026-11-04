import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const host = createFakeHost({ folder });
const turkish = createFakeHost({ folder, context: { language: "tr" } });
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const text = (value, kind = "text") => ({ id: 1, kind, text: value, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const link = (url) => ({ id: 2, kind: "link", text: url, url, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const offered = (item) => host.offers(item).sort();

describe("manifest", () => {
  test("asksForNoPermissionAndNoTools", () => {
    assert.deepEqual(manifest.permissions, []);
    assert.equal(manifest.network, undefined);
    assert.equal(manifest.requires, undefined);
  });

  test("everyActionIsImplementedAndTheOtherWayRound", () => {
    assert.deepEqual(Object.keys(actions).sort(), manifest.contributes.actions.map((a) => a.id).sort());
  });

  test("hashHasFourVariantsAndNoHint", () => {
    const hash = manifest.contributes.actions.find((a) => a.id === "hash");
    assert.deepEqual(hash.variants.map((v) => v.id), ["md5", "sha1", "sha256", "sha512"]);
    assert.notEqual(hash.hint, true);
  });

  test("everyStringHasATurkishTwin", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  });
});

describe("hash", () => {
  const sample = "Şişli’de çay ☕ 😀\n";
  for (const [variant, algorithm] of [["md5", "md5"], ["sha1", "sha1"], ["sha256", "sha256"], ["sha512", "sha512"]]) {
    test(`${variant}OfUtf8Text`, async () => {
      const result = await host.run(actions.hash, text(sample), { variant });
      assert.deepEqual(result, { text: createHash(algorithm).update(sample, "utf8").digest("hex") });
      assert.match(result.text, /^[0-9a-f]+$/);
    });
  }

  test("theFamousVectors", async () => {
    assert.deepEqual(await host.run(actions.hash, text("abc"), { variant: "sha256" }), {
      text: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    assert.deepEqual(await host.run(actions.hash, text("abc"), { variant: "md5" }), { text: "900150983cd24fb0d6963f7d28e17f72" });
  });

  test("hashesCodeExactlyWithoutTrimming", async () => {
    const code = "  let x = 1;\n";
    assert.deepEqual(await host.run(actions.hash, text(code, "code"), { variant: "sha1" }), {
      text: createHash("sha1").update(code).digest("hex"),
    });
  });

  test("withoutAKnownVariantItIsSha256", async () => {
    const expected = createHash("sha256").update("abc").digest("hex");
    assert.deepEqual(await host.run(actions.hash, text("abc"), {}), { text: expected });
    assert.deepEqual(await host.run(actions.hash, text("abc"), { variant: "nope" }), { text: expected });
  });

  test("emptyTextHasNothingToHash", async () => {
    assert.deepEqual(await host.run(actions.hash, text(""), { variant: "md5" }), { none: true, message: "There’s no text to convert" });
    assert.deepEqual(await turkish.run(actions.hash, text(""), { variant: "md5" }), { none: true, message: "Dönüştürülecek metin yok" });
  });

  test("aBigTextIsHashedWellInsideTheLimit", async () => {
    const big = "satır çok uzun 😀\n".repeat(200_000);
    const started = Date.now();
    const result = await host.run(actions.hash, text(big), { variant: "sha512" });
    assert.equal(result.text, createHash("sha512").update(big).digest("hex"));
    assert.ok(Date.now() - started < 8000);
  });

  test("isOfferedOnTextAndCodeOnly", () => {
    assert.ok(offered(text("hello")).includes("hash"));
    assert.ok(offered(text("let x", "code")).includes("hash"));
    assert.ok(!offered(link("https://example.com/")).includes("hash"));
  });
});

describe("url", () => {
  test("encodesAndDecodes", async () => {
    assert.deepEqual(await host.run(actions["url-encode"], text("a b&c/é")), { text: "a%20b%26c%2F%C3%A9" });
    assert.deepEqual(await host.run(actions["url-decode"], text("a%20b%26c%2F%C3%A9")), { text: "a b&c/é" });
  });

  test("decodesALinkFromItsAddress", async () => {
    assert.deepEqual(await host.run(actions["url-decode"], link("https://example.com/caf%C3%A9")), { text: "https://example.com/café" });
  });

  test("decodeOnlyAppearsWithPercentEscapes", () => {
    assert.ok(offered(text("a%20b")).includes("url-decode"));
    assert.ok(offered(link("https://example.com/a%2Fb")).includes("url-decode"));
    assert.ok(!offered(text("plain text 100%")).includes("url-decode"));
    assert.ok(!offered(text("%2")).includes("url-decode"));
    assert.ok(!offered(text("%zz")).includes("url-decode"));
  });

  test("anEscapeThatIsNotTextIsReportedNotThrown", async () => {
    assert.deepEqual(await host.run(actions["url-decode"], text("%FF")), { none: true, message: "There’s nothing to decode here" });
    assert.deepEqual(await turkish.run(actions["url-decode"], text("%FF")), { none: true, message: "Burada çözülecek bir şey yok" });
  });

  test("worksAsAHint", async () => {
    assert.deepEqual(await host.hint(actions["url-decode"], text("a%20b")), { text: "a b" });
    assert.deepEqual(await host.hint(actions["url-encode"], text("a b")), { text: "a%20b" });
  });

  test("emptyText", async () => {
    assert.deepEqual(await host.run(actions["url-encode"], text("")), { none: true, message: "There’s no text to convert" });
    assert.deepEqual(await host.run(actions["url-encode"], null), { none: true, message: "There’s no text to convert" });
  });
});

describe("html", () => {
  test("encodesAndDecodes", async () => {
    assert.deepEqual(await host.run(actions["html-encode"], text("<b>Tom & \"Jerry\"</b> ç")), {
      text: "&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt; &#231;",
    });
    assert.deepEqual(await host.run(actions["html-decode"], text("&lt;b&gt;caf&eacute; &#x1F600;&lt;/b&gt;")), { text: "<b>café 😀</b>" });
  });

  test("decodeAppearsOnlyWithAReference", () => {
    assert.ok(offered(text("Tom &amp; Jerry")).includes("html-decode"));
    assert.ok(offered(text("&#233;")).includes("html-decode"));
    assert.ok(offered(text("&#xE9;")).includes("html-decode"));
    assert.ok(!offered(text("Tom & Jerry; tea")).includes("html-decode"));
    assert.ok(!offered(text("a &amp b")).includes("html-decode"));
  });

  test("unknownReferencesAreReported", async () => {
    assert.deepEqual(await host.run(actions["html-decode"], text("&nosuchthing;")), { none: true, message: "There are no known HTML entities here" });
    assert.deepEqual(await turkish.run(actions["html-decode"], text("&nosuchthing;")), { none: true, message: "Burada bilinen bir HTML varlığı yok" });
  });
});

describe("unicode", () => {
  test("escapesAndUnescapes", async () => {
    assert.deepEqual(await host.run(actions["unicode-escape"], text("Şi😀")), { text: "\\u015ei\\ud83d\\ude00" });
    assert.deepEqual(await host.run(actions["unicode-unescape"], text("\\u015ei\\ud83d\\ude00 \\u{1F600} \\x41")), { text: "Şi😀 😀 A" });
  });

  test("offeredOnlyWhenItApplies", () => {
    assert.ok(offered(text("çay")).includes("unicode-escape"));
    assert.ok(!offered(text("tea")).includes("unicode-escape"));
    assert.ok(offered(text("\\u00e9")).includes("unicode-unescape"));
    assert.ok(offered(text("\\u{1F600}")).includes("unicode-unescape"));
    assert.ok(offered(text("\\x41")).includes("unicode-unescape"));
    assert.ok(!offered(text("\\u12")).includes("unicode-unescape"));
    assert.ok(!offered(text("C:\\users\\xavier")).includes("unicode-unescape"));
  });

  test("saysSoWhenNothingDecodes", async () => {
    assert.deepEqual(await host.run(actions["unicode-unescape"], text("\\ud800")), { none: true, message: "There are no Unicode escapes to decode here" });
  });
});

describe("hex", () => {
  test("encodesAndDecodes", async () => {
    assert.deepEqual(await host.run(actions["hex-encode"], text("Şi😀")), { text: "c59e69f09f9880" });
    assert.deepEqual(await host.run(actions["hex-decode"], text("c59e69f09f9880")), { text: "Şi😀" });
    assert.deepEqual(await host.run(actions["hex-decode"], text("48 65 6c 6c 6f")), { text: "Hello" });
  });

  test("decodeIsOfferedOnlyForPairsOfHexDigits", () => {
    assert.ok(offered(text("48656c6c6f")).includes("hex-decode"));
    assert.ok(offered(text("48 65 6c")).includes("hex-decode"));
    assert.ok(offered(text("48:65:6c")).includes("hex-decode"));
    assert.ok(offered(text("0x48656c")).includes("hex-decode"));
    assert.ok(!offered(text("48656c6")).includes("hex-decode"));
    assert.ok(!offered(text("hello")).includes("hex-decode"));
    assert.ok(!offered(text("48 6")).includes("hex-decode"));
  });

  test("bytesThatAreNotTextAreReported", async () => {
    assert.deepEqual(await host.run(actions["hex-decode"], text("ff00")), { none: true, message: "These bytes aren’t valid UTF-8 text" });
    assert.deepEqual(await turkish.run(actions["hex-decode"], text("ff00")), { none: true, message: "Bu baytlar geçerli bir UTF-8 metni değil" });
  });

  test("oddOrBrokenHexIsReported", async () => {
    assert.deepEqual(await host.run(actions["hex-decode"], text("abc")), { none: true, message: "This isn’t valid hex: it needs pairs of digits" });
    assert.deepEqual(await host.run(actions["hex-decode"], text("xyz1")), { none: true, message: "This isn’t valid hex: it needs pairs of digits" });
  });
});

describe("rot13", () => {
  test("rotates", async () => {
    assert.deepEqual(await host.run(actions.rot13, text("Hello, World!")), { text: "Uryyb, Jbeyq!" });
  });
  test("offeredOnlyWhenThereAreLetters", () => {
    assert.ok(offered(text("abc")).includes("rot13"));
    assert.ok(!offered(text("12345 !?")).includes("rot13"));
  });
  test("saysSoWithoutLetters", async () => {
    assert.deepEqual(await host.run(actions.rot13, text("123")), { none: true, message: "There are no letters to rotate" });
  });
});

describe("punycode", () => {
  test("encodesADomainAndALink", async () => {
    assert.deepEqual(await host.run(actions["punycode-encode"], text("bücher.example")), { text: "xn--bcher-kva.example" });
    assert.deepEqual(await host.run(actions["punycode-encode"], link("https://bücher.example/yol?q=ü")), { text: "https://xn--bcher-kva.example/yol?q=ü" });
  });

  test("decodesADomainAndALink", async () => {
    assert.deepEqual(await host.run(actions["punycode-decode"], text("xn--bcher-kva.example")), { text: "bücher.example" });
    assert.deepEqual(await host.run(actions["punycode-decode"], link("https://xn--bcher-kva.example/a")), { text: "https://bücher.example/a" });
  });

  test("offeredOnDomainLikeText", () => {
    assert.ok(offered(text("bücher.example")).includes("punycode-encode"));
    assert.ok(offered(link("https://bücher.example/")).includes("punycode-encode"));
    assert.ok(!offered(text("a plain sentence with ü in it")).includes("punycode-encode"));
    assert.ok(!offered(text("example.com")).includes("punycode-encode"));
    assert.ok(offered(text("xn--bcher-kva.example")).includes("punycode-decode"));
    assert.ok(offered(link("https://XN--bcher-kva.example/")).includes("punycode-decode"));
    assert.ok(!offered(text("example.com")).includes("punycode-decode"));
  });

  test("failuresAreReportedInPlainWords", async () => {
    assert.deepEqual(await host.run(actions["punycode-decode"], text("xn--!!!.example")), { none: true, message: "This isn’t valid Punycode" });
    assert.deepEqual(await host.run(actions["punycode-encode"], text("two words ü")), { none: true, message: "This isn’t a domain or a link" });
    assert.deepEqual(await host.run(actions["punycode-encode"], text("example.com")), { none: true, message: "The domain is already plain ASCII" });
    assert.deepEqual(await host.run(actions["punycode-decode"], text("example.com")), { none: true, message: "The domain has no Punycode in it" });
    assert.deepEqual(await host.run(actions["punycode-encode"], text("ü".repeat(70) + ".example")), {
      none: true,
      message: "A part of the domain is longer than 63 characters",
    });
    assert.deepEqual(await turkish.run(actions["punycode-decode"], text("xn--!!!.example")), { none: true, message: "Bu geçerli bir Punycode değil" });
  });
});

describe("limits and secrets", () => {
  const big = "Çok uzun satır &amp; %C3%A9 \\u00e9 4a 😀 xn--abc\n".repeat(20_000);
  const everything = Object.keys(actions).filter((id) => id !== "hash");

  test("everyActionRunsWellInsideItsLimitOnAMegabyte", async () => {
    for (const id of everything) {
      const started = Date.now();
      await host.run(actions[id], text(big));
      assert.ok(Date.now() - started < 8000, id);
    }
  });

  test("hintsAnswerInsideHalfASecondOnFiftyThousandCharacters", async () => {
    const input = (big + big).slice(0, 50_000);
    for (const id of everything) {
      const started = Date.now();
      await host.hint(actions[id], text(input));
      assert.ok(Date.now() - started < 400, id);
    }
  });

  test("noMessageEverQuotesTheInput", async () => {
    const secret = "sekret-" + "k".repeat(24);
    const inputs = [secret, `%FF${secret}`, `&nosuch;${secret}`, `\\ud800${secret}`, `zz${secret}`, `xn--!!!${secret}.example`, `${secret} ü`, `0xff${secret}`];
    for (const id of Object.keys(actions)) {
      for (const input of inputs) {
        const result = await host.run(actions[id], text(input), { variant: "sha256" });
        if (result.none) assert.ok(!result.message.includes(secret), `${id}: ${result.message}`);
      }
    }
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.notifications, []);
  });

  test("anActionNeverReachesForTheNetworkOrAProgram", async () => {
    for (const id of Object.keys(actions)) await host.run(actions[id], text("abc"), { variant: "md5" });
    assert.deepEqual(host.calls.filter((call) => ["http", "exec", "fetch"].includes(call.api)), []);
  });
});
