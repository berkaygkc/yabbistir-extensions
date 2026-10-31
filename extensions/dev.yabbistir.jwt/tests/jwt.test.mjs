import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { detectors } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const b64url = (text) => Buffer.from(text, "utf8").toString("base64url");
// Synthetic tokens, built here.
const token = ({ header = '{"alg":"HS256","typ":"JWT"}', payload, signature = "c2lnbmF0dXJl" }) => `${b64url(header)}.${b64url(payload)}.${signature}`;
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
// Fixed clock: 2026-01-01T00:00:00Z is 1767225600.
const now = "2026-01-01T00:00:00Z";
const hostIn = (language, preferredNow = now) => createFakeHost({ folder, now: preferredNow, context: { language } });
const valid = (text) => hostIn("en").validate(detectors.jwt, item(text));
const sections = (text, language = "en") => hostIn(language).preview(detectors.jwt, item(text), { language });

describe("detection", () => {
  test("aTokenIsRecognized", async () => {
    assert.equal(await valid(token({ payload: '{"sub":"1234"}' })), true);
    assert.equal(await valid(token({ payload: '{"sub":"1234"}', signature: "" })), true);
    assert.equal(await valid("  " + token({ payload: '{"a":1}' }) + "\n"), true);
  });

  test("otherTextIsNot", async () => {
    assert.equal(await valid("a.b"), false);
    assert.equal(await valid("a.b.c.d"), false);
    assert.equal(await valid("hello.world.sig"), false);
    assert.equal(await valid(""), false);
  });

  test("theHeaderNeedsAStringAlgAndThePayloadAnObject", async () => {
    assert.equal(await valid(token({ header: '{"typ":"JWT"}', payload: "{}" })), false);
    assert.equal(await valid(token({ header: '{"alg":5}', payload: "{}" })), false);
    assert.equal(await valid(token({ payload: "[1]" })), false);
    assert.equal(await valid(token({ payload: '"text"' })), false);
  });

  test("brokenBase64OrJsonIsNot", async () => {
    // A part whose length is 1 mod 4 is never valid base64; "!!" is outside the alphabet.
    assert.equal(await valid(`${b64url('{"alg":"HS256"}')}.A.sig`), false);
    assert.equal(await valid(`${b64url('{"alg":"HS256"}')}.!!.sig`), false);
    assert.equal(await valid(`${b64url("not json")}.${b64url("{}")}.sig`), false);
    // Bytes that are not UTF-8 are not text.
    assert.equal(await valid(`${Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url")}.${b64url("{}")}.sig`), false);
    assert.deepEqual(await sections("a.!!.c"), []);
  });

  test("anOversizedTokenIsNot", async () => {
    assert.equal(await valid(token({ payload: '{"pad":"' + "a".repeat(17_000) + '"}' })), false);
  });
});

describe("preview", () => {
  test("showsHeaderPayloadAndTimes", async () => {
    const result = await sections(token({ payload: '{"sub":"1234","iat":1700000000,"exp":1700003600}' }));
    assert.equal(result.length, 3);
    const [header, payload, info] = result;
    assert.deepEqual([header.type, header.title, header.language], ["code", "Header", "json"]);
    assert.equal(header.code, '{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    assert.ok(payload.code.includes('\n  "sub": "1234"'));
    assert.deepEqual([info.type, info.title], ["keyValue", "Info"]);
    assert.deepEqual(info.rows[0], ["alg", "HS256"]);
    assert.ok(info.rows.some(([key, value]) => key === "typ" && value === "JWT"));
    assert.ok(info.rows.some(([key, value]) => key === "sub" && value === "1234"));
    assert.ok(info.rows.some(([key, value]) => key === "iat" && !value.includes("expired")));
    assert.deepEqual(info.rows.at(-1), ["", "The signature isn't checked"]);
  });

  test("anExpiredTokenIsMarked", async () => {
    const [, , info] = await sections(token({ payload: '{"exp":1000}' }));
    const exp = info.rows.find(([key]) => key === "exp");
    assert.ok(exp[1].endsWith(" · expired"), exp[1]);
  });

  test("theClockDecidesExpiry", async () => {
    const text = token({ payload: '{"exp":1767225660}' }); // one minute after the fixed now
    const before = await hostIn("en", "2026-01-01T00:00:00Z").preview(detectors.jwt, item(text));
    assert.ok(!before[2].rows.find(([key]) => key === "exp")[1].includes("expired"));
    const after = await hostIn("en", "2026-01-01T00:02:00Z").preview(detectors.jwt, item(text));
    assert.ok(after[2].rows.find(([key]) => key === "exp")[1].endsWith("expired"));
  });

  test("aFutureTokenIsNotMarked", async () => {
    const [, , info] = await sections(token({ payload: '{"exp":99999999999}' }));
    assert.ok(!info.rows.find(([key]) => key === "exp")[1].includes("expired"));
  });

  test("speaksTheAppsLanguage", async () => {
    const [header, payload, info] = await sections(token({ payload: '{"exp":1000}' }), "tr");
    assert.deepEqual([header.title, payload.title, info.title], ["Başlık", "İçerik", "Bilgi"]);
    assert.ok(info.rows.find(([key]) => key === "exp")[1].endsWith("süresi doldu"));
    assert.equal(info.rows.at(-1)[1], "İmza doğrulanmaz");
  });

  test("anythingElseHasNoPreview", async () => {
    assert.deepEqual(await sections("hello"), []);
  });
});
