import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import {
  AUTH_ERROR, FORBIDDEN, ISSUES, KEY, NOT_FOUND, RATE_LIMITED, ROWS, START, TEAMS,
  errorBody, fakeLinear, operations, uuid,
} from "./fake-linear.mjs";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

let helpers = 0;
async function newHelper() {
  return import(`../src/index.ts?helper=${++helpers}`);
}

/** A host for the module's calls; `key: undefined` is no key in Settings, `team: undefined` no team. */
function hostWith(module, fake, options = {}) {
  const { now = START, language = "en" } = options;
  const key = Object.hasOwn(options, "key") ? options.key : KEY;
  const team = Object.hasOwn(options, "team") ? options.team : "ENG";
  return createFakeHost({
    folder, sources: module.sources, http: fake.http, now, context: { language },
    preferences: team === undefined ? {} : { team },
    secrets: key === undefined ? {} : { apiKey: key },
  });
}

const text = (value) => ({ kind: "text", text: value });
const code = (value) => ({ kind: "code", text: value });
const link = (url) => ({ kind: "link", url });

function assertKeyKept(host, ...values) {
  assert.deepEqual(host.logs, [], "nothing reaches the log");
  for (const value of [...values, host.notifications, host.results]) {
    const shown = value instanceof Error ? `${value.message}\n${value.stack}` : JSON.stringify(value) ?? "";
    assert.ok(!shown.includes(KEY), "the key is never shown");
  }
}

const NO_KEY = "Add a Linear API key in Settings → Extensions → Linear. Make one in Linear under Settings › Account › Security & access.";
const PLAN_LIMIT = "This workspace’s Linear plan doesn’t allow that. Check its limits in Linear.";
const BAD_KEY = "Linear didn’t accept the API key. Paste a new one in Settings → Extensions → Linear.";

describe("where the actions are offered", () => {
  const host = createFakeHost({ folder });

  test("Paste as Linear link: on an issue key or a link to an issue, nothing else", () => {
    for (const value of ["ENG-123", "  ENG-123\n", "A1-9", "PLATFORM10-123456", "DES-7"]) assert.ok(host.offers(text(value)).includes("link"), value);
    for (const value of ["eng-123", "ENG-123 is broken", "ENG123", "E-1", "ENG-", "ENG-1234567", "TOOLONGTEAM-1", "see ENG-123", "ENG-123, ENG-124"]) {
      assert.ok(!host.offers(text(value)).includes("link"), value);
    }
    for (const url of ["https://linear.app/ornek/issue/ENG-123", "https://linear.app/ornek/issue/ENG-123/login-button", "https://linear.app/ornek/issue/ENG-123#comment-1"]) {
      assert.ok(host.offers(link(url)).includes("link"), url);
    }
    for (const url of ["https://linear.app/ornek/project/ENG-123", "https://example.com/ornek/issue/ENG-123", "http://linear.app/ornek/issue/ENG-123", "https://linear.app/ornek/issue/ENG-123x"]) {
      assert.ok(!host.offers(link(url)).includes("link"), url);
    }
  });

  test("Create Linear issue: on text and code with a word in it, not on links or blank text", () => {
    for (const item of [text("Login fails"), code("const x = 1;"), text("404"), text("Ödeme hatası")]) assert.ok(host.offers(item).includes("create"), item.text);
    for (const item of [text("   "), text("---"), link("https://example.com")]) assert.ok(!host.offers(item).includes("create"), item.text ?? item.url);
  });

  test("neither runs as a hint: both reach the network", () => {
    for (const action of manifest.contributes.actions) assert.equal(action.hint, undefined, action.id);
  });

  test("the network reaches only Linear's API", () => {
    assert.deepEqual(manifest.permissions, ["network"]);
    assert.deepEqual(manifest.network, { domains: ["api.linear.app"] });
  });
});

