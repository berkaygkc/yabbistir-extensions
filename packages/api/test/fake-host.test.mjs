import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { acceptsMatch, createFakeHost, yabError } from "../fake-host.mjs";

const manifest = {
  id: "dev.example.fetcher",
  defaultLocale: "en",
  permissions: ["network", "exec"],
  network: { domains: ["example.com"] },
  requires: { tools: [{ name: "yt-dlp", install: "brew install yt-dlp" }, { name: "ffmpeg", install: "brew install ffmpeg" }] },
  preferences: [
    { id: "quality", type: "choice", title: "quality", default: "best", options: [{ id: "best", title: "best" }] },
    { id: "token", type: "secret", title: "token" },
    { id: "folder", type: "folder", title: "folder", default: "~/Downloads" },
  ],
};

describe("permissions", () => {
  test("undeclaredNetworkIsDenied", async () => {
    const offline = createFakeHost({ manifest: { id: "dev.example.offline" }, http: { "https://example.com/a": { text: "a" } } });
    await assert.rejects(offline.yab.http.fetch("https://example.com/a"), { code: "permissionDenied" });

    const host = createFakeHost({ manifest, http: { "https://elsewhere.org/a": { text: "a" } } });
    await assert.rejects(host.yab.http.fetch("https://elsewhere.org/a"), { code: "permissionDenied", message: /elsewhere\.org/ });
    await assert.rejects(host.yab.http.fetch("ftp://example.com/a"), { code: "permissionDenied" });
    assert.deepEqual(host.calls.map((call) => call.api), ["http.fetch", "http.fetch"]);
  });

  test("unmatchedHttpIsANetworkError", async () => {
    const host = createFakeHost({ manifest, http: { "https://example.com/a": { text: "a" }, "POST https://api.example.com/b": { status: 201, json: { ok: true } } } });
    await assert.rejects(host.yab.http.fetch("https://example.com/missing"), { code: "networkError" });
    await assert.rejects(host.yab.http.fetch("https://api.example.com/b"), { code: "networkError" }, "the table entry is for POST only");

    const page = await host.yab.http.fetch("https://example.com/a");
    assert.deepEqual(page, { status: 200, headers: {}, text: "a" });
    const created = await host.yab.http.fetch("https://api.example.com/b", { method: "post", body: "{}" });
    assert.equal(created.status, 201);
    assert.deepEqual(JSON.parse(created.text), { ok: true });
    assert.equal(created.headers["content-type"], "application/json");
    assert.deepEqual(host.calls.at(-1).args, ["https://api.example.com/b", { method: "post", body: "{}" }]);
  });

  test("execOfAnUnlistedToolIsDenied", async () => {
    const host = createFakeHost({ manifest, exec: { curl: { stdout: "x" } } });
    await assert.rejects(host.yab.exec("curl", ["https://example.com"]), { code: "permissionDenied", message: /curl/ });

    const noExec = createFakeHost({ manifest: { ...manifest, permissions: ["network"] }, exec: { "yt-dlp": {} } });
    await assert.rejects(noExec.yab.exec("yt-dlp", []), { code: "permissionDenied" });
  });

  test("a listed tool missing from the table is not installed", async () => {
    const host = createFakeHost({ manifest });
    await assert.rejects(host.yab.exec("ffmpeg", ["-version"]), { code: "toolMissing", message: /brew install ffmpeg/ });
  });

  test("hints, detectors, previews and rules have no effects", async () => {
    const host = createFakeHost({ manifest, http: { "https://example.com/a": { text: "a" } } });
    const notify = { run: () => { yab.notify("hi"); return { text: "x" }; } };
    await assert.rejects(host.hint(notify, { text: "x" }), { code: "permissionDenied" });
    await assert.rejects(host.preview({ preview: async () => { await yab.http.fetch("https://example.com/a"); return []; } }), { code: "permissionDenied" });
    await assert.rejects(host.capture({ run: async () => { await yab.ai.generate("hi"); } }), { code: "permissionDenied" });
    assert.deepEqual(host.notifications, []);
    // The same action, run by the person, may notify.
    await host.run(notify, { text: "x" });
    assert.deepEqual(host.notifications, ["hi"]);
  });

  test("history needs its permission and arrives trimmed", async () => {
    const items = [
      { id: 3, kind: "text", text: "x".repeat(70_000), tags: [], copiedAt: "2026-10-31T10:00:00Z" },
      { id: 2, kind: "image", image: { __image: "i", width: 4, height: 3 }, tags: [], copiedAt: "2026-10-31T09:00:00Z" },
      { id: 1, kind: "link", url: "https://example.com/x", tags: [], copiedAt: "2026-10-31T08:00:00Z" },
    ];
    const without = createFakeHost({ manifest, history: items });
    await assert.rejects(without.yab.history.recent(), { code: "permissionDenied" });

    const host = createFakeHost({ manifest: { ...manifest, permissions: ["history"] }, history: items });
    const recent = await host.yab.history.recent(2);
    assert.deepEqual(recent.map((item) => item.id), [3, 2]);
    assert.equal(recent[0].text.length, 65_536);
    assert.equal(recent[0].truncated, true);
    assert.deepEqual(recent[1].image, { width: 4, height: 3 });
    assert.deepEqual((await host.yab.history.search("EXAMPLE")).map((item) => item.id), [1]);
    await assert.rejects(host.preview({ preview: async () => { await yab.history.recent(); return []; } }), { code: "permissionDenied" });
  });

  test("secrets are the declared ones only", () => {
    const host = createFakeHost({ manifest, secrets: { token: "s3cret", other: "nope" } });
    assert.equal(host.yab.secrets.get("token"), "s3cret");
    assert.equal(host.yab.secrets.get("other"), null);
    assert.equal(host.yab.preferences.token, undefined);
  });
});

