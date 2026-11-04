import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { actions, calculate, detectors, formatNumber } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const hostIn = (language) => createFakeHost({ folder, context: { language } });
const en = hostIn("en");
const tr = hostIn("tr");

const result = (text, language = "en") => calculate(text, language)?.result ?? null;
const tagged = (text, host = en) => host.validate(detectors.expression, item(text));

describe("arithmetic", () => {
  test("basicOperatorsAndPrecedence", () => {
    assert.equal(result("2 + 3 * 4"), "14");
    assert.equal(result("(2 + 3) * 4"), "20");
    assert.equal(result("10 - 4 - 3"), "3", "left to right");
    assert.equal(result("100 / 5 / 4"), "5");
    assert.equal(result("7 / 2"), "3.5");
    assert.equal(result("6 × 7"), "42");
    assert.equal(result("84 ÷ 2"), "42");
    assert.equal(result("5 − 2"), "3", "the real minus sign");
  });

  test("powerIsRightAssociative", () => {
    assert.equal(result("2^3^2"), "512");
    assert.equal(result("(2^3)^2"), "64");
    assert.equal(result("2^-2"), "0.25");
  });

  test("unaryMinusBindsLooserThanPower", () => {
    assert.equal(result("-2^2"), "-4");
    assert.equal(result("(-2)^2"), "4");
    assert.equal(result("-3 + 5"), "2");
    assert.equal(result("4 - -3"), "7");
    assert.equal(result("--5 + 1"), "6");
    assert.equal(result("3 * -2"), "-6");
  });

  test("remainder", () => {
    assert.equal(result("10 % 3"), "1");
    assert.equal(result("10 % (2 + 1)"), "1");
    assert.equal(result("10 % 0"), null);
  });

  test("functionsAndConstants", () => {
    assert.equal(result("sqrt(16) + 1"), "5");
    assert.equal(result("abs(-4.5) * 2"), "9");
    assert.equal(result("round(2.5) + 0"), "3");
    assert.equal(result("round(3.14159; 2) + 0"), "3.14");
    assert.equal(result("round(3.14159, 3) + 0"), "3.142");
    assert.equal(result("floor(2.9) + ceil(2.1)"), "5");
    assert.equal(result("max(1, 7, 3) - min(4; 2)"), "5");
    assert.equal(result("log(1000) + ln(e)"), "4");
    assert.equal(result("exp(0) + 1"), "2");
    assert.equal(result("sin(0) + cos(0)"), "1");
    assert.equal(result("tan(0) + 1"), "1");
    assert.equal(result("pi * 2"), "6.28318530718");
    assert.equal(result("2 * π"), "6.28318530718");
    assert.equal(result("SQRT(9) + 1"), "4", "case does not matter");
    assert.equal(result("sqrt(16)"), "4", "a function call counts as a calculation");
  });

  test("wrongArgumentCountsFail", () => {
    assert.equal(result("sqrt(1; 2)"), null);
    assert.equal(result("max()"), null);
    assert.equal(result("round(1; 2; 3)"), null);
    assert.equal(result("round(1; 2.5)"), null);
  });

  test("percentages", () => {
    assert.equal(result("15% of 80"), "12");
    assert.equal(result("80 + 15%"), "92");
    assert.equal(result("80 - 15%"), "68");
    assert.equal(result("80 * 15%"), "12");
    assert.equal(result("80 / 50%"), "160");
    assert.equal(result("200 + 10% + 10%"), "242");
    assert.equal(result("50% + 10"), "10.5");
    assert.equal(result("12.5% of 200"), "25");
    assert.equal(result("10 of 80"), null, "of needs a percentage on its left");
    assert.equal(result("50%"), null, "a lone percentage is not a calculation");
  });

  test("floatNoiseIsRoundedAway", () => {
    assert.equal(result("0.1 + 0.2"), "0.3");
    assert.equal(result("0.1 + 0.2 - 0.3"), "0");
    assert.equal(result("1 / 3"), "0.333333333333");
    assert.equal(result("2 / 3 * 3"), "2");
    assert.equal(result("1234567.891 * 1000"), "1234567891");
  });

  test("hugeAndTinyResultsUseAnExponent", () => {
    assert.equal(result("2^100"), "1.26765060023e30");
    assert.equal(result("1 / 2^40"), "9.09494701773e-13");
    assert.equal(result("2^60"), "1152921504610000000", "twelve significant digits");
  });

  test("calculationsThatFailGiveNothing", () => {
    for (const bad of ["1 / 0", "5 / (3 - 3)", "sqrt(-1) + 1", "ln(0) + 1", "log(-5) + 1", "10^400", "9^9^9", "1 +", "* 5", "(1 + 2", "1 + 2)", "2 +* 3", "foo + 1", "1 + bar(2)", "1 + sqrt", "1 + 2 = 4", "e + x"]) {
      assert.equal(result(bad), null, bad);
    }
  });

  test("aTrailingOrLeadingEqualsSignIsIgnored", () => {
    assert.equal(result("2 + 2 ="), "4");
    assert.equal(result("= 2 + 2"), "4");
  });
});

