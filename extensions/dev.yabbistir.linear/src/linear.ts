import type { HttpResponse } from "@yabbistir/api";

// Linear's GraphQL API (https://linear.app/developers/graphql): one endpoint, a POST with a JSON body, and the
// personal API key as the Authorization header, without "Bearer" (that prefix is for OAuth tokens). Everything the
// extension asks of Linear is in the four documents below, and every answer goes through `answerOf`.

export const ENDPOINT = "https://api.linear.app/graphql";

/** Open issues are those whose state is of none of these types; the rest are triage, backlog, unstarted, started. */
const CLOSED_STATE_TYPES = ["completed", "canceled", "duplicate"];

/** The viewer's open issues, most recently updated first. */
export const MY_ISSUES = `query MyIssues($first: Int!) {
  viewer {
    assignedIssues(first: $first, orderBy: updatedAt, filter: { state: { type: { nin: ${JSON.stringify(CLOSED_STATE_TYPES)} } } }) {
      nodes { id identifier title priority updatedAt state { name } team { name } }
    }
  }
}`;

/** One issue, by its id or by its identifier (`issue(id: "ENG-123")` takes either). */
export const ISSUE = `query Issue($id: String!) {
  issue(id: $id) { id identifier title url }
}`;

/** A team by its key, whatever its case. */
export const TEAM_BY_KEY = `query TeamByKey($key: String!) {
  teams(first: 1, filter: { key: { eqIgnoreCase: $key } }) { nodes { id key } }
}`;

/** The teams the viewer is a member of: two are enough to tell whether there is only one. */
export const MY_TEAMS = `query MyTeams {
  viewer { teams(first: 2) { nodes { id key } } }
}`;

export const CREATE_ISSUE = `mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}`;

/** Why a request did not give data. Messages are the caller's: none of Linear's own text is kept. */
export type Failure =
  | { kind: "badKey" }
  | { kind: "forbidden" }
  | { kind: "rateLimited"; minutes: number | undefined }
  | { kind: "notFound" }
  | { kind: "server"; status: number }
  | { kind: "failed" }
  | { kind: "unreadable" };

export type Answer = { data: Record<string, unknown> } | { failure: Failure };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The person's API key, or undefined when there is none. Whitespace is dropped (a key pasted with a line end) and so
 * is a "Bearer " someone typed in front of it.
 */
export function apiKey(): string | undefined {
  const key = (yab.secrets.get("apiKey") ?? "").trim().replace(/^Bearer\s/i, "").replace(/\s/g, "");
  return key === "" ? undefined : key;
}

type ErrorKind = "rateLimited" | "badKey" | "forbidden" | "notFound" | "other";

/**
 * What one GraphQL error is about, from its `extensions` (`code` such as "RATELIMITED", or `type` such as
 * "authentication error", as Linear's SDK reads it) or, for a missing entity, its message ("Entity not found: Issue").
 */
function errorKind(error: unknown): ErrorKind {
  if (!isRecord(error)) return "other";
  const extensions = isRecord(error.extensions) ? error.extensions : {};
  const code = typeof extensions.code === "string" ? extensions.code.toUpperCase() : "";
  const type = typeof extensions.type === "string" ? extensions.type.toLowerCase() : "";
  const message = typeof error.message === "string" ? error.message.slice(0, 200) : "";
  if (code === "RATELIMITED" || type === "ratelimited") return "rateLimited";
  if (code === "AUTHENTICATION_ERROR" || type === "authentication error") return "badKey";
  if (code === "FORBIDDEN" || type === "forbidden") return "forbidden";
  if (code === "NOT_FOUND" || type === "not found" || /\bnot found\b/i.test(message)) return "notFound";
  return "other";
}

/** The rate-limit windows Linear reports, as `[remaining, reset]` header names; a reset is in UTC epoch milliseconds. */
const WINDOWS = [
  ["x-ratelimit-requests-remaining", "x-ratelimit-requests-reset"],
  ["x-ratelimit-endpoint-requests-remaining", "x-ratelimit-endpoint-requests-reset"],
  ["x-ratelimit-complexity-remaining", "x-ratelimit-complexity-reset"],
] as const;

/** Whole minutes until Linear takes requests again (1 to 60), or undefined when its headers don't say. */
export function waitOf(headers: Record<string, string>, now: number): number | undefined {
  const minutes = (ms: number) => Math.min(60, Math.max(1, Math.ceil(ms / 60_000)));
  const retryAfter = Number(headers["retry-after"]);
  if (headers["retry-after"] !== undefined && Number.isFinite(retryAfter) && retryAfter > 0) return minutes(retryAfter * 1000);
  let latest: number | undefined;
  for (const [remaining, reset] of WINDOWS) {
    const left = Number(headers[remaining]);
    const at = Number(headers[reset]);
    if (headers[remaining] === undefined || headers[reset] === undefined || !(left <= 0) || !Number.isFinite(at)) continue;
    if (at > now && (latest === undefined || at > latest)) latest = at;
  }
  return latest === undefined ? undefined : minutes(latest - now);
}

