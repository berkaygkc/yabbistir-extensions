import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions, byteLength, maxBytes, sizeFrom } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const text = (value) => ({ kind: "text", text: value });
const link = (url) => ({ kind: "link", url, text: url });
const image = { kind: "image", image: { __image: "src-image", width: 40, height: 40 } };
const withImage = (options) => createFakeHost({ folder, ...options });
const secretLike = "otp" + "auth://totp/Demo:demo@example.test?secret=" + "A".repeat(16);

describe("show as QR code", () => {
  test("textBecomesAnImage", async () => {
    const host = createFakeHost({ folder });
    const result = await host.run(actions.show, text("hello"));
    assert.equal(typeof result.image.__image, "string");
    assert.deepEqual(host.calls.find((c) => c.api === "qr.generate").args, ["hello", { size: 512 }]);
  });

  test("aLinkUsesItsUrl", async () => {
    const host = createFakeHost({ folder });
    await host.run(actions.show, link("https://example.com/menu"));
    assert.equal(host.calls.find((c) => c.api === "qr.generate").args[0], "https://example.com/menu");
  });

  test("theSizePreferenceIsHonored", async () => {
    for (const size of ["256", "512", "1024"]) {
      const host = createFakeHost({ folder, preferences: { size } });
      const result = await host.run(actions.show, text("hi"));
      assert.equal(result.image.width, Number(size));
      assert.deepEqual(host.calls.find((c) => c.api === "qr.generate").args[1], { size: Number(size) });
    }
  });

  test("anOddSizeFallsBackToMedium", () => {
    assert.equal(sizeFrom(undefined), 512);
    assert.equal(sizeFrom("300"), 512);
    assert.equal(sizeFrom("abc"), 512);
    assert.equal(sizeFrom("1024"), 1024);
  });

  test("emptyTextHasNothingToDo", async () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(await host.run(actions.show, text("  \n ")), { none: true, message: "There’s no text to turn into a QR code" });
    assert.equal(host.calls.some((c) => c.api === "qr.generate"), false);
  });

  test("textAtTheLimitWorks", async () => {
    const host = createFakeHost({ folder });
    const result = await host.run(actions.show, text("a".repeat(maxBytes)));
    assert.ok(result.image);
  });

  test("textPastTheLimitSaysSo", async () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(await host.run(actions.show, text("a".repeat(maxBytes + 1))), { none: true, message: "This is too long for a QR code" });
    // Multi-byte letters count by their bytes: 1,000 of them are 2,000 bytes, 2,000 are over the limit.
    assert.ok((await host.run(actions.show, text("ş".repeat(1000)))).image);
    assert.equal((await host.run(actions.show, text("ş".repeat(2000)))).none, true);
    assert.equal((await host.run(actions.show, text("😀".repeat(800)))).none, true);
  });

  test("hugeTextIsQuick", async () => {
    const host = createFakeHost({ folder });
    const started = Date.now();
    const result = await host.run(actions.show, text("x".repeat(5_000_000)));
    assert.equal(result.none, true);
    assert.ok(Date.now() - started < 2000);
    assert.equal(byteLength("ş"), 2);
  });

  test("anEncoderRefusalGetsAPlainMessage", async () => {
    const host = createFakeHost({ folder });
    host.yab.qr.generate = () => {
      throw yabError("badResult", "encoder says no: " + "secret-looking-text");
    };
    const original = globalThis.yab;
    globalThis.yab = host.yab;
    try {
      const result = actions.show.run(text("hello"), { preferences: { size: "512" } });
      assert.deepEqual(result, { none: true, message: "This is too long for a QR code" });
    } finally {
      globalThis.yab = original;
    }
  });

  test("aCancelPassesThrough", () => {
    const host = createFakeHost({ folder });
    host.yab.qr.generate = () => {
      throw yabError("cancelled", "cancelled");
    };
    const original = globalThis.yab;
    globalThis.yab = host.yab;
    try {
      assert.throws(() => actions.show.run(text("hello"), { preferences: {} }), { code: "cancelled" });
    } finally {
      globalThis.yab = original;
    }
  });

  test("offeredOnTextAndLinksNotImages", () => {
    const host = createFakeHost({ folder });
    assert.ok(host.offers(text("hi")).includes("show"));
    assert.ok(host.offers(link("https://example.com")).includes("show"));
    assert.ok(!host.offers(image).includes("show"));
  });

  test("turkishTitles", () => {
    const host = createFakeHost({ folder, context: { language: "tr" } });
    assert.equal(host.yab.t("show.title"), "QR kod olarak göster");
    assert.equal(host.yab.t("noCode"), "Bu görüntüde QR kod bulunamadı");
  });
});