describe("number styles", () => {
  test("englishStyle", () => {
    assert.equal(result("1,234.56 + 1"), "1,235.56");
    assert.equal(result("1,234,567 + 1"), "1,234,568");
    assert.equal(result("0.5 + .25"), "0.75");
  });

  test("turkishAndGermanStyle", () => {
    assert.equal(result("1.234,56 + 1"), "1.235,56");
    assert.equal(result("1.234.567 + 1"), "1.234.568");
    assert.equal(result("2,5 * 2"), "5");
    assert.equal(result("0,5 + ,25"), "0,75");
  });

  test("outputFollowsTheStyleOfTheInput", () => {
    assert.equal(result("1,5 + 1", "en"), "2,5", "an unambiguous comma decimal wins over the language");
    assert.equal(result("1.5 + 1", "tr"), "2.5");
    assert.equal(result("1500,5 * 2", "en"), "3001");
    assert.equal(result("1.500,5 * 2", "en"), "3.001");
    assert.equal(result("1,500.5 * 2", "tr"), "3,001");
  });

  test("ambiguousNumbersFollowTheLanguage", () => {
    assert.equal(result("1.234 + 1", "en"), "2.234", "a dot is a decimal in English");
    assert.equal(result("1.234 + 1", "tr"), "1.235", "a dot is a thousands mark in Turkish");
    assert.equal(result("1,234 + 1", "en"), "1,235");
    assert.equal(result("1,234 + 1", "tr"), "2,234");
    assert.equal(result("1.2345 + 1", "tr"), "2.2345", "four decimals cannot be a thousands mark, so the dot is a decimal");
    assert.equal(result("0.123 + 1", "tr"), "1.123", "a leading zero cannot start a group, so the dot is a decimal");
    assert.equal(result("12.345 + 1", "de"), "12.346");
  });

  test("badSeparatorsFail", () => {
    for (const bad of ["1.2.3 + 1", "1,2,3 + 1", "192.168.1.1 + 1", "1.234,56,7 + 1", "1,234.567,8 + 1", "12.34.567 + 1", "5. + 1", "1..2 + 1", "1,23.456 + 1"]) {
      assert.equal(result(bad), null, bad);
    }
  });

  test("argumentSeparatorsDoNotEatDecimals", () => {
    assert.equal(result("max(1,5; 2) + 0", "tr"), "2");
    assert.equal(result("max(1, 5) + 0", "en"), "5");
    assert.equal(result("max(1,5) + 0", "en"), null, "no space after the comma in a call: refused rather than read as 1,5");
  });

  test("formatNumberHandlesEdges", () => {
    const dot = { decimal: ".", grouped: false };
    assert.equal(formatNumber(0, dot), "0");
    assert.equal(formatNumber(-0, dot), "0");
    assert.equal(formatNumber(-1234.5, { decimal: ",", grouped: true }), "-1.234,5");
    assert.equal(formatNumber(1e21, dot), "1e21");
    assert.equal(formatNumber(123456789012345, dot), "123456789012000", "twelve significant digits");
    assert.equal(formatNumber(0.000001, dot), "0.000001");
  });
});

