import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import {
  actions, randomBelow, generatePassword, generatePassphrase, generatePin, generateHex, generateBase64Url,
  readInteger, characterSets, lookAlikes, lowercase, uppercase, digits, symbols, lengthRange,
} from "../src/index.ts";
import { wordList } from "../src/words.ts";

const folder = new URL("..", import.meta.url);
const host = (preferences) => createFakeHost({ folder, preferences });

/** A fixed, seeded source (xorshift32): the same numbers every run. */
function seeded(seed) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  return (array) => {
    if (array instanceof Uint32Array) for (let i = 0; i < array.length; i++) array[i] = next();
    else for (let i = 0; i < array.length; i++) array[i] = next() & 0xff;
    return array;
  };
}

const all = { length: 20, lowercase: true, uppercase: true, digits: true, symbols: true, noLookAlikes: false };
const chiSquare = (counts, expected) => [...counts.values()].reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
const run = (h, variant) => h.run(actions.generate, null, { variant });
const textOf = (result) => result.text;

describe("password", () => {
  test("defaultsToTwentyCharactersFromEverySet", async () => {
    const text = textOf(await run(host(), "password"));
    assert.equal(Array.from(text).length, 20);
    assert.match(text, /[a-z]/); assert.match(text, /[A-Z]/); assert.match(text, /\d/);
    assert.ok(Array.from(text).some((c) => symbols.includes(c)));
  });

  test("lengthPreferenceIsHonoredAndClamped", async () => {
    for (const [value, expected] of [["8", 8], ["64", 64], ["128", 128], ["3", 8], ["500", 128], ["abc", 20], ["", 20], ["12.5", 20], [" 33 ", 33], ["-5", 20]]) {
      assert.equal(textOf(await run(host({ length: value }), "password")).length, expected, `length ${value}`);
    }
  });

  test("everyEnabledSetIsRepresentedEvenAtTheShortestLength", () => {
    const fill = seeded(7);
    for (let n = 0; n < 2000; n++) {
      const text = generatePassword({ ...all, length: 8 }, fill);
      assert.match(text, /[a-z]/); assert.match(text, /[A-Z]/); assert.match(text, /\d/);
      assert.ok(Array.from(text).some((c) => symbols.includes(c)));
    }
  });

  test("setPreferencesLimitTheAlphabet", async () => {
    const only = async (prefs, allowed) => {
      const text = textOf(await run(host({ length: "128", lowercase: false, uppercase: false, digits: false, symbols: false, noLookAlikes: false, ...prefs }), "password"));
      assert.ok(Array.from(text).every((c) => allowed.includes(c)), "only the chosen set");
    };
    await only({ lowercase: true }, lowercase);
    await only({ uppercase: true }, uppercase);
    await only({ digits: true }, digits);
    await only({ symbols: true }, symbols);
    await only({ lowercase: true, digits: true }, lowercase + digits);
  });

  test("lookAlikesAreLeftOutWhenAsked", async () => {
    const fill = seeded(11);
    for (let n = 0; n < 500; n++) {
      const text = generatePassword({ ...all, length: 128, noLookAlikes: true }, fill);
      assert.ok(!Array.from(text).some((c) => lookAlikes.includes(c)));
    }
    const kept = generatePassword({ ...all, length: 128, noLookAlikes: false }, seeded(3));
    assert.ok(Array.from(kept).some((c) => lookAlikes.includes(c)), "look-alikes appear when allowed");
    const sets = characterSets({ ...all, noLookAlikes: true });
    assert.equal(sets.length, 4);
    assert.ok(!sets.join("").split("").some((c) => lookAlikes.includes(c)));
  });

  test("withNoSetItSaysWhy", async () => {
    const h = host({ lowercase: false, uppercase: false, digits: false, symbols: false });
    assert.deepEqual(await run(h, "password"), { none: true, message: "Turn on at least one character set in Settings." });
    assert.deepEqual(await h.hint(actions.generate, null, { variant: "password" }), { none: true, message: "Turn on at least one character set in Settings." });
    const turkish = createFakeHost({ folder, context: { language: "tr" }, preferences: { lowercase: false, uppercase: false, digits: false, symbols: false } });
    assert.deepEqual(await turkish.run(actions.generate, null, { variant: "password" }), { none: true, message: "Ayarlar’dan en az bir karakter grubunu aç." });
  });

  test("anUnknownVariantMakesAPassword", async () => {
    assert.equal(textOf(await host().run(actions.generate, null, {})).length, 20);
  });
});

