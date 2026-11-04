import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch } from "@yabbistir/api/fake-host";

import { actions, detectors } from "../src/index.ts";
import { areaCodes, parsePhone } from "../src/phone.ts";
import { hostIn, item } from "./synthetic.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const { accepts } = manifest.contributes.detectors.find((entry) => entry.id === "phone");
const tagged = (text) => hostIn().validate(detectors.phone, item(text));

// Every common way of writing one synthetic mobile number, 0532 000 00 01.
const MOBILE_FORMS = [
  "+90 532 000 00 01", "+90 (532) 000 00 01", "+90-532-000-00-01", "+905320000001", "+90 5320000001", "+90 532 000 0001",
  "+90 (0) 532 000 00 01", "+90 0532 000 00 01", "0090 532 000 00 01", "00905320000001", "90 532 000 00 01",
  "905320000001", "0532 000 00 01", "0 532 000 00 01", "0 (532) 000 00 01", "(0532) 000 00 01", "0532-000-00-01",
  "05320000001", "0532 0000001", "0532 000 0001", "532 000 00 01", "(532) 000 00 01", "532-000-00-01",
  "0532 000 00 01", "  0532 000 00 01\n",
];

describe("phoneDetection", () => {
  test("everyCommonFormOfAMobileNumberIsTagged", async () => {
    for (const text of MOBILE_FORMS) {
      assert.equal(await tagged(text), true, text);
      assert.deepEqual(parsePhone(text), { national: "5320000001", kind: "mobile" }, text);
      assert.equal(acceptsMatch(accepts, item(text)), true, `pattern: ${text}`);
    }
  });

  test("everyOperatorsMobilePrefixIsTaken", () => {
    for (const prefix of ["500", "505", "507", "530", "539", "541", "549", "551", "555", "559", "561"]) {
      assert.equal(parsePhone(`0${prefix} 200 00 00`)?.kind, "mobile", prefix);
    }
    for (const prefix of ["510", "512", "520", "522", "560", "570", "592", "594", "599"]) assert.equal(parsePhone(`0${prefix} 200 00 00`), null, prefix);
  });

  test("landlinesAndNationalNumbersAreTagged", () => {
    assert.deepEqual(parsePhone("0212 200 00 01"), { national: "2122000001", kind: "landline" });
    assert.deepEqual(parsePhone("+90 312 200 00 01"), { national: "3122000001", kind: "landline" });
    assert.deepEqual(parsePhone("(0216) 300 00 01"), { national: "2163000001", kind: "landline" });
    assert.deepEqual(parsePhone("0392 200 00 01"), { national: "3922000001", kind: "landline" });
    assert.deepEqual(parsePhone("0850 000 00 01"), { national: "8500000001", kind: "nonGeographic" });
    assert.deepEqual(parsePhone("0800 000 00 01"), { national: "8000000001", kind: "tollFree" });
  });

  test("theAreaCodeTableHasEveryProvince", () => {
    // 81 provinces, İstanbul with two codes, and Northern Cyprus (392) on the +90 plan.
    assert.equal(Object.keys(areaCodes).length, 83);
    for (const code of Object.keys(areaCodes)) assert.match(code, /^[234][0-9]{2}$/);
  });

  test("otherTextIsNotTagged", async () => {
    const others = [
      "5320000001", // ten bare digits: as likely a tax number
      "0123 456 78 90", "0612 200 00 01", "0900 000 00 01", "0444 00 00", "444 0 444", // no such prefix
      "0212 000 00 01", "0212 100 00 01", // a subscriber number never starts with 0 or 1
      "+1 202 555 0100", "+44 20 7946 0000", "+90 532 000 00", "+90 532 000 00 011", "0532 000 00 0", "0532 000 00 011",
      "05320000001 05320000001", "+90 +532 000 00 01", "90+5320000001", "0532 (000) 00 01", "(0532 000 00 01", "0532) 000 00 01",
      "((532)) 000 00 01", "(05321) 000 00 01", "0532.000.00.01", "212.200.00.01", "call 0532 000 00 01", "0532 000 00 01 (home)",
      "", "+", "0", "+90",
    ];
    for (const text of others) assert.equal(await tagged(text), false, text);
  });

  test("theManifestPatternLeavesOtherTextOut", () => {
    for (const text of ["call 0532 000 00 01", "0532.000.00.01", "+90 532 000 00 01 ext", "12345", "a1234567890"]) {
      assert.equal(acceptsMatch(accepts, item(text)), false, text);
    }
  });
});

