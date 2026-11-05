import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch } from "@yabbistir/api/fake-host";

import { detectors } from "../src/index.ts";
import { isTCKN, isVKN } from "../src/ids.ts";
import { bump, digitsFrom, hostIn, item, tckn, vkn } from "./synthetic.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const accepts = (name) => manifest.contributes.detectors.find((entry) => entry.id === name).accepts;
const tagged = (name, text) => hostIn().validate(detectors[name], item(text));

const next = digitsFrom(2026);
const someTCKNs = Array.from({ length: 300 }, () => tckn(next(9, true)));
const someVKNs = Array.from({ length: 300 }, () => vkn(next(9)));

describe("tckn", () => {
  test("numbersWithBothCheckDigitsAreTagged", async () => {
    for (const number of someTCKNs) assert.equal(await tagged("tckn", number), true, number);
    assert.equal(await tagged("tckn", ` ${someTCKNs[0]}\n`), true, "the text is trimmed");
  });

  test("aWrongTenthOrEleventhDigitIsNot", async () => {
    for (const number of someTCKNs.slice(0, 50)) {
      assert.equal(await tagged("tckn", bump(number, 9)), false, `10th of ${number}`);
      assert.equal(await tagged("tckn", bump(number, 10)), false, `11th of ${number}`);
    }
  });

  test("aTypoInTheFirstNineIsCaught", async () => {
    // One changed digit always breaks the 11th-digit rule (the sum changes by 1 to 9).
    for (const number of someTCKNs.slice(0, 20)) {
      for (let index = 1; index < 9; index += 1) assert.equal(isTCKN(bump(number, index)), false, `${index} of ${number}`);
    }
  });

  test("theFirstDigitIsNeverZero", async () => {
    // "0" + ten digits whose check digits would otherwise fit.
    const nine = "012345678";
    assert.equal(await tagged("tckn", tckn(nine)), false);
    assert.equal(acceptsMatch(accepts("tckn"), item(tckn(nine))), false);
  });

  test("otherShapesAreNot", async () => {
    const good = someTCKNs[0];
    for (const text of [good.slice(0, 10), `${good}0`, `${good.slice(0, 5)} ${good.slice(5)}`, `TC ${good}`, "", "abcdefghijk", "1".repeat(11)]) {
      assert.equal(isTCKN(text.trim()), false, text);
    }
  });

  test("previewSaysOnlyThatItIsValid", async () => {
    const number = someTCKNs[1];
    const english = await hostIn("en").preview(detectors.tckn, item(number));
    assert.deepEqual(english, [{
      type: "keyValue",
      title: "TC Kimlik No",
      rows: [["Check", "Valid"], ["Rule", "10th and 11th digits"], ["", "Only the check digits are tested"]],
    }]);
    const turkish = await hostIn("tr").preview(detectors.tckn, item(number), { language: "tr" });
    assert.deepEqual(turkish, [{
      type: "keyValue",
      title: "TC Kimlik No",
      rows: [["Kontrol", "Geçerli"], ["Kural", "10. ve 11. haneler"], ["", "Yalnızca kontrol haneleri denetlenir"]],
    }]);
    for (const sections of [english, turkish]) {
      const shown = JSON.stringify(sections);
      assert.ok(!shown.includes(number) && !shown.includes(number.slice(0, 9)), "the number itself is never repeated");
    }
  });

  test("anInvalidNumberHasNoPreview", async () => {
    assert.deepEqual(await hostIn().preview(detectors.tckn, item(bump(someTCKNs[2], 10))), []);
  });

  test("theManifestPatternFindsTheCandidates", () => {
    assert.equal(acceptsMatch(accepts("tckn"), item(someTCKNs[0])), true);
    assert.equal(acceptsMatch(accepts("tckn"), item(`  ${someTCKNs[0]}  `)), true);
    for (const text of ["1234567890", "123456789012", "TC 12345678901", "1234 5678 901"]) assert.equal(acceptsMatch(accepts("tckn"), item(text)), false, text);
  });
});