describe("randomness", () => {
  test("rejectionSamplingDiscardsTheBiasedTail", () => {
    // max 3: 2^32 mod 3 = 1, so the single value 4294967295 must be thrown away, not mapped to 0.
    const queue = [0xffffffff, 0xffffffff, 4];
    const fill = (array) => { array[0] = queue.shift(); return array; };
    assert.equal(randomBelow(3, fill), 1);
    assert.equal(queue.length, 0, "both rejected draws were consumed");
    // A power of two never rejects.
    assert.equal(randomBelow(256, (a) => { a[0] = 0xffffffff; return a; }), 255);
    assert.equal(randomBelow(1, () => { throw new Error("no draw needed"); }), 0);
  });

  test("rejectsNonsenseBounds", () => {
    for (const bad of [0, -1, 1.5, NaN, 0x100000001]) assert.throws(() => randomBelow(bad), RangeError);
  });

  test("randomBelowIsUniform", () => {
    // Chi-square goodness of fit with a fixed source. df = 61: the p = 0.001 critical value is 100.9.
    const fill = seeded(20260101);
    const counts = new Map(Array.from({ length: 62 }, (_, i) => [i, 0]));
    for (let i = 0; i < 62 * 2000; i++) { const v = randomBelow(62, fill); counts.set(v, counts.get(v) + 1); }
    assert.ok(chiSquare(counts, 2000) < 100.9, "uniform");
  });

  test("passwordCharactersAreUniformAcrossThePool", () => {
    // The pool without look-alikes, letters and digits only.
    const prefs = { ...all, length: 128, symbols: false, noLookAlikes: true };
    const pool = characterSets(prefs).join("");
    const counts = new Map(Array.from(pool, (c) => [c, 0]));
    const fill = seeded(99);
    const passwords = 2000;
    for (let i = 0; i < passwords; i++) for (const c of generatePassword(prefs, fill)) counts.set(c, counts.get(c) + 1);
    // One guaranteed character per set comes from its own set, which tilts the totals a little; the shape stays flat.
    const min = Math.min(...counts.values()), max = Math.max(...counts.values());
    assert.ok(max / min < 1.15, "no character is favored");
  });

  test("shuffleDoesNotFavorAPositionForTheGuaranteedCharacter", () => {
    // The digit is guaranteed once in a lowercase+digit password of 8; where it can land must be uniform too.
    const prefs = { ...all, length: 8, uppercase: false, symbols: false, lowercase: true, digits: true };
    const fill = seeded(5);
    const counts = new Map(Array.from({ length: 8 }, (_, i) => [i, 0]));
    const runs = 40000;
    for (let i = 0; i < runs; i++) {
      const text = generatePassword(prefs, fill);
      // Count the position of every digit: positions must be uniformly used.
      Array.from(text).forEach((c, index) => { if (digits.includes(c)) counts.set(index, counts.get(index) + 1); });
    }
    const values = [...counts.values()];
    assert.ok(Math.max(...values) / Math.min(...values) < 1.1);
  });
});