describe("normalized expression", () => {
  test("spacesAndOperatorsAreTidied", () => {
    assert.equal(calculate("12*3+4", "en").expression, "12 * 3 + 4");
    assert.equal(calculate("  12 × 3  ÷ 4 ", "en").expression, "12 * 3 / 4");
    assert.equal(calculate("2 ^ 3", "en").expression, "2^3");
    assert.equal(calculate("15 % of 80", "en").expression, "15% of 80");
    assert.equal(calculate("SQRT( 16 ; 2 )+1", "en"), null);
    assert.equal(calculate("MAX(1;2)+PI", "en").expression, "max(1, 2) + pi");
    assert.equal(calculate("1.234,56+1", "tr").expression, "1.234,56 + 1", "numbers keep the way they were written");
    assert.equal(calculate("2 + 2 =", "en").expression, "2 + 2");
  });
});

describe("what is tagged", () => {
  test("sumsAreTagged", async () => {
    for (const text of ["2+2", "12 * 3 + 4", "  15% of 80  ", "1.234,56 + 10", "sqrt(2) * 3", "(1+2)*3", "100/8", "2^10", "1,5 × 2", "10 - 3", "5 +\t5"]) {
      assert.equal(await tagged(text), true, text);
    }
  });

  test("datesPhonesVersionsAndIdsAreNot", async () => {
    for (const text of [
      "2024-11-04", "04-11-2024", "11/04/2024", "04.11.2024", "2024-11", "2024/11/04",
      "555-123-4567", "+1-555-123-4567", "555-1234", "+90 555 123 45 67", "(555) 123-4567", "0555 123 45 67", "0555-123-45-67",
      "1.2.3", "v1.2.3", "10.4.1-beta", "192.168.1.1", "10.0.0.1/24", "::1",
      "12:30", "1920x1080", "A1+B2", "=SUM(A1:A3)", "C-3PO", "COVID-19", "x-1", "3 apples + 2 pears",
    ]) {
      assert.equal(await tagged(text), false, text);
    }
  });

  test("plainNumbersAndProseAreNot", async () => {
    for (const text of ["42", "-5", "1,234.56", "3.14159", "50%", "(5)", "pi", "e", "", "   ", "hello world", "I owe you 5 - 3 things.", "Meeting at 5 + extra", "+", "()", "1 2", "1 2 + 3", "5 5", "hello (world)", "a-b"]) {
      assert.equal(await tagged(text), false, JSON.stringify(text));
    }
  });

  test("multilineAndOversizedTextIsNot", async () => {
    assert.equal(await tagged("1 + 2\n3 + 4"), false);
    assert.equal(await tagged("1 + 2\r\n"), true, "trailing line break is trimmed");
    assert.equal(await tagged("1 +" + " 1 +".repeat(2000) + " 1"), false, "over 5000 characters");
  });

  test("theLanguageDecidesAmbiguousSums", async () => {
    // Either way it is a sum; the language only changes the answer.
    assert.equal(await tagged("1.234 + 1", tr), true);
    assert.equal(await tagged("1.234 + 1", en), true);
  });

  test("theManifestPatternFindsTheCandidates", () => {
    const { accepts } = manifest.contributes.detectors[0];
    for (const text of ["2+2", "sqrt(4)", "1 − 2", "6×7", "  2^3\n", "80 + 15%"]) assert.equal(acceptsMatch(accepts, item(text)), true, text);
    for (const text of ["42", "hello", "ab", "1 + 2\n3 + 4", "1 +" + " 1 +".repeat(2000) + " 1"]) assert.equal(acceptsMatch(accepts, item(text)), false, JSON.stringify(text));
  });

  test("theActionsAreOfferedOnlyOnTaggedItems", () => {
    for (const action of manifest.contributes.actions) assert.deepEqual(action.accepts.tags, ["expression"]);
    assert.deepEqual(manifest.contributes.actions.map((a) => a.id), ["result", "full"]);
  });
});

