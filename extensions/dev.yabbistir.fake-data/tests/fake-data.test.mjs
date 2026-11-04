import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, localeFor } from "../src/index.ts";
import { useRandomSource, int } from "../src/random.ts";
import { fold } from "../src/generators.ts";
import { emailDomains, testCards, trBankCodes, firstNames, lastNames } from "../src/data.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));

/** A repeatable random source (mulberry32), so a hint and a run can be compared. */
function seeded(seed) {
  let state = seed >>> 0;
  return (array) => {
    for (let i = 0; i < array.length; i += 1) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      array[i] = (t ^ (t >>> 14)) >>> 0;
    }
    return array;
  };
}

afterEach(() => useRandomSource(null));

const make = (preferences = {}, language = "en", now) =>
  createFakeHost({ folder, preferences, context: { language }, ...(now ? { now } : {}) });
const gen = async (host, action, variant) => (await host.run(actions[action], null, variant ? { variant } : {})).text;

// Independent checkers, written from the published algorithms and not shared with the source.
function validTckn(text) {
  if (!/^[1-9]\d{10}$/.test(text)) return false;
  const d = [...text].map(Number);
  const tenth = (((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10 + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}
function validVkn(text) {
  if (!/^\d{10}$/.test(text)) return false;
  const d = [...text].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const a = (d[i] + (9 - i)) % 10;
    let b = (a * Math.pow(2, 9 - i)) % 9;
    if (a !== 0 && b === 0) b = 9;
    sum += b;
  }
  return d[9] === (10 - (sum % 10)) % 10;
}
function validIban(text) {
  if (!/^TR\d{24}$/.test(text)) return false;
  const moved = text.slice(4) + "2927" + text.slice(2, 4);
  return BigInt(moved) % 97n === 1n;
}
function luhn(number) {
  let sum = 0;
  [...number].reverse().forEach((char, i) => {
    let n = Number(char);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  });
  return sum % 10 === 0;
}

describe("the checkers themselves", () => {
  test("agreeWithPublishedExamples", () => {
    assert.equal(validTckn("10000000146"), true);
    assert.equal(validTckn("10000000147"), false);
    assert.equal(validIban("TR330006100519786457841326"), true);
    assert.equal(validIban("TR330006100519786457841327"), false);
    assert.equal(luhn("4111111111111111"), true);
    assert.equal(luhn("4111111111111112"), false);
  });
});

describe("numbers", () => {
  test("tcknHasValidChecksums", async () => {
    const host = make();
    for (let i = 0; i < 300; i += 1) assert.equal(validTckn(await gen(host, "numbers", "tckn")), true);
  });

  test("vknHasAValidCheckDigit", async () => {
    const host = make();
    for (let i = 0; i < 300; i += 1) assert.equal(validVkn(await gen(host, "numbers", "vkn")), true);
  });

  test("ibanHasValidChecksAndAKnownBankCode", async () => {
    const host = make();
    for (let i = 0; i < 300; i += 1) {
      const value = await gen(host, "numbers", "iban");
      assert.equal(value.length, 26);
      assert.equal(validIban(value), true, value);
      assert.ok(trBankCodes.includes(value.slice(4, 9)), value);
      assert.equal(value[9], "0", "the reserved digit");
    }
  });

  test("ibanBankCodesVary", async () => {
    const host = make();
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add((await gen(host, "numbers", "iban")).slice(4, 9));
    assert.ok(seen.size > 3);
  });

  test("cardsAreTheNetworksPublishedTestNumbers", async () => {
    const host = make();
    assert.equal(await gen(host, "numbers", "visa"), "4111 1111 1111 1111");
    assert.equal(await gen(host, "numbers", "mastercard"), "5555 5555 5555 4444");
    assert.equal(await gen(host, "numbers", "amex"), "3782 822463 10005");
    for (const network of Object.keys(testCards)) {
      assert.equal(luhn(testCards[network]), true);
      const shown = await gen(host, "numbers", network);
      assert.equal(shown.replace(/ /g, ""), testCards[network]);
    }
  });

  test("turkishNumbersIgnoreTheLocale", async () => {
    const host = make({ locale: "en" });
    assert.equal(validTckn(await gen(host, "numbers", "tckn")), true);
    assert.equal(validIban(await gen(host, "numbers", "iban")), true);
  });

  test("adversarialSourcesStillGiveValidNumbers", async () => {
    for (const fill of [0, 0xffffffff]) {
      useRandomSource((array) => array.fill(fill));
      const host = make();
      assert.equal(validTckn(await gen(host, "numbers", "tckn")), true);
      assert.equal(validVkn(await gen(host, "numbers", "vkn")), true);
      assert.equal(validIban(await gen(host, "numbers", "iban")), true);
    }
  });
});

describe("people and contacts", () => {
  test("namesFollowTheLocale", async () => {
    for (const [locale, code] of [["tr", "tr"], ["en", "en"]]) {
      const host = make({ locale });
      for (let i = 0; i < 60; i += 1) {
        const [first, ...rest] = (await gen(host, "person", "fullName")).split(" ");
        assert.ok(firstNames[code].includes(first));
        assert.ok(lastNames[code].includes(rest.join(" ")));
      }
    }
  });

  test("firstAndLastNameAreSingleListEntries", async () => {
    const host = make({ locale: "tr" });
    assert.ok(firstNames.tr.includes(await gen(host, "person", "firstName")));
    assert.ok(lastNames.tr.includes(await gen(host, "person", "lastName")));
  });

  test("emailDomainIsAlwaysReserved", async () => {
    for (const locale of ["tr", "en"]) {
      const host = make({ locale });
      for (let i = 0; i < 300; i += 1) {
        const value = await gen(host, "contact", "email");
        assert.match(value, /^[a-z0-9._]+@example\.(com|org|net)$/);
        assert.ok(emailDomains.includes(value.split("@")[1]));
      }
    }
  });

  test("turkishLettersAreFoldedInEmailsAndUsernames", async () => {
    assert.equal(fold("Şükrü"), "sukru");
    assert.equal(fold("İbrahim Çağlar Ğ Ö ı"), "ibrahimcaglargoi");
    const host = make({ locale: "tr" });
    for (let i = 0; i < 200; i += 1) {
      assert.match(await gen(host, "contact", "email"), /^[a-z0-9._]+@/);
      assert.match(await gen(host, "person", "username"), /^[a-z0-9._-]+$/);
    }
  });

  test("phonesFollowTheLocale", async () => {
    const turkish = make({ locale: "tr" });
    const english = make({ locale: "en" });
    for (let i = 0; i < 100; i += 1) {
      assert.match(await gen(turkish, "contact", "phone"), /^\+90 5\d{2} \d{3} \d{2} \d{2}$/);
      assert.match(await gen(english, "contact", "phone"), /^\+1 \(\d{3}\) 555-01\d{2}$/);
    }
  });

  test("addressesAndCitiesFollowTheLocale", async () => {
    const turkish = make({ locale: "tr" });
    const english = make({ locale: "en" });
    for (let i = 0; i < 60; i += 1) {
      assert.match(await gen(turkish, "contact", "address"), /^.+ (Sokak|Caddesi) No: \d+\/\d+, .+\/.+ \d{5}$/u);
      assert.match(await gen(english, "contact", "address"), /^\d+ \w+ (Street|Avenue|Road|Lane|Drive), [A-Za-z ]+, [A-Z]{2} \d{5}$/);
    }
    const cities = new Set();
    for (let i = 0; i < 200; i += 1) cities.add(await gen(turkish, "contact", "city"));
    assert.ok(cities.has("İstanbul") || cities.has("Ankara"));
    assert.ok(![...cities].includes("Seattle"));
  });

  test("companyAndJobTitleFollowTheLocale", async () => {
    const turkish = make({ locale: "tr" });
    const english = make({ locale: "en" });
    assert.match(await gen(turkish, "work", "company"), /(A\.Ş\.|Ltd\. Şti\.)$/u);
    assert.match(await gen(english, "work", "company"), /(Inc\.|LLC|Ltd\.)$/);
    assert.ok((await gen(turkish, "work", "jobTitle")).length > 3);
    assert.ok((await gen(english, "work", "jobTitle")).length > 3);
  });

  test("dateOfBirthIsAnAdultAndARealDate", async () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const host = make({}, "en", now);
    for (let i = 0; i < 400; i += 1) {
      const value = await gen(host, "person", "birthDate");
      assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
      const born = new Date(`${value}T00:00:00Z`);
      assert.equal(born.toISOString().slice(0, 10), value, "a real calendar date");
      const eighteen = new Date(Date.UTC(2008, 10, 4));
      const eighty = new Date(Date.UTC(1946, 10, 4));
      assert.ok(born <= eighteen && born >= eighty, value);
    }
  });

  test("dateOfBirthOnALeapDayStillMeansAdult", async () => {
    const now = new Date("2028-02-29T00:00:00Z");
    const host = make({}, "en", now);
    useRandomSource((array) => array.fill(0xffffffff));
    const value = await gen(host, "person", "birthDate");
    assert.ok(new Date(`${value}T00:00:00Z`) < new Date("2010-03-01T00:00:00Z"), value);
  });
});

describe("lorem and the user object", () => {
  test("sentenceAndParagraph", async () => {
    const host = make();
    for (let i = 0; i < 100; i += 1) {
      const one = await gen(host, "lorem", "sentence");
      assert.match(one, /^[A-Z][a-z ]+\.$/);
      const words = one.slice(0, -1).split(" ").length;
      assert.ok(words >= 6 && words <= 14);
      const many = await gen(host, "lorem", "paragraph");
      const sentences = many.split(". ").length;
      assert.ok(sentences >= 4 && sentences <= 6);
      assert.ok(many.endsWith("."));
    }
  });

  test("loremIsTheSameInBothLocales", async () => {
    const host = make({ locale: "tr" });
    assert.match(await gen(host, "lorem", "sentence"), /^[A-Z][a-z ]+\.$/);
  });

  test("theJsonUserIsValidAndConsistent", async () => {
    for (const locale of ["tr", "en"]) {
      const host = make({ locale });
      for (let i = 0; i < 100; i += 1) {
        const user = JSON.parse(await gen(host, "user"));
        assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.ok(firstNames[locale].includes(user.firstName));
        assert.ok(lastNames[locale].includes(user.lastName));
        assert.ok(user.email.startsWith(fold(user.firstName) + ""), user.email);
        assert.ok(user.email.includes(fold(user.lastName)));
        assert.match(user.email, /@example\.(com|org|net)$/);
        assert.match(user.birthDate, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(user.address.street && user.address.city);
        if (locale === "tr") {
          assert.equal(validTckn(user.tckn), true);
          assert.equal(validIban(user.iban), true);
        } else {
          assert.equal("tckn" in user, false);
          assert.equal("iban" in user, false);
        }
      }
    }
  });

  test("theJsonIsPrettyPrintedWithTwoSpaces", async () => {
    const text = await gen(make(), "user");
    assert.ok(text.startsWith('{\n  "id": '));
    assert.equal(JSON.stringify(JSON.parse(text), null, 2), text);
  });
});

describe("locale", () => {
  test("localeForResolvesAutoFromTheAppLanguage", () => {
    assert.equal(localeFor("auto", "tr"), "tr");
    assert.equal(localeFor("auto", "tr-TR"), "tr");
    assert.equal(localeFor("auto", "en"), "en");
    assert.equal(localeFor("auto", "de"), "en");
    assert.equal(localeFor(undefined, undefined), "en");
    assert.equal(localeFor("tr", "en"), "tr");
    assert.equal(localeFor("en", "tr"), "en");
    assert.equal(localeFor("klingon", "tr"), "tr");
  });

  test("theDefaultFollowsTheAppAndAnExplicitChoiceWins", async () => {
    const turkishApp = make({}, "tr");
    assert.ok(firstNames.tr.includes(await gen(turkishApp, "person", "firstName")));
    const englishApp = make({}, "en");
    assert.ok(firstNames.en.includes(await gen(englishApp, "person", "firstName")));
    const forced = make({ locale: "en" }, "tr");
    assert.ok(firstNames.en.includes(await gen(forced, "person", "firstName")));
    const forcedTr = make({ locale: "tr" }, "en");
    assert.ok(firstNames.tr.includes(await gen(forcedTr, "person", "firstName")));
  });

  test("everyKeyIsInBothLocaleFiles", () => {
    const en = JSON.parse(readFileSync(new URL("locales/en.json", folder), "utf8"));
    const tr = JSON.parse(readFileSync(new URL("locales/tr.json", folder), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
    for (const [key, value] of Object.entries(tr)) {
      if (typeof value === "string" && key !== "lorem.title") assert.notEqual(value, en[key], key);
    }
  });
});

describe("hints and the pasted value", () => {
  const variantsOf = (action) => manifest.contributes.actions.find((entry) => entry.id === action).variants?.map((v) => v.id) ?? [undefined];

  test("everyActionIsAHintedGeneratorWithoutPermissions", () => {
    assert.deepEqual(manifest.permissions, []);
    for (const entry of manifest.contributes.actions) {
      assert.equal(entry.input, "none");
      assert.equal(entry.hint, true);
      assert.equal(typeof actions[entry.id].run, "function", entry.id);
    }
  });

  test("theHintIsExactlyWhatRunPastes", async () => {
    for (const entry of manifest.contributes.actions) {
      for (const variant of variantsOf(entry.id)) {
        for (const locale of ["tr", "en"]) {
          const host = make({ locale });
          const context = variant ? { variant } : {};
          useRandomSource(seeded(42));
          const hinted = await host.hint(actions[entry.id], null, context);
          useRandomSource(seeded(42));
          const pasted = await host.run(actions[entry.id], null, context);
          assert.deepEqual(hinted, pasted, `${entry.id}/${variant}/${locale}`);
          assert.equal(typeof pasted.text, "string");
          assert.ok(pasted.text.length > 0);
        }
      }
    }
  });

  test("everyVariantRunsWellInsideTheHintLimit", async () => {
    const host = make({ locale: "tr" });
    const started = Date.now();
    for (let round = 0; round < 40; round += 1) {
      for (const entry of manifest.contributes.actions) {
        for (const variant of variantsOf(entry.id)) await host.hint(actions[entry.id], null, variant ? { variant } : {});
      }
    }
    // 40 rounds of every variant; one hint has 500 ms, so this whole run is a very loose bound.
    assert.ok(Date.now() - started < 5000);
  });

  test("anUnknownOrMissingVariantFallsBackToTheFirst", async () => {
    const host = make({ locale: "en" });
    assert.ok(firstNames.en.includes((await host.run(actions.person, null, { variant: "nope" })).text.split(" ")[0]));
    assert.ok(firstNames.en.includes((await host.run(actions.person, null, {})).text.split(" ")[0]));
  });

  test("nothingIsLoggedOrCalled", async () => {
    const host = make();
    for (const entry of manifest.contributes.actions) await host.run(actions[entry.id], null, {});
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.calls, []);
    assert.deepEqual(host.notifications, []);
  });
});

describe("randomness", () => {
  test("theDefaultSourceIsCryptoGetRandomValues", () => {
    const original = globalThis.crypto.getRandomValues;
    let calls = 0;
    globalThis.crypto.getRandomValues = function (array) { calls += 1; return original.call(globalThis.crypto, array); };
    try {
      useRandomSource(null);
      int(10);
      assert.ok(calls >= 1);
    } finally {
      globalThis.crypto.getRandomValues = original;
    }
  });

  test("anInjectedSourceMakesOutputRepeatable", async () => {
    const host = make({ locale: "tr" });
    useRandomSource(seeded(7));
    const first = await gen(host, "user");
    useRandomSource(seeded(7));
    assert.equal(await gen(host, "user"), first);
    useRandomSource(seeded(8));
    assert.notEqual(await gen(host, "user"), first);
  });

  test("intStaysInRangeAndIsUnbiasedEnoughOnABadSource", () => {
    useRandomSource((array) => array.fill(0xffffffff));
    for (const max of [1, 2, 7, 10, 97, 1000]) assert.ok(int(max) < max);
    useRandomSource(seeded(1));
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 7000; i += 1) counts[int(7)] += 1;
    for (const count of counts) assert.ok(count > 800 && count < 1200, String(counts));
    assert.throws(() => int(0), RangeError);
    assert.throws(() => int(1.5), RangeError);
  });
});
