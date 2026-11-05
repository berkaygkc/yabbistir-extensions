// A fake Linear GraphQL API for the tests, answering the extension's four queries and one mutation in the shapes
// Linear documents (https://linear.app/developers/graphql, /rate-limiting): `{ data }` on success, `{ errors: [{
// message, path, extensions: { code, type, userPresentableMessage } }] }` on failure. All data is made up.

import assert from "node:assert/strict";

export const ENDPOINT = "https://api.linear.app/graphql";

// Built at run time, so no file holds a token-shaped literal.
export const KEY = ["lin", "api", "t".repeat(40)].join("_");
export const OTHER_KEY = ["lin", "api", "u".repeat(40)].join("_");

export const START = Date.parse("2026-11-04T09:00:00Z");

export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const urlOf = (identifier, slug) => `https://linear.app/ornek/issue/${identifier}/${slug}`;

export const TEAMS = [
  { id: uuid(901), key: "ENG", name: "Engineering" },
  { id: uuid(902), key: "DES", name: "Tasarım" },
];

/** Issues in a synthetic workspace; `mine` marks the viewer's. */
export const ISSUES = [
  { id: uuid(1), identifier: "ENG-101", title: "Login button does nothing on Safari", priority: 2, updatedAt: "2026-11-03T10:00:00.000Z",
    state: { name: "In Progress", type: "started" }, team: TEAMS[0], mine: true, slug: "login-button-does-nothing-on-safari" },
  { id: uuid(2), identifier: "ENG-102", title: "Use [brackets] *stars* and_underscores `ticks` <tags> \\ in titles", priority: 0,
    updatedAt: "2026-11-04T08:00:00.000Z", state: { name: "Todo", type: "unstarted" }, team: TEAMS[0], mine: true, slug: "use-brackets" },
  { id: uuid(3), identifier: "DES-7", title: "Ödeme ekranı ikonları", priority: 4, updatedAt: "2026-11-02T10:00:00.000Z",
    state: { name: "Backlog", type: "backlog" }, team: TEAMS[1], mine: true, slug: "odeme-ekrani-ikonlari" },
  { id: uuid(4), identifier: "ENG-90", title: "Shipped already", priority: 1, updatedAt: "2026-11-04T08:30:00.000Z",
    state: { name: "Done", type: "completed" }, team: TEAMS[0], mine: true, slug: "shipped-already" },
  { id: uuid(5), identifier: "ENG-91", title: "Won’t do", priority: 3, updatedAt: "2026-11-04T08:40:00.000Z",
    state: { name: "Canceled", type: "canceled" }, team: TEAMS[0], mine: true, slug: "wont-do" },
  { id: uuid(6), identifier: "ENG-92", title: "Same as ENG-101", priority: 3, updatedAt: "2026-11-04T08:50:00.000Z",
    state: { name: "Duplicate", type: "duplicate" }, team: TEAMS[0], mine: true, slug: "same-as-eng-101" },
  { id: uuid(7), identifier: "ENG-200", title: "Someone else’s issue", priority: 1, updatedAt: "2026-11-04T08:55:00.000Z",
    state: { name: "Todo", type: "unstarted" }, team: TEAMS[0], mine: false, slug: "someone-elses-issue" },
  { id: uuid(8), identifier: "ENG-103", title: "Triage me", priority: 1, updatedAt: "2026-11-01T10:00:00.000Z",
    state: { name: "Triage", type: "triage" }, team: TEAMS[0], mine: true, slug: "triage-me" },
];

/** The rows the column shows for ISSUES: the viewer's open issues, most recently updated first. */
export const ROWS = [
  { id: uuid(2), title: "ENG-102 Use [brackets] *stars* and_underscores `ticks` <tags> \\ in titles", subtitle: "Todo · Engineering" },
  { id: uuid(1), title: "ENG-101 Login button does nothing on Safari", subtitle: "In Progress · Engineering · High" },
  { id: uuid(3), title: "DES-7 Ödeme ekranı ikonları", subtitle: "Backlog · Tasarım · Low" },
  { id: uuid(8), title: "ENG-103 Triage me", subtitle: "Triage · Engineering · Urgent" },
];