describe("Paste as Linear link", () => {
  test("pastes [ENG-101: Title](url), asking Linear for the issue by its key", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const host = hostWith(module, fake);
    assert.deepEqual(await host.run(module.actions.link, text("ENG-101")), { text: "[ENG-101: Login button does nothing on Safari](https://linear.app/ornek/issue/ENG-101/login-button-does-nothing-on-safari)" });
    assert.deepEqual(operations(fake), ["Issue"]);
    assert.deepEqual(fake.requests[0].body.variables, { id: "ENG-101" });
    assert.deepEqual(fake.requests[0].headers, { "content-type": "application/json", authorization: KEY });
    assertKeyKept(host);
  });

  test("works on a link to the issue too", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const result = await hostWith(module, fake).run(module.actions.link, link("https://linear.app/ornek/issue/DES-7/old-slug?foo=1"));
    assert.deepEqual(result, { text: "[DES-7: Ödeme ekranı ikonları](https://linear.app/ornek/issue/DES-7/odeme-ekrani-ikonlari)" });
    assert.deepEqual(fake.requests[0].body.variables, { id: "DES-7" });
  });

  test("escapes the title's Markdown and the link's parentheses", async () => {
    const module = await newHelper();
    const issues = [...ISSUES, { ...ISSUES[0], id: uuid(50), identifier: "ENG-50", title: "Fix (edge) case [WIP]", slug: "fix-(edge) case" }];
    const result = await hostWith(module, fakeLinear({ issues })).run(module.actions.link, text("ENG-50"));
    assert.deepEqual(result, { text: "[ENG-50: Fix (edge) case \\[WIP\\]](https://linear.app/ornek/issue/ENG-50/fix-%28edge%29%20case)" });
  });

  test("an issue without a title links its key alone", async () => {
    const module = await newHelper();
    const issues = [{ ...ISSUES[0], identifier: "ENG-1", title: "  " }];
    assert.deepEqual(await hostWith(module, fakeLinear({ issues })).run(module.actions.link, text("ENG-1")), { text: "[ENG-1](https://linear.app/ornek/issue/ENG-1/login-button-does-nothing-on-safari)" });
  });

  test("an issue Linear doesn't have is a calm message", async () => {
    const module = await newHelper();
    for (const answer of [{ json: NOT_FOUND }, { status: 400, json: NOT_FOUND }, { json: { data: { issue: null } } }]) {
      const fake = fakeLinear({ answer: () => answer });
      assert.deepEqual(await hostWith(module, fake).run(module.actions.link, text("ENG-999")), { none: true, message: "Linear has no issue ENG-999, or this API key can’t see it." });
    }
  });

  test("text that isn't an issue key says so without a request", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    assert.deepEqual(await hostWith(module, fake).run(module.actions.link, text("hello")), { none: true, message: "This isn’t a Linear issue key such as ENG-123." });
    assert.deepEqual(await hostWith(module, fake).run(module.actions.link, null), { none: true, message: "This isn’t a Linear issue key such as ENG-123." });
    assert.equal(fake.requests.length, 0);
  });

  test("without a key it says where to add one, without a request", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const host = hostWith(module, fake, { key: undefined });
    assert.deepEqual(await host.run(module.actions.link, text("ENG-101")), { none: true, message: NO_KEY });
    assert.equal(fake.requests.length, 0);
  });

  test("a refused key, a key without access, a rate limit and a server error are messages, not failures", async () => {
    const module = await newHelper();
    const cases = [
      [{ status: 401, json: AUTH_ERROR }, BAD_KEY],
      [{ status: 400, json: AUTH_ERROR }, BAD_KEY],
      [{ status: 403, json: FORBIDDEN }, "This API key can’t read your issues. Check its permissions in Linear under Settings › Account › Security & access."],
      [{ status: 400, json: errorBody("Feature not accessible", "FEATURE_NOT_ACCESSIBLE", "feature not accessible") }, PLAN_LIMIT],
      [{ status: 429, headers: { "retry-after": "180" }, json: RATE_LIMITED }, "Linear has had too many requests from your account. Try again in 3 min."],
      [{ status: 429, json: RATE_LIMITED }, "Linear has had too many requests from your account. Try again in a few minutes."],
      [{ status: 502, text: "Bad gateway" }, "Linear didn’t answer (status 502). Try again later."],
      [{ text: "<!doctype html>" }, "Linear’s answer couldn’t be read. Try again later."],
      [{ json: { data: { issue: { identifier: "ENG-101", title: "x", url: "not a url" } } } }, "Linear’s answer couldn’t be read. Try again later."],
      [{ json: { data: { issue: { identifier: 3, url: "https://linear.app/x" } } } }, "Linear’s answer couldn’t be read. Try again later."],
      [{ status: 400, json: errorBody(`Something odd with ${KEY}`, "INTERNAL", "internal error") }, "Linear couldn’t look up ENG-101."],
      [{ status: 418, text: "" }, "Linear couldn’t look up ENG-101."],
    ];
    for (const [answer, message] of cases) {
      const host = hostWith(module, fakeLinear({ answer: () => answer }));
      const result = await host.run(module.actions.link, text("ENG-101"));
      assert.deepEqual(result, { none: true, message }, JSON.stringify(answer));
      assertKeyKept(host);
    }
  });

  test("no connection and a cancel are let through", async () => {
    const module = await newHelper();
    await assert.rejects(hostWith(module, fakeLinear({ answer: () => yabError("networkError", "offline") })).run(module.actions.link, text("ENG-101")), { code: "networkError" });
    const host = hostWith(module, fakeLinear({ answer: () => new Promise(() => {}) }));
    const running = host.run(module.actions.link, text("ENG-101"));
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("speaks Turkish", async () => {
    const module = await newHelper();
    const host = hostWith(module, fakeLinear(), { language: "tr" });
    assert.deepEqual(await host.run(module.actions.link, text("ENG-999")), { none: true, message: "Linear’da ENG-999 diye bir issue yok ya da bu API anahtarı onu göremiyor." });
  });
});

