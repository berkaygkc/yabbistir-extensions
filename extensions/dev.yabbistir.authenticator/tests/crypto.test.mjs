import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";

import { hash, hmac } from "../src/hash.ts";
import { base32Bytes, codeToPaste, counterAt, hotp, MARGIN } from "../src/otp.ts";
import { ascii, base32, referenceHotp } from "./fixtures.mjs";

const ALGORITHMS = ["SHA1", "SHA256", "SHA512"];
const hex = (bytes) => Buffer.from(bytes).toString("hex");

describe("hashes", () => {
  test("SHA-1, SHA-256 and SHA-512 agree with Node's, around every padding boundary", () => {
    for (const algorithm of ALGORITHMS) {
      for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 111, 112, 113, 119, 120, 127, 128, 129, 200, 1000]) {
        const message = randomBytes(length);
        assert.equal(hex(hash(algorithm, new Uint8Array(message))), createHash(algorithm.toLowerCase()).update(message).digest("hex"), `${algorithm} of ${length} bytes`);
      }
    }
    assert.equal(hex(hash("SHA256", ascii("abc"))), createHash("sha256").update("abc").digest("hex"));
  });

  test("HMAC agrees with Node's for keys shorter than, as long as and longer than a block", () => {
    for (const algorithm of ALGORITHMS) {
      for (const keyLength of [0, 1, 20, 63, 64, 65, 127, 128, 129, 300]) {
        for (const messageLength of [0, 8, 200]) {
          const key = randomBytes(keyLength);
          const message = randomBytes(messageLength);
          const expected = createHmac(algorithm.toLowerCase(), key).update(message).digest("hex");
          assert.equal(hex(hmac(algorithm, new Uint8Array(key), new Uint8Array(message))), expected, `${algorithm}, key ${keyLength}, message ${messageLength}`);
        }
      }
    }
  });
});

describe("RFC test vectors", () => {
  test("RFC 4226 Appendix D: HOTP for counts 0 to 9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    const secret = ascii("12345678901234567890");
    assert.deepEqual(expected.map((_, count) => hotp(secret, count, "SHA1", 6)), expected);
  });

  // The seeds of RFC 6238's reference implementation: 20, 32 and 64 bytes of "1234567890…".
  const RFC6238_SEEDS = {
    SHA1: ascii("12345678901234567890"),
    SHA256: ascii("12345678901234567890123456789012"),
    SHA512: ascii("1234567890123456789012345678901234567890123456789012345678901234"),
  };
  const RFC6238 = [
    [59, { SHA1: "94287082", SHA256: "46119246", SHA512: "90693936" }],
    [1111111109, { SHA1: "07081804", SHA256: "68084774", SHA512: "25091201" }],
    [1111111111, { SHA1: "14050471", SHA256: "67062674", SHA512: "99943326" }],
    [1234567890, { SHA1: "89005924", SHA256: "91819424", SHA512: "93441116" }],
    [2000000000, { SHA1: "69279037", SHA256: "90698825", SHA512: "38618901" }],
    [20000000000, { SHA1: "65353130", SHA256: "77737706", SHA512: "47863826" }],
  ];

  test("RFC 6238 Appendix B: TOTP, 8 digits, 30 s steps, all three algorithms", () => {
    for (const [seconds, codes] of RFC6238) {
      for (const algorithm of ALGORITHMS) {
        const counter = counterAt(seconds * 1000, 30);
        assert.equal(hotp(RFC6238_SEEDS[algorithm], counter, algorithm, 8), codes[algorithm], `${algorithm} at ${seconds}`);
      }
    }
  });

  test("RFC 6238's T values", () => {
    assert.equal(counterAt(59_000, 30), 1);
    assert.equal(counterAt(1111111109_000, 30), 0x23523ec);
    assert.equal(counterAt(1111111111_000, 30), 0x23523ed);
    assert.equal(counterAt(1234567890_000, 30), 0x273ef07);
    assert.equal(counterAt(2000000000_000, 30), 0x3f940aa);
    assert.equal(counterAt(20000000000_000, 30), 0x27bc86aa);
  });

  test("with plenty of the period left, the pasted code is RFC 6238's", () => {
    // 1111111111, 1234567890, 2000000000 and 20000000000 are 1, 0, 20 and 20 seconds into their periods.
    for (const [seconds, codes] of RFC6238.slice(2)) {
      for (const algorithm of ALGORITHMS) {
        const account = { secret: RFC6238_SEEDS[algorithm], algorithm, digits: 8, period: 30 };
        assert.equal(codeToPaste(account, seconds * 1000), codes[algorithm], `${algorithm} at ${seconds}`);
      }
    }
  });

  test("at 1111111109, one second before its period ends, the next period's code (1111111111's) is pasted", () => {
    for (const algorithm of ALGORITHMS) {
      const account = { secret: RFC6238_SEEDS[algorithm], algorithm, digits: 8, period: 30 };
      assert.equal(codeToPaste(account, 1111111109_000), RFC6238[2][1][algorithm]);
    }
  });

  test("6, 7, 8 and 10 digits, padded with leading zeros", () => {
    const secret = ascii("12345678901234567890");
    for (const digits of [6, 7, 8, 10]) {
      for (let counter = 0; counter < 50; counter++) {
        assert.equal(hotp(secret, counter, "SHA256", digits), referenceHotp(secret, counter, "SHA256", digits));
      }
    }
    assert.equal(hotp(ascii("12345678901234567890"), 0x23523ec, "SHA1", 8), "07081804", "a leading zero stays");
  });

  test("counters past 2^32", () => {
    const secret = ascii("12345678901234567890");
    for (const counter of [2 ** 32, 2 ** 32 + 1, 2 ** 40 + 12345, 2 ** 52]) {
      assert.equal(hotp(secret, counter, "SHA1", 6), referenceHotp(secret, counter, "SHA1", 6), String(counter));
    }
  });
});