describe("read QR code", () => {
  test("oneCode", async () => {
    const host = withImage({ vision: { readCodes: ["https://example.com/a"] } });
    assert.deepEqual(await host.run(actions.read, image), { text: "https://example.com/a" });
    assert.equal(host.calls.filter((c) => c.api === "vision.readCodes").length, 1);
  });

  test("severalCodesOnePerLine", async () => {
    const host = withImage({ vision: { readCodes: ["one", "two", "three"] } });
    assert.deepEqual(await host.run(actions.read, image), { text: "one\ntwo\nthree" });
  });

  test("blankCodesAreDropped", async () => {
    const host = withImage({ vision: { readCodes: ["", "  ", "kept"] } });
    assert.deepEqual(await host.run(actions.read, image), { text: "kept" });
  });

  test("noCodeSaysSo", async () => {
    const host = withImage({ vision: { readCodes: [] } });
    assert.deepEqual(await host.run(actions.read, image), { none: true, message: "No QR code found in this image" });
    const onlyBlank = withImage({ vision: { readCodes: [" "] } });
    assert.equal((await onlyBlank.run(actions.read, image)).none, true);
  });

  test("visionAnswerIsAFunction", async () => {
    const host = withImage({ vision: { readCodes: (handle) => [`size ${handle.width}`] } });
    assert.deepEqual(await host.run(actions.read, image), { text: "size 40" });
  });

  test("wifiCodesAreReturnedAsTheyAre", async () => {
    const wifi = "WIFI:S:Demo;T:WPA;P:" + "pass" + "word;;";
    const host = withImage({ vision: { readCodes: [wifi] } });
    assert.deepEqual(await host.run(actions.read, image), { text: wifi });
  });

  test("twoFactorSeedsAreStillReturned", async () => {
    const host = withImage({ vision: { readCodes: [secretLike] } });
    assert.deepEqual(await host.run(actions.read, image), { text: secretLike });
    const migration = "otp" + "auth-migration://offline?data=AAAA";
    const other = withImage({ vision: { readCodes: [migration] } });
    assert.deepEqual(await other.run(actions.read, image), { text: migration });
  });

  test("visionUnavailableReachesTheCardUnchanged", async () => {
    const host = withImage({});
    await assert.rejects(host.run(actions.read, image), { code: "unavailable" });
  });

  test("aVisionErrorIsNotSwallowed", async () => {
    const host = withImage({ vision: { readCodes: () => { throw yabError("unavailable", "Vision is not available"); } } });
    await assert.rejects(host.run(actions.read, image), { code: "unavailable" });
  });

  test("noImageHasNothingToRead", async () => {
    const host = withImage({ vision: { readCodes: ["x"] } });
    assert.deepEqual(await host.run(actions.read, text("hello")), { none: true, message: "No QR code found in this image" });
  });

  test("offeredOnImagesOnly", () => {
    const host = createFakeHost({ folder });
    assert.ok(host.offers(image).includes("read"));
    assert.ok(!host.offers(text("hi")).includes("read"));
  });

  test("theDecodedTextNeverReachesLogsOrErrors", async () => {
    const host = withImage({ vision: { readCodes: [secretLike] } });
    await host.run(actions.read, image);
    assert.equal(host.logs.join("\n").includes("secret="), false);
    const bad = withImage({});
    try {
      await bad.run(actions.read, image);
    } catch (error) {
      assert.equal(String(error.message).includes("secret="), false);
    }
  });
});
