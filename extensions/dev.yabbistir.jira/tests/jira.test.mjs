import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { JQL } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const START = Date.parse("2026-03-02T09:00:00Z");

// Synthetic account. The token is built at run time so that no file holds anything shaped like a real one.
const SITE = "your-domain.atlassian.net";
const EMAIL = "deniz@example.com";
const TOKEN = ["synthetic", "jira", "token", "7".repeat(24)].join("-");
const basic = (email, token) => `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
const BASIC = basic(EMAIL, TOKEN);
const PREFS = { site: SITE, email: EMAIL, project: "ENG" };

const SEARCH =
  "https://your-domain.atlassian.net/rest/api/3/search/jql" +
  "?jql=assignee%20%3D%20currentUser()%20AND%20statusCategory%20!%3D%20Done%20ORDER%20BY%20updated%20DESC" +
  "&maxResults=50&fields=summary,status,project";
const CREATE = "https://your-domain.atlassian.net/rest/api/3/issue";
const browse = (key) => `https://your-domain.atlassian.net/browse/${key}`;

let ids = 10000;
/** An issue as Jira's search answers with the extension's fields. */
function issue(key, summary, status, project) {
  const id = String(++ids);
  return {
    expand: "",
    id,
    key,
    self: `https://${SITE}/rest/api/3/issue/${id}`,
    fields: {
      summary,
      status: { name: status, id: "3", statusCategory: { key: "indeterminate", name: "In Progress" } },
      project: { id: "10000", key: key.split("-")[0], name: project },
    },
  };
}

const ISSUES = [
  issue("ENG-42", "Fix the login button on Safari", "In Progress", "Engineering"),
  issue("ENG-7", "Write the release notes", "To Do", "Engineering"),
  issue("OPS_2-310", "Rotate the staging certificates", "In Review", "Operations"),
];
const ROWS = [
  { id: "ENG-42", title: "ENG-42 Fix the login button on Safari", subtitle: "In Progress · Engineering" },
  { id: "ENG-7", title: "ENG-7 Write the release notes", subtitle: "To Do · Engineering" },
  { id: "OPS_2-310", title: "OPS_2-310 Rotate the staging certificates", subtitle: "In Review · Operations" },
];

const REJECTED = { status: 401, headers: { "X-Seraph-LoginReason": "AUTHENTICATED_FAILED" }, json: { errorMessages: ["Client must be authenticated to access this resource."], errors: {} } };

/**
 * A fake Jira Cloud site: the search, one issue's summary and create issue, each checking the sign-in as Jira does.
 * `search`, `issue` and `create` replace an answer; every request lands in `state.requests`.
 */
function fakeJira(changes = {}) {
  const state = { issues: ISSUES, search: undefined, issue: undefined, create: undefined, created: "ENG-101", requests: [], ...changes };
  const jira = (request) => {
    state.requests.push(request);
    const { method, url, headers } = request;
    if (headers.authorization !== BASIC) return REJECTED;
    if (method === "GET" && url === SEARCH) return state.search ?? { json: { isLast: true, issues: state.issues } };
    const one = /^https:\/\/your-domain\.atlassian\.net\/rest\/api\/3\/issue\/([^/?]+)\?fields=summary$/.exec(url);
    if (method === "GET" && one !== null) {
      if (state.issue !== undefined) return state.issue;
      const found = state.issues.find((entry) => entry.key === one[1]);
      if (found === undefined) return { status: 404, json: { errorMessages: ["Issue does not exist or you do not have permission to see it."], errors: {} } };
      return { json: { id: found.id, key: found.key, fields: { summary: found.fields.summary } } };
    }
    if (method === "POST" && url === CREATE) {
      if (state.create !== undefined) return state.create;
      return { status: 201, json: { id: "10101", key: state.created, self: `https://${SITE}/rest/api/3/issue/10101` } };
    }
    return { status: 404, text: "" };
  };
  return Object.assign(jira, { state });
}

let helpers = 0;
/** The extension as a newly started helper has it: a module of its own, with nothing cached. */
async function newHelper() {
  return import(`../src/index.ts?helper=${++helpers}`);
}

function hostWith(extension, jira, { preferences = PREFS, secrets = { apiToken: TOKEN }, now = START, language = "en" } = {}) {
  return createFakeHost({ folder, sources: extension.sources, http: jira, preferences, secrets, now, context: { language } });
}
const fetches = (host) => host.calls.filter((call) => call.api === "http.fetch");
const settled = (promise) => promise.then(() => undefined, () => undefined);

describe("settings", () => {
  test("a missing setting locks the column with what to add, and nothing is asked", async () => {
    const cases = [
      [{}, {}, "Add your Jira site, email and API token in Settings → Extensions → Jira."],
      [{ site: SITE }, {}, "Add your Jira site, email and API token in Settings → Extensions → Jira."],
      [{ email: EMAIL }, { apiToken: TOKEN }, "Add your Jira site, such as yourteam.atlassian.net, in Settings → Extensions → Jira."],
      [{ site: SITE }, { apiToken: TOKEN }, "Add the email you sign in to Jira with in Settings → Extensions → Jira."],
      [{ site: SITE, email: EMAIL }, {}, "Add a Jira API token in Settings → Extensions → Jira. Make one at id.atlassian.com › Security › API tokens."],
      [{ site: SITE, email: EMAIL }, { apiToken: "  \n" }, "Add a Jira API token in Settings → Extensions → Jira. Make one at id.atlassian.com › Security › API tokens."],
      [{ site: "  ", email: " ", project: "ENG" }, { apiToken: TOKEN }, "Add your Jira site, email and API token in Settings → Extensions → Jira."],
      [{ site: "yourteam.jira.com", email: EMAIL }, { apiToken: TOKEN }, "The Jira site must be a Jira Cloud address, such as yourteam.atlassian.net."],
      [{ site: SITE, email: "deniz" }, { apiToken: TOKEN }, "The email in Settings → Extensions → Jira doesn’t look like an email address."],
      [{ site: SITE, email: "deniz@example.com:x" }, { apiToken: TOKEN }, "The email in Settings → Extensions → Jira doesn’t look like an email address."],
    ];
    for (const [preferences, secrets, message] of cases) {
      const host = hostWith(await newHelper(), fakeJira(), { preferences, secrets });
      assert.deepEqual(await host.list("issues"), { locked: true, message }, JSON.stringify(preferences));
      assert.deepEqual(fetches(host), []);
    }
  });

  test("the site may be written with or without https://, or as any link into it", async () => {
    const { siteHost } = await newHelper();
    for (const value of [
      SITE,
      `https://${SITE}`,
      `https://${SITE}/`,
      `HTTPS://Your-Domain.Atlassian.NET/jira/your-work`,
      `http://${SITE}`,
      `${SITE}.`,
      `${SITE}/browse/ENG-1?focused=1#comment`,
      `https://${SITE}:443`,
    ]) {
      assert.equal(siteHost(value), SITE, value);
    }
  });

  test("a site outside atlassian.net, or one that hides another host, is refused", async () => {
    const { siteHost } = await newHelper();
    for (const value of [
      "",
      "atlassian.net",
      ".atlassian.net",
      "example.com",
      `${SITE}.example.com`,
      "your-domainatlassian.net",
      "your-domain.atlassian.net.example.com/x",
      `https://user:pass@${SITE}`,
      `https://${SITE}@example.com`,
      `https://example.com\\@${SITE}`,
      `https://example.com/${SITE}`,
      `${SITE}:8080`,
      `ftp://${SITE}`,
      "javascript:alert(1)",
      "team.eu.atlassian.net",
      "-team.atlassian.net",
      "team-.atlassian.net",
      "your domain.atlassian.net",
      `${"a".repeat(64)}.atlassian.net`,
      `${"x".repeat(3000)}.atlassian.net`,
    ]) {
      assert.equal(siteHost(value), undefined, value);
    }
  });

  test("answers in Turkish", async () => {
    const host = hostWith(await newHelper(), fakeJira(), { preferences: { site: SITE, email: EMAIL }, secrets: {}, language: "tr" });
    assert.deepEqual(await host.list("issues"), {
      locked: true,
      message: "Ayarlar → Uzantılar → Jira’ya bir Jira API token’ı ekle. Token’ı id.atlassian.com › Security › API tokens altında oluşturabilirsin.",
    });
  });
});