describe("vkn", () => {
  test("numbersWithTheirCheckDigitAreTagged", async () => {
    for (const number of someVKNs) assert.equal(await tagged("vkn", number), true, number);
  });

  test("aWrongCheckDigitIsNot", async () => {
    for (const number of someVKNs.slice(0, 80)) {
      for (let step = 1; step < 10; step += 1) {
        const wrong = `${number.slice(0, 9)}${(Number(number[9]) + step) % 10}`;
        assert.equal(await tagged("vkn", wrong), false, wrong);
      }
    }
  });

  test("theAlgorithmMatchesTheOneWrittenSeparately", () => {
    // src/ids.ts counts positions from 0 and tests/synthetic.mjs from 1; both must agree on every number.
    const more = digitsFrom(7);
    for (let n = 0; n < 2000; n += 1) {
      const number = more(10);
      assert.equal(isVKN(number), vkn(number.slice(0, 9)) === number, number);
    }
  });

  test("otherShapesAreNot", async () => {
    const good = someVKNs[0];
    for (const text of [good.slice(0, 9), `${good}0`, `${good.slice(0, 3)} ${good.slice(3)}`, `VKN ${good}`, "", "abcdefghij"]) {
      assert.equal(isVKN(text.trim()), false, text);
    }
  });

  test("previewSaysOnlyThatItIsValid", async () => {
    const number = someVKNs[1];
    const english = await hostIn("en").preview(detectors.vkn, item(number));
    assert.deepEqual(english, [{
      type: "keyValue",
      title: "Tax number",
      rows: [["Check", "Valid"], ["Rule", "10th digit"], ["", "Only the check digit is tested"]],
    }]);
    const turkish = await hostIn("tr").preview(detectors.vkn, item(number), { language: "tr" });
    assert.deepEqual(turkish[0].title, "Vergi Kimlik No");
    assert.deepEqual(turkish[0].rows, [["Kontrol", "Geçerli"], ["Kural", "10. hane"], ["", "Yalnızca kontrol hanesi denetlenir"]]);
    assert.ok(!JSON.stringify([english, turkish]).includes(number));
  });

  test("anInvalidNumberHasNoPreview", async () => {
    const wrong = `${someVKNs[3].slice(0, 9)}${(Number(someVKNs[3][9]) + 1) % 10}`;
    assert.deepEqual(await hostIn().preview(detectors.vkn, item(wrong)), []);
  });

  test("tenAndElevenDigitsNeverMeetTheOtherDetector", () => {
    // A VKN is ten digits and a TC Kimlik No eleven, so one number never carries both tags.
    for (const number of someVKNs.slice(0, 20)) assert.equal(acceptsMatch(accepts("tckn"), item(number)), false);
    for (const number of someTCKNs.slice(0, 20)) assert.equal(acceptsMatch(accepts("vkn"), item(number)), false);
  });
});

describe("ordinaryNumbers", () => {
  test("areNotTaggedAsAnyNumber", async () => {
    const ordinary = [
      "0", "42", "1000", "2026", "3.14", "-17", "1,299.00", "₺1.250,00", "100.000 TL", "12:30", "2026-11-04",
      "192.168.1.1", "212.123.45.67", "v1.2.3", "#1234", "+1 202 555 0100", "1234 5678", "99999", "00000000000",
      "123456789", "4-8-15-16-23-42",
    ];
    const host = hostIn();
    for (const text of ordinary) {
      for (const name of ["iban", "tckn", "vkn", "phone"]) {
        assert.equal(await host.validate(detectors[name], item(text)), false, `${name} on ${text}`);
      }
    }
  });

  test("numbersWithAWrongCheckDigitAreNotTagged", async () => {
    // Ten- and eleven-digit numbers are tagged only when their check digits fit, never for their length alone.
    const host = hostIn();
    const more = digitsFrom(99);
    let tcknTags = 0;
    let vknTags = 0;
    for (let n = 0; n < 1000; n += 1) {
      const eleven = more(11, true);
      const ten = more(10);
      const tc = await host.validate(detectors.tckn, item(eleven));
      const tax = await host.validate(detectors.vkn, item(ten));
      assert.equal(tc, isTCKN(eleven));
      assert.equal(tax, isVKN(ten));
      tcknTags += tc ? 1 : 0;
      vknTags += tax ? 1 : 0;
    }
    // About one in a hundred random eleven-digit numbers fits both TC Kimlik rules, and one in ten ten-digit numbers
    // fits the single VKN check digit: the limit the README states.
    assert.ok(tcknTags < 30, `${tcknTags} of 1000`);
    assert.ok(vknTags > 50 && vknTags < 150, `${vknTags} of 1000`);
  });
});

describe("idTiming", () => {
  test("longAdversarialTextIsAnsweredQuickly", async () => {
    const host = hostIn();
    for (const text of ["1".repeat(60_000), ` ${"9".repeat(60_000)} `, `${"0".repeat(59_999)}x`]) {
      const started = performance.now();
      for (const name of ["tckn", "vkn"]) {
        acceptsMatch(accepts(name), item(text));
        await host.validate(detectors[name], item(text));
        await host.preview(detectors[name], item(text));
      }
      assert.ok(performance.now() - started < 50, `${performance.now() - started} ms`);
    }
  });
});