/** Linear's answer to one request: its data, or why there is none. */
export function answerOf(response: HttpResponse, now: number): Answer {
  let body: unknown;
  try {
    body = JSON.parse(response.text ?? "");
  } catch {
    body = undefined;
  }
  const errors: unknown[] = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  const kinds = new Set(errors.map(errorKind));
  const status = response.status;
  if (status === 429 || kinds.has("rateLimited")) return { failure: { kind: "rateLimited", minutes: waitOf(response.headers ?? {}, now) } };
  if (status === 401 || kinds.has("badKey")) return { failure: { kind: "badKey" } };
  if (status === 403 || kinds.has("forbidden")) return { failure: { kind: "forbidden" } };
  if (kinds.has("notFound")) return { failure: { kind: "notFound" } };
  if (status >= 500) return { failure: { kind: "server", status } };
  if (errors.length > 0 || status < 200 || status > 299) return { failure: { kind: "failed" } };
  if (!isRecord(body) || !isRecord(body.data)) return { failure: { kind: "unreadable" } };
  return { data: body.data };
}

/**
 * Sends one GraphQL document to Linear with the key. The key goes in the Authorization header and nowhere else. A
 * failed connection rejects with "networkError" and a cancelled call with "cancelled": both are let through.
 */
export async function graphql(key: string, query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<Answer> {
  const response = await yab.http.fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: key },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  return answerOf(response, Date.now());
}

/** The value at `path` in `data`, or undefined when a step is missing. */
export function at(data: unknown, ...path: string[]): unknown {
  let value = data;
  for (const step of path) {
    if (!isRecord(value)) return undefined;
    value = value[step];
  }
  return value;
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Linear's ids are UUIDs; a row's id is checked against this before it is sent back. */
export const ISSUE_ID = /^[0-9A-Za-z-]{1,64}$/;

/** An issue's link as Linear gives it, or undefined when it is not an https link. */
function linkOf(value: unknown): string | undefined {
  const url = text(value);
  if (url === undefined) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export interface ListedIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  updatedAt: number;
  state: string;
  team: string;
}

/** The issues in a MY_ISSUES answer, or undefined when it has no list of them. Malformed issues are left out. */
export function listedIssues(data: Record<string, unknown>): ListedIssue[] | undefined {
  const nodes = at(data, "viewer", "assignedIssues", "nodes");
  if (!Array.isArray(nodes)) return undefined;
  const issues: ListedIssue[] = [];
  for (const node of nodes) {
    const id = text(at(node, "id"));
    const identifier = text(at(node, "identifier"))?.trim();
    if (id === undefined || !ISSUE_ID.test(id) || identifier === undefined || !/\S/.test(identifier)) continue;
    const priority = at(node, "priority");
    const updatedAt = Date.parse(text(at(node, "updatedAt")) ?? "");
    issues.push({
      id,
      identifier,
      title: text(at(node, "title")) ?? "",
      priority: typeof priority === "number" ? priority : 0,
      updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt,
      state: text(at(node, "state", "name")) ?? "",
      team: text(at(node, "team", "name")) ?? "",
    });
  }
  return issues;
}

export interface LinkedIssue {
  identifier: string;
  title: string;
  url: string;
}

/** The issue in an ISSUE answer, or undefined when it lacks an identifier or an https link. */
export function linkedIssue(data: Record<string, unknown>): LinkedIssue | undefined {
  const identifier = text(at(data, "issue", "identifier"))?.trim();
  const url = linkOf(at(data, "issue", "url"));
  if (identifier === undefined || identifier === "" || url === undefined) return undefined;
  return { identifier, title: text(at(data, "issue", "title")) ?? "", url };
}

/** The ids of the teams at `path`, or undefined when there is no list there. */
export function teamIds(data: Record<string, unknown>, ...path: string[]): string[] | undefined {
  const nodes = at(data, ...path, "nodes");
  if (!Array.isArray(nodes)) return undefined;
  return nodes.map((node) => text(at(node, "id"))).filter((id): id is string => id !== undefined && id !== "");
}

/** The new issue in a CREATE_ISSUE answer, or undefined when Linear did not say it made one. */
export function createdIssue(data: Record<string, unknown>): { identifier: string; url: string } | undefined {
  if (at(data, "issueCreate", "success") !== true) return undefined;
  const identifier = text(at(data, "issueCreate", "issue", "identifier"))?.trim();
  const url = linkOf(at(data, "issueCreate", "issue", "url"));
  if (identifier === undefined || identifier === "" || url === undefined) return undefined;
  return { identifier, url };
}