/** A GraphQL error as Linear sends it. */
export const errorBody = (message, code, type, extra = {}) => ({
  errors: [{ message, extensions: { code, type, userError: true, userPresentableMessage: message }, ...extra }],
});
export const AUTH_ERROR = errorBody("Authentication required, not authenticated", "AUTHENTICATION_ERROR", "authentication error");
export const RATE_LIMITED = errorBody("Rate limit exceeded", "RATELIMITED", "ratelimited");
export const FORBIDDEN = errorBody("Forbidden: this API key has no access", "FORBIDDEN", "forbidden");
export const NOT_FOUND = {
  data: null,
  errors: [{ message: "Entity not found: Issue", path: ["issue"],
    extensions: { code: "INVALID_INPUT", type: "invalid input", userError: true, userPresentableMessage: "Could not find referenced Issue." } }],
};

const CLOSED = new Set(["completed", "canceled", "duplicate"]);
const project = (issue, fields) => Object.fromEntries(fields.map((field) => [field, issue[field]]));

/**
 * A fake Linear: `fake.http` is the fake host's `http` option, `fake.requests` every request it got (headers as the
 * extension wrote them, the body parsed), `fake.created` each new issue's input. `answer(request)` may answer a
 * request first; returning undefined lets Linear answer it.
 */
export function fakeLinear(changes = {}) {
  const state = { key: KEY, issues: ISSUES, teams: TEAMS, memberOf: [TEAMS[0].id], answer: undefined, next: 124, ...changes };
  const requests = [];
  const created = [];
  const http = ({ method, url, headers, body }) => {
    assert.equal(method, "POST");
    assert.equal(url, ENDPOINT);
    const request = { method, url, headers, body: JSON.parse(body) };
    requests.push(request);
    const early = state.answer?.(request);
    if (early !== undefined) return early;
    if (headers.authorization !== state.key) return { status: 401, json: AUTH_ERROR };

    const { query, variables } = request.body;
    if (query.startsWith("query MyIssues(")) {
      const nodes = state.issues
        .filter((issue) => issue.mine && !CLOSED.has(issue.state.type))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, variables.first)
        .map((issue) => ({ ...project(issue, ["id", "identifier", "title", "priority", "updatedAt"]),
          state: { name: issue.state.name }, team: { name: issue.team.name } }));
      return { json: { data: { viewer: { assignedIssues: { nodes } } } } };
    }
    if (query.startsWith("query Issue(")) {
      const issue = state.issues.find((candidate) => candidate.id === variables.id || candidate.identifier === variables.id);
      if (issue === undefined) return { json: NOT_FOUND };
      return { json: { data: { issue: { id: issue.id, identifier: issue.identifier, title: issue.title, url: urlOf(issue.identifier, issue.slug) } } } };
    }
    if (query.startsWith("query TeamByKey(")) {
      const nodes = state.teams.filter((team) => team.key.toLowerCase() === variables.key.toLowerCase()).map((team) => project(team, ["id", "key"]));
      return { json: { data: { teams: { nodes } } } };
    }
    if (query.startsWith("query MyTeams")) {
      const nodes = state.teams.filter((team) => state.memberOf.includes(team.id)).map((team) => project(team, ["id", "key"]));
      return { json: { data: { viewer: { teams: { nodes } } } } };
    }
    if (query.startsWith("mutation CreateIssue(")) {
      const team = state.teams.find((candidate) => candidate.id === variables.input.teamId);
      if (team === undefined) return { status: 400, json: errorBody("Argument Validation Error", "INVALID_INPUT", "invalid input") };
      created.push(variables.input);
      const identifier = `${team.key}-${state.next++}`;
      return { json: { data: { issueCreate: { success: true, issue: { id: uuid(500 + created.length), identifier, url: urlOf(identifier, "new-issue") } } } } };
    }
    return { status: 400, json: errorBody("Unknown query", "GRAPHQL_VALIDATION_FAILED", "graphql error") };
  };
  return { http, requests, created, state };
}

/** The operation names of the requests, in order: "MyIssues", "Issue", "TeamByKey", "MyTeams", "CreateIssue". */
export const operations = (fake) => fake.requests.map((request) => /^(?:query|mutation) (\w+)/.exec(request.body.query)?.[1]);
