import type { Actions, Context, HttpResponse, SourceRow, Sources } from "@yabbistir/api";

import { cutAt, draftOf, hasWords, oneLine, type Draft, DESCRIPTION_LIMIT } from "./draft.ts";

// Jira Cloud through its REST API v3, signed in with the person's email and an API token (HTTP basic auth). Requests
// go only to the site in Settings, which must be a *.atlassian.net address. The token is read with yab.secrets.get for
// the request that needs it, and neither it nor the email is ever logged, kept anywhere but in memory for that request,
// or put in a message: messages name the site, the project key and the issue type at most, never the item's text or
// Jira's own answer.

/**
 * The person's open issues, the most recently updated first. A status category rather than a resolution, so an issue
 * a workflow moves to a done status without setting a resolution is left out too.
 */
export const JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
/** The most rows the column lists; one page of the search. */
export const MAX_ROWS = 50;
/** The search answers with issue ids alone unless it is told which fields to send. */
const FIELDS = "summary,status,project";
/** How long a listing is reused: the panel opens often, and Jira limits how often it is asked. */
const LIFETIME = 60_000;
/** How long the summaries of a listing serve ⇧↵ before Jira is asked for the issue's summary again. */
const SUMMARY_LIFETIME = 5 * 60_000;
/** How long the column waits after Jira limited it without saying for how long, and the longest it ever waits. */
const DEFAULT_PAUSE = 60;
const LONGEST_PAUSE = 24 * 60 * 60;
/** A project key, then a number: ENG-42. Older sites may have keys with underscores. */
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[1-9][0-9]{0,8}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
/** The longest site setting read: anything longer is not a site. */
const PREFERENCE_LIMIT = 2_000;
const ATLASSIAN = ".atlassian.net";

// ---- Settings ----