describe("answers", () => {
  test("notificationsAreRecorded", () => {
    const host = createFakeHost({ manifest });
    host.yab.notify("Saved");
    host.yab.notify("x".repeat(300));
    assert.deepEqual(host.notifications, ["Saved", "x".repeat(200)]);
    assert.throws(() => host.yab.notify(42), { code: "badResult" });
    host.yab.open("https://example.com/page");
    assert.deepEqual(host.opened, ["https://example.com/page"]);
    assert.throws(() => host.yab.open("file:///etc/hosts"), { code: "badResult" });
  });

  test("exec answers from the table and reports lines", async () => {
    const host = createFakeHost({
      manifest,
      exec: { "yt-dlp": (args, { input }) => ({ exitCode: 0, stdout: `got ${args.join(" ")}\n\nline two\r\n`, stderr: input ?? "" }) },
    });
    const lines = [];
    const result = await host.yab.exec("yt-dlp", ["--", "https://example.com/v"], { input: "warn", onLine: (line, stream) => lines.push([stream, line]) });
    assert.deepEqual(result, { exitCode: 0, stdout: "got -- https://example.com/v\n\nline two\r\n", stderr: "warn" });
    assert.deepEqual(lines, [["stdout", "got -- https://example.com/v"], ["stdout", "line two"], ["stderr", "warn"]]);
    assert.deepEqual(host.calls.at(-1), { api: "exec", args: ["yt-dlp", ["--", "https://example.com/v"], { input: "warn" }] });
    await assert.rejects(host.yab.exec("yt-dlp", "--version"), { code: "badResult" });
  });

  test("a table entry can fail like the app", async () => {
    const host = createFakeHost({
      manifest,
      translate: () => { throw yabError("unavailable", "the language pack is not downloaded"); },
      exec: { "yt-dlp": yabError("toolMissing", "yt-dlp is not installed") },
    });
    await assert.rejects(host.yab.translate("merhaba", { to: "en" }), { code: "unavailable", message: "the language pack is not downloaded" });
    await assert.rejects(host.yab.exec("yt-dlp", []), { code: "toolMissing" });
  });

  test("ai and translate answer what the test gives", async () => {
    const host = createFakeHost({ ai: (prompt, options) => `${options.instructions}: ${prompt}`, translate: { text: "hello", from: "tr" } });
    assert.equal(await host.yab.ai.generate("text", { instructions: "Summarize" }), "Summarize: text");
    assert.deepEqual(await host.yab.translate("merhaba", { to: "en" }), { text: "hello", from: "tr" });
    await assert.rejects(host.yab.translate("merhaba", {}), { code: "badResult" });

    const bare = createFakeHost();
    await assert.rejects(bare.yab.ai.generate("text"), { code: "unavailable" });
    await assert.rejects(bare.yab.translate("x", { to: "en" }), { code: "unavailable" });
  });

  test("the global fetch goes through the same table", async () => {
    const realFetch = globalThis.fetch;
    const host = createFakeHost({ manifest, http: { "https://example.com/data": { json: [1, 2] } } });
    const restore = host.install();
    try {
      assert.equal(globalThis.yab, host.yab);
      const response = await fetch("https://example.com/data");
      assert.equal(response.ok, true);
      assert.deepEqual(await response.json(), [1, 2]);
      await assert.rejects(fetch("https://example.com/other"), { code: "networkError" });
      await assert.rejects(fetch("https://elsewhere.org/"), { code: "permissionDenied" });
    } finally {
      restore();
    }
    assert.equal(globalThis.fetch, realFetch);
    assert.equal(globalThis.yab, undefined);
  });

  test("files live in memory, in the work folder", async () => {
    const host = createFakeHost({ manifest, files: { "/Users/test/in.txt": "from the item" },
      item: { kind: "file", files: [{ path: "/Users/test/in.txt", name: "in.txt", size: 13, uti: "public.plain-text" }] } });
    const path = host.yab.files.write("a/b:c.txt", "hello");
    assert.equal(path, `${host.yab.files.workDir}/a-b-c.txt`);
    assert.equal(new TextDecoder().decode(host.yab.files.read(path)), "hello");
    assert.equal(host.yab.files.exists(path), true);
    assert.throws(() => host.yab.files.write("..", "x"), { code: "badResult" });
    assert.throws(() => host.yab.files.read("/etc/hosts"), { code: "badResult" });
    assert.equal(host.yab.files.exists("/etc/hosts"), false);
    assert.equal(new TextDecoder().decode(host.yab.files.read("/Users/test/in.txt")), "from the item");
  });

  test("toFile streams into the work folder", async () => {
    const host = createFakeHost({ manifest, http: { "https://example.com/v.mp4": { body: new Uint8Array([1, 2, 3]) }, "https://example.com/gone": { status: 404, text: "no" } } });
    const saved = await host.yab.http.fetch("https://example.com/v.mp4", { toFile: true });
    assert.equal(saved.file, `${host.yab.files.workDir}/v.mp4`);
    assert.deepEqual([...host.yab.files.read(saved.file)], [1, 2, 3]);
    assert.deepEqual(await host.yab.http.fetch("https://example.com/gone", { toFile: true }), { status: 404, headers: {}, text: "no" });
  });

  test("storage, preferences and t", () => {
    const host = createFakeHost({
      manifest,
      preferences: { quality: "worst" },
      locales: { en: { hello: "Hello {name}", only: "English" }, tr: { hello: "Merhaba {name}" } },
      context: { language: "tr" },
    });
    assert.deepEqual(host.yab.preferences, { quality: "worst", folder: "/Users/test/Downloads" });
    assert.equal(host.yab.t("hello", { name: "Ada" }), "Merhaba Ada");
    assert.equal(host.yab.t("only"), "English");
    assert.equal(host.yab.t("missing"), "missing");
    host.yab.storage.set("count", 2);
    assert.equal(host.yab.storage.get("count"), 2);
    host.yab.storage.remove("count");
    assert.equal(host.yab.storage.get("count"), undefined);
    assert.throws(() => host.yab.storage.set("big", "x".repeat(1_048_577)));
  });
});

