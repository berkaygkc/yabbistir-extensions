// The Mac's own time zone decides what "local" means, so the tests fix it before anything reads a date.
process.env.TZ = "Europe/Istanbul";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { actions, detectors, parse } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const detector = manifest.contributes.detectors[0];
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const now = "2026-01-04T12:00:00Z";
const hostIn = (language = "en", extra = {}) => createFakeHost({ folder, now, context: { language }, ...extra });
const en = hostIn("en");

/** Detected the way the app does it: the manifest's pattern first, then validate. */
async function tagged(text, host = en) {
  return acceptsMatch(detector.accepts, item(text)) && (await host.validate(detectors.timestamp, item(text)));
}

describe("what is tagged", () => {
  test("unixTimestampsOfEveryLength", async () => {
    for (const text of ["1767225600", "1767225600000", "1767225600000000", "1767225600000000000", "  1767225600\n"]) {
      assert.equal(await tagged(text), true, text);
    }
  });

  test("isoAndRfc3339", async () => {
    for (const text of [
      "2026-01-01T00:00:00Z", "2026-01-01T00:00:00.123Z", "2026-01-01T03:00:00+03:00", "2026-01-01T03:00:00+0300",
      "2026-01-01T03+03", "2026-01-01T03:00:00.123456789+03:00", "2026-01-01T00:00:00", "2026-01-01 00:00:00",
      "2026-01-01T00:00", "2026-01-01t00:00:00z", "2026-01-01T00:00:00,5Z", "2026-02-28T23:59:59-05:00",
    ]) {
      // "2026-01-01T03+03" has no minutes, which the pattern rightly refuses.
      assert.equal(await tagged(text), text !== "2026-01-01T03+03", text);
    }
  });

  test("rfc2822", async () => {
    for (const text of [
      "Thu, 1 Jan 2026 00:00:00 +0000", "Thu, 01 Jan 2026 03:00:00 +0300", "1 Jan 2026 00:00:00 GMT", "Thu, 1 Jan 2026 00:00 UT",
      "Wed, 31 Dec 2025 19:00:00 EST", "thu, 1 jan 2026 00:00:00 +0000", "Thu,1 Jan 2026 00:00:00 +0000", "Thu, 1 Jan 2026 00:00:00",
    ]) {
      assert.equal(await tagged(text), true, text);
    }
  });

  test("boundaries1990And2100", async () => {
    assert.equal(await tagged("2026-01-01T00:00:00Z"), true);
    assert.equal(parse("1990-01-01T00:00:00Z").ms, Date.UTC(1990, 0, 1));
    assert.equal(await tagged("1990-01-01T00:00:00Z"), true);
    assert.equal(await tagged("1989-12-31T23:59:59Z"), false);
    assert.equal(await tagged("2099-12-31T23:59:59Z"), true);
    assert.equal(await tagged("2100-01-01T00:00:00Z"), false);
    // The 2100 edge in the offset's favor and against it.
    assert.equal(await tagged("2099-12-31T23:59:59-05:00"), false, "that is already 2100 in UTC");
    assert.equal(await tagged("1990-01-01T02:00:00+03:00"), false, "that is still 1989 in UTC");
    // Ten digits: 1 000 000 000 is 2001; the largest in range is 4 102 444 799.
    assert.equal(await tagged("1000000000"), true);
    assert.equal(await tagged("4102444799"), true);
    assert.equal(await tagged("4102444800"), false, "2100-01-01");
    assert.equal(await tagged("9999999999"), false);
    // Thirteen digits start at 1 000 000 000 000 (2001); sixteen and nineteen likewise.
    assert.equal(await tagged("4102444799999"), true);
    assert.equal(await tagged("4102444800000"), false);
    assert.equal(await tagged("4102444799999999"), true);
    assert.equal(await tagged("4102444800000000"), false);
    assert.equal(await tagged("4102444799999999999"), true);
    assert.equal(await tagged("4102444800000000000"), false);
  });

  test("falsePositivesAreLeftAlone", async () => {
    for (const text of [
      "05321234567", "905321234567", "+905321234567", "0900000000", "0000000000", "0631152000", // phone numbers, leading zeros
      "999999999", "12345678901", "123456789012", "1234567890123456789012", "123456789012345", // wrong length
      "2026", "1999", "2026-01-01", "2026-01", "2026-01-01T", "12:30", "12:30:45", "1.767225600", "-1767225600", "1767225600.5",
      "1e9", "1,767,225,600", "0x6957F900", "hello", "", "   ", "Thu, 1 Jan 2026", "Jan 1 2026",
      "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z",
      "2026-01-01T00:00:60Z", "2026-01-01T00:00:00+24:00", "2026-01-01T00:00:00+03:60", "2026-01-01T00:00:00 PST",
      "2026-01-01T00:00:00Z and more", "see 2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z\n2026-01-02T00:00:00Z",
      "Fri, 1 Jan 2026 00:00:00 +0000", "Thu, 1 Foo 2026 00:00:00 +0000", "Thu, 32 Jan 2026 00:00:00 +0000",
      "Thu, 1 Jan 2026 00:00:00 XYZ", "Thu, 1 Jan 2026 00:00:00 +2500", "Thu, 1 Jan 2026 25:00:00 +0000",
      "١٧٦٧٢٢٥٦٠٠", // Arabic-Indic digits
    ]) {
      assert.equal(await tagged(text), false, JSON.stringify(text));
    }
  });

  test("onlyTextAndCodeAreCandidates", () => {
    assert.equal(acceptsMatch(detector.accepts, { id: 1, kind: "link", url: "https://example.com", text: "1767225600", tags: [], copiedAt: now }), false);
    assert.equal(acceptsMatch(detector.accepts, { ...item("1767225600"), kind: "code" }), true);
  });

  test("validateIsFastAndNeverThrows", async () => {
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) {
      await en.validate(detectors.timestamp, item("2026-01-01T00:00:00.123456789+03:00"));
      await en.validate(detectors.timestamp, item("1767225600000000000"));
    }
    assert.ok((performance.now() - started) / 400 < 5, "well inside 50 ms per call");
    for (const text of [undefined, null, "\u0000", "9".repeat(60_000)]) {
      assert.equal(await en.validate(detectors.timestamp, { id: 1, kind: "text", text, tags: [], copiedAt: now }), false);
    }
  });

  test("adversarialInputsAreCheapAndRefused", () => {
    const started = performance.now();
    for (const text of [
      "2026-01-01T00:00:00" + ".1".repeat(30_000), "2026-01-01T00:00:00" + " ".repeat(30_000) + "x", "1 Jan 2026 00:00" + " ".repeat(30_000) + "x",
      "Thu," + " ".repeat(40_000), "1".repeat(50_000), "-".repeat(50_000), "0".repeat(70), "2026-01-01 00:00:00" + "9".repeat(60),
    ]) {
      assert.equal(parse(text), null);
    }
    assert.ok(performance.now() - started < 50);
  });
});

