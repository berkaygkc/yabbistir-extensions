import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { captureRules } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const base = { id: 1, tags: [], copiedAt: "2026-01-01T00:00:00Z" };
const link = (url) => ({ ...base, kind: "link", text: url, url });
const text = (value) => ({ ...base, kind: "text", text: value });
const clean = (item) => host.capture(captureRules.clean, item);

describe("clean", () => {
  test("trackingParametersAreRemoved", async () => {
    assert.deepEqual(await clean(link("https://www.youtube.com/watch?v=abc&si=x&t=42")), { replace: { url: "https://www.youtube.com/watch?v=abc&t=42" } });
    // utm_ is a lowercase prefix; the harmless UTM_x, the encoded id and the fragment stay.
    assert.deepEqual(await clean(link("https://Example.com/a?utm_source=x&id=7%20&fbclid=1&UTM_x=2#frag")), { replace: { url: "https://Example.com/a?id=7%20&UTM_x=2#frag" } });
  });

  test("harmlessParametersStay", async () => {
    assert.deepEqual(await clean(link("https://example.com/s?q=cats&page=2&gclid=z")), { replace: { url: "https://example.com/s?q=cats&page=2" } });
    assert.deepEqual(await clean(link("https://example.com/s?q=cats&page=2&lang=en")), { keep: true });
  });

  test("xLinksLoseTheirTrackingToken", async () => {
    assert.deepEqual(await clean(link("https://x.com/user/status/1?s=20&t=abc")), { replace: { url: "https://x.com/user/status/1" } });
    // `s` and `t` go only on X: elsewhere they are ordinary parameters.
    assert.deepEqual(await clean(link("https://example.com/p?s=20&t=abc")), { keep: true });
  });

  test("aLinkWithOnlyTrackingParametersLosesItsQuestionMark", async () => {
    assert.deepEqual(await clean(link("https://example.com/p?utm_source=a&gclid=b#top")), { replace: { url: "https://example.com/p#top" } });
  });

  test("aCleanLinkIsLeftAlone", async () => {
    assert.deepEqual(await clean(link("https://example.com/p?id=1#x")), { keep: true });
    assert.deepEqual(await clean(link("https://example.com/p")), { keep: true });
    assert.deepEqual(await clean(link("https://example.com/p?")), { keep: true });
  });

  test("aTextThatIsOneAddressStaysText", async () => {
    assert.deepEqual(await clean(text("  https://example.com/p?fbclid=1&id=2 \n")), { replace: { text: "https://example.com/p?id=2" } });
  });

  test("textThatIsNotOneAddressIsLeftAlone", async () => {
    assert.deepEqual(await clean(text("see https://example.com/p?fbclid=1 now")), { keep: true });
    assert.deepEqual(await clean(text("https://example.com/?fbclid=1 https://example.com/?gclid=2")), { keep: true });
    assert.deepEqual(await clean(text("hello")), { keep: true });
  });

  test("hostRulesFollowTheDomainList", async () => {
    assert.deepEqual(await clean(link("https://m.youtube.com/watch?v=a&feature=share&pp=z")), { replace: { url: "https://m.youtube.com/watch?v=a" } });
    assert.deepEqual(await clean(link("https://youtu.be/abc?si=q&t=9")), { replace: { url: "https://youtu.be/abc?t=9" } });
    assert.deepEqual(await clean(link("https://notyoutube.com/w?si=q")), { keep: true });
    assert.deepEqual(await clean(link("https://open.spotify.com/track/1?si=q")), { replace: { url: "https://open.spotify.com/track/1" } });
    assert.deepEqual(await clean(link("https://www.tiktok.com/@a/video/1?_r=1&_t=2&lang=tr")), { replace: { url: "https://www.tiktok.com/@a/video/1?lang=tr" } });
  });
});

describe("manifest pattern", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const accepts = manifest.contributes.captureRules[0].accepts;
  // The app compiles the pattern with ICU; (?i) is its inline flag, which JavaScript spells as the i flag.
  const pattern = new RegExp(accepts.pattern.replace(/^\(\?i\)/, ""), "i");

  test("takesOnlyASingleAddress", () => {
    for (const yes of ["https://a.dev/x?utm_source=y", "  https://a.dev/x?fbclid=1 \n", "http://a.dev", "HTTPS://WWW.YOUTUBE.COM/watch?v=a&si=x"]) {
      assert.ok(pattern.test(yes), yes);
    }
    for (const no of ["hello world", "see https://a.dev/x?fbclid=1 now", "https://a.dev/?a=1 https://b.dev/?b=2", "ftp://a.dev/x"]) {
      assert.ok(!pattern.test(no), no);
    }
  });

  test("anUppercaseAddressIsCleaned", async () => {
    assert.deepEqual(await clean(text("HTTPS://WWW.YOUTUBE.COM/watch?v=a&si=x")), { replace: { text: "HTTPS://WWW.YOUTUBE.COM/watch?v=a" } });
  });

  test("theRuleDoesNotAskForTags", () => {
    assert.equal(accepts.tags, undefined);
  });
});
