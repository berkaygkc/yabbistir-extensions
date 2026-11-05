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
  const key = (short, h = "is.gd") => `https://${h}/forward.php?format=simple&shorturl=${encodeURIComponent(short)}`;
  const chain = (n) => {
    const table = {};
    for (let i = 0; i < n; i++) {
      const from = `https://is.gd/h${i}`;
      table[key(from)] = { text: i === n - 1 ? "https://example.org/end" : `https://is.gd/h${i + 1}` };
    }
    return table;
  };

  for (const hops of [1, 2, 3, 4, 5]) {
    test(`${hops}Hops`, async () => {
      const host = make(chain(hops));
      assert.deepEqual(await host.run(actions.expand, link("https://is.gd/h0")), { text: "https://example.org/end" });
      assert.equal(host.calls.filter((c) => c.api === "http.fetch").length, hops);
    });
  }

  test("sixHopsIsTooMany", async () => {
    await assert.rejects(make(chain(6)).run(actions.expand, link("https://is.gd/h0")), /more than 5/);
  });

  test("lookupIsAPlainGetOfTheDocumentedEndpoint", async () => {
    const host = make(chain(1));
    await host.run(actions.expand, link("https://is.gd/h0"));
    const call = host.calls.find((c) => c.api === "http.fetch");
    assert.ok(call.args[0].startsWith("https://is.gd/forward.php?format=simple&shorturl="));
    assert.equal(call.args[1]?.method ?? "GET", "GET");
  });

  test("subdomainUsesTheLookupToo", async () => {
    const host = make({ [key("https://www.is.gd/x")]: { text: "https://example.org/" } });
    assert.deepEqual(await host.run(actions.expand, link("https://www.is.gd/x")), { text: "https://example.org/" });
    assert.equal(host.calls.length, 1);
  });

  test("vgdLeadingToIsgd", async () => {
    const host = make({ [key("https://v.gd/a", "v.gd")]: { text: "https://is.gd/b" }, [key("https://is.gd/b")]: { text: "https://example.org/" } });
    assert.deepEqual(await host.run(actions.expand, link("https://v.gd/a")), { text: "https://example.org/" });
  });

  test("stopsAtAHostThatIsNotListed", async () => {
    const host = make({ [key("https://is.gd/a")]: { text: "https://bit.ly/z" } });
    assert.deepEqual(await host.run(actions.expand, link("https://is.gd/a")), { text: "https://bit.ly/z" });
    assert.equal(host.calls.filter((c) => c.api === "http.fetch").length, 1);
  });

  test("detectsALoop", async () => {
    const host = make({ [key("https://is.gd/a")]: { text: "https://v.gd/b" }, [key("https://v.gd/b", "v.gd")]: { text: "https://is.gd/a" } });
    await assert.rejects(host.run(actions.expand, link("https://is.gd/a")), /back to itself/);
  });

  test("selfLoop", async () => {
    await assert.rejects(make({ [key("https://is.gd/a")]: { text: "https://is.gd/a" } }).run(actions.expand, link("https://is.gd/a")), /back to itself/);
  });

  test("badLocation", async () => {
    await assert.rejects(make({ [key("https://is.gd/a")]: { text: "javascript:alert(1)" } }).run(actions.expand, link("https://is.gd/a")), /not a web link/);
    await assert.rejects(make({ [key("https://is.gd/a")]: { text: "file:///etc/hosts" } }).run(actions.expand, link("https://is.gd/a")), /not a web link/);
  });

  test("networkErrorMessageHasNoUrl", async () => {
    const short = "https://is.gd/secret-path?token=zzz";
    const host = make({ [key(short)]: yabError("networkError", "failed") });
    await assert.rejects(host.run(actions.expand, link(short)), (e) => !/secret-path|zzz/.test(e.message));
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

  test("notAShortLink", async () => {
    const host = make({});
    const result = await host.run(actions.expand, link("https://example.org/page"));
    assert.deepEqual(result, { none: true, message: "This is not an is.gd or v.gd link." });
    assert.equal(host.calls.length, 0);
  });

  test("cancelStaysCancelled", async () => {
    const host = make({ [key("https://is.gd/a")]: yabError("cancelled", "cancelled") });
    await assert.rejects(host.run(actions.expand, link("https://is.gd/a")), { code: "cancelled" });
  });

  test("turkishMessage", async () => {
    const result = await make({}, "tr").run(actions.expand, link("https://example.org/"));
    assert.equal(result.message, "Bu bir is.gd veya v.gd bağlantısı değil.");
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

  test("alreadyShortLinkIsNotShortenedAgain", async () => {
    const host = make({});
    assert.deepEqual(await host.run(actions.shorten, link("https://is.gd/Ab12")), { none: true, message: "This link is already short." });
    assert.equal(host.calls.length, 0);
  });

  test("linkWithCredentialsIsNotSent", async () => {
    const host = make({});
    const result = await host.run(actions.shorten, link("https://user:" + "pw" + "@example.org/a"));
    assert.equal(result.none, true);
    assert.equal(host.calls.length, 0);
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
    assert.equal(await host.validate(detectors.shortlink, link("https://www.is.gd/abc")), true);
    assert.equal(await host.validate(detectors.shortlink, link("https://example.org/is.gd")), false);
    assert.equal(await host.validate(detectors.shortlink, link("https://notis.gd/abc")), false);
    assert.equal(await host.validate(detectors.shortlink, link("https://is.gd.evil.example/abc")), false);
    assert.equal(await host.validate(detectors.shortlink, link("ftp://is.gd/abc")), false);
  });

  test("manifestPatternMatchesTheListedHosts", () => {
    const host = make({});
    for (const h of SHORTENERS) assert.ok(host.offers(link(`https://${h}/abc`, [TAG])).includes("expand"), h);
    assert.ok(host.offers(link("https://is.gd", [TAG])).includes("expand"));
  });

  test("expandIsOfferedOnlyOnTaggedLinks", () => {
    const host = make({});
    assert.deepEqual(host.offers(link("https://example.org/a")), ["shorten"]);
    assert.deepEqual(host.offers(link("https://is.gd/a", [TAG])), ["expand", "shorten"]);
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
    const long = "https://" + "a.".repeat(20000) + "is.gd/" + "x".repeat(20000);
    const start = performance.now();
    await host.validate(detectors.shortlink, link(long));
    host.offers(link(long, [TAG]));
    assert.ok(performance.now() - start < 250);
  });
});