describe("what the moment is", () => {
  const instant = Date.UTC(2026, 0, 1);

  test("everyUnixLengthGivesTheSameMoment", () => {
    for (const text of ["1767225600", "1767225600000", "1767225600000000", "1767225600000000000"]) {
      assert.equal(parse(text).ms, instant, text);
    }
  });

  test("subMillisecondDigitsAreKept", () => {
    assert.deepEqual([parse("1767225600123456").ms, parse("1767225600123456").subMs], [instant + 123, 456_000]);
    assert.deepEqual([parse("1767225600123456789").ms, parse("1767225600123456789").subMs], [instant + 123, 456_789]);
    assert.deepEqual([parse("2026-01-01T00:00:00.123456789Z").ms, parse("2026-01-01T00:00:00.123456789Z").subMs], [instant + 123, 456_789]);
  });

  test("offsetsAndNamedZones", () => {
    for (const text of [
      "2026-01-01T03:00:00+03:00", "2025-12-31T19:00:00-05:00", "2026-01-01T03:00:00+0300", "2026-01-01T03:00+03:00",
      "Thu, 1 Jan 2026 03:00:00 +0300", "Wed, 31 Dec 2025 19:00:00 EST", "Wed, 31 Dec 2025 16:00:00 PST", "Thu, 1 Jan 2026 00:00:00 GMT",
    ]) {
      assert.equal(parse(text).ms, instant, text);
    }
  });

  test("noZoneMeansThisMacsTime", () => {
    const local = parse("2026-01-01T03:00:00"); // the tests run in Istanbul, UTC+3
    assert.equal(local.ms, instant);
    assert.equal(local.assumedLocal, true);
    assert.equal(parse("2026-01-01T03:00:00Z").assumedLocal, false);
    assert.equal(parse("Thu, 1 Jan 2026 03:00:00").assumedLocal, true);
  });

  test("leapDayAndYearEndAreReal", () => {
    assert.ok(parse("2024-02-29T12:00:00Z"));
    assert.equal(parse("2100-02-29T12:00:00Z"), null);
    assert.ok(parse("2025-12-31T23:59:59Z"));
  });
});

