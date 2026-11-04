import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import {
  AUTH_ERROR, ENDPOINT, FORBIDDEN, ISSUES, KEY, NOT_FOUND, OTHER_KEY, RATE_LIMITED, ROWS, START,
  errorBody, fakeLinear, operations, uuid,
} from "./fake-linear.mjs";

const folder = new URL("..", import.meta.url);
const MINUTE = 60_000;

let helpers = 0;
/** The extension as a newly started helper has it: a module of its own, so nothing is cached yet. */
async function newHelper() {
  return import(`../src/index.ts?helper=${++helpers}`);
}

/** A host for the module's calls; `key: undefined` is no key in Settings. */
function hostWith(module, fake, options = {}) {
  const { now = START, language = "en", preferences } = options;
  const key = Object.hasOwn(options, "key") ? options.key : KEY;
  return createFakeHost({
    folder, sources: module.sources, http: fake.http, now, context: { language }, preferences,
    secrets: key === undefined ? {} : { apiKey: key },
  });
}

/** Nothing the host shows or writes anywhere holds the key. */
function assertKeyKept(host, ...values) {
  assert.deepEqual(host.logs, [], "nothing reaches the log");
  for (const value of [...values, host.notifications, host.results]) {
    const text = value instanceof Error ? `${value.message}\n${value.stack}` : JSON.stringify(value) ?? "";
    assert.ok(!text.includes(KEY) && !text.includes(OTHER_KEY), "the key is never shown");
  }
}

const LOCKED_NO_KEY = {
  locked: true,
  message: "Add a Linear API key in Settings → Extensions → Linear. Make one in Linear under Settings › Security & access.",
  command: "open https://linear.app/settings/account/security",
};
const LOCKED_BAD_KEY = {
  locked: true,
  message: "Linear didn’t accept the API key. Paste a new one in Settings → Extensions → Linear.",
  command: "open https://linear.app/settings/account/security",
};

