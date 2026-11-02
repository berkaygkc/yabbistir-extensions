import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

describe("sources", () => {
  // Synthetic data only: a vault, ornek.dev, deniz.k and s3cr3t-örnek.
  const vault = {
    id: "dev.example.vault",
    defaultLocale: "en",
    permissions: ["exec"],
    requires: { tools: [{ name: "vault-cli", install: "brew install vault-cli" }] },
    contributes: { sources: [{ id: "vault", title: "vault.title", sensitive: true, actions: [
      { id: "password", kind: "secret", title: "password.title", label: "password.label" },
      { id: "username", kind: "text", title: "username.title", label: "username.label" },
    ] }] },
  };
  const tools = { "vault-cli": { exitCode: 0, stdout: "", stderr: "" } };
  const hostWith = (source, options = {}) => createFakeHost({ manifest: vault, exec: tools, sources: { vault: source }, ...options });
  const listing = (answer) => hostWith({ list: () => answer }).list("vault");

  test("lists rows and the locked state", async () => {
    const rows = { rows: [{ id: "1", title: "ornek.dev", subtitle: "deniz.k" }, { id: "2", title: "Kasa" }] };
    assert.deepEqual(await listing(rows), rows);
    assert.deepEqual(await listing({ locked: true, message: "Kasa kilitli", command: "vault-cli login" }),
      { locked: true, message: "Kasa kilitli", command: "vault-cli login" });
    assert.deepEqual(await listing({ locked: true, message: "Kasa kilitli", rows: rows.rows }), { locked: true, message: "Kasa kilitli" },
      "locked wins over rows");
    assert.deepEqual(await listing({ locked: true, message: " Kasa\tkilitli ", command: "  " }), { locked: true, message: "Kasa kilitli" },
      "a blank command is none");
    assert.deepEqual(await listing({ locked: true, message: "k".repeat(300), command: "vault-cli login\n" }),
      { locked: true, message: "k".repeat(200), command: "vault-cli login" });
  });

  test("caps and cleans rows like the app", async () => {
    const host = hostWith({ list: () => ({ rows: [
      { id: "0", title: "a\tb\nc", subtitle: "  \n " },
      { id: "1", title: "x".repeat(300), subtitle: " deniz.k\r\n" },
      { id: " 4\t2 ", title: " ornek.dev\u0085", subtitle: null },
      { id: "e\u0301".repeat(256), title: "👩‍💻".repeat(300) },
      ...Array.from({ length: 9_997 }, (_, i) => ({ id: String(i + 4), title: "ornek.dev" })),
    ] }) });
    const { rows } = await host.list("vault");
    assert.equal(rows.length, 10_000);
    assert.deepEqual(rows[0], { id: "0", title: "a b c" });
    assert.deepEqual(rows[1], { id: "1", title: "x".repeat(256), subtitle: "deniz.k" });
    assert.deepEqual(rows[2], { id: " 4\t2 ", title: "ornek.dev" }, "the id goes back exactly as listed");
    assert.deepEqual(rows[3], { id: "e\u0301".repeat(256), title: "👩‍💻".repeat(256) }, "lengths count characters as a person sees them");
    assert.deepEqual(rows.at(-1), { id: "9999", title: "ornek.dev" });
    assert.deepEqual(host.logs, ["list returned more than 10000 rows; kept the first 10000"], "one line, naming no row");
  });

  test("every other listing is a bad result, named by its shape", async () => {
    const cases = [
      ["ornek.dev", "list returned a string; expected {rows} or {locked}"],
      [[], "list returned an array; expected {rows} or {locked}"],
      [undefined, "list returned nothing; expected {rows} or {locked}"],
      [{ items: [] }, "list returned an object of another shape; expected {rows} or {locked}"],
      [{ locked: false, message: "Kasa kilitli" }, "list returned an object of another shape; expected {rows} or {locked}"],
      [{ rows: "ornek.dev" }, "rows must be an array of {id, title, subtitle?}"],
      [{ rows: undefined }, "rows must be an array of {id, title, subtitle?}"],
      [{ rows: ["ornek.dev"] }, "rows[0] is a string; expected {id, title, subtitle?}"],
      [{ rows: [{ id: "1", title: "ornek.dev" }, { id: 2, title: "ornek.dev" }] }, "rows[1].id must be a non-empty string"],
      [{ rows: [{ id: "", title: "ornek.dev" }] }, "rows[0].id must be a non-empty string"],
      [{ rows: [{ id: "x".repeat(257), title: "ornek.dev" }] }, "rows[0].id is longer than 256 characters"],
      [{ rows: [{ id: "1", title: "ornek.dev" }, { id: "2", title: "deniz.k" }, { id: "1", title: "Kasa" }] }, "rows[2].id repeats an earlier row's id"],
      [{ rows: [{ id: "1", title: " \n " }] }, "rows[0].title must be a non-empty string"],
      [{ rows: [{ id: "1" }] }, "rows[0].title must be a non-empty string"],
      [{ rows: [{ id: "1", title: "ornek.dev", subtitle: 7 }] }, "rows[0].subtitle must be a string"],
      [{ locked: true }, "a locked listing needs a non-empty message"],
      [{ locked: true, message: " " }, "a locked listing needs a non-empty message"],
      [{ locked: true, message: "Kasa kilitli", command: ["vault-cli", "login"] }, "command must be a string"],
    ];
    for (const [answer, message] of cases) {
      await assert.rejects(listing(answer), { code: "badResult", message }, JSON.stringify(answer) ?? String(answer));
    }
  });

  test("a secret action must return a secret", async () => {
    const run = (answer, action = "password") => hostWith({ run: () => answer }).runSource("vault", "42", action);
    assert.deepEqual(await run({ secret: "s3cr3t-örnek", note: "extra keys are ignored" }), { secret: "s3cr3t-örnek" });
    assert.deepEqual(await run({ text: "deniz.k" }, "username"), { text: "deniz.k" });
    assert.deepEqual(await run({ secret: " s3cr3t-örnek\n" }), { secret: " s3cr3t-örnek\n" }, "kept exactly as given");
    const cases = [
      [{ text: "s3cr3t-örnek" }, "password", "run returned {text}; this action expects {secret}"],
      [{ secret: "s3cr3t-örnek" }, "username", "run returned {secret}; this action expects {text}"],
      ["s3cr3t-örnek", "password", "run returned a string; this action expects {secret}"],
      [undefined, "username", "run returned nothing; this action expects {text}"],
      [{ value: "s3cr3t-örnek" }, "password", "run returned an object of another shape; this action expects {secret}"],
      [{ secret: ["s3cr3t-örnek"] }, "password", "secret must be a string"],
      [{ text: { s3cr3t: 1 } }, "username", "text must be a string"],
    ];
    for (const [answer, action, message] of cases) {
      const error = await run(answer, action).then(() => undefined, (failure) => failure);
      assert.equal(error?.code, "badResult", message);
      assert.equal(error.message, message);
      assert.doesNotMatch(error.message, /s3cr3t/, "a reason names shapes, never the value");
    }
  });

  test("a blank value is refused", async () => {
    for (const [action, answer] of [["password", { secret: "  \n" }], ["username", { text: "" }], ["username", { text: " \t" }]]) {
      await assert.rejects(hostWith({ run: () => answer }).runSource("vault", "42", action), { code: "badResult", message: "run returned an empty value" });
    }
  });

  test("run receives row, action and a ctx with a signal", async () => {
    let seen;
    const host = hostWith({
      list: (...args) => { seen = { list: args }; return { rows: [] }; },
      run: (...args) => { seen = { run: args }; return { secret: "s3cr3t-örnek" }; },
    }, { context: { language: "tr", variant: "audio", target: { bundleID: "com.apple.finder", name: "Finder", kind: "finder" } } });
    await host.list("vault");
    assert.equal(seen.list.length, 1, "list gets the context alone");
    await host.runSource("vault", " 4\t2 ", "password", { language: "en" });
    const [rowId, actionId, ctx] = seen.run;
    assert.deepEqual([rowId, actionId], [" 4\t2 ", "password"]);
    assert.equal(ctx.trigger, "source");
    assert.equal(ctx.language, "en");
    assert.equal(ctx.variant, null);
    assert.equal(ctx.target, null, "a source's rows are the same wherever they go");
    assert.ok(ctx.signal instanceof AbortSignal);
    assert.equal(ctx.signal.aborted, false);
  });

  test("exec is allowed in a source call", async () => {
    const host = hostWith({
      async list(ctx) {
        const result = await yab.exec("vault-cli", ["ls"], { signal: ctx.signal });
        return { rows: [{ id: "1", title: result.stdout.trim() }] };
      },
      async run(rowId, actionId, ctx) {
        const result = await yab.exec("vault-cli", ["show", "--", rowId], { signal: ctx.signal });
        return { secret: result.stdout.replace(/\n$/, "") };
      },
    }, { exec: { "vault-cli": (args) => ({ exitCode: 0, stdout: args[0] === "ls" ? "ornek.dev\n" : "s3cr3t-örnek\n", stderr: "" }) } });
    assert.deepEqual(await host.list("vault"), { rows: [{ id: "1", title: "ornek.dev" }] });
    assert.deepEqual(await host.runSource("vault", "1", "password"), { secret: "s3cr3t-örnek" });
    assert.deepEqual(host.calls.map((call) => call.args.slice(0, 2)), [["vault-cli", ["ls"]], ["vault-cli", ["show", "--", "1"]]]);
    // History stays out of reach: source calls are not runs of an action.
    const history = hostWith({ list: async () => { await yab.history.recent(); return { rows: [] }; } },
      { manifest: { ...vault, permissions: ["exec", "history"] } });
    await assert.rejects(history.list("vault"), { code: "permissionDenied" });
  });

  test("a missing tool fails before the source runs, as in the app", async () => {
    let called = false;
    const host = createFakeHost({ manifest: vault, sources: { vault: { list: () => { called = true; return { rows: [] }; } } } });
    await assert.rejects(host.list("vault"), { code: "toolMissing", message: "vault-cli is not installed. Install it with: brew install vault-cli" });
    assert.equal(called, false);
  });

  test("an unknown source, action or export is not found", async () => {
    const host = hostWith({ list: () => ({ rows: [] }) });
    await assert.rejects(host.runSource("vault", "1", "password"), { code: "notFound", message: "sources.vault.run is not exported" });
    await assert.rejects(host.runSource("vault", "1", "otp"), { code: "notFound", message: /otp/ });
    await assert.rejects(host.list("other"), { code: "notFound", message: /other/ });
    await assert.rejects(createFakeHost({ manifest: vault, exec: tools }).list("vault"), { code: "notFound", message: /sources\.vault\.list is not exported/ });
  });

  test("a source cannot open links or show notices", async () => {
    const tries = () => {
      const codes = [];
      for (const ask of [() => yab.notify("s3cr3t-örnek"), () => yab.open("https://ornek.dev/?p=s3cr3t-örnek")]) {
        try {
          ask();
          codes.push("sent");
        } catch (error) {
          codes.push(`${error.code}: ${error.message}`);
        }
      }
      return codes.join("|");
    };
    const host = hostWith({ list: () => ({ rows: [{ id: "1", title: tries() }] }), run: () => ({ secret: tries() }) });
    const refused = "permissionDenied: a source cannot open links or show notices";
    assert.deepEqual(await host.list("vault"), { rows: [{ id: "1", title: `${refused}|${refused}` }] });
    assert.deepEqual(await host.runSource("vault", "1", "password"), { secret: `${refused}|${refused}` });
    assert.deepEqual(host.notifications, []);
    assert.deepEqual(host.opened, []);
  });
});