describe("Create Linear issue from this", () => {
  test("makes the issue in the team from Settings and pastes its link", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const host = hostWith(module, fake, { team: " eng " });
    const result = await host.run(module.actions.create, text("Checkout button is grey on iPad\n\nTapping it does nothing since the last update."));
    assert.deepEqual(result, { text: "https://linear.app/ornek/issue/ENG-124/new-issue" });
    assert.deepEqual(operations(fake), ["TeamByKey", "CreateIssue"]);
    assert.deepEqual(fake.requests[0].body.variables, { key: "ENG" });
    assert.match(fake.requests[0].body.query, /teams\(first: 1, filter: \{ key: \{ eqIgnoreCase: \$key \} \}\)/);
    assert.match(fake.requests[1].body.query, /^mutation CreateIssue\(\$input: IssueCreateInput!\) \{\s+issueCreate\(input: \$input\) \{ success issue \{ id identifier url \} \}/);
    assert.deepEqual(fake.created, [{
      teamId: TEAMS[0].id,
      title: "Checkout button is grey on iPad",
      description: "Checkout button is grey on iPad\n\nTapping it does nothing since the last update.",
    }]);
    for (const request of fake.requests) assert.equal(request.headers.authorization, KEY);
    assert.deepEqual(host.notifications, ["ENG-124 created in Linear."]);
    assertKeyKept(host);
  });

  test("a stack trace goes in a code block, under its error as the title", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const trace = "TypeError: Cannot read properties of undefined (reading 'map')\n    at renderList (app.js:12:9)\n    at main (app.js:40:3)\n";
    await hostWith(module, fake).run(module.actions.create, text(trace));
    assert.deepEqual(fake.created[0], {
      teamId: TEAMS[0].id,
      title: "TypeError: Cannot read properties of undefined (reading 'map')",
      description: "```\nTypeError: Cannot read properties of undefined (reading 'map')\n    at renderList (app.js:12:9)\n    at main (app.js:40:3)\n```",
    });
  });

  test("a log's time stamps stay in the description and leave the title", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const log = "\r\n2026-11-04T08:12:03.120Z ERROR payment failed: card declined\r\n2026-11-04T08:12:03.400Z INFO retrying\r\n";
    await hostWith(module, fake).run(module.actions.create, text(log));
    assert.equal(fake.created[0].title, "ERROR payment failed: card declined");
    assert.equal(fake.created[0].description, "```\n2026-11-04T08:12:03.120Z ERROR payment failed: card declined\n2026-11-04T08:12:03.400Z INFO retrying\n```");
  });

  test("an item the app calls code is always a code block, and its backticks can't close the fence", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).run(module.actions.create, code("```js\nconst a = `x`;\n````\n"));
    assert.equal(fake.created[0].title, "const a = `x`;");
    assert.equal(fake.created[0].description, "`````\n```js\nconst a = `x`;\n````\n`````");
  });

  test("prose stays prose, a single sentence too", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).run(module.actions.create, text("Settings page: the save button overlaps the footer"));
    await hostWith(module, fake).run(module.actions.create, text("# Dark mode\n\n- The sidebar is too bright\n- Icons lose contrast (see screenshot)\n"));
    assert.deepEqual(fake.created.map((input) => [input.title, input.description]), [
      ["Settings page: the save button overlaps the footer", "Settings page: the save button overlaps the footer"],
      ["Dark mode", "# Dark mode\n\n- The sidebar is too bright\n- Icons lose contrast (see screenshot)"],
    ]);
  });

  test("a long first line is cut to a hundred characters at a word", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const line = "When the person opens the panel twice quickly the second open shows an empty column for about a second before the rows";
    await hostWith(module, fake).run(module.actions.create, text(`${line} arrive\nmore`));
    const { title } = fake.created[0];
    assert.equal(title, "When the person opens the panel twice quickly the second open shows an empty column for about a…");
    assert.ok(Array.from(title).length <= 100);
  });

  test("with no team in Settings, the viewer's only team is used", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    assert.deepEqual(await hostWith(module, fake, { team: undefined }).run(module.actions.create, text("Crash on launch")), { text: "https://linear.app/ornek/issue/ENG-124/new-issue" });
    assert.deepEqual(operations(fake), ["MyTeams", "CreateIssue"]);
    assert.equal(fake.created[0].teamId, TEAMS[0].id);
  });

  test("with no team in Settings and several teams, it asks for one and creates nothing", async () => {
    const module = await newHelper();
    for (const memberOf of [[TEAMS[0].id, TEAMS[1].id], []]) {
      const fake = fakeLinear({ memberOf });
      const result = await hostWith(module, fake, { team: "  " }).run(module.actions.create, text("Crash on launch"));
      assert.deepEqual(result, { none: true, message: "Choose a team for new issues: add its key, such as ENG, in Settings → Extensions → Linear." });
      assert.deepEqual(operations(fake), ["MyTeams"]);
    }
  });

  test("a failed look-up of the viewer's teams stops before creating", async () => {
    const module = await newHelper();
    for (const [answer, message] of [
      [{ status: 401, json: AUTH_ERROR }, BAD_KEY],
      [{ status: 403, json: FORBIDDEN }, "This API key isn’t allowed to do that. Check its permissions in Linear."],
      [{ status: 429, headers: { "retry-after": "60" }, json: RATE_LIMITED }, "Linear has had too many requests from your account. Try again in 1 min."],
      [{ status: 502, text: "" }, "Linear didn’t answer (status 502). Try again later."],
      [{ json: { data: { viewer: { teams: null } } } }, "Linear’s answer couldn’t be read. Try again later."],
      [{ status: 400, json: errorBody(`Odd ${KEY}`, "INTERNAL", "internal error") }, "Linear couldn’t find the team for new issues."],
    ]) {
      const fake = fakeLinear({ answer: () => answer });
      const host = hostWith(module, fake, { team: undefined });
      assert.deepEqual(await host.run(module.actions.create, text("Crash on launch")), { none: true, message }, JSON.stringify(answer));
      assert.deepEqual(operations(fake), ["MyTeams"]);
      assertKeyKept(host);
    }
  });

  test("a team key Linear doesn't have says so", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const result = await hostWith(module, fake, { team: "ops" }).run(module.actions.create, text("Crash on launch"));
    assert.deepEqual(result, { none: true, message: "Linear has no team OPS. Check the team key in Settings → Extensions → Linear." });
    assert.equal(fake.created.length, 0);
  });

  test("a team key that can't be one is never sent or shown", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    for (const team of [KEY, "EN G", "ENG-1", "x".repeat(11)]) {
      const host = hostWith(module, fake, { team });
      const result = await host.run(module.actions.create, text("Crash on launch"));
      assert.deepEqual(result, { none: true, message: "The team key in Settings → Extensions → Linear should be letters and digits, such as ENG." });
      assertKeyKept(host);
    }
    assert.equal(fake.requests.length, 0);
  });

  test("text with no word in it is not made into an issue", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    // The last one has a word, but past what is read for the title, which would be empty.
    const unreadTitle = `${"\u0085\n".repeat(300)}word`;
    for (const item of [text(""), text(" \n\t "), text("--- !!! ---"), null, text(unreadTitle)]) {
      assert.deepEqual(await hostWith(module, fake).run(module.actions.create, item), { none: true, message: "There is no text to make an issue from." });
    }
    assert.equal(fake.requests.length, 0);
  });

  test("a copy whose only words are on a fence line is titled by them, never with an empty title", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).run(module.actions.create, text("```Error in prod"));
    await hostWith(module, fake).run(module.actions.create, code("```js\n```"));
    assert.deepEqual(fake.created.map((input) => input.title), ["Error in prod", "js"]);
  });

  test("a bug report with an indented list, or two lines with an arrow, stays prose", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).run(module.actions.create, text("Steps:\n  1. Open the panel\n  2. Press return"));
    await hostWith(module, fake).run(module.actions.create, text("Go to Settings => Billing\nThe total is wrong"));
    assert.deepEqual(fake.created.map((input) => input.description), ["Steps:\n  1. Open the panel\n  2. Press return", "Go to Settings => Billing\nThe total is wrong"]);
  });

  test("without a key it says where to add one, without a request", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    assert.deepEqual(await hostWith(module, fake, { key: undefined }).run(module.actions.create, text("Crash")), { none: true, message: NO_KEY });
    assert.equal(fake.requests.length, 0);
  });

  test("a key that may not create issues says what to check", async () => {
    const module = await newHelper();
    const fake = fakeLinear({ answer: ({ body }) => (body.query.startsWith("mutation") ? { status: 403, json: FORBIDDEN } : undefined) });
    assert.deepEqual(await hostWith(module, fake).run(module.actions.create, text("Crash")), { none: true, message: "This API key can’t create issues in this team. Check its permissions in Linear." });
  });

  test("a refused key and a rate limit on the team lookup stop before creating", async () => {
    const module = await newHelper();
    for (const [answer, message] of [
      [{ status: 401, json: AUTH_ERROR }, BAD_KEY],
      [{ status: 429, headers: { "x-ratelimit-requests-remaining": "0", "x-ratelimit-requests-reset": String(START + 10 * 60_000) }, json: RATE_LIMITED }, "Linear has had too many requests from your account. Try again in 10 min."],
      [{ status: 500, text: "" }, "Linear didn’t answer (status 500). Try again later."],
      [{ json: { data: { teams: null } } }, "Linear’s answer couldn’t be read. Try again later."],
      [{ status: 400, json: errorBody("Odd", "INTERNAL", "internal error") }, "Linear couldn’t find the team for new issues."],
    ]) {
      const fake = fakeLinear({ answer: () => answer });
      assert.deepEqual(await hostWith(module, fake).run(module.actions.create, text("Crash")), { none: true, message }, JSON.stringify(answer));
      assert.deepEqual(operations(fake), ["TeamByKey"]);
    }
  });

  test("Linear saying it didn't create the issue is a calm message, and nothing is pasted", async () => {
    const module = await newHelper();
    for (const answer of [
      { json: { data: { issueCreate: { success: false, issue: null } } } },
      { json: { data: { issueCreate: { success: true, issue: { identifier: "ENG-1", url: "ftp://linear.app/x" } } } } },
      { json: { data: { issueCreate: { success: true, issue: null } } } },
      { status: 400, json: errorBody("Argument Validation Error", "INVALID_INPUT", "invalid input") },
    ]) {
      const fake = fakeLinear({ answer: ({ body }) => (body.query.startsWith("mutation") ? answer : undefined) });
      const host = hostWith(module, fake);
      assert.deepEqual(await host.run(module.actions.create, text("Crash")), { none: true, message: "Linear didn’t create the issue." }, JSON.stringify(answer));
      assert.deepEqual(host.notifications, []);
    }
  });

  test("an issue Linear made despite an error in its answer is pasted, so it isn't made twice", async () => {
    const module = await newHelper();
    const partial = {
      data: { issueCreate: { success: true, issue: { id: uuid(600), identifier: "ENG-600", url: "https://linear.app/ornek/issue/ENG-600/new-issue" } } },
      ...errorBody("Could not add the issue to its cycle", "INTERNAL", "internal error"),
    };
    const fake = fakeLinear({ answer: ({ body }) => (body.query.startsWith("mutation") ? { json: partial } : undefined) });
    const host = hostWith(module, fake);
    assert.deepEqual(await host.run(module.actions.create, text("Crash")), { text: "https://linear.app/ornek/issue/ENG-600/new-issue" });
    assert.deepEqual(host.notifications, ["ENG-600 created in Linear."]);
  });

  test("an error that came with an answer saying nothing was made is still a message", async () => {
    const module = await newHelper();
    for (const [answer, message] of [
      [{ json: { data: { issueCreate: { success: false, issue: null } }, ...errorBody("Odd", "INTERNAL", "internal error") } }, "Linear didn’t create the issue."],
      [{ json: { data: { issueCreate: null }, ...RATE_LIMITED } }, "Linear has had too many requests from your account. Try again in a few minutes."],
      // An answer with a failing status never counts as made, whatever its data says.
      [{ status: 500, json: { data: { issueCreate: { success: true, issue: { identifier: "ENG-1", url: "https://linear.app/ornek/issue/ENG-1/x" } } } } }, "Linear didn’t answer (status 500). Try again later."],
    ]) {
      const fake = fakeLinear({ answer: ({ body }) => (body.query.startsWith("mutation") ? answer : undefined) });
      const host = hostWith(module, fake);
      assert.deepEqual(await host.run(module.actions.create, text("Crash")), { none: true, message }, JSON.stringify(answer));
      assert.deepEqual(host.notifications, []);
    }
  });

  test("a plan's limit says so", async () => {
    const module = await newHelper();
    for (const type of ["usage limit exceeded", "feature not accessible"]) {
      const fake = fakeLinear({ answer: ({ body }) => (body.query.startsWith("mutation") ? { status: 400, json: errorBody("Usage limit exceeded", "INVALID_INPUT", type) } : undefined) });
      assert.deepEqual(await hostWith(module, fake).run(module.actions.create, text("Crash")), { none: true, message: PLAN_LIMIT }, type);
    }
    const tr = fakeLinear({ answer: ({ body }) => (body.query.startsWith("mutation") ? { status: 400, json: errorBody("x", "INVALID_INPUT", "usage limit exceeded") } : undefined) });
    assert.deepEqual(await hostWith(module, tr, { language: "tr" }).run(module.actions.create, text("Crash")), {
      none: true, message: "Bu çalışma alanının Linear planı buna izin vermiyor. Sınırlarını Linear’da kontrol et.",
    });
  });

  test("a new issue makes the column list again", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    assert.deepEqual(await hostWith(module, fake).list("issues"), { rows: ROWS });
    await hostWith(module, fake, { now: START + 1000 }).run(module.actions.create, text("Crash"));
    await hostWith(module, fake, { now: START + 2000 }).list("issues");
    assert.deepEqual(operations(fake), ["MyIssues", "TeamByKey", "CreateIssue", "MyIssues"]);
  });

  test("a very long copy is cut at a line, and the description says so", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    const line = "a".repeat(99);
    const long = Array.from({ length: 1000 }, () => line).join("\n");
    await hostWith(module, fake).run(module.actions.create, text(long));
    const { description } = fake.created[0];
    assert.ok(description.length < 50_100);
    assert.ok(description.endsWith(`${line}\n\n_Cut to the first 50,000 characters._`));
    assert.ok(!description.includes("```"));

    const tr = fakeLinear();
    await hostWith(module, tr, { language: "tr" }).run(module.actions.create, code(long));
    assert.ok(tr.created[0].description.startsWith("```\n"));
    assert.ok(tr.created[0].description.endsWith(`${line}\n\`\`\`\n\n_İlk 50.000 karakter alındı._`));
    assert.ok(tr.created[0].description.indexOf("\n\n_İlk") <= 50_000, "the code block, fences included, is within the limit");
  });

  test("no connection and a cancel are let through", async () => {
    const module = await newHelper();
    await assert.rejects(hostWith(module, fakeLinear({ answer: () => yabError("networkError", "offline") })).run(module.actions.create, text("Crash")), { code: "networkError" });
    const host = hostWith(module, fakeLinear({ answer: ({ body }) => (body.query.startsWith("mutation") ? new Promise(() => {}) : undefined) }));
    const running = host.run(module.actions.create, text("Crash"));
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("speaks Turkish", async () => {
    const module = await newHelper();
    const host = hostWith(module, fakeLinear(), { language: "tr" });
    assert.deepEqual(await host.run(module.actions.create, text("Çökme")), { text: "https://linear.app/ornek/issue/ENG-124/new-issue" });
    assert.deepEqual(host.notifications, ["ENG-124 Linear’da açıldı."]);
    const none = await hostWith(module, fakeLinear({ memberOf: [] }), { language: "tr", team: undefined }).run(module.actions.create, text("Çökme"));
    assert.equal(none.message, "Yeni issue’lar için bir takım seç: ENG gibi anahtarını Ayarlar → Uzantılar → Linear’a ekle.");
  });
});

describe("every locale", () => {
  test("Turkish has every English key, and every key the code uses is in English", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
    const source = ["index.ts", "linear.ts", "text.ts"].map((name) => fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8")).join("\n");
    const used = new Set([...source.matchAll(/yab\.t\("([^"]+)"/g)].map((match) => match[1]));
    for (const priority of [1, 2, 3, 4]) used.add(`priority.${priority}`);
    for (const key of used) assert.ok(Object.hasOwn(en, key), key);
    for (const value of Object.values(en).filter((value) => typeof value === "string")) assert.ok(value.length <= 200, value);
  });
});
