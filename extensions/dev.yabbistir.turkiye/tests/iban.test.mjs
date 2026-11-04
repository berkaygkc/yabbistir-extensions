import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch } from "@yabbistir/api/fake-host";

import { actions, detectors } from "../src/index.ts";
import { ibanLengths, parseIban } from "../src/iban.ts";
import { bankName, participantCount } from "../src/banks.ts";
import { hostIn, iban, item, spaced, turkishIban } from "./synthetic.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const detector = (name) => manifest.contributes.detectors.find((entry) => entry.id === name);
const valid = (text) => hostIn().validate(detectors.iban, item(text));

// Synthetic IBANs from several countries, with the right length and check digits.
const ZIRAAT = turkishIban("00010");
const PAPARA = turkishIban("00829", "0000000000000042");
const UNKNOWN_BANK = turkishIban("00208");
const OTHERS = {
  DE: iban("DE", "100000000000000001"),
  GB: iban("GB", "XBNK00000000000001"),
  FR: iban("FR", "10000000000000000000000"),
  NL: iban("NL", "XBNK0000000001"),
  NO: iban("NO", "10000000001"),
  MT: iban("MT", "XBNK10000000000000000000001"),
  LC: iban("LC", "XBNK000000000000000000000001"),
  RU: iban("RU", "00000000000000000000000000001"),
  XK: iban("XK", "1000000000000001"),
};

describe("ibanDetection", () => {
  test("theSyntheticIbansHaveTheirCountrysLength", () => {
    for (const [country, number] of Object.entries({ TR: ZIRAAT, ...OTHERS })) assert.equal(number.length, ibanLengths[country], country);
  });

  test("aTurkishIbanIsTaggedWithOrWithoutSpaces", async () => {
    for (const text of [ZIRAAT, spaced(ZIRAAT), ZIRAAT.toLowerCase(), spaced(ZIRAAT).replace(/ /g, " "), `  ${spaced(ZIRAAT)}\n`]) {
      assert.equal(await valid(text), true, text);
    }
  });

  test("anIbanAfterAnIbanLabelIsTagged", async () => {
    for (const text of [`IBAN: ${spaced(ZIRAAT)}`, `IBAN ${ZIRAAT}`, `iban:${ZIRAAT}`]) assert.equal(await valid(text), true, text);
  });

  test("ibansOfOtherCountriesAreTagged", async () => {
    for (const [country, number] of Object.entries(OTHERS)) {
      assert.equal(await valid(number), true, country);
      assert.equal(await valid(spaced(number)), true, `${country} with spaces`);
    }
  });

  test("aWrongCheckIsNotTagged", async () => {
    // Every single-digit typo in the account part breaks MOD 97-10.
    for (let index = 4; index < ZIRAAT.length; index += 1) {
      const typo = `${ZIRAAT.slice(0, index)}${(Number(ZIRAAT[index]) + 1) % 10}${ZIRAAT.slice(index + 1)}`;
      assert.equal(await valid(typo), false, typo);
    }
    // So does swapping two neighbouring digits that differ.
    for (let index = 4; index < PAPARA.length - 1; index += 1) {
      if (PAPARA[index] === PAPARA[index + 1]) continue;
      const swapped = `${PAPARA.slice(0, index)}${PAPARA[index + 1]}${PAPARA[index]}${PAPARA.slice(index + 2)}`;
      assert.equal(await valid(swapped), false, swapped);
    }
  });

  test("theLengthMustBeTheCountrys", async () => {
    // A Turkish IBAN is 26 characters: one more or one less, even with check digits that fit, is not one.
    assert.equal(await valid(iban("TR", "000100000000000000001")), false);
    assert.equal(await valid(iban("TR", "00010000000000000000001")), false);
    assert.equal(await valid(iban("DE", "1000000000000000001")), false);
  });

  test("anUnknownCountryIsNotTagged", async () => {
    assert.equal(await valid(iban("ZZ", "000100000000000000001")), false);
    assert.equal(await valid(iban("US", "000100000000000000001")), false);
  });

  test("checkDigitsThatAreNeverIssuedAreNotTagged", async () => {
    // 00, 01 and 99 can pass the remainder test when the real check digits are 97, 98 or 02.
    let found = 0;
    for (let n = 0; n < 2000 && found < 3; n += 1) {
      const real = turkishIban("00010", String(n).padStart(16, "0"));
      const check = Number(real.slice(2, 4));
      const other = { 97: "00", 98: "01", 2: "99" }[check];
      if (other === undefined) continue;
      found += 1;
      assert.equal(await valid(real), true, real);
      assert.equal(await valid(`TR${other}${real.slice(4)}`), false, `TR${other}`);
    }
    assert.ok(found > 0);
  });

  test("otherTextIsNotTagged", async () => {
    for (const text of ["", "TR", "hello", "TR33", "IBAN", `${ZIRAAT} please`, `send to ${ZIRAAT}`, "TRXX0006100519786457841326", ZIRAAT.replace(/^TR/, "T1"), `${spaced(ZIRAAT)}  ${spaced(ZIRAAT)}`]) {
      assert.equal(await valid(text), false, text);
    }
  });

  test("theManifestPatternFindsTheCandidates", () => {
    const { accepts } = detector("iban");
    for (const text of [ZIRAAT, spaced(ZIRAAT), ZIRAAT.toLowerCase(), `IBAN: ${spaced(ZIRAAT)}`, spaced(ZIRAAT).replace(/ /g, " "), OTHERS.NO, OTHERS.RU]) {
      assert.equal(acceptsMatch(accepts, item(text)), true, text);
    }
    for (const text of ["hello", `send to ${ZIRAAT}`, "TR33 0006", "12345678901234567890"]) assert.equal(acceptsMatch(accepts, item(text)), false, text);
  });
});

