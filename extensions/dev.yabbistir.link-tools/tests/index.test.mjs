import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions, detectors, SHORTENERS } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const link = (url, tags = []) => ({ id: 1, kind: "link", text: url, url, tags, copiedAt: "2026-01-01T00:00:00Z" });
const redirect = (to, status = 301) => ({ status, headers: { Location: to }, text: "" });
const make = (http, language = "en") => createFakeHost({ folder, http, context: { language } });
const TAG = "dev.yabbistir.link-tools:shortlink";

describe("expand", () => {
  test("oneHop", async () => {
    const host = make({ "https://bit.ly/abc": redirect("https://example.org/page?a=1") });
    assert.deepEqual(await host.run(actions.expand, link("https://bit.ly/abc")), { text: "https://example.org/page?a=1" });
  });

  for (const hops of [2, 3, 4, 5]) {
    test(`${hops}Hops`, async () => {
      const table = {};
      const hosts = ["bit.ly", "t.co", "tinyurl.com", "ow.ly", "buff.ly"];
      for (let i = 0; i < hops; i++) {
        table[`https://${hosts[i]}/x`] = redirect(i === hops - 1 ? "https://example.org/end" : `https://${hosts[i + 1]}/x`);
      }
      const host = make(table);
      assert.deepEqual(await host.run(actions.expand, link("https://bit.ly/x")), { text: "https://example.org/end" });
      assert.equal(host.calls.filter((c) => c.api === "http.fetch").length, hops);
    });
  }

  test("sixHopsIsTooMany", async () => {
    const hosts = ["bit.ly", "t.co", "tinyurl.com", "ow.ly", "buff.ly", "lnkd.in"];
    const table = {};
    hosts.forEach((h, i) => { table[`https://${h}/x`] = redirect(i === 5 ? "https://example.org/end" : `https://${hosts[i + 1]}/x`); });
    await assert.rejects(make(table).run(actions.expand, link("https://bit.ly/x")), /more than 5/);
  });

  test("stopsAtAHostThatIsNotListed", async () => {
    const host = make({ "https://bit.ly/a": redirect("https://t.co/b"), "https://t.co/b": redirect("https://news.example.com/story") });
    assert.deepEqual(await host.run(actions.expand, link("https://bit.ly/a")), { text: "https://news.example.com/story" });
    assert.equal(host.calls.filter((c) => c.api === "http.fetch").length, 2);
  });

  test("resolvesRelativeLocation", async () => {
    const host = make({ "https://bit.ly/a": redirect("/b"), "https://bit.ly/b": redirect("https://example.org/") });
    assert.deepEqual(await host.run(actions.expand, link("https://bit.ly/a")), { text: "https://example.org/" });
  });

  test("detectsALoop", async () => {
    const host = make({ "https://bit.ly/a": redirect("https://t.co/b"), "https://t.co/b": redirect("https://bit.ly/a") });
    await assert.rejects(host.run(actions.expand, link("https://bit.ly/a")), /back to itself/);
  });

  test("selfLoop", async () => {
    await assert.rejects(make({ "https://bit.ly/a": redirect("https://bit.ly/a") }).run(actions.expand, link("https://bit.ly/a")), /back to itself/);
  });

  test("answerWithoutLocation", async () => {
    await assert.rejects(make({ "https://bit.ly/a": { status: 200, text: "<html>" } }).run(actions.expand, link("https://bit.ly/a")), /did not say/);
    await assert.rejects(make({ "https://bit.ly/a": { status: 301, text: "" } }).run(actions.expand, link("https://bit.ly/a")), /did not say/);
  });

  test("redirectOutsideTheListGivesAClearMessage", async () => {
    const host = make({ "https://bit.ly/a": yabError("networkError", "bit.ly: redirected outside the domains") });
    await assert.rejects(host.run(actions.expand, link("https://bit.ly/a")), /Couldn’t read where this link goes/);
  });

  test("networkErrorMessageHasNoUrl", async () => {
    const host = make({ "https://bit.ly/secret-path?token=zzz": yabError("networkError", "failed") });
    await assert.rejects(host.run(actions.expand, link("https://bit.ly/secret-path?token=zzz")), (e) => !/secret-path|zzz/.test(e.message));
  });

  test("badLocation", async () => {
    await assert.rejects(make({ "https://bit.ly/a": redirect("javascript:alert(1)") }).run(actions.expand, link("https://bit.ly/a")), /not a web link/);
    await assert.rejects(make({ "https://bit.ly/a": redirect("file:///etc/hosts") }).run(actions.expand, link("https://bit.ly/a")), /not a web link/);
  });

  test("isgdUsesTheLookupApi", async () => {
    const short = "https://is.gd/Ab12";
    const host = make({ [`https://is.gd/forward.php?format=simple&shorturl=${encodeURIComponent(short)}`]: { text: "https://example.org/a?b=c&d=e\n" } });
    assert.deepEqual(await host.run(actions.expand, link(short)), { text: "https://example.org/a?b=c&d=e" });
  });

  test("vgdUsesItsOwnLookup", async () => {
    const short = "https://v.gd/Zz9";
    const host = make({ [`https://v.gd/forward.php?format=simple&shorturl=${encodeURIComponent(short)}`]: { text: "https://example.org/" } });
    assert.deepEqual(await host.run(actions.expand, link(short)), { text: "https://example.org/" });
  });

  test("lookupFailures", async () => {
    const short = "https://is.gd/nope";
    const key = `https://is.gd/forward.php?format=simple&shorturl=${encodeURIComponent(short)}`;
    await assert.rejects(make({ [key]: { status: 400, text: "Error: Sorry, the short URL you clicked on is not valid." } }).run(actions.expand, link(short)), /couldn’t find/);
    await assert.rejects(make({ [key]: { status: 502, text: "Error: Rate limit exceeded" } }).run(actions.expand, link(short)), /busy/);
    await assert.rejects(make({ [key]: { status: 200, text: "Error: odd" } }).run(actions.expand, link(short)), /couldn’t find/);
    await assert.rejects(make({ [key]: yabError("networkError", "down") }).run(actions.expand, link(short)), /couldn’t find/);
  });

  test("isgdThenAnotherShortener", async () => {
    const short = "https://is.gd/q";
    const host = make({
      [`https://is.gd/forward.php?format=simple&shorturl=${encodeURIComponent(short)}`]: { text: "https://bit.ly/z" },
      "https://bit.ly/z": redirect("https://example.org/"),
    });
    assert.deepEqual(await host.run(actions.expand, link(short)), { text: "https://example.org/" });
  });

  test("notAShortLink", async () => {
    const host = make({});
    const result = await host.run(actions.expand, link("https://example.org/page"));
    assert.deepEqual(result, { none: true, message: "This is not a known short link." });
    assert.equal(host.calls.length, 0);
  });

  test("cancelStaysCancelled", async () => {
    const host = make({ "https://bit.ly/a": yabError("cancelled", "cancelled") });
    await assert.rejects(host.run(actions.expand, link("https://bit.ly/a")), { code: "cancelled" });
  });

  test("turkishMessage", async () => {
    const result = await make({}, "tr").run(actions.expand, link("https://example.org/"));
    assert.equal(result.message, "Bu, bilinen bir kısa bağlantı değil.");
  });
});