describe("base32", () => {
  // RFC 4648 section 10.
  const VECTORS = [["f", "MY======"], ["fo", "MZXQ===="], ["foo", "MZXW6==="], ["foob", "MZXW6YQ="], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI======"]];

  test("RFC 4648's vectors, with and without padding", () => {
    for (const [text, encoded] of VECTORS) {
      assert.equal(Buffer.from(base32Bytes(encoded)).toString(), text, encoded);
      assert.equal(Buffer.from(base32Bytes(encoded.replace(/=+$/, ""))).toString(), text, `${encoded} unpadded`);
    }
  });

  test("lower case, spaces and hyphens are tolerated", () => {
    const encoded = base32(ascii("synthetic seed for spacing"));
    const expected = Buffer.from(base32Bytes(encoded)).toString("hex");
    const spaced = encoded.match(/.{1,4}/g).join(" ");
    for (const variant of [encoded.toLowerCase(), spaced, spaced.toLowerCase(), encoded.match(/.{1,4}/g).join("-"), ` ${encoded}\n`, `${encoded}====`]) {
      assert.equal(Buffer.from(base32Bytes(variant)).toString("hex"), expected, JSON.stringify(variant));
    }
  });

  test("anything else is unreadable rather than a different secret", () => {
    for (const text of ["", "   ", "====", "MZXW6YTB0", "MZXW 6YTB 1", "MZXW8", "MZ=XW6", "MZXW6YTB!", "M", "ÇZXW6YTB"]) {
      assert.equal(base32Bytes(text), undefined, JSON.stringify(text));
    }
  });

  test("bits left over after the last whole byte are dropped", () => {
    assert.equal(Buffer.from(base32Bytes("MZXW6YQ")).toString(), "foob");
    assert.equal(Buffer.from(base32Bytes("MZXW6YR")).toString(), "foob", "non-zero spare bits too");
  });
});

describe("the code pasted near the end of a period", () => {
  const secret = ascii("12345678901234567890");
  const thirty = { secret, algorithm: "SHA1", digits: 6, period: 30 };
  const sixty = { secret, algorithm: "SHA512", digits: 8, period: 60 };
  const at = (account, counter) => hotp(account.secret, counter, account.algorithm, account.digits);
  const start = 1_800_000_000_000; // a period boundary for both 30 and 60 seconds

  test("the margin is three seconds", () => {
    assert.equal(MARGIN, 3000);
  });

  test("30 s: the current code until exactly three seconds are left, the next code after", () => {
    const counter = start / 30_000;
    assert.equal(codeToPaste(thirty, start), at(thirty, counter), "the first millisecond of a period");
    assert.equal(codeToPaste(thirty, start + 26_999), at(thirty, counter));
    assert.equal(codeToPaste(thirty, start + 27_000), at(thirty, counter), "exactly three seconds left");
    assert.equal(codeToPaste(thirty, start + 27_001), at(thirty, counter + 1), "a millisecond less than three seconds");
    assert.equal(codeToPaste(thirty, start + 29_999), at(thirty, counter + 1), "the last millisecond");
    assert.equal(codeToPaste(thirty, start + 30_000), at(thirty, counter + 1), "the next period's first millisecond");
    assert.equal(codeToPaste(thirty, start + 57_001), at(thirty, counter + 2));
  });

  test("60 s: the same three seconds", () => {
    const counter = start / 60_000;
    assert.equal(codeToPaste(sixty, start + 56_999), at(sixty, counter));
    assert.equal(codeToPaste(sixty, start + 57_000), at(sixty, counter));
    assert.equal(codeToPaste(sixty, start + 57_001), at(sixty, counter + 1));
    assert.equal(codeToPaste(sixty, start + 60_000), at(sixty, counter + 1));
  });

  test("the current and the next code differ, so the rule is seen", () => {
    assert.notEqual(at(thirty, start / 30_000), at(thirty, start / 30_000 + 1));
  });
});