describe("ibanPreview", () => {
  test("aTurkishIbanShowsItsBank", async () => {
    const sections = await hostIn("en").preview(detectors.iban, item(spaced(ZIRAAT)));
    assert.deepEqual(sections, [{
      type: "keyValue",
      title: "IBAN",
      rows: [
        ["IBAN", spaced(ZIRAAT)],
        ["Country", "Türkiye"],
        ["Bank", "T.C. Ziraat Bankası"],
        ["Bank code", "00010"],
        ["Check", "Valid · mod 97"],
      ],
    }]);
  });

  test("anElectronicMoneyInstitutionIsNamedToo", async () => {
    const [section] = await hostIn("en").preview(detectors.iban, item(PAPARA));
    assert.deepEqual(section.rows[2], ["Bank", "Papara Elektronik Para"]);
  });

  test("aCodeNotInTheListsShowsOnlyTheCode", async () => {
    const [section] = await hostIn("en").preview(detectors.iban, item(UNKNOWN_BANK));
    assert.deepEqual(section.rows.map(([key]) => key), ["IBAN", "Country", "Bank code", "Check"]);
    assert.deepEqual(section.rows[2], ["Bank code", "00208"]);
  });

  test("anotherCountryHasNoBankRows", async () => {
    const [section] = await hostIn("en").preview(detectors.iban, item(OTHERS.DE));
    assert.deepEqual(section.rows, [["IBAN", spaced(OTHERS.DE)], ["Country", "Germany"], ["Check", "Valid · mod 97"]]);
  });

  test("speaksTurkish", async () => {
    const [section] = await hostIn("tr").preview(detectors.iban, item(ZIRAAT), { language: "tr" });
    assert.deepEqual(section.rows, [
      ["IBAN", spaced(ZIRAAT)],
      ["Ülke", "Türkiye"],
      ["Banka", "T.C. Ziraat Bankası"],
      ["Banka kodu", "00010"],
      ["Kontrol", "Geçerli · mod 97"],
    ]);
    const [german] = await hostIn("tr").preview(detectors.iban, item(OTHERS.DE), { language: "tr" });
    assert.deepEqual(german.rows[1], ["Ülke", "Almanya"]);
  });

  test("anUnknownLanguageFallsBackToTheCountryCode", async () => {
    const [section] = await hostIn("en").preview(detectors.iban, item(OTHERS.DE), { language: "not a language tag!" });
    assert.deepEqual(section.rows[1], ["Country", "DE"]);
  });

  test("anythingElseHasNoPreview", async () => {
    assert.deepEqual(await hostIn().preview(detectors.iban, item("hello")), []);
    const typo = `${ZIRAAT.slice(0, -1)}${(Number(ZIRAAT.at(-1)) + 1) % 10}`;
    assert.deepEqual(await hostIn().preview(detectors.iban, item(typo)), []);
  });
});