describe("the column", () => {
  test("without a key it is locked, says where to make one, and sends nothing", async () => {
    const fake = fakeLinear();
    const host = hostWith(await newHelper(), fake, { key: undefined });
    assert.deepEqual(await host.list("issues"), LOCKED_NO_KEY);
    assert.equal(fake.requests.length, 0);
    assertKeyKept(host);
  });

  test("a blank key counts as none", async () => {
    const fake = fakeLinear();
    assert.deepEqual(await hostWith(await newHelper(), fake, { key: "  \n" }).list("issues"), LOCKED_NO_KEY);
    assert.equal(fake.requests.length, 0);
  });

  test("lists the viewer's open issues, most recently updated first", async () => {
    const fake = fakeLinear();
    const host = hostWith(await newHelper(), fake);
    assert.deepEqual(await host.list("issues"), { rows: ROWS });
    assertKeyKept(host);
  });

  test("asks Linear for open issues with the key as the Authorization header, without Bearer", async () => {
    const fake = fakeLinear();
    await hostWith(await newHelper(), fake).list("issues");
    assert.equal(fake.requests.length, 1);
    const [{ url, headers, body }] = fake.requests;
    assert.equal(url, ENDPOINT);
    assert.deepEqual(headers, { "content-type": "application/json", authorization: KEY });
    assert.deepEqual(body.variables, { first: 50 });
    assert.match(body.query, /^query MyIssues\(\$first: Int!\)/);
    assert.match(body.query, /viewer \{\s+assignedIssues\(first: \$first, orderBy: updatedAt, filter: \{ state: \{ type: \{ nin: \["completed","canceled","duplicate"\] \} \} \}\)/);
    assert.match(body.query, /nodes \{ id identifier title priority updatedAt state \{ name \} team \{ name \} \}/);
  });

  test("a key pasted with spaces, a line end or Bearer in front still works", async () => {
    for (const key of [`  ${KEY}\n`, `Bearer ${KEY}`, `${KEY.slice(0, 10)}\n${KEY.slice(10)}`]) {
      const fake = fakeLinear();
      assert.deepEqual(await hostWith(await newHelper(), fake, { key }).list("issues"), { rows: ROWS }, JSON.stringify(key.length));
      assert.equal(fake.requests[0].headers.authorization, KEY);
    }
  });

  test("keeps at most fifty rows, newest first, whatever order Linear sends", async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...ISSUES[0], id: uuid(1000 + index), identifier: `ENG-${1000 + index}`, title: `Issue ${index}`,
      updatedAt: new Date(START - index * MINUTE).toISOString(),
    }));
    const fake = fakeLinear({
      answer: () => ({ json: { data: { viewer: { assignedIssues: { nodes: [...many].reverse().map((issue) => ({ ...issue, state: { name: "Todo" }, team: { name: "Engineering" } })) } } } } }),
    });
    const { rows } = await hostWith(await newHelper(), fake).list("issues");
    assert.equal(rows.length, 50);
    assert.equal(rows[0].title, "ENG-1000 Issue 0");
    assert.equal(rows[49].title, "ENG-1049 Issue 49");
  });

  test("leaves out malformed issues and repeated ids instead of failing the column", async () => {
    const good = { id: uuid(1), identifier: "ENG-1", title: "Good", priority: 3, updatedAt: "2026-11-01T00:00:00Z", state: { name: "Todo" }, team: { name: "Engineering" } };
    const nodes = [
      good,
      { ...good, title: "Again" },
      { ...good, id: "" },
      { ...good, id: "../../etc" },
      { ...good, id: "x".repeat(65) },
      { ...good, id: 7 },
      { ...good, id: uuid(2), identifier: " \u2028 " },
      { ...good, id: uuid(3), identifier: undefined },
      null,
      "ENG-4",
      { id: uuid(5), identifier: "ENG-5" },
      { ...good, id: uuid(6), identifier: "ENG-6", title: "Odd\tline\nbreaks", priority: 2.5, state: null, team: { name: 42 }, updatedAt: "yesterday" },
    ];
    const fake = fakeLinear({ answer: () => ({ json: { data: { viewer: { assignedIssues: { nodes } } } } }) });
    assert.deepEqual(await hostWith(await newHelper(), fake).list("issues"), {
      rows: [
        { id: uuid(1), title: "ENG-1 Good", subtitle: "Todo · Engineering · Medium" },
        { id: uuid(5), title: "ENG-5" },
        { id: uuid(6), title: "ENG-6 Odd line breaks" },
      ],
    });
  });

  test("an empty list is no rows", async () => {
    const fake = fakeLinear({ issues: [] });
    assert.deepEqual(await hostWith(await newHelper(), fake).list("issues"), { rows: [] });
  });

  test("is reused for a minute, then asked for again", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    assert.deepEqual(await hostWith(module, fake).list("issues"), { rows: ROWS });
    assert.deepEqual(await hostWith(module, fake, { now: START + MINUTE }).list("issues"), { rows: ROWS });
    assert.equal(fake.requests.length, 1, "within the minute nothing is sent");

    fake.state.issues = [ISSUES[2]];
    assert.deepEqual(await hostWith(module, fake, { now: START + MINUTE + 1 }).list("issues"), { rows: [ROWS[2]] });
    assert.equal(fake.requests.length, 2);
  });

  test("a clock that went back lists again", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).list("issues");
    await hostWith(module, fake, { now: START - 1 }).list("issues");
    assert.equal(fake.requests.length, 2);
  });

  test("a new key never shows the old key's rows", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).list("issues");
    fake.state.key = OTHER_KEY;
    fake.state.issues = [ISSUES[2]];
    assert.deepEqual(await hostWith(module, fake, { key: OTHER_KEY, now: START + 1000 }).list("issues"), { rows: [ROWS[2]] });
    assert.equal(fake.requests.length, 2);
  });

  test("a key Linear refuses (401) locks the column and drops its rows", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).list("issues");

    fake.state.key = OTHER_KEY;
    const host = hostWith(module, fake, { key: "lin_api_wrong", now: START + 1000 });
    assert.deepEqual(await host.list("issues"), LOCKED_BAD_KEY);
    assertKeyKept(host);

    fake.state.key = KEY;
    await hostWith(module, fake, { now: START + 2000 }).list("issues");
    assert.equal(fake.requests.length, 3, "the rows are asked for again, well within the minute");
  });

  test("an authentication error with another status locks it too", async () => {
    for (const answer of [{ status: 400, json: AUTH_ERROR }, { status: 200, json: AUTH_ERROR }, { status: 401, text: "" }, { status: 401, text: "<html>Unauthorized</html>" }]) {
      const fake = fakeLinear({ answer: () => answer });
      assert.deepEqual(await hostWith(await newHelper(), fake).list("issues"), LOCKED_BAD_KEY, JSON.stringify(answer));
    }
  });

  test("a key that may not read issues locks it with what to check", async () => {
    for (const answer of [{ status: 403, text: "" }, { status: 400, json: FORBIDDEN }]) {
      const fake = fakeLinear({ answer: () => answer });
      assert.deepEqual(await hostWith(await newHelper(), fake).list("issues"), {
        locked: true,
        message: "This API key can’t read your issues. Check its permissions in Linear under Settings › Security & access.",
        command: "open https://linear.app/settings/account/security",
      });
    }
  });

  test("a rate limit says when to try again, from Retry-After or the window that ran out", async () => {
    const cases = [
      [{ "Retry-After": "720" }, "Try again in 12 min."],
      [{ "Retry-After": "5" }, "Try again in 1 min."],
      [{ "X-RateLimit-Requests-Remaining": "0", "X-RateLimit-Requests-Reset": String(START + 25 * MINUTE + 1) }, "Try again in 26 min."],
      [{ "X-RateLimit-Requests-Remaining": "100", "X-RateLimit-Requests-Reset": String(START + 5 * MINUTE),
        "X-RateLimit-Complexity-Remaining": "0", "X-RateLimit-Complexity-Reset": String(START + 40 * MINUTE) }, "Try again in 40 min."],
      [{ "X-RateLimit-Requests-Remaining": "0", "X-RateLimit-Requests-Reset": String(START + 300 * MINUTE) }, "Try again in 60 min."],
      [{ "X-RateLimit-Requests-Remaining": "0", "X-RateLimit-Requests-Reset": String(START - MINUTE) }, "Try again in a few minutes."],
      [{ "Retry-After": "soon" }, "Try again in a few minutes."],
      [{}, "Try again in a few minutes."],
    ];
    for (const [headers, ending] of cases) {
      const fake = fakeLinear({ answer: () => ({ status: 429, headers, json: RATE_LIMITED }) });
      await assert.rejects(hostWith(await newHelper(), fake).list("issues"), { message: `Linear has had too many requests from this key. ${ending}` }, JSON.stringify(headers));
    }
  });

  test("a rate limit in the body alone counts too", async () => {
    const fake = fakeLinear({ answer: () => ({ status: 400, json: RATE_LIMITED }) });
    await assert.rejects(hostWith(await newHelper(), fake).list("issues"), { message: "Linear has had too many requests from this key. Try again in a few minutes." });
  });

  test("a server error says Linear didn't answer", async () => {
    const fake = fakeLinear({ answer: () => ({ status: 503, text: "upstream connect error" }) });
    await assert.rejects(hostWith(await newHelper(), fake).list("issues"), { message: "Linear didn’t answer (status 503). Try again later." });
  });

  test("an answer that isn't the list fails with a calm message, never Linear's text", async () => {
    const answers = [
      { text: "not json" },
      { text: "" },
      { json: [] },
      { json: { data: null } },
      { json: { data: { viewer: null } } },
      { json: { data: { viewer: { assignedIssues: { nodes: "many" } } } } },
    ];
    for (const answer of answers) {
      const fake = fakeLinear({ answer: () => answer });
      await assert.rejects(hostWith(await newHelper(), fake).list("issues"), { message: "Linear’s answer couldn’t be read. Try again later." }, JSON.stringify(answer));
    }
    const fake = fakeLinear({ answer: () => ({ status: 400, json: errorBody(`Field 'x' doesn't exist; key ${KEY}`, "GRAPHQL_VALIDATION_FAILED", "graphql error") }) });
    const host = hostWith(await newHelper(), fake);
    await assert.rejects(host.list("issues"), (error) => {
      assert.equal(error.message, "Linear couldn’t list your issues.");
      assertKeyKept(host, error);
      return true;
    });
  });

  test("a failed listing is not cached", async () => {
    const module = await newHelper();
    const fake = fakeLinear({ answer: () => ({ status: 502, text: "" }) });
    await assert.rejects(hostWith(module, fake).list("issues"));
    fake.state.answer = undefined;
    assert.deepEqual(await hostWith(module, fake, { now: START + 1000 }).list("issues"), { rows: ROWS });
  });

  test("no connection and a cancel are let through", async () => {
    const offline = fakeLinear({ answer: () => yabError("networkError", "offline") });
    await assert.rejects(hostWith(await newHelper(), offline).list("issues"), { code: "networkError" });

    const slow = fakeLinear({ answer: () => new Promise(() => {}) });
    const host = hostWith(await newHelper(), slow);
    const listing = host.list("issues");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(listing, { code: "cancelled" });
  });

  test("speaks Turkish", async () => {
    const fake = fakeLinear();
    const module = await newHelper();
    const locked = await hostWith(module, fake, { key: undefined, language: "tr" }).list("issues");
    assert.equal(locked.message, "Ayarlar → Uzantılar → Linear’a bir Linear API anahtarı ekle. Anahtarı Linear’da Settings › Security & access altında oluşturabilirsin.");
    const { rows } = await hostWith(module, fake, { language: "tr" }).list("issues");
    assert.deepEqual(rows.map((row) => row.subtitle), ["Todo · Engineering", "In Progress · Engineering · Yüksek", "Backlog · Tasarım · Düşük", "Triage · Engineering · Acil"]);
  });
});