describe("console", () => {
  const fakeHost = new URL("../fake-host.mjs", import.meta.url).href;
  const vault = { id: "dev.example.vault", contributes: { sources: [{ id: "vault", title: "vault.title", actions: [
    { id: "username", kind: "text", title: "username.title", label: "username.label" },
  ] }] } };

  /**
   * Runs `script` in a Node of its own, as an extension's test runs: the fake host is imported first, then the
   * extension (`extension`, as ./extension.mjs), and the script ends by printing a report. Returns the report, and
   * what the process wrote.
   */
  function isolated(extension, script) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "yab-console-"));
    try {
      fs.writeFileSync(path.join(folder, "extension.mjs"), extension);
      fs.writeFileSync(path.join(folder, "test.mjs"), [
        `import { createFakeHost } from ${JSON.stringify(fakeHost)};`,
        `import { sources } from "./extension.mjs";`,
        `const manifest = ${JSON.stringify(vault)};`,
        script,
      ].join("\n"));
      const child = spawnSync(process.execPath, [path.join(folder, "test.mjs")], { encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr);
      const report = child.stdout.split("\n").find((line) => line.startsWith("REPORT "));
      return { report: JSON.parse(report.slice("REPORT ".length)), stdout: child.stdout, stderr: child.stderr };
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
  const report = (expression) => `process.stdout.write("REPORT " + JSON.stringify(${expression}) + "\\n");`;

  test("lines written during a call go to host.logs and still reach the console", () => {
    const { report: logs, stdout, stderr } = isolated(
      `export const sources = { vault: { list() { console.log("listing", { count: 1 }, 2); console.error("done"); return { rows: [] }; } } };`,
      `const host = createFakeHost({ manifest, sources });\nawait host.list("vault");\n${report("host.logs")}`);
    assert.deepEqual(logs, ["listing {\"count\":1} 2", "done"]);
    assert.match(stdout, /listing \{ count: 1 \} 2/);
    assert.match(stderr, /done/);
  });

  test("a console method taken at load, and the module's own top level, are recorded", () => {
    const { report: logs } = isolated([
      `const { log } = console;`,
      `console.info("loaded");`,
      `export const sources = { vault: { list() { log("listing"); return { rows: [] }; } } };`,
    ].join("\n"), `const host = createFakeHost({ manifest, sources });\nawait host.list("vault");\n${report("host.logs")}`);
    assert.deepEqual(logs, ["loaded", "listing"]);
  });

  test("a line written outside a call reaches every host", () => {
    const { report: logs } = isolated(
      `export const sources = { vault: { list() { console.log("in a call"); return { rows: [] }; } } };`,
      [
        `const first = createFakeHost({ manifest, sources });`,
        `const second = createFakeHost({ manifest, sources });`,
        `await second.list("vault");`,
        `console.warn("after the call");`,
        report("[first.logs, second.logs]"),
      ].join("\n"));
    assert.deepEqual(logs, [["after the call"], ["in a call", "after the call"]]);
  });

  test("the console has the app's five methods only", () => {
    const { report: seen } = isolated(`export const sources = {};`, [
      `const failures = [];`,
      `for (const method of ["table", "dir", "trace"]) {`,
      `  try { console[method]("x"); failures.push(method + " ran"); } catch (error) { failures.push(error.constructor.name); }`,
      `}`,
      report("{ methods: Object.keys(console), failures }"),
    ].join("\n"));
    assert.deepEqual(seen, { methods: ["log", "info", "warn", "error", "debug"], failures: ["TypeError", "TypeError", "TypeError"] });
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