describe("ibanActions", () => {
  test("bothFormatsArePastedAsTheHintShowsThem", async () => {
    const host = hostIn();
    for (const text of [ZIRAAT, spaced(ZIRAAT), ZIRAAT.toLowerCase(), `IBAN: ${spaced(ZIRAAT)}`]) {
      assert.deepEqual(await host.hint(actions.ibanSpaced, item(text, "iban")), { text: spaced(ZIRAAT) }, text);
      assert.deepEqual(await host.hint(actions.ibanCompact, item(text, "iban")), { text: ZIRAAT }, text);
      assert.deepEqual(await host.run(actions.ibanCompact, item(text, "iban")), { text: ZIRAAT }, text);
    }
    assert.deepEqual(await host.hint(actions.ibanSpaced, item(OTHERS.NO, "iban")), { text: spaced(OTHERS.NO) });
  });

  test("somethingElseSaysSo", async () => {
    assert.deepEqual(await hostIn("en").run(actions.ibanSpaced, item("hello")), { none: true, message: "This is not a valid IBAN." });
    assert.deepEqual(await hostIn("tr").run(actions.ibanCompact, item("merhaba")), { none: true, message: "Bu geçerli bir IBAN değil." });
    assert.deepEqual(await hostIn("en").run(actions.ibanCompact, null), { none: true, message: "This is not a valid IBAN." });
  });

  test("theActionsAreOfferedOnlyOnTaggedItems", () => {
    const host = hostIn();
    assert.deepEqual(host.offers(item(spaced(ZIRAAT), "iban")), ["ibanSpaced", "ibanCompact"]);
    assert.deepEqual(host.offers(item(spaced(ZIRAAT))), []);
  });
});

describe("bankTable", () => {
  test("holdsEveryParticipantOfBothLists", () => {
    // 70 participants of the TCMB payment systems and 11 payment and e-money institutions that only the FAST list has.
    assert.equal(participantCount, 81);
  });

  test("namesTheBanksByTheirCode", () => {
    const expected = {
      "00010": "T.C. Ziraat Bankası", "00012": "Türkiye Halk Bankası", "00015": "Türkiye Vakıflar Bankası",
      "00046": "Akbank", "00062": "Türkiye Garanti Bankası", "00064": "Türkiye İş Bankası", "00067": "Yapı ve Kredi Bankası",
      "00111": "QNB Bank", "00134": "Denizbank", "00157": "Enpara Bank", "00205": "Kuveyt Türk Katılım Bankası",
      "00807": "Posta ve Telgraf Teşkilatı", "00829": "Papara Elektronik Para",
    };
    for (const [code, name] of Object.entries(expected)) assert.equal(bankName(code), name, code);
  });

  test("otherCodesAreUnknown", () => {
    for (const code of ["00150", "00208", "99999", "10010", "0010", "000100", "toString", "__proto__", ""]) assert.equal(bankName(code), null, code);
  });

  test("parsingIsStrictAboutTheWholeText", () => {
    assert.equal(parseIban(`x${ZIRAAT}`), null);
    assert.deepEqual(parseIban(spaced(ZIRAAT)), { compact: ZIRAAT, country: "TR" });
  });
});

describe("ibanTiming", () => {
  test("longAdversarialTextIsAnsweredQuickly", async () => {
    const { accepts } = detector("iban");
    const host = hostIn();
    for (const text of [`TR33${"0".repeat(60_000)}`, `TR33${" 0".repeat(30_000)}!`, `IBAN:${" ".repeat(60_000)}TR`, `${"A".repeat(60_000)}`]) {
      const started = performance.now();
      acceptsMatch(accepts, item(text));
      await host.validate(detectors.iban, item(text));
      await host.preview(detectors.iban, item(text));
      assert.ok(performance.now() - started < 50, `${text.length} characters took ${performance.now() - started} ms`);
    }
  });
});