describe("a row's actions", () => {
  test("↵ pastes the issue's link, asked of Linear by the row's id", async () => {
    const fake = fakeLinear();
    const host = hostWith(await newHelper(), fake);
    assert.deepEqual(await host.runSource("issues", uuid(1), "url"), { text: "https://linear.app/ornek/issue/ENG-101/login-button-does-nothing-on-safari" });
    assert.deepEqual(operations(fake), ["Issue"]);
    assert.deepEqual(fake.requests[0].body.variables, { id: uuid(1) });
    assert.equal(fake.requests[0].headers.authorization, KEY);
    assertKeyKept(host);
  });

  test("⇧↵ pastes a Markdown link, with the title's Markdown characters escaped", async () => {
    const host = hostWith(await newHelper(), fakeLinear());
    assert.deepEqual(await host.runSource("issues", uuid(1), "markdown"), { text: "[ENG-101: Login button does nothing on Safari](https://linear.app/ornek/issue/ENG-101/login-button-does-nothing-on-safari)" });
    assert.deepEqual(await host.runSource("issues", uuid(2), "markdown"), {
      text: "[ENG-102: Use \\[brackets\\] \\*stars\\* and\\_underscores \\`ticks\\` \\<tags\\> \\\\ in titles](https://linear.app/ornek/issue/ENG-102/use-brackets)",
    });
  });

  test("the link is read fresh, so a renamed issue pastes its new title", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).list("issues");
    fake.state.issues = ISSUES.map((issue) => (issue.id === uuid(1) ? { ...issue, title: "Renamed" } : issue));
    assert.deepEqual(await hostWith(module, fake).runSource("issues", uuid(1), "markdown"), { text: "[ENG-101: Renamed](https://linear.app/ornek/issue/ENG-101/login-button-does-nothing-on-safari)" });
  });

  test("an issue gone since the list says so", async () => {
    const fake = fakeLinear();
    await assert.rejects(hostWith(await newHelper(), fake).runSource("issues", uuid(77), "url"), { message: "This issue is no longer in Linear, or the API key can’t see it." });
    const nulled = fakeLinear({ answer: () => ({ json: { data: { issue: null } } }) });
    await assert.rejects(hostWith(await newHelper(), nulled).runSource("issues", uuid(1), "url"), { message: "This issue is no longer in Linear, or the API key can’t see it." });
  });

  test("an id that isn't Linear's never reaches the request", async () => {
    const fake = fakeLinear();
    const host = hostWith(await newHelper(), fake);
    for (const rowId of ["../graphql", "x".repeat(65), "a b", "ENG-1\n"]) {
      await assert.rejects(host.runSource("issues", rowId, "url"), { message: "This issue is no longer in Linear, or the API key can’t see it." }, JSON.stringify(rowId));
    }
    assert.equal(fake.requests.length, 0);
  });

  test("without a key it says where to add one", async () => {
    const fake = fakeLinear();
    await assert.rejects(hostWith(await newHelper(), fake, { key: undefined }).runSource("issues", uuid(1), "url"), { message: LOCKED_NO_KEY.message });
    assert.equal(fake.requests.length, 0);
  });

  test("a refused key says so and drops the rows", async () => {
    const module = await newHelper();
    const fake = fakeLinear();
    await hostWith(module, fake).list("issues");
    fake.state.key = OTHER_KEY;
    const host = hostWith(module, fake, { now: START + 1000 });
    await assert.rejects(host.runSource("issues", uuid(1), "url"), (error) => {
      assert.equal(error.message, LOCKED_BAD_KEY.message);
      assertKeyKept(host, error);
      return true;
    });
    fake.state.key = KEY;
    await hostWith(module, fake, { now: START + 2000 }).list("issues");
    assert.deepEqual(operations(fake), ["MyIssues", "Issue", "MyIssues"]);
  });

  test("a rate limit, a server error and an unreadable answer each say so", async () => {
    const cases = [
      [{ status: 429, headers: { "retry-after": "120" }, json: RATE_LIMITED }, "Linear has had too many requests from this key. Try again in 2 min."],
      [{ status: 500, text: "" }, "Linear didn’t answer (status 500). Try again later."],
      [{ json: { data: { issue: { identifier: "ENG-101", title: "x", url: "javascript:alert(1)" } } } }, "Linear’s answer couldn’t be read. Try again later."],
      [{ json: { data: { issue: { identifier: "ENG-101", title: "x" } } } }, "Linear’s answer couldn’t be read. Try again later."],
      [{ status: 400, json: errorBody("Something else", "INTERNAL", "internal error") }, "Linear couldn’t read this issue."],
    ];
    for (const [answer, message] of cases) {
      const fake = fakeLinear({ answer: () => answer });
      await assert.rejects(hostWith(await newHelper(), fake).runSource("issues", uuid(1), "url"), { message }, JSON.stringify(answer));
    }
  });

  test("no connection is let through", async () => {
    const fake = fakeLinear({ answer: () => yabError("networkError", "offline") });
    await assert.rejects(hostWith(await newHelper(), fake).runSource("issues", uuid(1), "url"), { code: "networkError" });
  });

  test("speaks Turkish", async () => {
    const fake = fakeLinear();
    await assert.rejects(hostWith(await newHelper(), fake, { language: "tr" }).runSource("issues", uuid(77), "url"), { message: "Bu issue artık Linear’da yok ya da API anahtarı onu göremiyor." });
  });

  test("the not-found answer Linear documents is recognised by its message", async () => {
    const fake = fakeLinear({ answer: () => ({ status: 400, json: NOT_FOUND }) });
    await assert.rejects(hostWith(await newHelper(), fake).runSource("issues", uuid(1), "url"), { message: "This issue is no longer in Linear, or the API key can’t see it." });
  });
});
