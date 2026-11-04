import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions, detectors, limits } from "../src/index.ts";
import { parseNumber, parseQuantity, units, findUnit } from "../src/units.ts";
import { parseEcb, parseMoney, extraCodes } from "../src/currency.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-11-04T10:00:00Z" });
const now = "2026-11-04T10:00:00Z";
const url = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

// The ECB's documented shape: single-quoted attributes, tabs, two namespaces.
const xml = (date = "2026-11-04", rates = { USD: "1.1000", JPY: "160.00", GBP: "0.8500", TRY: "50.0000", CHF: "0.9400" }) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
\t<gesmes:subject>Reference rates</gesmes:subject>
\t<gesmes:Sender>
\t\t<gesmes:name>European Central Bank</gesmes:name>
\t</gesmes:Sender>
\t<Cube>
\t\t<Cube time='${date}'>
${Object.entries(rates).map(([c, r]) => `\t\t\t<Cube currency='${c}' rate='${r}'/>`).join("\n")}
\t\t</Cube>
\t</Cube>
</gesmes:Envelope>`;

const hostWith = (options = {}) => createFakeHost({ folder, now, http: { [url]: { text: xml() } }, ...options });
const language = (lang, options = {}) => hostWith({ context: { language: lang }, ...options });
const valid = (detector, text) => hostWith().validate(detector, item(text));
const unit = (text) => valid(detectors.unit, text);
const money = (text) => valid(detectors.currency, text);

describe("manifest", () => {
  const [unitRule, currencyRule] = manifest.contributes.detectors.map((d) => d.accepts);
  test("theUnitPatternFindsCandidates", () => {
    for (const text of ["5 km", "72°F", "-3.5 kg", "1.234,5 m", "  10 mph\n", "1 234 km", "1h 30m", "5 m²", "−5 °C"]) {
      assert.equal(acceptsMatch(unitRule, item(text)), true, text);
    }
    for (const text of ["km", "hello 5 km", "5", "see 5 km tomorrow", ""]) {
      assert.equal(acceptsMatch(unitRule, item(text)), false, text);
    }
  });
  test("theCurrencyPatternFindsCandidates", () => {
    for (const text of ["$120", "€50", "₺1.250,50", "120 USD", "50 EUR", "100 TL", "USD 120", "1.250,50 ₺", "-$5", "£ 3"]) {
      assert.equal(acceptsMatch(currencyRule, item(text)), true, text);
    }
    for (const text of ["USD", "hello", "$", "buy 120 USD now please thanks"]) {
      assert.equal(acceptsMatch(currencyRule, item(text)), false, text);
    }
  });
  test("onlyTheEcbMayBeReached", () => {
    assert.deepEqual(manifest.network.domains, ["www.ecb.europa.eu"]);
    assert.deepEqual(manifest.permissions, ["network"]);
  });
  test("everyActionIsOfferedOnItsTag", async () => {
    const host = hostWith();
    const tagged = (tag, text) => ({ ...item(text), tags: [`dev.yabbistir.units-currency:${tag}`] });
    const unitOffers = JSON.stringify(await host.offers(tagged("unit", "5 km")));
    assert.match(unitOffers, /convertUnit/);
    assert.doesNotMatch(unitOffers, /convertCurrency/);
    const moneyOffers = JSON.stringify(await host.offers(tagged("currency", "5 USD")));
    assert.match(moneyOffers, /convertCurrency/);
    assert.doesNotMatch(moneyOffers, /convertUnit/);
  });
});

describe("number formats", () => {
  const cases = [
    ["1234", false, 1234], ["1,234.5", false, 1234.5], ["1.234,5", false, 1234.5], ["1 234,5", false, 1234.5],
    ["1 234.5", false, 1234.5], ["1'234.5", false, 1234.5], ["3,5", false, 3.5], ["3.5", true, 3.5],
    ["1,234", false, 1234], ["1,234", true, 1.234], ["1.234", false, 1.234], ["1.234", true, 1234],
    ["1.234.567", false, 1234567], ["1,234,567", true, 1234567], ["0,500", false, 0.5], ["0.500", true, 0.5],
    ["12,34", false, 12.34], ["1.2345", true, 1.2345], ["1,2345", false, 1.2345], ["1 234 567", false, 1234567],
  ];
  for (const [text, comma, expected] of cases) {
    test(`reads ${text} (${comma ? "comma" : "dot"} language)`, () => assert.equal(parseNumber(text, comma), expected));
  }
  test("rejectsBrokenNumbers", () => {
    for (const text of ["", "abc", "1.2.3", "1,2,3", "12 34", "1.234,56,7", "1,234.567,8", ",5", ".5", "1 2345", "5'"]) {
      assert.equal(parseNumber(text, false), null, text);
    }
  });
  test("theLanguageDecidesAmbiguousGroups", async () => {
    const tr = await language("tr").preview(detectors.unit, item("1.234 km"), { language: "tr" });
    assert.deepEqual(tr[0].rows[0][0], "mi");
    assert.equal(tr[0].title, "1.234 km");
    const en = await language("en").preview(detectors.unit, item("1.234 km"), { language: "en" });
    assert.equal(en[0].title, "1.23 km");
  });
});

describe("unit families", () => {
  const good = [
    "5 mm", "5 cm", "5 m", "5 km", "5 in", "5 ft", "5 yd", "5 mi", "5 miles", "5 inches", "5 feet",
    "5 mg", "5 g", "5 kg", "5 t", "5 oz", "5 lb", "5 lbs", "5 st",
    "20 °C", "72°F", "300 K", "20 C", "72 F", "20 ℃", "20 celsius",
    "5 ml", "5 l", "5 L", "5 cl", "5 gal", "5 qt", "5 pt", "5 fl oz", "5 floz", "5 fl. oz.", "5 cup", "2 tbsp", "2 tsp",
    "50 km/h", "50 kmh", "30 mph", "10 m/s", "12 kn", "12 knots",
    "5 m²", "5 km²", "5 ha", "5 acre", "500 ft²", "500 sq ft", "5 m2", "5 sqm",
    "5 B", "5 KB", "5 MB", "5 GB", "5 TB", "5 kB", "5 mb", "5 KiB", "5 MiB", "5 GiB", "5 TiB", "1,5 GB",
    "90 s", "90 sec", "90 min", "2 h", "2 hours", "3 days", "2 weeks", "500 ms", "1h 30m", "2d 4h", "1 h 30 min 15 s",
    "5km", "-5 km", "+5 km", "−5 km", "0 km", "1 234 km", "1.234,5 m", "1,234.5 m",
  ];
  for (const text of good) test(`tags ${text}`, async () => assert.equal(await unit(text), true));

  const bad = [
    "", "km", "5", "hello", "5 apples", "5 xyz", "5 Mb", "5 Gb", "5 Kb", "1h 1h", "30m 1h", "1h 30", "5 km extra",
    "1.2.3 km", "5 km 3", "1e5 km", "NaN km", "-500 °C", "-1 K", "-460 °F", "1e300 km", "9999999999999999 km",
    "5 c", "5 f", "0x10 km",
  ];
  for (const text of bad) test(`does not tag ${JSON.stringify(text)}`, async () => assert.equal(await unit(text), false));

  test("everyAliasIsUniqueAndNormalized", () => {
    const seen = new Map();
    for (const u of units) {
      for (const alias of u.aliases) {
        assert.equal(alias, alias.toLowerCase(), alias);
        if (seen.has(alias)) assert.fail(`${alias} is in ${seen.get(alias)} and ${u.id}`);
        seen.set(alias, u.id);
      }
    }
  });

  test("ambiguousUnitsResolveTheCommonWay", () => {
    assert.equal(parseQuantity("5 oz").unit.dim, "mass");
    assert.equal(parseQuantity("5 fl oz").unit.dim, "volume");
    assert.equal(parseQuantity("5 t").unit.id, "t");
    assert.equal(parseQuantity("5 T").unit.id, "t");
    assert.equal(parseQuantity("5 pt").unit.dim, "volume");
    assert.equal(parseQuantity("5 ms").unit.dim, "time");
    assert.equal(parseQuantity("5 m/s").unit.dim, "speed");
    assert.equal(parseQuantity("5 m").unit.dim, "length");
    assert.equal(parseQuantity("5 MB").unit.id, "MB");
    assert.equal(parseQuantity("5 MiB").unit.id, "MiB");
    assert.equal(findUnit("Mb"), null);
  });
});

describe("unit conversions", () => {
  const run = (action, text, lang = "en", extra = {}) => language(lang).run(action, item(text), extra);

  test("temperatureOffsets", async () => {
    assert.deepEqual(await run(actions.convertUnit, "72 °F"), { text: "22.22 °C" });
    assert.deepEqual(await run(actions.convertUnit, "0 °C"), { text: "32 °F" });
    assert.deepEqual(await run(actions.convertUnit, "100 °C"), { text: "212 °F" });
    assert.deepEqual(await run(actions.convertUnit, "-40 °F"), { text: "-40 °C" });
    assert.deepEqual(await run(actions.convertUnit, "300 K"), { text: "26.85 °C" });
    assert.deepEqual(await run(actions.convertUnitAll, "0 K"), { text: "-273.15 °C\n-459.67 °F" });
  });

  test("lengthGoesToTheOtherSystemFirst", async () => {
    assert.deepEqual(await run(actions.convertUnit, "5 mi"), { text: "8.05 km" });
    assert.deepEqual(await run(actions.convertUnit, "100 km"), { text: "62.14 mi" });
    assert.deepEqual(await run(actions.convertUnit, "72 in"), { text: "1.83 m" });
    assert.deepEqual(await run(actions.convertUnit, "6 ft"), { text: "1.83 m" });
  });

  test("massVolumeSpeedArea", async () => {
    assert.deepEqual(await run(actions.convertUnit, "150 lb"), { text: "68.04 kg" });
    assert.deepEqual(await run(actions.convertUnit, "1 kg"), { text: "2.2 lb" });
    assert.deepEqual(await run(actions.convertUnit, "1 gal"), { text: "3.79 l" });
    assert.deepEqual(await run(actions.convertUnit, "250 ml"), { text: "1.06 cup" });
    assert.deepEqual(await run(actions.convertUnit, "100 km/h"), { text: "62.14 mph" });
    assert.deepEqual(await run(actions.convertUnit, "60 mph"), { text: "96.56 km/h" });
    assert.deepEqual(await run(actions.convertUnit, "1 acre"), { text: "0.405 ha" });
    assert.deepEqual(await run(actions.convertUnit, "1000 ft²"), { text: "92.9 m²" });
  });

  test("dataAndTimeStayInTheirOwnScale", async () => {
    assert.deepEqual(await run(actions.convertUnit, "1500 MB"), { text: "1.5 GB" });
    assert.deepEqual(await run(actions.convertUnit, "90 min"), { text: "1.5 h" });
    assert.deepEqual(await run(actions.convertUnit, "1h 30m"), { text: "1.5 h" });
    assert.deepEqual(await run(actions.convertUnit, "7200 s"), { text: "2 h" });
    const all = await run(actions.convertUnitAll, "1 GiB");
    assert.match(all.text, /1\.07 GB/);
    assert.match(all.text, /1,024 MiB/);
  });

  test("theAllActionListsSeveralLines", async () => {
    const result = await run(actions.convertUnitAll, "5 mi");
    const lines = result.text.split("\n");
    assert.equal(lines[0], "8.05 km");
    assert.ok(lines.length >= 4 && lines.length <= 6, result.text);
    assert.ok(!lines.some((line) => line.endsWith(" mi")));
  });

  test("numbersFollowTheLanguage", async () => {
    assert.deepEqual(await run(actions.convertUnit, "72 °F", "tr"), { text: "22,22 °C" });
    assert.deepEqual(await run(actions.convertUnit, "1,5 km", "tr"), { text: "0,932 mi" });
    assert.deepEqual(await run(actions.convertUnit, "1,234 km", "en"), { text: "766.77 mi" });
    assert.deepEqual(await run(actions.convertUnit, "0.001 km", "en"), { text: "1.09 yd" });
    assert.deepEqual(await run(actions.convertUnit, "0.5 km", "en"), { text: "0.311 mi" });
    assert.deepEqual(await run(actions.convertUnit, "0.5 km", "tr"), { text: "0,311 mi" });
  });

  test("zeroAndNegativeValues", async () => {
    assert.deepEqual(await run(actions.convertUnit, "0 km"), { text: "0 mi" });
    assert.deepEqual(await run(actions.convertUnit, "-5 km"), { text: "-3.11 mi" });
  });

  test("somethingElseSaysSoPlainly", async () => {
    const result = await run(actions.convertUnit, "hello");
    assert.deepEqual(result, { none: true, message: "This is not a number with a unit." });
    assert.deepEqual(await run(actions.convertUnitAll, ""), { none: true, message: "This is not a number with a unit." });
  });

  test("previewShowsTheSameConversions", async () => {
    const [section] = await hostWith().preview(detectors.unit, item("72 °F"), { language: "en" });
    assert.equal(section.type, "keyValue");
    assert.equal(section.title, "72 °F");
    assert.deepEqual(section.rows[0], ["°C", "22.22"]);
    assert.deepEqual(section.rows.map((r) => r[0]), ["°C", "K"]);
    assert.deepEqual(await hostWith().preview(detectors.unit, item("hello"), { language: "en" }), []);
    const [compound] = await hostWith().preview(detectors.unit, item("1h 30m"), { language: "en" });
    assert.equal(compound.title, "1h 30m");
    assert.deepEqual(compound.rows[0], ["h", "1.5"]);
  });

  test("hugeAndTinyResultsUseExponents", async () => {
    const result = await run(actions.convertUnit, "1 TiB");
    assert.ok(result.text);
    const tiny = await run(actions.convertUnitAll, "1 ms");
    assert.ok(tiny.text.split("\n").length >= 3);
  });
});

describe("money parsing", () => {
  const cases = [
    ["120 USD", 120, "USD"], ["$120", 120, "USD"], ["€50", 50, "EUR"], ["₺1.250,50", 1250.5, "TRY"], ["50 EUR", 50, "EUR"],
    ["100 TL", 100, "TRY"], ["100 tl", 100, "TRY"], ["USD 120", 120, "USD"], ["usd120", 120, "USD"], ["120$", 120, "USD"],
    ["50€", 50, "EUR"], ["1.250,50 ₺", 1250.5, "TRY"], ["£3.99", 3.99, "GBP"], ["¥1,000", 1000, "JPY"], ["$1,234.56", 1234.56, "USD"],
    ["-$5", -5, "USD"], ["−€5", -5, "EUR"], ["$ 12", 12, "USD"], ["12 jpy", 12, "JPY"], ["₹99", 99, "INR"], ["₩1.000.000", 1000000, "KRW"],
    ["1 234,50 EUR", 1234.5, "EUR"], ["0 USD", 0, "USD"],
  ];
  for (const [text, amount, code] of cases) {
    test(`reads ${text}`, () => assert.deepEqual(parseMoney(text, false), { amount, code }));
  }
  test("rejectsOtherText", () => {
    for (const text of ["", "USD", "$", "120", "120 XYZ", "hello 5 USD", "120 USD now", "1.2.3 USD", "5 km", "10 SOL", "1e5 USD", "$$5"]) {
      assert.equal(parseMoney(text, false), null, text);
    }
  });
  test("theLanguageSettlesAmbiguousGroups", () => {
    assert.equal(parseMoney("₺1.250", true).amount, 1250);
    assert.equal(parseMoney("$1,250", false).amount, 1250);
    assert.equal(parseMoney("$1,250", true).amount, 1.25);
  });
  test("theDetectorAcceptsMoneyAndNotUnits", async () => {
    assert.equal(await money("120 USD"), true);
    assert.equal(await money("5 km"), false);
    assert.equal(await unit("120 USD"), false);
  });
  test("extraCodesAreCleaned", () => {
    assert.deepEqual(extraCodes("jpy, CHF; sek  xxx jpy"), ["JPY", "CHF", "SEK"]);
    assert.deepEqual(extraCodes(""), []);
    assert.deepEqual(extraCodes(5), []);
    assert.deepEqual(extraCodes("$ €"), []);
  });
});

describe("ECB rates", () => {
  test("parsesTheDocumentedShape", () => {
    assert.deepEqual(parseEcb(xml()), { date: "2026-11-04", rates: { EUR: 1, USD: 1.1, JPY: 160, GBP: 0.85, TRY: 50, CHF: 0.94 } });
  });
  test("parsesDoubleQuotesAndAttributeOrder", () => {
    const text = `<Cube time="2026-01-02"><Cube rate="2.5" currency="USD"/></Cube>`;
    assert.deepEqual(parseEcb(text), { date: "2026-01-02", rates: { EUR: 1, USD: 2.5 } });
  });
  test("rejectsOtherDocuments", () => {
    for (const text of ["", "<html></html>", "<Cube/>", `<Cube time='bad'><Cube currency='USD' rate='1'/></Cube>`,
      `<Cube time='2026-01-01'></Cube>`, `<Cube time='2026-01-01'><Cube currency='USD' rate='abc'/></Cube>`,
      `<Cube time='2026-01-01'><Cube currency='USD' rate='0'/></Cube>`, `<Cube time='2026-01-01'><Cube currency='USD' rate='1'`]) {
      assert.equal(parseEcb(text), null, text);
    }
  });
  test("isLinearOnHostileInput", () => {
    const started = Date.now();
    parseEcb("<Cube " + "a='".repeat(30_000));
    parseEcb("<Cube ".repeat(30_000));
    parseEcb("<Cube time='2026-01-01'>" + "<Cube currency='USD' rate='1'/>".repeat(5000));
    assert.ok(Date.now() - started < 1500);
  });
});

describe("currency actions", () => {
  const variant = (host, code, text, lang = "en") => host.run(actions.convertCurrency, item(text), { variant: code, language: lang });

  test("convertsWithTheDaysRates", async () => {
    const host = hostWith();
    assert.deepEqual(await variant(host, "eur", "110 USD"), { text: "€100.00" });
    assert.deepEqual(await variant(host, "try", "110 USD"), { text: "TRY 5,000.00" });
    assert.deepEqual(await variant(host, "usd", "50 EUR"), { text: "$55.00" });
    assert.deepEqual(await variant(host, "gbp", "100 EUR"), { text: "£85.00" });
    assert.deepEqual(await variant(host, "eur", "$110"), { text: "€100.00" });
    assert.deepEqual(await variant(host, "usd", "₺1.250,00"), { text: "$27.50" });
  });

  test("theLanguageFormatsTheResult", async () => {
    const host = language("tr");
    assert.deepEqual(await variant(host, "try", "110 USD", "tr"), { text: "₺5.000,00" });
    assert.deepEqual(await variant(host, "eur", "1.100,00 USD", "tr"), { text: "€1.000,00" });
  });

  test("tellsTheRateDate", async () => {
    const host = hostWith();
    await variant(host, "eur", "110 USD");
    assert.deepEqual(host.notifications, ["European Central Bank rate of 2026-11-04"]);
  });

  test("fetchesOnceAndReusesTheCache", async () => {
    let requests = 0;
    const host = hostWith({ http: () => { requests += 1; return { text: xml() }; } });
    await variant(host, "eur", "110 USD");
    await variant(host, "try", "110 USD");
    await variant(host, "gbp", "110 USD");
    assert.equal(requests, 1);
    assert.equal(host.storage.ecb.date, "2026-11-04");
  });

  test("anOldCacheIsRefreshed", async () => {
    let requests = 0;
    const seven = Date.parse(now) - 7 * 60 * 60 * 1000;
    const host = hostWith({
      storage: { ecb: { date: "2026-11-03", fetchedAt: seven, rates: { EUR: 1, USD: 2 } } },
      http: () => { requests += 1; return { text: xml() }; },
    });
    assert.deepEqual(await variant(host, "eur", "110 USD"), { text: "€100.00" });
    assert.equal(requests, 1);
    assert.equal(host.storage.ecb.date, "2026-11-04");
  });

  test("aFreshCacheIsUsedWithoutTheNetwork", async () => {
    const fresh = Date.parse(now) - 60 * 60 * 1000;
    const host = hostWith({
      storage: { ecb: { date: "2026-11-03", fetchedAt: fresh, rates: { EUR: 1, USD: 2, TRY: 40 } } },
      http: () => assert.fail("no request expected"),
    });
    assert.deepEqual(await variant(host, "eur", "10 USD"), { text: "€5.00" });
    assert.deepEqual(host.notifications, ["European Central Bank rate of 2026-11-03"]);
  });

  test("aCacheFromTheFutureIsNotTrusted", async () => {
    const future = Date.parse(now) + 60 * 60 * 1000;
    const host = hostWith({ storage: { ecb: { date: "2026-11-03", fetchedAt: future, rates: { EUR: 1, USD: 9 } } } });
    assert.deepEqual(await variant(host, "eur", "110 USD"), { text: "€100.00" });
  });

  test("offlineUsesOlderRatesAndSaysSo", async () => {
    const old = Date.parse(now) - 3 * 24 * 60 * 60 * 1000;
    const host = hostWith({
      storage: { ecb: { date: "2026-11-01", fetchedAt: old, rates: { EUR: 1, USD: 2 } } },
      http: { [url]: yabError("networkError", "offline") },
    });
    assert.deepEqual(await variant(host, "eur", "10 USD"), { text: "€5.00" });
    assert.deepEqual(host.notifications, ["Offline. Using the rate of 2026-11-01"]);
  });

  test("offlineWithoutACacheSaysSo", async () => {
    const host = hostWith({ http: { [url]: yabError("networkError", "offline") } });
    assert.deepEqual(await variant(host, "eur", "10 USD"), {
      none: true, message: "Couldn’t reach the European Central Bank, and there are no saved rates yet.",
    });
    assert.equal(host.storage.ecb, undefined);
  });

  test("badAnswersAreFailuresToo", async () => {
    for (const answer of [{ status: 500, text: "oops" }, { status: 200, text: "<html>captive portal</html>" }, { status: 200, text: "" }]) {
      const host = hostWith({ http: { [url]: answer } });
      const result = await variant(host, "eur", "10 USD");
      assert.equal(result.none, true);
      assert.equal(host.storage.ecb, undefined);
    }
  });

  test("aSlowAnswerTimesOut", async () => {
    const before = limits.fetchMs;
    limits.fetchMs = 30;
    try {
      const host = hostWith({ http: () => new Promise(() => {}) });
      const result = await variant(host, "eur", "10 USD");
      assert.equal(result.none, true);
    } finally {
      limits.fetchMs = before;
    }
  });

  test("aBrokenCacheIsIgnored", async () => {
    for (const bad of [null, "text", { date: 5 }, { date: "2026-11-03", fetchedAt: "x", rates: {} }, { date: "2026-11-03", fetchedAt: 1, rates: { USD: -1 } }]) {
      const host = hostWith({ storage: { ecb: bad } });
      assert.deepEqual(await variant(host, "eur", "110 USD"), { text: "€100.00" });
    }
  });

  test("otherNetworkHostsAreNeverReached", async () => {
    const host = hostWith();
    await variant(host, "eur", "110 USD");
    const fetched = host.calls.filter((c) => c.api === "http.fetch").map((c) => new URL(c.args[0]).host);
    assert.deepEqual(fetched, ["www.ecb.europa.eu"]);
  });

  test("theSameCurrencyDoesNothing", async () => {
    const host = hostWith({ http: () => assert.fail("no request expected") });
    assert.deepEqual(await variant(host, "usd", "110 USD"), { none: true, message: "There is no other currency to convert to." });
  });

  test("aCurrencyWithoutARateSaysSo", async () => {
    const host = hostWith({ http: { [url]: { text: xml("2026-11-04", { USD: "1.1" }) } } });
    assert.deepEqual(await variant(host, "usd", "100 TRY"), { none: true, message: "The European Central Bank has no rate for TRY." });
    // A source currency the ECB does list, but a target it does not, is skipped rather than guessed.
    assert.deepEqual(await variant(host, "try", "10 USD"), { none: true, message: "There is no other currency to convert to." });
  });

  test("notMoneySaysSo", async () => {
    const host = hostWith({ http: () => assert.fail("no request expected") });
    assert.deepEqual(await variant(host, "eur", "hello"), { none: true, message: "This is not an amount of money." });
    assert.deepEqual(await host.run(actions.convertCurrency, item("5 USD"), { variant: null }), { none: true, message: "There is no other currency to convert to." });
  });

  test("theAllActionListsTheDefaultsWithoutTheSource", async () => {
    const host = hostWith();
    const result = await host.run(actions.convertCurrencyAll, item("110 USD"));
    assert.deepEqual(result.text.split("\n"), ["TRY 5,000.00", "€100.00", "£85.00"]);
  });

  test("theAllActionAddsThePreferredCurrencies", async () => {
    const host = hostWith({ preferences: { moreCurrencies: "jpy, chf, usd, nope" } });
    const result = await host.run(actions.convertCurrencyAll, item("100 EUR"));
    assert.deepEqual(result.text.split("\n"), ["TRY 5,000.00", "$110.00", "£85.00", "¥16,000", "CHF 94.00"]);
  });

  test("nothingSecretOrPrivateLeavesInNoticesOrLogs", async () => {
    const host = hostWith();
    await variant(host, "eur", "1234.56 USD");
    await host.run(actions.convertCurrencyAll, item("1234.56 USD"));
    for (const text of [...host.notifications, ...host.logs.map(String)]) assert.doesNotMatch(text, /1234|1,234/);
    const requests = host.calls.filter((c) => c.api === "http.fetch");
    assert.ok(requests.every((c) => c.args.length === 1 || !c.args[1].body));
    assert.ok(requests.every((c) => !JSON.stringify(c.args).includes("1234")));
  });
});

describe("currency preview", () => {
  const preview = (host, text, lang = "en") => host.preview(detectors.currency, item(text), { language: lang });
  const cache = { ecb: { date: "2026-11-03", fetchedAt: 1, rates: { EUR: 1, USD: 1.1, TRY: 50, GBP: 0.85, JPY: 160 } } };

  test("withoutCachedRatesItPromisesThemAndFetchesNothing", async () => {
    const host = hostWith({ http: () => assert.fail("no request expected") });
    const sections = await preview(host, "110 USD");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].type, "text");
    assert.equal(host.calls.filter((c) => c.api === "http.fetch").length, 0);
  });

  test("withCachedRatesItShowsConversionsAndTheirDate", async () => {
    const host = hostWith({ storage: cache });
    const [rows, source] = await preview(host, "110 USD");
    assert.equal(rows.title, "$110.00");
    assert.deepEqual(rows.rows, [["TRY", "TRY 5,000.00"], ["EUR", "€100.00"], ["GBP", "£85.00"]]);
    assert.deepEqual(source, { type: "text", title: "Rates", text: "European Central Bank · 2026-11-03" });
  });

  test("thePreferredCurrenciesJoin", async () => {
    const host = hostWith({ storage: cache, preferences: { moreCurrencies: "JPY" } });
    const [rows] = await preview(host, "100 EUR");
    assert.deepEqual(rows.rows.map((r) => r[0]), ["TRY", "USD", "GBP", "JPY"]);
  });

  test("turkishFormatting", async () => {
    const host = language("tr", { storage: cache });
    const [rows] = await preview(host, "1.100,00 USD", "tr");
    assert.deepEqual(rows.rows[0], ["TRY", "₺50.000,00"]);
  });

  test("unknownOrNonMoneyShowsNothing", async () => {
    const host = hostWith({ storage: cache });
    assert.deepEqual(await preview(host, "hello"), []);
    const [only] = await preview(host, "5 CHF");
    assert.equal(only.type, "text");
  });
});

describe("speed", () => {
  const ms = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
  const hostile = [
    "9".repeat(60_000), "1,".repeat(30_000), "1 ".repeat(30_000), "1.".repeat(30_000) + "km", "$" + "9,".repeat(30_000),
    "1h ".repeat(20_000), "a".repeat(60_000), "€".repeat(60_000), "0".repeat(100) + " km",
    "5 " + "k".repeat(60_000), "USD " + "1 ".repeat(30_000),
  ];
  test("validateStaysWellUnderTheLimit", async () => {
    const host = hostWith();
    for (const text of [...hostile, "1 234 567,89 km", "1h 30m 15s", "$1,234,567.89"]) {
      for (const detector of [detectors.unit, detectors.currency]) {
        assert.equal(ms(() => detector.validate(item(text))) < 25, true, text.slice(0, 12));
      }
    }
    assert.equal(await host.validate(detectors.unit, item("9".repeat(60_000))), false);
  });
  test("theManifestPatternsAreFastOnLongInput", () => {
    for (const { accepts } of manifest.contributes.detectors) {
      for (const text of hostile) assert.equal(ms(() => acceptsMatch(accepts, item(text))) < 100, true);
    }
  });
  test("previewsAndActionsAreFastToo", async () => {
    const host = hostWith();
    for (const text of hostile) {
      assert.deepEqual(await host.preview(detectors.unit, item(text), { language: "en" }), []);
      assert.equal((await host.run(actions.convertUnit, item(text))).none, true);
    }
  });
});

describe("localization", () => {
  test("turkishHasEveryKeyEnglishHas", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  });
  test("messagesAreTurkishInTurkish", async () => {
    const host = language("tr");
    const result = await host.run(actions.convertUnit, item("merhaba"));
    assert.equal(result.message, "Bu, birimli bir sayı değil.");
    const offline = createFakeHost({ folder, now, context: { language: "tr" }, http: { [url]: yabError("networkError", "x") } });
    const none = await offline.run(actions.convertCurrency, item("5 USD"), { variant: "eur" });
    assert.match(none.message, /Avrupa Merkez Bankası/);
  });
});

describe("false positives (fix round 1)", () => {
  const run = (action, text) => hostWith().run(action, item(text), {});
  test("ordinary copies are not tagged as units", async () => {
    for (const text of ["10k", "1st", "2nd", "3rd", "5sa", "2d", "3w", "7dk", "4sn"]) {
      assert.equal(parseQuantity(text), null, text);
      assert.ok(!(await unit(text)), text);
    }
  });
  test("spaced or capital forms still work", () => {
    assert.ok(parseQuantity("10 K"));
    assert.ok(parseQuantity("300K"));
    assert.ok(parseQuantity("1 st"));
    assert.ok(parseQuantity("2 d"));
    assert.equal(parseQuantity("10k"), null);
  });
  test("two-letter currency codes lead the amount in the manifest pattern", () => {
    const pattern = new RegExp(manifest.contributes.detectors.find((d) => d.id === "currency").accepts.pattern, "u");
    assert.ok(pattern.test("TL 100"));
    assert.ok(parseMoney("tl 5"));
  });
  test("byte values do not list vanishingly small conversions", async () => {
    const result = await run(actions.convertUnitAll, "5 B");
    assert.ok(!/0\.0000/.test(result.text), result.text);
  });
});