describe("calls", () => {
  test("run records results and checks their shape", async () => {
    const host = createFakeHost();
    const upper = { run: (item) => ({ text: item.text.toUpperCase() }) };
    assert.deepEqual(await host.run(upper, { text: "abc" }), { text: "ABC" });
    assert.deepEqual(host.results, [{ text: "ABC" }]);
    await assert.rejects(host.run({ run: () => "ABC" }, { text: "abc" }), { code: "badResult" });
    await assert.rejects(host.run({ run: () => ({ file: "/etc/hosts" }) }), { code: "badResult" });
    const write = { run: () => ({ file: yab.files.write("out.txt", "x") }) };
    assert.match((await host.run(write)).file, /out\.txt$/);
  });

  test("detectors, previews and capture rules answer in their own shapes", async () => {
    const host = createFakeHost();
    assert.equal(await host.validate({ validate: (item) => item.text.length > 2 }, { text: "abcd" }), true);
    assert.deepEqual(await host.preview({ preview: () => [{ type: "text", title: "T", text: "x" }] }, { text: "x" }), [{ type: "text", title: "T", text: "x" }]);
    await assert.rejects(host.preview({ preview: () => [{ type: "chart" }] }), { code: "badResult" });
    assert.deepEqual(await host.capture({ run: () => ({ replace: { text: "clean" } }) }, { text: "dirty" }), { replace: { text: "clean" } });
    assert.equal(await host.capture({ run: () => undefined }, { text: "x" }), undefined);
    await assert.rejects(host.capture({ run: () => ({ replace: { text: "" } }) }), { code: "badResult" });
  });

  test("the context carries the variant, the target and the trigger", async () => {
    const host = createFakeHost({ manifest, context: { variant: "audio" } });
    let seen;
    await host.run({ run: (item, ctx) => { seen = ctx; return { none: true }; } });
    assert.equal(seen.variant, "audio");
    assert.equal(seen.trigger, "search");
    assert.equal(seen.target, null);
    assert.equal(seen.preferences.quality, "best");
    assert.equal(seen.signal.aborted, false);
    await host.preview({ preview: (item, ctx) => { seen = ctx; return []; } });
    assert.equal(seen.trigger, "preview");
  });

  test("cancel rejects what is pending", async () => {
    const host = createFakeHost({ manifest, exec: { "yt-dlp": () => new Promise(() => {}) } });
    const job = host.run({ run: async (item, ctx) => {
      yab.job.progress(0.5, "Half");
      await yab.exec("yt-dlp", ["x"], { signal: ctx.signal });
      return { text: "never" };
    } });
    await new Promise((resolve) => setImmediate(resolve));
    host.cancel();
    await assert.rejects(job, { code: "cancelled" });
    assert.deepEqual(host.progress, [{ fraction: 0.5, message: "Half" }]);
  });

  test("now fixes the clock inside a call", async () => {
    const host = createFakeHost({ now: "2001-02-03T04:05:06Z" });
    const at = await host.run({ run: () => ({ text: new Date().toISOString() + " " + Date.now() }) });
    assert.equal(at.text, `2001-02-03T04:05:06.000Z ${Date.UTC(2001, 1, 3, 4, 5, 6)}`);
    assert.notEqual(new Date().getUTCFullYear(), 2001);
    assert.equal((await host.run({ run: (item) => ({ text: item.copiedAt }) })).text, "2001-02-03T04:05:06.000Z");
  });
});