describe("phonePreview", () => {
  test("aMobileNumber", async () => {
    assert.deepEqual(await hostIn("en").preview(detectors.phone, item("05320000001")), [{
      type: "keyValue", title: "Phone", rows: [["Type", "Mobile"], ["International", "+90 532 000 00 01"]],
    }]);
    assert.deepEqual(await hostIn("tr").preview(detectors.phone, item("05320000001"), { language: "tr" }), [{
      type: "keyValue", title: "Telefon", rows: [["Tür", "Mobil"], ["Uluslararası", "+90 532 000 00 01"]],
    }]);
  });

  test("aLandlineNamesItsArea", async () => {
    const rows = async (text, language = "en") => (await hostIn(language).preview(detectors.phone, item(text), { language }))[0].rows;
    assert.deepEqual(await rows("0312 200 00 01"), [["Type", "Landline"], ["Area", "Ankara"], ["International", "+90 312 200 00 01"]]);
    assert.deepEqual((await rows("0212 200 00 01"))[1], ["Area", "İstanbul (European side)"]);
    assert.deepEqual((await rows("0216 200 00 01", "tr"))[1], ["Bölge", "İstanbul (Anadolu Yakası)"]);
    assert.deepEqual((await rows("0392 200 00 01"))[1], ["Area", "Northern Cyprus"]);
    assert.deepEqual((await rows("0392 200 00 01", "tr"))[1], ["Bölge", "KKTC"]);
    assert.deepEqual((await rows("0414 200 00 01", "tr"))[1], ["Bölge", "Şanlıurfa"]);
  });

  test("nationalNumbersSayWhatTheyAre", async () => {
    const [section] = await hostIn("en").preview(detectors.phone, item("0850 000 00 01"));
    assert.deepEqual(section.rows, [["Type", "Non-geographic"], ["International", "+90 850 000 00 01"]]);
    const [free] = await hostIn("tr").preview(detectors.phone, item("0800 000 00 01"), { language: "tr" });
    assert.deepEqual(free.rows[0], ["Tür", "Ücretsiz hat"]);
  });

  test("anythingElseHasNoPreview", async () => {
    assert.deepEqual(await hostIn().preview(detectors.phone, item("hello")), []);
  });
});

describe("phoneActions", () => {
  test("eachFormatIsPastedAsTheHintShowsIt", async () => {
    const host = hostIn();
    for (const text of MOBILE_FORMS) {
      const phone = item(text, "phone");
      assert.deepEqual(await host.hint(actions.phoneInternational, phone), { text: "+90 532 000 00 01" }, text);
      assert.deepEqual(await host.hint(actions.phoneNational, phone), { text: "0532 000 00 01" }, text);
      assert.deepEqual(await host.hint(actions.phoneE164, phone), { text: "+905320000001" }, text);
    }
  });

  test("landlinesAreFormattedTheSameWay", async () => {
    const host = hostIn();
    const phone = item("+90 (212) 200-00-01", "phone");
    assert.deepEqual(await host.run(actions.phoneInternational, phone), { text: "+90 212 200 00 01" });
    assert.deepEqual(await host.run(actions.phoneNational, phone), { text: "0212 200 00 01" });
    assert.deepEqual(await host.run(actions.phoneE164, phone), { text: "+902122000001" });
  });

  test("somethingElseSaysSo", async () => {
    assert.deepEqual(await hostIn("en").run(actions.phoneE164, item("hello")), { none: true, message: "This is not a Turkish phone number." });
    assert.deepEqual(await hostIn("tr").hint(actions.phoneNational, item("+1 202 555 0100")), { none: true, message: "Bu bir Türkiye telefon numarası değil." });
    assert.deepEqual(await hostIn("en").run(actions.phoneInternational, null), { none: true, message: "This is not a Turkish phone number." });
  });

  test("theActionsAreOfferedOnlyOnTaggedItems", () => {
    const host = hostIn();
    assert.deepEqual(host.offers(item("0532 000 00 01", "phone")), ["phoneInternational", "phoneNational", "phoneE164"]);
    assert.deepEqual(host.offers(item("0532 000 00 01")), []);
  });
});

describe("phoneTiming", () => {
  test("longAdversarialTextIsAnsweredQuickly", async () => {
    const host = hostIn();
    const texts = [
      `+${" 0".repeat(30_000)}x`, `${"(".repeat(30_000)}0532 000 00 01`, `0${" ".repeat(60_000)}5`, `${"1-".repeat(30_000)}`,
      `${"9".repeat(60_000)}`, `+90 ${"5".repeat(60_000)} `,
    ];
    for (const text of texts) {
      const started = performance.now();
      acceptsMatch(accepts, item(text));
      await host.validate(detectors.phone, item(text));
      await host.preview(detectors.phone, item(text));
      await host.hint(actions.phoneInternational, item(text));
      assert.ok(performance.now() - started < 50, `${text.length} characters took ${performance.now() - started} ms`);
    }
  });
});