describe("speed", () => {
  const within = async (text, label) => {
    const started = performance.now();
    const answer = await en.validate(detectors.expression, item(text));
    const took = performance.now() - started;
    assert.ok(took < 50, `${label} took ${took.toFixed(1)} ms`);
    return answer;
  };

  test("aVeryLongSumValidatesInTime", async () => {
    const sum = Array.from({ length: 1100 }, (_, i) => String(i % 10)).join(" + "); // ~4.4k characters
    assert.ok(sum.length > 4000 && sum.length <= 5000);
    assert.equal(await within(sum, "long sum"), true);
  });

  test("adversarialInputsAreCheapAndRejected", async () => {
    assert.equal(await within("(".repeat(4900) + "1" + ")".repeat(4), "deep parentheses"), false);
    assert.equal(await within("-".repeat(4900) + "1 + 1", "many unary minuses"), false);
    assert.equal(await within("2^".repeat(2400) + "2", "power tower"), false);
    assert.equal(await within("1,".repeat(2400) + "1", "commas"), false);
    assert.equal(await within("1.".repeat(2400) + "1 + 1", "dots"), false);
    assert.equal(await within("9".repeat(4900) + " + 1", "huge integer"), false);
    assert.equal(await within("a".repeat(4900) + " + 1", "long word"), false);
    assert.equal(await within("%".repeat(4900), "percent signs"), false);
    assert.equal(await within(" ".repeat(2000) + "1+1" + " ".repeat(2000), "padding"), true);
  });

  test("moderateNestingStillWorks", () => {
    assert.equal(result("(".repeat(50) + "1 + 1" + ")".repeat(50)), "2");
    assert.equal(result("(".repeat(150) + "1 + 1" + ")".repeat(150)), null, "past the depth limit");
  });
});

describe("fix round 1", () => {
  test("commaWithoutSpaceInACallIsNotTaggedInEnglish", () => {
    assert.equal(result("max(1,7)"), null);
    assert.equal(result("min(3,4)"), null);
    assert.equal(result("max(1, 7)"), "7");
    assert.equal(result("max(1; 7)"), "7");
    assert.equal(result("1,5 + 1"), "2,5");
    assert.equal(result("max(1,7; 2)", "tr"), "2");
  });
  test("shortHyphenPairsAreNotTagged", () => {
    for (const t of ["2-1", "10-12", "e-1", "2-pi"]) assert.equal(result(t), null, t);
    assert.equal(result("2 - 1"), "1");
    assert.equal(result("10 - 12"), "-2");
  });
  test("remainderThenPercentIsNotTagged", () => {
    assert.equal(result("5 % 2%"), null);
    assert.equal(result("10 % 3"), "1");
  });
});

describe("preview and actions", () => {
  test("previewShowsTheResultAndTheExpression", async () => {
    assert.deepEqual(await en.preview(detectors.expression, item("12*3+4")),
      [{ type: "keyValue", title: "Calculation", rows: [["Result", "40"], ["Expression", "12 * 3 + 4"]] }]);
    assert.deepEqual(await tr.preview(detectors.expression, item("1.234,5 + 1"), { language: "tr" }),
      [{ type: "keyValue", title: "Hesaplama", rows: [["Sonuç", "1.235,5"], ["İşlem", "1.234,5 + 1"]] }]);
  });

  test("previewOfSomethingElseIsEmpty", async () => {
    assert.deepEqual(await en.preview(detectors.expression, item("hello")), []);
  });

  test("pasteResult", async () => {
    assert.deepEqual(await en.hint(actions.result, item("12 * 3 + 4")), { text: "40" });
    assert.deepEqual(await en.run(actions.result, item("15% of 80")), { text: "12" });
    assert.deepEqual(await tr.run(actions.result, item("1.234,56 * 2")), { text: "2.469,12" });
  });

  test("pasteExpressionAndResult", async () => {
    assert.deepEqual(await en.hint(actions.full, item("12*3+4")), { text: "12 * 3 + 4 = 40" });
    assert.deepEqual(await tr.run(actions.full, item("2,5*2")), { text: "2,5 * 2 = 5" });
  });

  test("nothingToDoSaysWhy", async () => {
    assert.deepEqual(await en.run(actions.result, item("hello")), { none: true, message: "This isn’t a calculation." });
    assert.deepEqual(await tr.run(actions.full, item("1 / 0")), { none: true, message: "Bu bir hesaplama değil." });
    assert.deepEqual(await en.run(actions.result, item("")), { none: true, message: "This isn’t a calculation." });
  });
});