describe("list", () => {
  test("lists the open issues assigned to the person, with Jira's enhanced search", async () => {
    const jira = fakeJira();
    const host = hostWith(await newHelper(), jira);
    assert.deepEqual(await host.list("issues"), { rows: ROWS });
    assert.equal(jira.state.requests.length, 1);
    const [{ method, url, headers, body }] = jira.state.requests;
    assert.equal(method, "GET");
    assert.equal(url, SEARCH);
    assert.equal(new URL(url).searchParams.get("jql"), "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC");
    assert.equal(JQL, "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC");
    assert.deepEqual(headers, { authorization: BASIC, accept: "application/json" });
    assert.equal(body, undefined);
  });

  test("signs in with the email and token in Base64 of UTF-8, trimmed", async () => {
    const email = "dëniz.öz@example.com";
    const jira = (request) => (request.headers.authorization === basic(email, TOKEN) ? { json: { issues: [] } } : REJECTED);
    const host = createFakeHost({ folder, sources: (await newHelper()).sources, http: jira, preferences: { site: ` ${SITE} `, email: ` ${email} ` }, secrets: { apiToken: ` ${TOKEN}\n` } });
    assert.deepEqual(await host.list("issues"), { rows: [] });
  });

  test("at most fifty rows; entries without a well-formed key, or repeated, are left out", async () => {
    const many = Array.from({ length: 80 }, (_, index) => issue(`BIG-${index + 1}`, `Task ${index + 1}`, "To Do", "Big"));
    const odd = [
      null,
      "ENG-1",
      { fields: { summary: "No key" } },
      { key: "eng-2", fields: { summary: "Lower case" } },
      { key: "ENG-0", fields: { summary: "Zero" } },
      { key: "ENG-3/../x", fields: { summary: "Path" } },
      { key: 42, fields: { summary: "Number" } },
      issue("ENG-42", "Fix the login button on Safari", "In Progress", "Engineering"),
      issue("ENG-42", "The same key again", "Done", "Engineering"),
    ];
    const host = hostWith(await newHelper(), fakeJira({ issues: [...odd, ...many] }));
    const { rows } = await host.list("issues");
    assert.equal(rows.length, 50);
    assert.deepEqual(rows[0], ROWS[0]);
    assert.deepEqual(rows[1], { id: "BIG-1", title: "BIG-1 Task 1", subtitle: "To Do · Big" });
    assert.equal(rows.at(-1).id, "BIG-49");
  });

  test("a missing summary, status or project leaves only what there is", async () => {
    const issues = [
      { key: "ENG-1", fields: {} },
      { key: "ENG-2" },
      { key: "ENG-3", fields: { summary: "  Spaces\tand\nlines  ", status: { name: "Blocked" }, project: { key: "ENG" } } },
      { key: "ENG-4", fields: { summary: 7, status: "Open", project: { name: 3 } } },
    ];
    const host = hostWith(await newHelper(), fakeJira({ issues }));
    assert.deepEqual(await host.list("issues"), {
      rows: [
        { id: "ENG-1", title: "ENG-1" },
        { id: "ENG-2", title: "ENG-2" },
        { id: "ENG-3", title: "ENG-3 Spaces and lines", subtitle: "Blocked · ENG" },
        { id: "ENG-4", title: "ENG-4" },
      ],
    });
  });

  test("no open issues is an empty column", async () => {
    const host = hostWith(await newHelper(), fakeJira({ issues: [] }));
    assert.deepEqual(await host.list("issues"), { rows: [] });
  });

  test("the list is reused for a minute, for the same site and email only", async () => {
    const extension = await newHelper();
    const jira = fakeJira();
    await hostWith(extension, jira).list("issues");
    jira.state.issues = [issue("ENG-500", "Newer", "To Do", "Engineering")];

    assert.deepEqual(await hostWith(extension, jira, { now: START + 60_000 }).list("issues"), { rows: ROWS });
    assert.equal(jira.state.requests.length, 1, "not asked again within the minute");

    const other = { ...PREFS, email: "ada@example.com" };
    const otherJira = (request) => (request.headers.authorization === basic("ada@example.com", TOKEN) ? { json: { issues: [] } } : REJECTED);
    assert.deepEqual(await createFakeHost({ folder, sources: extension.sources, http: otherJira, preferences: other, secrets: { apiToken: TOKEN }, now: START + 1 }).list("issues"), { rows: [] }, "another account asks Jira itself");

    const later = hostWith(extension, jira, { now: START + 60_001 + 1 });
    assert.deepEqual(await later.list("issues"), { rows: [{ id: "ENG-500", title: "ENG-500 Newer", subtitle: "To Do · Engineering" }] });
    assert.equal(jira.state.requests.length, 2);
  });

  test("a rejected sign-in locks the column and drops the rows", async () => {
    const extension = await newHelper();
    const jira = fakeJira();
    await hostWith(extension, jira).list("issues");
    const message = "Jira didn’t accept your email and API token. Check them in Settings → Extensions → Jira.";

    const wrong = hostWith(extension, jira, { secrets: { apiToken: `${TOKEN}x` }, now: START + 120_000 });
    assert.deepEqual(await wrong.list("issues"), { locked: true, message });

    const again = hostWith(extension, jira, { now: START + 120_001 });
    assert.deepEqual(await again.list("issues"), { rows: ROWS });
    assert.equal(fetches(again).length, 1, "the rows went with the lock");
  });

  test("Jira's sign that it ignored the credentials locks the column, even with a 200", async () => {
    // Jira Cloud may answer rejected credentials as if no one asked: 200, nothing found, and this header.
    const search = { status: 200, headers: { "x-seraph-loginreason": "AUTHENTICATED_FAILED" }, json: { issues: [], isLast: true } };
    const host = hostWith(await newHelper(), fakeJira({ search }));
    assert.deepEqual(await host.list("issues"), { locked: true, message: "Jira didn’t accept your email and API token. Check them in Settings → Extensions → Jira." });
  });

  test("a CAPTCHA, a refused account and a site without Jira lock the column with their own words", async () => {
    const captcha = "Jira wants you to sign in on the web first. Sign in at your-domain.atlassian.net once; the column tries again within 15 minutes.";
    const cases = [
      [{ status: 403, headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" }, text: "" }, captcha],
      [{ status: 200, headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" }, json: { issues: [] } }, captcha],
      [{ status: 403, json: { errorMessages: ["You do not have access."] } }, "Your Jira account can’t use your-domain.atlassian.net. Check the site and email in Settings."],
      [{ status: 404, text: "<html>Site not found</html>" }, "There is no Jira at your-domain.atlassian.net. Check the site in Settings → Extensions → Jira."],
    ];
    for (const [search, message] of cases) {
      const host = hostWith(await newHelper(), fakeJira({ search }));
      assert.deepEqual(await host.list("issues"), { locked: true, message });
    }
  });

  test("a refused sign-in is not sent again on every opening", async () => {
    const extension = await newHelper();
    const jira = fakeJira();
    const message = "Jira didn’t accept your email and API token. Check them in Settings → Extensions → Jira.";
    const wrong = { secrets: { apiToken: `${TOKEN}x` } };
    for (let opening = 0; opening < 5; opening++) {
      const host = hostWith(extension, jira, { ...wrong, now: START + opening * 61_000 });
      assert.deepEqual(await host.list("issues"), { locked: true, message });
    }
    assert.equal(jira.state.requests.length, 1, "five openings, one failed sign-in");

    const later = hostWith(extension, jira, { ...wrong, now: START + 15 * 60_000 });
    assert.deepEqual(await later.list("issues"), { locked: true, message });
    assert.equal(jira.state.requests.length, 2, "tried again after fifteen minutes");
  });

  test("a corrected token, email or site is tried at once", async () => {
    const extension = await newHelper();
    const jira = fakeJira();
    await hostWith(extension, jira, { secrets: { apiToken: `${TOKEN}x` } }).list("issues");
    assert.deepEqual(await hostWith(extension, jira, { now: START + 1 }).list("issues"), { rows: ROWS });
    assert.equal(jira.state.requests.length, 2);

    const email = await newHelper();
    const emailJira = fakeJira();
    await hostWith(email, emailJira, { preferences: { ...PREFS, email: "denz@example.com" } }).list("issues");
    assert.deepEqual(await hostWith(email, emailJira, { now: START + 1 }).list("issues"), { rows: ROWS });
    assert.equal(emailJira.state.requests.length, 2);

    const site = await newHelper();
    const siteJira = fakeJira({ search: { status: 404, text: "" } });
    await hostWith(site, siteJira, { preferences: { ...PREFS, site: "your-domain.atlassian.net" } }).list("issues");
    const moved = (request) => (siteJira.state.requests.push(request), { json: { issues: [] } });
    assert.deepEqual(await hostWith(site, moved, { preferences: { ...PREFS, site: "other-team.atlassian.net" }, now: START + 1 }).list("issues"), { rows: [] });
    assert.equal(siteJira.state.requests.length, 2);
  });

  test("a CAPTCHA, a refused account and a missing site are not asked again within the window either", async () => {
    for (const search of [
      { status: 403, headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" }, text: "" },
      { status: 403, json: { errorMessages: ["You do not have access."] } },
      { status: 404, text: "" },
    ]) {
      const extension = await newHelper();
      const jira = fakeJira({ search });
      const first = await hostWith(extension, jira).list("issues");
      jira.state.search = undefined;
      assert.deepEqual(await hostWith(extension, jira, { now: START + 15 * 60_000 - 1 }).list("issues"), first, JSON.stringify(search));
      assert.equal(jira.state.requests.length, 1, JSON.stringify(search));
      assert.deepEqual(await hostWith(extension, jira, { now: START + 15 * 60_000 }).list("issues"), { rows: ROWS });
    }
  });

  test("a new issue made with the same sign-in lets the column try again", async () => {
    const extension = await newHelper();
    const jira = fakeJira({ search: { status: 403, headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" }, text: "" } });
    assert.equal((await hostWith(extension, jira).list("issues")).locked, true);
    jira.state.search = undefined;
    await hostWith(extension, jira, { now: START + 60_000 }).run(extension.actions.create, { kind: "text", text: "Something" });
    assert.deepEqual(await hostWith(extension, jira, { now: START + 61_000 }).list("issues"), { rows: ROWS });
    assert.equal(jira.state.requests.length, 3);
  });

  test("a clock set back does not keep a sign-in refused", async () => {
    const extension = await newHelper();
    const jira = fakeJira({ search: { status: 404, text: "" } });
    await hostWith(extension, jira).list("issues");
    jira.state.search = undefined;
    assert.deepEqual(await hostWith(extension, jira, { now: START - 1 }).list("issues"), { rows: ROWS });
  });

  test("when Jira fails, the column waits a minute before asking again", async () => {
    const extension = await newHelper();
    const jira = fakeJira({ search: { status: 503, text: "" } });
    const message = "Jira isn’t answering right now (status 503). Try again later.";
    for (let opening = 0; opening < 5; opening++) {
      await assert.rejects(hostWith(extension, jira, { now: START + opening * 10_000 }).list("issues"), { message });
    }
    assert.equal(jira.state.requests.length, 1, "five openings in a minute, one request");
    jira.state.search = undefined;
    assert.deepEqual(await hostWith(extension, jira, { now: START + 60_000 }).list("issues"), { rows: ROWS });
    assert.equal(jira.state.requests.length, 2);

    for (const [search, failure] of [
      [{ status: 400, json: {} }, "Jira couldn’t list your issues (status 400)."],
      [{ text: "<html></html>" }, "Jira sent an answer that couldn’t be read."],
    ]) {
      const other = await newHelper();
      const failing = fakeJira({ search });
      await assert.rejects(hostWith(other, failing).list("issues"), { message: failure });
      await assert.rejects(hostWith(other, failing, { now: START + 59_999 }).list("issues"), { message: failure });
      assert.equal(failing.state.requests.length, 1, failure);
    }
  });

  test("no connection does not make the column wait", async () => {
    const extension = await newHelper();
    await assert.rejects(hostWith(extension, () => yabError("networkError", "offline")).list("issues"), { code: "networkError" });
    const jira = fakeJira();
    assert.deepEqual(await hostWith(extension, jira, { now: START + 1 }).list("issues"), { rows: ROWS });
  });

  test("a wait belongs to the account Jira limited", async () => {
    const extension = await newHelper();
    const jira = fakeJira({ search: { status: 429, headers: { "Retry-After": "600" }, text: "" } });
    await assert.rejects(hostWith(extension, jira).list("issues"), { message: "Jira is limiting requests right now. Try again in 10 minutes." });
    const other = { ...PREFS, email: "ada@example.com" };
    const otherJira = (request) => (request.headers.authorization === basic("ada@example.com", TOKEN) ? { json: { issues: [] } } : REJECTED);
    assert.deepEqual(await createFakeHost({ folder, sources: extension.sources, http: otherJira, preferences: other, secrets: { apiToken: TOKEN }, now: START + 1 }).list("issues"), { rows: [] });
    jira.state.search = undefined;
    await assert.rejects(hostWith(extension, jira, { now: START + 2 }).list("issues"), { message: "Jira is limiting requests right now. Try again in 10 minutes." });
    assert.equal(jira.state.requests.length, 1);
  });

  test("Retry-After is waited at least a minute and at most a day", async () => {
    const extension = await newHelper();
    const jira = fakeJira({ search: { status: 429, headers: { "Retry-After": "999999999" }, text: "" } });
    await assert.rejects(hostWith(extension, jira).list("issues"), { message: "Jira is limiting requests right now. Try again in 1440 minutes." });
    jira.state.search = undefined;
    await assert.rejects(hostWith(extension, jira, { now: START + 24 * 3_600_000 - 1 }).list("issues"), { message: "Jira is limiting requests right now. Try again in a minute." });
    assert.equal(jira.state.requests.length, 1);
    assert.deepEqual(await hostWith(extension, jira, { now: START + 24 * 3_600_000 }).list("issues"), { rows: ROWS });

    const brief = await newHelper();
    const briefJira = fakeJira({ search: { status: 429, headers: { "Retry-After": "5" }, text: "" } });
    await assert.rejects(hostWith(brief, briefJira).list("issues"), { message: "Jira is limiting requests right now. Try again in a minute." });
    briefJira.state.search = undefined;
    await assert.rejects(hostWith(brief, briefJira, { now: START + 59_999 }).list("issues"));
    assert.equal(briefJira.state.requests.length, 1, "asked at most once a minute");
  });

  test("when Jira limits requests the column waits as long as Jira asks", async () => {
    const extension = await newHelper();
    const jira = fakeJira({ search: { status: 429, headers: { "Retry-After": "120", "RateLimit-Reason": "jira-burst-based" }, text: "" } });
    await assert.rejects(hostWith(extension, jira).list("issues"), { message: "Jira is limiting requests right now. Try again in 2 minutes." });

    jira.state.search = undefined;
    const waiting = hostWith(extension, jira, { now: START + 60_000 });
    await assert.rejects(waiting.list("issues"), { message: "Jira is limiting requests right now. Try again in a minute." });
    assert.equal(fetches(waiting).length, 0, "Jira is not asked while it said to wait");

    const after = hostWith(extension, jira, { now: START + 120_000 });
    assert.deepEqual(await after.list("issues"), { rows: ROWS });
  });

  test("a limit without Retry-After waits a minute; a long one is said in minutes", async () => {
    const plain = hostWith(await newHelper(), fakeJira({ search: { status: 429, text: "" } }));
    await assert.rejects(plain.list("issues"), { message: "Jira is limiting requests right now. Try again in a minute." });
    const long = hostWith(await newHelper(), fakeJira({ search: { status: 429, headers: { "retry-after": "1847" }, text: "" } }));
    await assert.rejects(long.list("issues"), { message: "Jira is limiting requests right now. Try again in 31 minutes." });
    const odd = hostWith(await newHelper(), fakeJira({ search: { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, text: "" } }));
    await assert.rejects(odd.list("issues"), { message: "Jira is limiting requests right now. Try again in a minute." });
  });

  test("Jira being down, or refusing the query, is an error that keeps the app's rows", async () => {
    for (const [search, message] of [
      [{ status: 503, text: "Service Unavailable" }, "Jira isn’t answering right now (status 503). Try again later."],
      [{ status: 500, json: { errorMessages: ["Internal server error"] } }, "Jira isn’t answering right now (status 500). Try again later."],
      [{ status: 400, json: { errorMessages: ["The JQL query is invalid."] } }, "Jira couldn’t list your issues (status 400)."],
      [{ status: 410, json: { errorMessages: ["Gone"] } }, "Jira couldn’t list your issues (status 410)."],
      [{ status: 302, headers: { location: "https://your-domain.atlassian.net/login" }, text: "" }, "Jira couldn’t list your issues (status 302)."],
    ]) {
      await assert.rejects(hostWith(await newHelper(), fakeJira({ search })).list("issues"), { message });
    }
  });

  test("an answer that is not a search result is an error, and not kept", async () => {
    for (const search of [
      { text: "<!doctype html><title>Log in</title>" },
      { text: "" },
      { json: { issues: "none" } },
      { json: [ISSUES[0]] },
      { json: null },
      { json: { total: 3 } },
    ]) {
      const extension = await newHelper();
      const jira = fakeJira({ search });
      await assert.rejects(hostWith(extension, jira).list("issues"), { message: "Jira sent an answer that couldn’t be read." }, JSON.stringify(search));
      jira.state.search = undefined;
      assert.deepEqual(await hostWith(extension, jira, { now: START + 60_000 }).list("issues"), { rows: ROWS });
      assert.equal(jira.state.requests.length, 2, "the odd answer was not kept");
    }
  });

  test("no connection is let through, for the app to report", async () => {
    const host = hostWith(await newHelper(), () => yabError("networkError", "offline"));
    await assert.rejects(host.list("issues"), { code: "networkError" });
  });

  test("answers in Turkish", async () => {
    const host = hostWith(await newHelper(), fakeJira({ search: { status: 429, headers: { "retry-after": "300" }, text: "" } }), { language: "tr" });
    await assert.rejects(host.list("issues"), { message: "Jira şu an istekleri sınırlıyor. 5 dakika sonra yeniden dene." });
    const locked = hostWith(await newHelper(), fakeJira(), { secrets: { apiToken: "wrong" }, language: "tr" });
    assert.deepEqual(await locked.list("issues"), { locked: true, message: "Jira e-postanı ve API token’ını kabul etmedi. Ayarlar → Uzantılar → Jira’dan kontrol et." });
    const captcha = hostWith(await newHelper(), fakeJira({ search: { status: 403, headers: { "X-Seraph-LoginReason": "AUTHENTICATION_DENIED" }, text: "" } }), { language: "tr" });
    assert.deepEqual(await captcha.list("issues"), { locked: true, message: "Jira önce web’de giriş yapmanı istiyor. your-domain.atlassian.net adresinde bir kez giriş yap; sütun 15 dakika içinde yeniden dener." });
  });
});

describe("run", () => {
  test("↵ pastes the issue's link, without asking Jira", async () => {
    const jira = fakeJira();
    const host = hostWith(await newHelper(), jira);
    assert.deepEqual(await host.runSource("issues", "ENG-42", "link"), { text: "https://your-domain.atlassian.net/browse/ENG-42" });
    assert.deepEqual(await host.runSource("issues", "OPS_2-310", "link"), { text: browse("OPS_2-310") });
    assert.equal(jira.state.requests.length, 0);
  });

  test("⇧↵ pastes a Markdown link with the summary from the listing", async () => {
    const extension = await newHelper();
    const jira = fakeJira();
    await hostWith(extension, jira).list("issues");
    const host = hostWith(extension, jira, { now: START + 4 * 60_000 });
    assert.deepEqual(await host.runSource("issues", "ENG-42", "markdown"), { text: "[ENG-42: Fix the login button on Safari](https://your-domain.atlassian.net/browse/ENG-42)" });
    assert.deepEqual(await host.runSource("issues", "OPS_2-310", "markdown"), { text: `[OPS\\_2-310: Rotate the staging certificates](${browse("OPS_2-310")})` });
    assert.equal(fetches(host).length, 0);
  });

  test("the Markdown link's text shows every character as it is", async () => {
    const summary = "Fix [docs](https://example.com) *now* _maybe_ `code` <b>bold</b> & ~~old~~ | pipe \\ slash";
    const extension = await newHelper();
    const jira = fakeJira({ issues: [issue("ENG-9", summary, "To Do", "Engineering")] });
    const host = hostWith(extension, jira);
    await host.list("issues");
    assert.deepEqual(await host.runSource("issues", "ENG-9", "markdown"), {
      text: `[ENG-9: Fix \\[docs\\](https://example.com) \\*now\\* \\_maybe\\_ \\\`code\\\` \\<b\\>bold\\</b\\> \\& \\~\\~old\\~\\~ \\| pipe \\\\ slash](${browse("ENG-9")})`,
    });
  });

  test("without a recent listing the summary is asked of Jira", async () => {
    const jira = fakeJira();
    const host = hostWith(await newHelper(), jira);
    assert.deepEqual(await host.runSource("issues", "ENG-7", "markdown"), { text: `[ENG-7: Write the release notes](${browse("ENG-7")})` });
    assert.deepEqual(jira.state.requests.map(({ method, url, headers }) => [method, url, headers]), [
      ["GET", "https://your-domain.atlassian.net/rest/api/3/issue/ENG-7?fields=summary", { authorization: BASIC, accept: "application/json" }],
    ]);

    const extension = await newHelper();
    await hostWith(extension, jira).list("issues");
    const stale = hostWith(extension, jira, { now: START + 5 * 60_000 + 1 });
    await stale.runSource("issues", "ENG-42", "markdown");
    assert.equal(fetches(stale).length, 1, "a listing older than five minutes is not trusted for a summary");
  });

  test("without a summary the Markdown link carries the key alone", async () => {
    for (const answer of [
      { issue: { status: 503, text: "" } },
      { issue: { status: 429, text: "" } },
      { issue: { text: "not json" } },
      { issue: { json: { key: "ENG-8", fields: { summary: "Another issue" } } } },
      { issue: { json: { key: "ENG-7", fields: {} } } },
    ]) {
      const host = hostWith(await newHelper(), fakeJira(answer));
      assert.deepEqual(await host.runSource("issues", "ENG-7", "markdown"), { text: `[ENG-7](${browse("ENG-7")})` }, JSON.stringify(answer));
    }
    const offline = hostWith(await newHelper(), () => yabError("networkError", "offline"));
    assert.deepEqual(await offline.runSource("issues", "ENG-7", "markdown"), { text: `[ENG-7](${browse("ENG-7")})` });
    const unsigned = hostWith(await newHelper(), fakeJira(), { secrets: {} });
    assert.deepEqual(await unsigned.runSource("issues", "ENG-7", "markdown"), { text: `[ENG-7](${browse("ENG-7")})` });
    assert.equal(fetches(unsigned).length, 0);
  });

  test("an issue that is gone, or a rejected sign-in, says so", async () => {
    const host = hostWith(await newHelper(), fakeJira());
    await assert.rejects(host.runSource("issues", "ENG-404", "markdown"), { message: "Jira couldn’t find ENG-404. It may have moved or been deleted." });
    const wrong = hostWith(await newHelper(), fakeJira(), { secrets: { apiToken: "wrong" } });
    await assert.rejects(wrong.runSource("issues", "ENG-7", "markdown"), { message: "Jira didn’t accept your email and API token. Check them in Settings → Extensions → Jira." });
  });

  test("a cancelled summary request is let through", async () => {
    const host = hostWith(await newHelper(), () => new Promise(() => {}));
    const running = host.runSource("issues", "ENG-7", "markdown");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("row ids must be issue keys, and actions the source's own", async () => {
    const jira = fakeJira();
    const host = hostWith(await newHelper(), jira);
    for (const rowId of ["eng-1", "ENG-0", "E-1", "ENG-1/../x", "../ENG-1", "ENG-1?fields=*all", "ENG-1#x", "", " ENG-1", "ENG-1\n", "ＥＮＧ-1", `ENG-${"9".repeat(10)}`]) {
      await assert.rejects(host.runSource("issues", rowId, "markdown"), { message: "This row no longer holds a Jira issue." }, JSON.stringify(rowId));
      await assert.rejects(host.runSource("issues", rowId, "link"), { message: "This row no longer holds a Jira issue." });
    }
    assert.equal(jira.state.requests.length, 0);
  });

  test("a link needs the site", async () => {
    const host = hostWith(await newHelper(), fakeJira(), { preferences: {} });
    await assert.rejects(host.runSource("issues", "ENG-42", "link"), { message: "Add your Jira site, such as yourteam.atlassian.net, in Settings → Extensions → Jira." });
    const bad = hostWith(await newHelper(), fakeJira(), { preferences: { site: "example.com" } });
    await assert.rejects(bad.runSource("issues", "ENG-42", "link"), { message: "The Jira site must be a Jira Cloud address, such as yourteam.atlassian.net." });
  });
});

describe("paste as Jira link", () => {
  const text = (value) => ({ kind: "text", text: value });

  test("is offered on an issue key alone", async () => {
    const host = hostWith(await newHelper(), fakeJira());
    assert.deepEqual(host.offers(text("ENG-42")), ["keyLink", "create"]);
    assert.deepEqual(host.offers(text("  OPS_2-310\n")), ["keyLink", "create"]);
    assert.deepEqual(host.offers({ kind: "code", text: "ENG-42" }), ["keyLink", "create"]);
    for (const value of ["eng-42", "ENG-42 is done", "See ENG-42", "ENG-0", "E-1", "ENG42", "ENG-", "ENG-1234567890", `${"A".repeat(21)}-1`]) {
      assert.ok(!host.offers(text(value)).includes("keyLink"), value);
    }
    assert.deepEqual(host.offers({ kind: "link", url: browse("ENG-42") }), []);
  });

  test("makes the issue's link from the site alone, as a hint too", async () => {
    const extension = await newHelper();
    const host = createFakeHost({ folder, preferences: { site: `https://${SITE}/jira/your-work` } });
    const expected = { link: { url: "https://your-domain.atlassian.net/browse/ENG-42", title: "ENG-42" } };
    assert.deepEqual(await host.hint(extension.actions.keyLink, text("ENG-42")), expected);
    assert.deepEqual(await host.run(extension.actions.keyLink, text(" ENG-42\n")), expected);
    assert.deepEqual(host.calls, []);
  });

  test("says what is missing", async () => {
    const { actions } = await newHelper();
    const none = createFakeHost({ folder });
    assert.deepEqual(await none.hint(actions.keyLink, text("ENG-42")), { none: true, message: "Add your Jira site, such as yourteam.atlassian.net, in Settings → Extensions → Jira." });
    const bad = createFakeHost({ folder, preferences: { site: "jira.example.com" } });
    assert.deepEqual(await bad.run(actions.keyLink, text("ENG-42")), { none: true, message: "The Jira site must be a Jira Cloud address, such as yourteam.atlassian.net." });
    const host = createFakeHost({ folder, preferences: { site: SITE } });
    assert.deepEqual(await host.run(actions.keyLink, text("ENG-42 and more")), { none: true, message: "This isn’t a Jira issue key, such as ENG-42." });
    assert.deepEqual(await host.run(actions.keyLink, null), { none: true, message: "This isn’t a Jira issue key, such as ENG-42." });
    const tr = createFakeHost({ folder, context: { language: "tr" } });
    assert.deepEqual(await tr.hint(actions.keyLink, text("ENG-42")), { none: true, message: "Jira siteni (örneğin ekibin.atlassian.net) Ayarlar → Uzantılar → Jira’ya ekle." });
  });
});

describe("create Jira issue", () => {
  const text = (value) => ({ kind: "text", text: value });
  async function created(item, { preferences = PREFS, jira = fakeJira(), secrets, language } = {}) {
    const extension = await newHelper();
    const host = hostWith(extension, jira, { preferences, secrets, language });
    const result = await host.run(extension.actions.create, item);
    return { result, host, jira, requests: jira.state.requests, sent: jira.state.requests.map((request) => JSON.parse(request.body ?? "null")) };
  }

  test("one line becomes the summary of a Task in the project, and the new issue's link is pasted", async () => {
    const { result, requests, sent } = await created(text("Fix the login button on Safari"));
    assert.deepEqual(result, { link: { url: "https://your-domain.atlassian.net/browse/ENG-101", title: "ENG-101: Fix the login button on Safari" } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "https://your-domain.atlassian.net/rest/api/3/issue");
    assert.deepEqual(requests[0].headers, { authorization: BASIC, accept: "application/json", "content-type": "application/json" });
    assert.deepEqual(sent[0], { fields: { project: { key: "ENG" }, issuetype: { name: "Task" }, summary: "Fix the login button on Safari" } });
  });

  test("prose keeps its paragraphs and line breaks in the description", async () => {
    const copied = "Login fails on Safari\r\n\r\nSteps:\r\nOpen the page\r\nPress Log in  \n\n\n  Expected the dialog.\n";
    const { sent } = await created(text(copied), { preferences: { ...PREFS, project: "web", issueType: "Bug" } });
    assert.deepEqual(sent[0].fields, {
      project: { key: "WEB" },
      issuetype: { name: "Bug" },
      summary: "Login fails on Safari",
      description: {
        version: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Login fails on Safari" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Steps:" },
              { type: "hardBreak" },
              { type: "text", text: "Open the page" },
              { type: "hardBreak" },
              { type: "text", text: "Press Log in" },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "  Expected the dialog." }] },
        ],
      },
    });
  });

  test("a log goes into a code block, whole", async () => {
    const log = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at renderRow (app.js:120:18)",
      "    at Array.map (<anonymous>)",
    ].join("\n");
    const { result, sent } = await created(text(`\n${log}\n\n`));
    assert.equal(result.link.title, "ENG-101: TypeError: Cannot read properties of undefined (reading 'id')");
    assert.deepEqual(sent[0].fields.description, { version: 1, type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: log }] }] });
  });

  test("code the app marked as code goes into a code block, its summary from the first line with words", async () => {
    const code = "{\n  \"name\": \"yabbistir\",\n  \"private\": true\n}";
    const { sent } = await created({ kind: "code", text: code });
    assert.equal(sent[0].fields.summary, "\"name\": \"yabbistir\",");
    assert.deepEqual(sent[0].fields.description.content, [{ type: "codeBlock", content: [{ type: "text", text: code }] }]);
  });

  test("a long first line is cut in the summary and kept whole in the description", async () => {
    const line = `${"word ".repeat(80)}end`;
    const { sent } = await created(text(line));
    assert.equal(sent[0].fields.summary.length, 254);
    assert.ok(sent[0].fields.summary.endsWith("…"));
    assert.deepEqual(sent[0].fields.description.content, [{ type: "paragraph", content: [{ type: "text", text: line }] }]);
  });

  test("a text longer than a description holds is cut, and the person is told", async () => {
    const long = `Build failed\n${"2026-03-02 09:00:00 ERROR step failed\n".repeat(2000)}`;
    const { sent, host } = await created(text(long));
    const block = sent[0].fields.description.content[0];
    assert.equal(block.type, "codeBlock");
    assert.ok(JSON.stringify(sent[0].fields.description).length <= 30_000, "the document fits, as Jira counts it");
    assert.ok(block.content[0].text.endsWith("\n…"));
    assert.ok(long.startsWith(block.content[0].text.slice(0, -2)));
    const kept = new Intl.NumberFormat("en").format(block.content[0].text.length - 2);
    assert.deepEqual(host.notifications, [`The text was long, so the issue’s description holds only its first ${kept} characters.`]);
    const short = await created(text("Build failed\nsecond line"));
    assert.deepEqual(short.host.notifications, []);
  });

  test("prose of many short lines is cut on its document too", async () => {
    const notes = Array.from({ length: 1_200 }, (_, index) => `Line ${index + 1} of the notes`).join("\n");
    const { sent, host } = await created(text(notes));
    assert.ok(JSON.stringify(sent[0].fields.description).length <= 30_000);
    assert.equal(host.notifications.length, 1);
  });

  test("the issue type defaults to Task, and the project key is upper-cased", async () => {
    const { sent } = await created(text("Something"), { preferences: { ...PREFS, project: " eng ", issueType: "  " } });
    assert.deepEqual(sent[0].fields.issuetype, { name: "Task" });
    assert.deepEqual(sent[0].fields.project, { key: "ENG" });
    const spaced = await created(text("Something"), { preferences: { ...PREFS, issueType: " Bug \n report " } });
    assert.deepEqual(spaced.sent[0].fields.issuetype, { name: "Bug report" });
  });

  test("nothing to make an issue from says so, and asks nothing", async () => {
    for (const value of ["", "   \n\t", "{\n}\n", "—…!"]) {
      const { result, requests } = await created(text(value));
      assert.deepEqual(result, { none: true, message: "There is no text to make an issue from." }, JSON.stringify(value));
      assert.equal(requests.length, 0);
    }
    const { result } = await created(null);
    assert.deepEqual(result, { none: true, message: "There is no text to make an issue from." });
  });

  test("missing or wrong settings say what to fix, and ask nothing", async () => {
    const cases = [
      [{ ...PREFS, project: "" }, undefined, "Add the project key for new issues, such as ENG, in Settings → Extensions → Jira."],
      [{ ...PREFS, project: "1ENG" }, undefined, "The project key in Settings must start with a letter and use only A–Z, 0–9 and _, such as ENG."],
      [{ ...PREFS, project: "EN G" }, undefined, "The project key in Settings must start with a letter and use only A–Z, 0–9 and _, such as ENG."],
      [{ ...PREFS, project: "ENG-1" }, undefined, "The project key in Settings must start with a letter and use only A–Z, 0–9 and _, such as ENG."],
      [{ ...PREFS, site: "" }, undefined, "Add your Jira site, such as yourteam.atlassian.net, in Settings → Extensions → Jira."],
      [PREFS, {}, "Add a Jira API token in Settings → Extensions → Jira. Make one at id.atlassian.com › Security › API tokens."],
      [{ ...PREFS, site: "your-domain.atlassian.com" }, undefined, "The Jira site must be a Jira Cloud address, such as yourteam.atlassian.net."],
    ];
    for (const [preferences, secrets, message] of cases) {
      const { result, requests } = await created(text("Something"), { preferences, secrets });
      assert.deepEqual(result, { none: true, message }, JSON.stringify(preferences));
      assert.equal(requests.length, 0);
    }
  });

  test("Jira's refusals become messages that name the setting to check", async () => {
    const cases = [
      [{ status: 400, json: { errorMessages: [], errors: { project: "Specify a valid project ID or key" } } }, "Jira has no project ENG you can create issues in. Check the project key in Settings."],
      [{ status: 400, json: { errorMessages: [], errors: { issuetype: "Specify a valid issue type" } } }, "Project ENG has no issue type “Task”. Check the issue type in Settings."],
      [{ status: 400, json: { errorMessages: [], errors: { customfield_10011: "Epic Name is required.", components: "Component/s is required." } } }, "Jira refused some fields for new issues in ENG (customfield_10011, components). Create this one in Jira."],
      [{ status: 400, json: { errorMessages: ["Field 'priority' is required"], errors: {} } }, "Jira refused some fields for new issues in ENG (priority). Create this one in Jira."],
      [{ status: 400, json: { errorMessages: [], errors: { description: "Field 'description' cannot be set. It is not on the appropriate screen, or unknown." } } }, "Jira refused some fields for new issues in ENG (description). Create this one in Jira."],
      [{ status: 400, json: { errorMessages: ["CONTENT_LIMIT_EXCEEDED"], errors: {} } }, "The text is too long for a Jira issue. Copy a shorter part, or create this one in Jira."],
      [{ status: 400, json: { errorMessages: [], errors: { description: "The entered text is too long. It exceeds the allowed limit of 32,767 characters." } } }, "The text is too long for a Jira issue. Copy a shorter part, or create this one in Jira."],
      [{ status: 400, json: { errorMessages: ["A CONTENT_LIMIT_EXCEEDED somewhere"], errors: {} } }, "Jira couldn’t create the issue (status 400)."],
      [{ status: 400, json: { errorMessages: ["Something about Fix the login button"], errors: { "a field with spaces": "x" } } }, "Jira couldn’t create the issue (status 400)."],
      [{ status: 400, text: "<html>Bad request</html>" }, "Jira couldn’t create the issue (status 400)."],
      [REJECTED, "Jira didn’t accept your email and API token. Check them in Settings → Extensions → Jira."],
      [{ status: 201, headers: { "x-seraph-loginreason": "AUTHENTICATED_FAILED" }, json: {} }, "Jira didn’t accept your email and API token. Check them in Settings → Extensions → Jira."],
      [{ status: 403, headers: { "x-seraph-loginreason": "AUTHENTICATION_DENIED" }, text: "" }, "Jira wants you to sign in on the web first. Sign in at your-domain.atlassian.net once, then try again."],
      [{ status: 403, json: { errorMessages: ["You do not have permission to create issues in this project."] } }, "Your Jira account can’t create issues in ENG."],
      [{ status: 404, text: "" }, "There is no Jira at your-domain.atlassian.net. Check the site in Settings → Extensions → Jira."],
      [{ status: 429, headers: { "retry-after": "30" }, text: "" }, "Jira is limiting requests right now. Try again in a minute."],
      [{ status: 503, text: "" }, "Jira isn’t answering right now (status 503). Try again later."],
      [{ status: 422, json: { errorMessages: ["Configuration problem"] } }, "Jira couldn’t create the issue (status 422)."],
      [{ status: 201, text: "" }, "Jira created the issue, but its answer couldn’t be read. Look for it in Jira."],
      [{ status: 201, json: { id: "10101", key: "eng-101" } }, "Jira created the issue, but its answer couldn’t be read. Look for it in Jira."],
    ];
    for (const [create, message] of cases) {
      const { result, requests } = await created(text("Fix the login button"), { jira: fakeJira({ create }) });
      assert.deepEqual(result, { none: true, message }, JSON.stringify(create));
      assert.equal(requests.length, 1, "a create is never sent twice");
    }
  });

  test("no connection is let through, and a cancel stops it", async () => {
    const extension = await newHelper();
    const offline = hostWith(extension, () => yabError("networkError", "offline"));
    await assert.rejects(offline.run(extension.actions.create, text("Something")), { code: "networkError" });
    const slow = hostWith(extension, () => new Promise(() => {}));
    const running = slow.run(extension.actions.create, text("Something"));
    setTimeout(() => slow.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("after a new issue the column asks Jira again", async () => {
    const extension = await newHelper();
    const jira = fakeJira();
    await hostWith(extension, jira).list("issues");
    await hostWith(extension, jira, { now: START + 1_000 }).run(extension.actions.create, text("Something"));
    const after = hostWith(extension, jira, { now: START + 2_000 });
    await after.list("issues");
    assert.equal(fetches(after).length, 1);
  });

  test("never runs as a hint: a request is an effect", async () => {
    const extension = await newHelper();
    const host = hostWith(extension, fakeJira());
    await assert.rejects(host.hint(extension.actions.create, text("Something")), { code: "permissionDenied" });
  });

  test("answers in Turkish", async () => {
    const { result } = await created(text("Something"), { jira: fakeJira({ create: { status: 400, json: { errors: { issuetype: "x" } } } }), language: "tr" });
    assert.deepEqual(result, { none: true, message: "ENG projesinde “Task” adında bir issue türü yok. Ayarlar’daki issue türünü kontrol et." });
    const long = await created(text(`a\n${"b".repeat(40_000)}`), { language: "tr" });
    const kept = new Intl.NumberFormat("tr").format(long.sent[0].fields.description.content[0].content[2].text.length + 2);
    assert.deepEqual(long.host.notifications, [`Metin uzun olduğu için issue’nun açıklamasına yalnızca ilk ${kept} karakteri sığdı.`]);
    const tooLong = await created(text("Something"), { jira: fakeJira({ create: { status: 400, json: { errorMessages: ["CONTENT_LIMIT_EXCEEDED"], errors: {} } } }), language: "tr" });
    assert.deepEqual(tooLong.result, { none: true, message: "Metin bir Jira issue’su için fazla uzun. Daha kısa bir bölümünü kopyala ya da bu issue’yu Jira’da oluştur." });
  });
});

describe("everywhere", () => {
  const text = (value) => ({ kind: "text", text: value });

  /** Every path through the column and the actions, each on a host of its own; resolves to the hosts and messages. */
  async function everyPath() {
    const hosts = [];
    const messages = [];
    const on = async (changes, work, options = {}) => {
      const extension = await newHelper();
      const host = hostWith(extension, typeof changes === "function" ? changes : fakeJira(changes), options);
      hosts.push(host);
      try {
        const result = await work(host, extension);
        if (typeof result?.message === "string") messages.push(result.message);
        if (typeof result?.text === "string") messages.push(result.text);
        if (typeof result?.link?.title === "string") messages.push(result.link.title, result.link.url);
      } catch (error) {
        messages.push(error.message, String(error.stack));
      }
    };
    const list = (host) => host.list("issues");
    await on({}, list);
    await on({}, list, { secrets: { apiToken: `${TOKEN}x` } });
    await on({}, list, { preferences: { ...PREFS, email: "" } });
    await on({ search: { status: 200, headers: { "x-seraph-loginreason": "AUTHENTICATED_FAILED" }, json: { issues: [] } } }, list);
    await on({ search: { status: 403, headers: { "x-seraph-loginreason": "AUTHENTICATION_DENIED" }, text: "" } }, list);
    await on({ search: { status: 429, headers: { "retry-after": "60" }, text: "" } }, list);
    await on({ search: { status: 500, text: `${TOKEN} ${EMAIL}` } }, list);
    await on({ search: { status: 400, json: { errorMessages: [`${EMAIL} ${TOKEN}`] } } }, list);
    await on({ search: { text: `not json ${TOKEN}` } }, list);
    await on(() => yabError("networkError", "offline"), list);
    await on({}, (host) => host.runSource("issues", "ENG-42", "link"));
    await on({}, (host) => host.runSource("issues", "ENG-42", "markdown"));
    await on({}, (host) => host.runSource("issues", "ENG-404", "markdown"));
    await on({}, (host) => host.runSource("issues", "ENG-42", "markdown"), { secrets: { apiToken: "wrong" } });
    await on({}, (host) => host.runSource("issues", "../x", "markdown"));
    await on({}, (host, extension) => host.run(extension.actions.keyLink, text("ENG-42")));
    await on({}, (host, extension) => host.run(extension.actions.create, text(`Leak check\n${TOKEN}`)));
    await on({}, (host, extension) => host.run(extension.actions.create, text("Leak check")), { secrets: { apiToken: "wrong" } });
    await on({ create: { status: 400, json: { errorMessages: [`Field '${TOKEN}' is required`], errors: { [EMAIL]: TOKEN } } } }, (host, extension) => host.run(extension.actions.create, text("Leak check")));
    await on({ create: { status: 500, text: TOKEN } }, (host, extension) => host.run(extension.actions.create, text("Leak check")));
    await on({ create: { status: 400, json: { errorMessages: ["CONTENT_LIMIT_EXCEEDED"], errors: { description: `The entered text is too long ${TOKEN}` } } } }, (host, extension) => host.run(extension.actions.create, text("Leak check")));
    await on({}, async (host) => (await host.list("issues"), host.list("issues")), { secrets: { apiToken: `${TOKEN}x` } });
    await on({}, (host, extension) => host.run(extension.actions.create, text(`a\n${"b".repeat(40_000)}`)));
    return { hosts, messages };
  }

  test("nothing is logged and nothing is stored", async () => {
    const { hosts } = await everyPath();
    for (const host of hosts) {
      assert.deepEqual(host.logs, []);
      assert.deepEqual(host.storage, {});
      assert.deepEqual(host.opened, []);
      assert.ok(host.calls.every((call) => call.api === "http.fetch" || call.api === "notify" || call.api === "secrets.get"), JSON.stringify(host.calls.map((call) => call.api)));
    }
  });

  test("no message, title or notice holds the token, the email or the sign-in header", async () => {
    const { hosts, messages } = await everyPath();
    const secret = Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64");
    const seen = [...messages, ...hosts.flatMap((host) => host.notifications)];
    assert.ok(seen.length > 20);
    for (const message of seen) {
      for (const needle of [TOKEN, EMAIL, secret, "Basic ", "deniz"]) assert.ok(!message.includes(needle), `${needle} in ${message}`);
    }
  });

  test("the token goes only to the site in Settings, over https", async () => {
    const { hosts } = await everyPath();
    for (const host of hosts) {
      for (const call of host.calls.filter((entry) => entry.api === "http.fetch")) {
        assert.ok(call.args[0].startsWith("https://your-domain.atlassian.net/rest/api/3/"), call.args[0]);
      }
    }
  });

  test("every request carries the call's signal", async () => {
    const extension = await newHelper();
    const host = hostWith(extension, fakeJira());
    const signals = [];
    const fetch = host.yab.http.fetch;
    host.yab.http.fetch = (url, init) => {
      signals.push(init?.signal);
      return fetch(url, init);
    };
    await host.list("issues");
    await settled(host.runSource("issues", "ENG-404", "markdown"));
    await host.run(extension.actions.create, text("Something"));
    assert.equal(signals.length, 3);
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  });

  test("the manifest asks for the network, for atlassian.net alone, and keeps the token a secret", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.permissions, ["network"]);
    assert.deepEqual(manifest.network, { domains: ["atlassian.net"] });
    assert.deepEqual(manifest.preferences.filter((preference) => preference.type === "secret").map((preference) => preference.id), ["apiToken"]);
    assert.equal(manifest.contributes.sources[0].sensitive, undefined);
    assert.ok(manifest.contributes.sources[0].actions.every((action) => action.kind === "text"));
    assert.equal(manifest.contributes.actions.find((action) => action.id === "create").hint, undefined);
  });

  test("every string has a Turkish version", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      const placeholders = (string) => [...String(string).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      assert.deepEqual(placeholders(tr[key]), placeholders(value), key);
    }
  });
});