const preference = (ctx: Context, id: string): string => {
  const value = ctx.preferences[id];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * The host of a Jira Cloud site as the person wrote it: "yourteam.atlassian.net", with or without https://, or any
 * link into the site. Undefined for anything else, including a user name, a port, or a host outside atlassian.net.
 */
export function siteHost(value: string): string | undefined {
  if (value === "" || value.length > PREFERENCE_LIMIT) return undefined;
  let url: URL;
  try {
    url = new URL(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) ? value : `https://${value}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "" || url.port !== "") return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(ATLASSIAN)) return undefined;
  const name = host.slice(0, -ATLASSIAN.length);
  if (name.length === 0 || name.length > 63 || !/^[a-z0-9-]+$/.test(name) || name.startsWith("-") || name.endsWith("-")) {
    return undefined;
  }
  return host;
}

const EMAIL = /^[^\s@:]{1,64}@[^\s@:]{1,255}$/;

/** UTF-8 bytes in Base64: btoa alone takes Latin-1 only, and an email may hold any letter. */
function base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface Account {
  host: string;
  /** Who the caches belong to: the site and the email, never the token. */
  owner: string;
  /** The Authorization header's value. Never logged and never kept beyond the call. */
  authorization: string;
}

/** The account in Settings, or the message that says what is missing or wrong. */
function accountOf(ctx: Context): Account | { problem: string } {
  const site = preference(ctx, "site");
  const email = preference(ctx, "email");
  const token = (yab.secrets.get("apiToken") ?? "").trim();
  const missing = [site, email, token].filter((value) => value === "").length;
  if (missing > 1) return { problem: yab.t("setup") };
  if (site === "") return { problem: yab.t("noSite") };
  if (email === "") return { problem: yab.t("noEmail") };
  if (token === "") return { problem: yab.t("noToken") };
  const host = siteHost(site);
  if (host === undefined) return { problem: yab.t("badSite") };
  if (!EMAIL.test(email)) return { problem: yab.t("badEmail") };
  return { host, owner: ownerOf(host, email), authorization: `Basic ${base64(`${email}:${token}`)}` };
}

const ownerOf = (host: string, email: string): string => `${host}\n${email.toLowerCase()}`;

/** The site's host, or the message that says why there is none. Links need the site alone, no sign-in. */
function hostOf(ctx: Context): string | { problem: string } {
  const site = preference(ctx, "site");
  if (site === "") return { problem: yab.t("noSite") };
  return siteHost(site) ?? { problem: yab.t("badSite") };
}

export const browseURL = (host: string, key: string): string => `https://${host}/browse/${key}`;

// ---- Requests ----

function request(account: Account, path: string, signal: AbortSignal, body?: unknown): Promise<HttpResponse> {
  const headers: Record<string, string> = { authorization: account.authorization, accept: "application/json" };
  if (body === undefined) return yab.http.fetch(`https://${account.host}${path}`, { headers, signal });
  headers["content-type"] = "application/json";
  return yab.http.fetch(`https://${account.host}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
}

/** The search for the column, as Jira's enhanced search takes it. */
export const searchPath = (): string =>
  `/rest/api/3/search/jql?jql=${encodeURIComponent(JQL)}&maxResults=${MAX_ROWS}&fields=${FIELDS}`;

type Failure = "credentials" | "captcha" | "forbidden" | "missing" | "rateLimited" | "unavailable" | "other";

/**
 * What went wrong with a request, or undefined when it worked. Jira Cloud may answer a request whose credentials it
 * rejected as if it came from no one (200, with nothing in it); its X-Seraph-LoginReason header is then the only sign,
 * so the header is read before the status. AUTHENTICATION_DENIED means Jira wants a CAPTCHA solved on the web first.
 */
function failureOf(response: HttpResponse): Failure | undefined {
  const reason = (response.headers["x-seraph-loginreason"] ?? "").toUpperCase();
  if (reason.includes("AUTHENTICATION_DENIED")) return "captcha";
  if (reason.includes("AUTHENTICATED_FAILED") || response.status === 401) return "credentials";
  if (response.status === 403) return "forbidden";
  if (response.status === 404) return "missing";
  if (response.status === 429) return "rateLimited";
  if (response.status >= 500) return "unavailable";
  if (response.status < 200 || response.status > 299) return "other";
  return undefined;
}

/** How many seconds Jira asked to wait, from Retry-After; a minute when it did not say. */
function pauseOf(response: HttpResponse): number {
  const value = (response.headers["retry-after"] ?? "").trim();
  return /^\d{1,9}$/.test(value) ? Math.min(Number(value), LONGEST_PAUSE) : DEFAULT_PAUSE;
}

function rateLimited(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? yab.t("rateLimited.minute") : yab.t("rateLimited.minutes", { minutes });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parsed(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
}

const stringIn = (value: unknown, key: string): string =>
  isObject(value) && typeof value[key] === "string" ? oneLine(value[key] as string) : "";

// ---- The column ----

interface Issue {
  key: string;
  summary: string;
  status: string;
  project: string;
}

/** The issues of a search answer, or undefined when it is not one. Issues without a well-formed key are left out. */
export function issuesOf(text: string | undefined): Issue[] | undefined {
  const body = parsed(text);
  if (!isObject(body) || !Array.isArray(body.issues)) return undefined;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const entry of body.issues) {
    if (issues.length === MAX_ROWS) break;
    if (!isObject(entry) || typeof entry.key !== "string" || !ISSUE_KEY.test(entry.key) || seen.has(entry.key)) continue;
    seen.add(entry.key);
    const fields = isObject(entry.fields) ? entry.fields : {};
    issues.push({
      key: entry.key,
      summary: stringIn(fields, "summary"),
      status: stringIn(fields.status, "name"),
      project: stringIn(fields.project, "name") || stringIn(fields.project, "key"),
    });
  }
  return issues;
}

const rowOf = (issue: Issue): SourceRow => {
  const subtitle = [issue.status, issue.project].filter((part) => part !== "").join(" · ");
  return { id: issue.key, title: issue.summary === "" ? issue.key : `${issue.key} ${issue.summary}`, subtitle: subtitle || undefined };
};

// The helper's memory only, never yab.storage or a file: the last listing for a minute, its summaries for ⇧↵ a little
// longer, and when Jira asked the column to wait. Each belongs to one site and email.
let cached: { at: number; owner: string; rows: SourceRow[]; summaries: Map<string, string> } | undefined;
let paused: { owner: string; until: number } | undefined;

function forget(): void {
  cached = undefined;
}

/** Characters that would end a Markdown link's text, start a tag, an entity, emphasis or a code span, or a table cell. */
const MARKDOWN_SPECIAL = /[\\`*_[\]<>&~|]/g;

/** `[ENG-42: Summary](link)`, every character of the text shown as it is; the key alone without a summary. */
export function markdownLink(key: string, summary: string, url: string): string {
  const text = summary === "" ? key : `${key}: ${summary}`;
  return `[${text.replace(MARKDOWN_SPECIAL, "\\$&")}](${url})`;
}

/** Why a request failed, as the column's locked row says it; undefined when it is no reason to lock. */
function lockMessage(failure: Failure, host: string): string | undefined {
  if (failure === "credentials") return yab.t("badCredentials");
  if (failure === "captcha") return yab.t("captcha", { site: host });
  if (failure === "forbidden") return yab.t("forbidden", { site: host });
  if (failure === "missing") return yab.t("noJira", { site: host });
  return undefined;
}

/**
 * An issue's summary for its Markdown link: from the last listing when it is recent, or else from Jira. Without one
 * (no settings, no connection, a busy or odd answer) the link carries the key alone; a rejected sign-in and an issue
 * that is gone say so instead.
 */
async function summaryFor(key: string, host: string, ctx: Context): Promise<string> {
  if (cached !== undefined && cached.owner === ownerOf(host, preference(ctx, "email"))) {
    const age = Date.now() - cached.at;
    const summary = cached.summaries.get(key);
    if (age >= 0 && age <= SUMMARY_LIFETIME && summary !== undefined) return summary;
  }
  const account = accountOf(ctx);
  if ("problem" in account) return "";
  let response: HttpResponse;
  try {
    response = await request(account, `/rest/api/3/issue/${key}?fields=summary`, ctx.signal);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "networkError") return "";
    throw error;
  }
  const failure = failureOf(response);
  if (failure === "credentials" || failure === "captcha") throw new Error(lockMessage(failure, account.host));
  if (failure === "missing") throw new Error(yab.t("issueGone", { key }));
  if (failure !== undefined) return "";
  const body = parsed(response.text);
  return isObject(body) && body.key === key ? stringIn(body.fields, "summary") : "";
}

export const sources: Sources = {
  issues: {
    async list(ctx) {
      const account = accountOf(ctx);
      if ("problem" in account) {
        forget();
        return { locked: true, message: account.problem };
      }
      const now = Date.now();
      // A listing of another account, or one too old even for a summary, is dropped rather than kept around.
      const age = cached === undefined ? Infinity : now - cached.at;
      if (cached !== undefined && (cached.owner !== account.owner || age < 0 || age > SUMMARY_LIFETIME)) cached = undefined;
      if (cached !== undefined && age <= LIFETIME) return { rows: cached.rows };
      // Jira asked to wait: the app keeps the rows it has, and Jira is not asked again until then.
      if (paused !== undefined && paused.owner === account.owner && now < paused.until) {
        throw new Error(rateLimited((paused.until - now) / 1000));
      }

      const response = await request(account, searchPath(), ctx.signal);
      const failure = failureOf(response);
      if (failure !== undefined) {
        const locked = lockMessage(failure, account.host);
        if (locked !== undefined) {
          forget();
          return { locked: true, message: locked };
        }
        if (failure === "rateLimited") {
          const seconds = pauseOf(response);
          paused = { owner: account.owner, until: now + seconds * 1000 };
          throw new Error(rateLimited(seconds));
        }
        throw new Error(yab.t(failure === "unavailable" ? "unavailable" : "listFailed", { status: response.status }));
      }
      const issues = issuesOf(response.text);
      if (issues === undefined) throw new Error(yab.t("unreadable"));
      paused = undefined;
      const rows = issues.map(rowOf);
      cached = { at: now, owner: account.owner, rows, summaries: new Map(issues.map((issue) => [issue.key, issue.summary])) };
      return { rows };
    },

    async run(rowId, actionId, ctx) {
      // Row ids are issue keys, so nothing else reaches a link or a request.
      if (!ISSUE_KEY.test(rowId) || (actionId !== "link" && actionId !== "markdown")) throw new Error(yab.t("notARow"));
      const host = hostOf(ctx);
      if (typeof host !== "string") throw new Error(host.problem);
      const url = browseURL(host, rowId);
      if (actionId === "link") return { text: url };
      return { text: markdownLink(rowId, await summaryFor(rowId, host, ctx), url) };
    },
  },
};

// ---- Actions ----

/** Why Jira refused a new issue, from the field names of its 400 answer; never from its messages, which may quote. */
function refusal(text: string | undefined, project: string, issueType: string): string {
  const body = parsed(text);
  const errors = isObject(body) && isObject(body.errors) ? Object.keys(body.errors) : [];
  if (errors.includes("project") || errors.includes("pid")) return yab.t("projectRefused", { project });
  if (errors.includes("issuetype")) return yab.t("issueTypeRefused", { project, issueType });
  const fields = new Set(errors.filter((name) => /^[A-Za-z0-9_.-]{1,40}$/.test(name)));
  const messages = isObject(body) && Array.isArray(body.errorMessages) ? body.errorMessages : [];
  for (const message of messages) {
    const field = typeof message === "string" ? /^Field '([A-Za-z0-9_.-]{1,40})' is required\.?$/.exec(message)?.[1] : undefined;
    if (field !== undefined) fields.add(field);
  }
  if (fields.size > 0) return yab.t("fieldsRefused", { project, fields: [...fields].slice(0, 3).join(", ") });
  return yab.t("createFailed", { status: 400 });
}

/** "30,000" in the app's language. */
function formatted(value: number, language: string): string {
  try {
    return new Intl.NumberFormat(language).format(value);
  } catch {
    return String(value);
  }
}

/** The fields of a new issue, as Jira's create issue takes them. */
export function fieldsOf(draft: Draft, project: string, issueType: string): Record<string, unknown> {
  const fields: Record<string, unknown> = { project: { key: project }, issuetype: { name: issueType }, summary: draft.summary };
  if (draft.description !== undefined) fields.description = draft.description;
  return fields;
}

export const actions: Actions = {
  keyLink: {
    // Needs only the site: it runs as a hint too, and the link it shows is the one pasted.
    run(item, ctx) {
      const key = (item?.text ?? "").trim();
      if (!ISSUE_KEY.test(key)) return { none: true, message: yab.t("notAKey") };
      const host = hostOf(ctx);
      if (typeof host !== "string") return { none: true, message: host.problem };
      return { link: { url: browseURL(host, key), title: key } };
    },
  },

  create: {
    async run(item, ctx) {
      const text = item?.text ?? "";
      const draft = hasWords(text) ? draftOf(text, item?.kind) : undefined;
      if (draft === undefined) return { none: true, message: yab.t("empty") };
      const account = accountOf(ctx);
      if ("problem" in account) return { none: true, message: account.problem };
      const project = preference(ctx, "project").toUpperCase();
      if (project === "") return { none: true, message: yab.t("noProject") };
      if (!PROJECT_KEY.test(project)) return { none: true, message: yab.t("badProject") };
      // Jira's issue type names are at most 60 characters.
      const issueType = cutAt(oneLine(preference(ctx, "issueType")), 60) || "Task";

      // Never sent twice: a create that failed half way may still have made the issue.
      const response = await request(account, "/rest/api/3/issue", ctx.signal, { fields: fieldsOf(draft, project, issueType) });
      const failure = failureOf(response);
      if (failure === "credentials" || failure === "captcha") return { none: true, message: lockMessage(failure, account.host) };
      if (failure === "forbidden") return { none: true, message: yab.t("cannotCreate", { project }) };
      if (failure === "missing") return { none: true, message: yab.t("noJira", { site: account.host }) };
      if (failure === "rateLimited") return { none: true, message: rateLimited(pauseOf(response)) };
      if (failure === "unavailable") return { none: true, message: yab.t("unavailable", { status: response.status }) };
      if (failure === "other") {
        return { none: true, message: response.status === 400 ? refusal(response.text, project, issueType) : yab.t("createFailed", { status: response.status }) };
      }

      const body = parsed(response.text);
      const key = isObject(body) && typeof body.key === "string" && ISSUE_KEY.test(body.key) ? body.key : undefined;
      if (key === undefined) return { none: true, message: yab.t("createdUnreadable") };
      // The column asks Jira again next time, in case the new issue is assigned to the person.
      forget();
      if (draft.cut) yab.notify(yab.t("cut", { limit: formatted(DESCRIPTION_LIMIT, ctx.language) }));
      return { link: { url: browseURL(account.host, key), title: `${key}: ${draft.summary}` } };
    },
  },
};