describe("preview", () => {
  const rows = async (host, text) => {
    const [time, details] = await host.preview(detectors.timestamp, item(text));
    return { time, details };
  };

  test("inEnglish", async () => {
    const { time, details } = await rows(en, "1767225600");
    assert.deepEqual(time, {
      type: "keyValue", title: "Date and time",
      rows: [
        ["Local", "January 1, 2026 at 3:00:00 AM GMT+3"],
        ["UTC", "January 1, 2026 at 12:00:00 AM UTC"],
        ["ISO 8601", "2026-01-01T00:00:00Z"],
      ],
    });
    assert.deepEqual(details, {
      type: "keyValue", title: "Details",
      rows: [["Relative", "3 days ago"], ["Weekday", "Thursday"], ["Unix seconds", "1767225600"], ["Read as", "Unix seconds"]],
    });
  });

  test("inTurkish", async () => {
    const { time, details } = await rows(hostIn("tr"), "1767225600");
    assert.equal(time.title, "Tarih ve saat");
    assert.deepEqual(time.rows[0], ["Yerel", "1 Ocak 2026 03:00:00 GMT+3"]);
    assert.deepEqual(time.rows[1], ["UTC", "1 Ocak 2026 00:00:00 UTC"]);
    assert.deepEqual(details.rows, [["Göreli", "3 gün önce"], ["Haftanın günü", "Perşembe"], ["Unix saniye", "1767225600"], ["Okunan biçim", "Unix saniye"]]);
  });

  test("relativeTimeAcrossTheScale", async () => {
    const relativeOf = async (text) => (await rows(en, text)).details.rows[0][1];
    assert.equal(await relativeOf("2026-01-04T12:00:00Z"), "now");
    assert.equal(await relativeOf("2026-01-04T11:59:55Z"), "5 seconds ago");
    assert.equal(await relativeOf("2026-01-04T11:58:00Z"), "2 minutes ago");
    assert.equal(await relativeOf("2026-01-04T09:00:00Z"), "3 hours ago");
    assert.equal(await relativeOf("2026-01-03T12:00:00Z"), "yesterday");
    assert.equal(await relativeOf("2026-01-05T12:00:00Z"), "tomorrow");
    assert.equal(await relativeOf("2026-01-07T12:00:00Z"), "in 3 days");
    assert.equal(await relativeOf("2025-10-04T12:00:00Z"), "3 months ago");
    assert.equal(await relativeOf("2023-01-04T12:00:00Z"), "3 years ago");
    assert.equal(await relativeOf("2028-01-04T12:00:00Z"), "in 2 years");
  });

  test("subMillisecondAndFractionShowInIso", async () => {
    assert.equal((await rows(en, "1767225600123456789")).time.rows.at(-1)[1], "2026-01-01T00:00:00.123456789Z");
    assert.equal((await rows(en, "1767225600123")).time.rows.at(-1)[1], "2026-01-01T00:00:00.123Z");
    assert.equal((await rows(en, "1767225600123456")).time.rows.at(-1)[1], "2026-01-01T00:00:00.123456Z");
  });

  test("readAsNamesTheForm", async () => {
    const readAs = async (text) => (await rows(en, text)).details.rows.at(-1)[1];
    assert.equal(await readAs("1767225600000"), "Unix milliseconds");
    assert.equal(await readAs("1767225600000000"), "Unix microseconds");
    assert.equal(await readAs("1767225600000000000"), "Unix nanoseconds");
    assert.equal(await readAs("2026-01-01T00:00:00Z"), "ISO 8601");
    assert.equal(await readAs("2026-01-01T00:00:00"), "ISO 8601, no zone (this Mac’s time)");
    assert.equal(await readAs("Thu, 1 Jan 2026 00:00:00 +0000"), "RFC 2822");
    assert.equal(await readAs("Thu, 1 Jan 2026 00:00:00"), "RFC 2822, no zone (this Mac’s time)");
    assert.equal((await rows(hostIn("tr"), "2026-01-01T00:00:00")).details.rows.at(-1)[1], "ISO 8601, dilimsiz (bu Mac’in saati)");
  });

  test("anExtraZoneAppearsBetweenUtcAndIso", async () => {
    const host = hostIn("en", { preferences: { zone: "America/New_York" } });
    const { time } = await rows(host, "1767225600");
    assert.deepEqual(time.rows.map((row) => row[0]), ["Local", "UTC", "America/New_York", "ISO 8601"]);
    assert.equal(time.rows[2][1], "December 31, 2025 at 7:00:00 PM EST");
  });

  test("daylightSavingChangesAreShownInTheZone", async () => {
    const host = hostIn("en", { preferences: { zone: " America/New_York " } });
    const zoned = async (text) => (await rows(host, text)).time.rows[2][1];
    // 2026-03-08: 02:00 EST jumps to 03:00 EDT.
    assert.equal(await zoned("2026-03-08T06:59:59Z"), "March 8, 2026 at 1:59:59 AM EST");
    assert.equal(await zoned("2026-03-08T07:00:00Z"), "March 8, 2026 at 3:00:00 AM EDT");
    // 2026-11-01: 02:00 EDT falls back to 01:00 EST, so 1:30 happens twice.
    assert.equal(await zoned("2026-11-01T05:30:00Z"), "November 1, 2026 at 1:30:00 AM EDT");
    assert.equal(await zoned("2026-11-01T06:30:00Z"), "November 1, 2026 at 1:30:00 AM EST");
  });

  test("anInvalidOrEmptyExtraZoneIsSkipped", async () => {
    for (const zone of ["", "   ", "Not/AZone", "Europe/Atlantis", "x".repeat(200), 42, null, true]) {
      const host = hostIn("en", { preferences: { zone } });
      const { time } = await rows(host, "1767225600");
      assert.deepEqual(time.rows.map((row) => row[0]), ["Local", "UTC", "ISO 8601"], JSON.stringify(zone));
    }
  });

  test("somethingElseHasNoPreview", async () => {
    assert.deepEqual(await en.preview(detectors.timestamp, item("hello")), []);
    assert.deepEqual(await en.preview(detectors.timestamp, item("12345")), []);
  });
});