describe("shorten", () => {
  const api = (url) => `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`;

  test("success", async () => {
    const host = make({ [api("https://example.org/a")]: { text: "https://is.gd/Ab12\n" } });
    assert.deepEqual(await host.run(actions.shorten, link("https://example.org/a")), { text: "https://is.gd/Ab12" });
  });

  test("encodesTheUrl", async () => {
    const long = "https://example.org/a%20b?x=1&y=2#frag";
    const normalized = new URL(long).href;
    const host = make({ [api(normalized)]: { text: "https://is.gd/Q" } });
    assert.deepEqual(await host.run(actions.shorten, link(long)), { text: "https://is.gd/Q" });
    const called = host.calls.find((c) => c.api === "http.fetch").args[0];
    assert.ok(called.includes("%26y%3D2%23frag"), called);
    assert.ok(!called.includes(" "));
  });

  test("failureAnswer", async () => {
    const host = make({ [api("https://example.org/a")]: { status: 400, text: "Error: Please specify a URL to shorten." } });
    await assert.rejects(host.run(actions.shorten, link("https://example.org/a")), /couldn’t shorten/);
  });

  test("successStatusButErrorBody", async () => {
    const host = make({ [api("https://example.org/a")]: { status: 200, text: "Error: nope" } });
    await assert.rejects(host.run(actions.shorten, link("https://example.org/a")), /couldn’t shorten/);
  });

  test("rateLimit", async () => {
    const host = make({ [api("https://example.org/a")]: { status: 502, text: "Error: Rate limit exceeded" } });
    await assert.rejects(host.run(actions.shorten, link("https://example.org/a")), /busy/);
  });

  test("networkFailure", async () => {
    const host = make({ [api("https://example.org/a")]: yabError("networkError", "no connection") });
    await assert.rejects(host.run(actions.shorten, link("https://example.org/a")), /couldn’t shorten/);
  });

  test("errorMessageKeepsTheLinkOut", async () => {
    const host = make({ [api("https://example.org/private?token=zzz")]: { status: 503, text: "Error: x" } });
    await assert.rejects(host.run(actions.shorten, link("https://example.org/private?token=zzz")), (e) => !/private|zzz/.test(e.message));
  });

  test("notALink", async () => {
    const host = make({});
    const item = { id: 1, kind: "text", text: "just words", tags: [], copiedAt: "2026-01-01T00:00:00Z" };
    assert.deepEqual(await host.run(actions.shorten, item), { none: true, message: "There is no link to shorten." });
  });
});