describe("passphrase", () => {
  test("hasFiveWordsWithDashesByDefault", async () => {
    const patch = mock.method(globalThis.crypto, "getRandomValues", seeded(77));
    let text;
    try { text = textOf(await run(host(), "passphrase")); } finally { patch.mock.restore(); }
    assert.equal(text, generatePassphrase(5, "-", seeded(77)));
  });

  test("countAndSeparatorFollowThePreferences", async () => {
    const fill = seeded(1);
    for (const count of [4, 5, 6, 7, 8]) {
      const phrase = generatePassphrase(count, " ", fill);
      assert.equal(phrase.split(" ").length, count);
      assert.ok(phrase.split(" ").every((w) => wordList.includes(w)));
    }
    const cases = [["space", " "], ["period", "."], ["underscore", "_"], ["comma", ","], ["dash", "-"]];
    for (const [id, mark] of cases) {
      const text = textOf(await run(host({ separator: id, words: "6" }), "passphrase"));
      assert.equal(text.split(mark).length >= 6, true, id);
      assert.ok(text.includes(mark));
    }
    const patch = mock.method(globalThis.crypto, "getRandomValues", seeded(31));
    let joined;
    try { joined = textOf(await run(host({ separator: "none", words: "4" }), "passphrase")); } finally { patch.mock.restore(); }
    assert.equal(joined, generatePassphrase(4, "", seeded(31)));
    const picked = generatePassphrase(4, " ", seeded(31)).split(" ");
    assert.equal(joined, picked.join(""));
    assert.equal(textOf(await run(host({ separator: "bogus", words: "99" }), "passphrase")).length > 0, true);
  });

  test("wordCountIsClamped", () => {
    assert.equal(readInteger("2", { min: 4, max: 8, fallback: 5 }), 4);
    assert.equal(readInteger("40", { min: 4, max: 8, fallback: 5 }), 8);
    assert.equal(readInteger(undefined, { min: 4, max: 8, fallback: 5 }), 5);
    assert.equal(readInteger(7, { min: 4, max: 8, fallback: 5 }), 7);
  });

  test("theWordListIsTheEffLargeList", () => {
    assert.equal(wordList.length, 7776);
    assert.equal(new Set(wordList).size, 7776);
    assert.equal(wordList[0], "abacus");
    assert.equal(wordList[7775], "zoom");
    assert.ok(wordList.every((w) => /^[a-z]+(-[a-z]+)?$/.test(w)));
  });

  test("wordsAreChosenUniformly", () => {
    // 7,776 words over 77,760 draws (expected 10 each), df = 7775: the 0.001 critical value is about 8,120.
    const fill = seeded(424242);
    const counts = new Map(wordList.map((w) => [w, 0]));
    const draws = 7776 * 10;
    for (let i = 0; i < draws; i++) { const w = wordList[randomBelow(wordList.length, fill)]; counts.set(w, counts.get(w) + 1); }
    assert.ok(chiSquare(counts, 10) < 8120);
  });
});

describe("pin", () => {
  test("isSixDigitsByDefaultAndFollowsThePreference", async () => {
    assert.match(textOf(await run(host(), "pin")), /^\d{6}$/);
    assert.match(textOf(await run(host({ pinLength: "4" }), "pin")), /^\d{4}$/);
    assert.match(textOf(await run(host({ pinLength: "12" }), "pin")), /^\d{12}$/);
    assert.match(textOf(await run(host({ pinLength: "100" }), "pin")), /^\d{12}$/);
  });

  test("digitsAreUniform", () => {
    const fill = seeded(8);
    const counts = new Map(Array.from("0123456789", (c) => [c, 0]));
    for (let i = 0; i < 10000; i++) for (const c of generatePin(6, fill)) counts.set(c, counts.get(c) + 1);
    assert.ok(chiSquare(counts, 60000 / 10) < 27.9, "df = 9, p = 0.001");
  });
});