describe("actions", () => {
  const input = item("2026-01-01T03:00:00+03:00");

  test("convertEachWay", async () => {
    assert.deepEqual(await en.run(actions.toIso, input), { text: "2026-01-01T00:00:00Z" });
    assert.deepEqual(await en.run(actions.toSeconds, input), { text: "1767225600" });
    assert.deepEqual(await en.run(actions.toMilliseconds, input), { text: "1767225600000" });
    assert.deepEqual(await en.run(actions.toLocal, input), { text: "January 1, 2026 at 3:00:00 AM GMT+3" });
    assert.deepEqual(await hostIn("tr").run(actions.toLocal, input), { text: "1 Ocak 2026 03:00:00 GMT+3" });
  });

  test("everyInputFormConverts", async () => {
    for (const text of ["1767225600", "1767225600000", "1767225600000000", "1767225600000000000", "Thu, 1 Jan 2026 00:00:00 +0000"]) {
      assert.deepEqual(await en.run(actions.toSeconds, item(text)), { text: "1767225600" }, text);
      assert.deepEqual(await en.run(actions.toIso, item(text)), { text: "2026-01-01T00:00:00Z" }, text);
      assert.deepEqual(await en.run(actions.toMilliseconds, item(text)), { text: "1767225600000" }, text);
    }
  });

  test("precisionSurvivesInIso", async () => {
    assert.deepEqual(await en.run(actions.toIso, item("1767225600123456789")), { text: "2026-01-01T00:00:00.123456789Z" });
    assert.deepEqual(await en.run(actions.toMilliseconds, item("1767225600123456789")), { text: "1767225600123" });
    assert.deepEqual(await en.run(actions.toSeconds, item("1767225600999")), { text: "1767225600" });
  });

  test("hintsAreTheSameAnswer", async () => {
    for (const id of ["toIso", "toSeconds", "toMilliseconds", "toLocal"]) {
      assert.deepEqual(await en.hint(actions[id], input), await en.run(actions[id], input), id);
    }
  });

  test("somethingThatIsNotATimestampSaysSo", async () => {
    assert.deepEqual(await en.run(actions.toIso, item("hello")), { none: true, message: "This is not a timestamp." });
    assert.deepEqual(await hostIn("tr").run(actions.toIso, item("hello")), { none: true, message: "Bu bir zaman damgası değil." });
    assert.deepEqual(await en.run(actions.toSeconds, item("")), { none: true, message: "This is not a timestamp." });
  });

  test("generatorsUseTheClock", async () => {
    assert.deepEqual(await en.run(actions.nowSeconds, null), { text: "1767528000" });
    assert.deepEqual(await en.run(actions.nowIso, null), { text: "2026-01-04T12:00:00Z" });
    assert.deepEqual(await en.hint(actions.nowIso, null), { text: "2026-01-04T12:00:00Z" });
  });

  test("onlyTaggedItemsGetTheConversions", () => {
    const tag = "dev.yabbistir.timestamp:timestamp";
    const plain = en.offers(item("1767225600"));
    const withTag = en.offers({ ...item("1767225600"), tags: [tag] });
    for (const id of ["toIso", "toSeconds", "toMilliseconds", "toLocal"]) {
      assert.ok(!plain.includes(id), id);
      assert.ok(withTag.includes(id), id);
    }
    assert.ok(!withTag.includes("nowIso"), "generators are not item actions");
  });
});

describe("nothing leaks", () => {
  test("noContentInLogsOrMessages", async () => {
    const host = hostIn("en", { preferences: { zone: "Not/AZone" } });
    const secretish = "2026-01-01T00:00:00Z" + " private-note";
    await host.validate(detectors.timestamp, item(secretish));
    await host.preview(detectors.timestamp, item("1767225600"));
    const result = await host.run(actions.toIso, item(secretish));
    assert.deepEqual(host.logs, []);
    assert.ok(!JSON.stringify(result).includes("private-note"));
  });
});

describe("the manifest", () => {
  test("hasNoPermissions", () => {
    assert.equal(manifest.permissions, undefined);
    assert.equal(manifest.network, undefined);
  });
});
