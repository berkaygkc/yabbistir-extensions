import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";
import { carriers, trackingCode } from "../src/tracking.ts";
import { hostIn, item, tckn, turkishIban, vkn } from "./synthetic.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const track = manifest.contributes.actions.find((action) => action.id === "track");

// Synthetic tracking numbers of the shapes the carriers use.
const TWELVE = "100000000001";
const THIRTEEN = "6000000000001";
const SIXTEEN = "1000000000000001";
const WAYBILL = "1000000001";
const UPS = "1Z999AA10000000001";
const PIECE = "JJD000000000000000001";

/** Runs the action for one carrier and returns what it answered and which links it opened. */
async function trackWith(variant, text, language = "en") {
  const host = hostIn(language);
  const result = await host.run(actions.track, item(text), { variant, language });
  return { result, opened: host.opened, host };
}

describe("trackPackage", () => {
  test("eachCarrierOpensItsOwnTrackingPage", async () => {
    const english = {
      yurtici: [TWELVE, `https://www.yurticikargo.com/en/online-services/tracking?code=${TWELVE}`],
      aras: [THIRTEEN, `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${THIRTEEN}`],
      dhlecommerce: [TWELVE, `https://kargotakip.dhlecommerce.com.tr/?takipNo=${TWELVE}`],
      ups: [UPS, `https://www.ups.com/track?loc=en_US&tracknum=${UPS}&requester=ST%2Ftrackdetails`],
      dhl: [WAYBILL, `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${WAYBILL}&submit=1`],
    };
    for (const [variant, [number, url]] of Object.entries(english)) {
      const { result, opened } = await trackWith(variant, number);
      assert.deepEqual(result, { none: true }, variant);
      assert.deepEqual(opened, [url], variant);
    }
  });

  test("inTurkishTheCarriersTurkishPagesOpen", async () => {
    const turkish = {
      yurtici: `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${SIXTEEN}`,
      aras: `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${SIXTEEN}`,
      dhlecommerce: `https://kargotakip.dhlecommerce.com.tr/?takipNo=${SIXTEEN}`,
      ups: `https://www.ups.com/track?loc=tr_TR&tracknum=${SIXTEEN}&requester=ST%2Ftrackdetails`,
      dhl: `https://www.dhl.com/tr-tr/home/tracking.html?tracking-id=${SIXTEEN}&submit=1`,
    };
    for (const [variant, url] of Object.entries(turkish)) {
      const { opened } = await trackWith(variant, SIXTEEN, "tr");
      assert.deepEqual(opened, [url], variant);
    }
  });

  test("theNumberIsCleanedFirst", async () => {
    const { opened } = await trackWith("ups", `  ${UPS.toLowerCase()}\n`);
    assert.deepEqual(opened, [`https://www.ups.com/track?loc=en_US&tracknum=${UPS}&requester=ST%2Ftrackdetails`]);
  });

  test("yurticiTakesOnlyItsOwnLengths", async () => {
    for (const [text, language, message] of [
      [WAYBILL, "en", "Yurtiçi Kargo tracking numbers are 12 to 16 digits."],
      [UPS, "en", "Yurtiçi Kargo tracking numbers are 12 to 16 digits."],
      ["10000000000000000001", "tr", "Yurtiçi Kargo takip numaraları 12 ile 16 hane arasındadır."],
    ]) {
      const { result, opened } = await trackWith("yurtici", text, language);
      assert.deepEqual(result, { none: true, message }, text);
      assert.deepEqual(opened, [], text);
    }
  });

  test("somethingElseSaysSo", async () => {
    for (const [text, language, message] of [
      ["hello", "en", "This doesn’t look like a tracking number."],
      ["12345", "tr", "Bu bir kargo takip numarasına benzemiyor."],
      [null, "en", "This doesn’t look like a tracking number."],
    ]) {
      const host = hostIn(language);
      const result = await host.run(actions.track, text === null ? null : item(text), { variant: "aras", language });
      assert.deepEqual(result, { none: true, message });
      assert.deepEqual(host.opened, []);
    }
  });

  test("withoutACarrierNothingOpens", async () => {
    for (const [variant, language, message] of [
      [null, "en", "Pick a carrier to track the package with."],
      ["ptt", "tr", "Kargoyu takip etmek için bir firma seç."],
      ["toString", "en", "Pick a carrier to track the package with."],
    ]) {
      const { result, opened } = await trackWith(variant, TWELVE, language);
      assert.deepEqual(result, { none: true, message }, String(variant));
      assert.deepEqual(opened, []);
    }
  });

  test("nothingOpensUnlessThePersonPicksIt", async () => {
    // Run early, as a hint would be, the link is refused: opening a page is an effect.
    await assert.rejects(hostIn().hint(actions.track, item(TWELVE), { variant: "aras" }), { code: "permissionDenied" });
  });

  test("everyVariantHasACarrierAndEveryCarrierAVariant", () => {
    assert.deepEqual(track.variants.map((variant) => variant.id).sort(), Object.keys(carriers).sort());
    assert.equal(track.hint, undefined, "a hint would try to open the page early");
    assert.equal(track.output, "none");
  });
});

describe("whereTrackPackageIsOffered", () => {
  test("onNumbersShapedLikeTrackingNumbers", () => {
    const host = hostIn();
    for (const text of [WAYBILL, TWELVE, THIRTEEN, SIXTEEN, "1000000000000000000001", UPS, UPS.toLowerCase(), PIECE, "JD000000000000000001"]) {
      assert.deepEqual(host.offers(item(text)), ["track"], text);
      assert.equal(trackingCode(text), text.toUpperCase(), text);
    }
  });

  test("notOnTCKimlikNumbersPhoneNumbersOrIbans", () => {
    const host = hostIn();
    const others = [
      tckn("100000000"), "05320000001", "905320000001", "00905320000001", "902122000001", turkishIban("00010"),
      "123456789", "10000000000000000000001", "1Z999AA1", "hello", "0532 000 00 01", "1000 0000 0001", "12-34-56-78-90",
    ];
    for (const text of others) {
      assert.deepEqual(host.offers(item(text)).filter((id) => id === "track"), [], text);
      assert.equal(trackingCode(text), null, text);
    }
  });

  test("aTenDigitTaxNumberLooksLikeAWaybill", () => {
    // Known limit: a DHL Express waybill is ten digits, and so is a VKN; both are offered.
    assert.equal(acceptsMatch(track.accepts, item(vkn("100000000"))), true);
  });

  test("longAdversarialTextIsLeftOutQuickly", () => {
    for (const text of ["1".repeat(60_000), `1Z${"A".repeat(60_000)}`, `JJD${"0".repeat(60_000)}x`, `90${"5".repeat(60_000)}`]) {
      const started = performance.now();
      assert.equal(acceptsMatch(track.accepts, item(text)), false);
      assert.equal(trackingCode(text), null);
      assert.ok(performance.now() - started < 50, `${performance.now() - started} ms`);
    }
  });
});