describe("keys", () => {
  test("hexIsSixtyFourLowercaseDigits", async () => {
    assert.match(textOf(await run(host(), "hex")), /^[0-9a-f]{64}$/);
    assert.equal(generateHex(4, (a) => { a.set([0x00, 0x0f, 0xa0, 0xff]); return a; }), "000fa0ff");
  });

  test("base64urlIsFortyThreeCharactersWithoutPadding", async () => {
    assert.match(textOf(await run(host(), "base64url")), /^[A-Za-z0-9_-]{43}$/);
    // Bytes that make +, / and = in plain Base64.
    assert.equal(generateBase64Url(3, (a) => { a.set([0xfb, 0xff, 0xbf]); return a; }), "-_-_");
    assert.equal(generateBase64Url(1, (a) => { a.set([0xff]); return a; }), "_w");
  });

  test("keysUseThirtyTwoBytes", () => {
    let asked = 0;
    generateHex(32, (a) => { asked = a.length; return a; });
    assert.equal(asked, 32);
  });

  test("twoKeysDiffer", async () => {
    const h = host();
    assert.notEqual(textOf(await run(h, "hex")), textOf(await run(h, "hex")));
    assert.notEqual(textOf(await run(h, "base64url")), textOf(await run(h, "base64url")));
    assert.notEqual(textOf(await run(h, "password")), textOf(await run(h, "password")));
  });
});

describe("hint and secrecy", () => {
  /** Replaces crypto.getRandomValues with a seeded source for the duration of `fn`. */
  async function withSeed(seed, fn) {
    const fill = seeded(seed);
    const patch = mock.method(globalThis.crypto, "getRandomValues", (array) => fill(array));
    try { return await fn(); } finally { patch.mock.restore(); }
  }

  test("theHintIsTheValueThatIsPasted", async () => {
    const h = host();
    for (const variant of ["password", "passphrase", "pin", "hex", "base64url"]) {
      const hinted = await withSeed(77, () => h.hint(actions.generate, null, { variant }));
      const pasted = await withSeed(77, () => h.run(actions.generate, null, { variant }));
      assert.deepEqual(hinted, pasted, variant);
      assert.equal(typeof hinted.text, "string");
    }
  });

  test("randomnessComesOnlyFromGetRandomValues", async () => {
    let calls = 0;
    const fill = seeded(1);
    const patch = mock.method(globalThis.crypto, "getRandomValues", (array) => { calls++; return fill(array); });
    const math = mock.method(Math, "random", () => { throw new Error("Math.random is not allowed"); });
    try {
      for (const variant of ["password", "passphrase", "pin", "hex", "base64url"]) await run(host(), variant);
    } finally { patch.mock.restore(); math.mock.restore(); }
    assert.ok(calls > 0);
  });

  test("theHintFitsItsTimeBudgetEvenAtTheLongestPassword", async () => {
    const h = host({ length: "128" });
    const started = performance.now();
    for (let i = 0; i < 20; i++) await h.hint(actions.generate, null, { variant: "password" });
    assert.ok((performance.now() - started) / 20 < 50, "far under 500 ms");
  });

  test("nothingIsLoggedOrCalledOut", async () => {
    const h = host();
    for (const variant of ["password", "passphrase", "pin", "hex", "base64url"]) { await run(h, variant); await h.hint(actions.generate, null, { variant }); }
    assert.deepEqual(h.logs, []);
    assert.deepEqual(h.notifications, []);
    assert.equal(h.calls.some((c) => ["http", "exec", "history", "ai", "translate", "open"].includes(c.api)), false);
  });

  test("aFailingSourceSurfacesExactlyItsOwnError", async () => {
    const failure = new Error("entropy source failed");
    const patch = mock.method(globalThis.crypto, "getRandomValues", () => { throw failure; });
    try {
      await assert.rejects(run(host(), "password"), (error) => error === failure || error.message === "entropy source failed");
    } finally { patch.mock.restore(); }
  });

  test("minimumLengthConstantsMatchTheBrief", () => {
    assert.deepEqual([lengthRange.min, lengthRange.max, lengthRange.fallback], [8, 128, 20]);
  });
});