describe("offers and detector", () => {
  test("detectorTagsShortenersOnly", async () => {
    const host = make({});
    for (const h of SHORTENERS) assert.equal(await host.validate(detectors.shortlink, link(`https://${h}/abc`)), true, h);
    assert.equal(await host.validate(detectors.shortlink, link("https://www.bit.ly/abc")), true);
    assert.equal(await host.validate(detectors.shortlink, link("https://example.org/bit.ly")), false);
    assert.equal(await host.validate(detectors.shortlink, link("https://notbit.ly/abc")), false);
    assert.equal(await host.validate(detectors.shortlink, link("https://bit.ly.evil.example/abc")), false);
    assert.equal(await host.validate(detectors.shortlink, link("ftp://bit.ly/abc")), false);
  });

  test("manifestPatternMatchesTheListedHosts", () => {
    const host = make({});
    for (const h of SHORTENERS) assert.ok(host.offers(link(`https://${h}/abc`, [TAG])).includes("expand"), h);
    assert.ok(host.offers(link("https://bit.ly", [TAG])).includes("expand"));
  });

  test("expandIsOfferedOnlyOnTaggedLinks", () => {
    const host = make({});
    assert.deepEqual(host.offers(link("https://example.org/a")), ["shorten"]);
    assert.deepEqual(host.offers(link("https://bit.ly/a", [TAG])), ["expand", "shorten"]);
  });

  test("shortenNotOfferedOnTextOrBadLinks", () => {
    const host = make({});
    assert.deepEqual(host.offers({ kind: "text", text: "hello", tags: [] }), []);
  });

  test("networkDomainsCoverEveryShortener", async () => {
    const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    assert.deepEqual([...manifest.network.domains].sort(), [...SHORTENERS].sort());
  });

  test("detectorIsLinearOnLongInput", async () => {
    const host = make({});
    const long = "https://" + "a.".repeat(20000) + "bit.ly/" + "x".repeat(20000);
    const start = performance.now();
    await host.validate(detectors.shortlink, link(long));
    host.offers(link(long, [TAG]));
    assert.ok(performance.now() - start < 40);
  });
});