describe("accepts", () => {
  const text = (value) => ({ kind: "text", text: value });

  test("acceptsMatchAppliesTheKindsAndThePattern", () => {
    const accepts = { kinds: ["text", "code"], pattern: "^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$" };
    assert.equal(acceptsMatch(accepts, text("  ada@example.com\n")), true, "the text is trimmed first");
    assert.equal(acceptsMatch(accepts, { kind: "code", text: "ada@example.com" }), true);
    assert.equal(acceptsMatch(accepts, text("Ada@Example.com")), false, "case counts without (?i)");
    assert.equal(acceptsMatch(accepts, { kind: "link", url: "mailto:ada@example.com" }), false, "the kind must be listed");
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "@" }, text("write to ada@example.com")), true, "searched for, not matched whole");
    assert.equal(acceptsMatch({ kinds: ["link"] }, { kind: "link", url: "https://example.com" }), true, "no pattern: the kind decides");
  });

  test("aLeadingFlagGroupBecomesJavaScriptFlags", () => {
    assert.equal(acceptsMatch({ kinds: ["link"], pattern: "(?i)^https://example\\.com/" }, { kind: "link", url: "HTTPS://EXAMPLE.COM/a" }), true);
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "(?s)^a.b$" }, text("a\nb")), true);
  });

  test("unicodeConstructsMatchAsInICU", () => {
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "^\\p{Lu}\\p{Ll}+$" }, text("Çiçek")), true, "general categories");
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "^\\p{Greek}+$" }, text("λόγος")), true, "a bare script name");
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "^[\\p{Latin}\\s]+$" }, text("Hello world")), true, "a script inside a set");
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "^\\d+$" }, text("١٢٣")), true, "\\d is any decimal digit, as in ICU");
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "(?<=@)example\\.com$" }, text("ada@example.com")), true, "look-behind");
    assert.equal(acceptsMatch({ kinds: ["text"], pattern: "^(?!test@)\\S+@\\S+$" }, text("test@example.com")), false, "look-ahead");
  });

  test("tagsAndImageFiles", () => {
    const tagged = { kind: "text", text: "x", tags: ["dev.example.jwt:jwt"] };
    assert.equal(acceptsMatch({ kinds: ["text"], tags: ["jwt"] }, tagged, { extensionID: "dev.example.jwt" }), true, "an own detector by its id");
    assert.equal(acceptsMatch({ kinds: ["text"], tags: ["dev.example.jwt:jwt"] }, tagged), true);
    assert.equal(acceptsMatch({ kinds: ["text"], tags: ["other"] }, tagged, { extensionID: "dev.example.jwt" }), false);
    const png = { kind: "file", files: [{ path: "/tmp/a.png", name: "a.png", size: 1, uti: "public.png" }] };
    assert.equal(acceptsMatch({ kinds: ["image"] }, png), true, "an image file counts as an image");
    assert.equal(acceptsMatch({ kinds: ["image"] }, { ...png, files: [{ ...png.files[0], uti: "public.plain-text" }] }), false);
  });

  test("icuOnlySyntaxSaysSo", () => {
    assert.throws(() => acceptsMatch({ kinds: ["text"], pattern: "a++" }, text("aa")), /ICU/);
    assert.throws(() => acceptsMatch({ kinds: ["text"], pattern: "(?x) a b" }, text("ab")), /ICU/);
  });

  test("hostOffersTheActionsThatTakeAnItem", () => {
    const host = createFakeHost({ manifest: { id: "dev.example.offers", contributes: { actions: [
      { id: "lower", input: "item", accepts: { kinds: ["text"], pattern: "@" } },
      { id: "uuid", input: "none" },
      { id: "first", input: "item", accepts: { kinds: ["text"], pattern: "@" }, priority: 5 },
      { id: "save", input: "item", accepts: { kinds: ["text"] }, targets: ["finder"], targetsOnly: true },
    ] } } });
    assert.deepEqual(host.offers({ text: "ada@example.com" }), ["first", "lower"], "highest priority first; generators are not transforms");
    assert.deepEqual(host.offers({ text: "no address" }), []);
    const finder = { target: { bundleID: "com.apple.finder", name: "Finder", kind: "finder" } };
    assert.deepEqual(host.offers({ text: "ada@example.com" }, finder), ["save", "first", "lower"], "the target's actions lead");
  });
});
