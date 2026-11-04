import type { Actions, Context, Result, SourceListing, SourceRow, Sources } from "@yabbistir/api";

import type { Failure } from "./linear.ts";
import {
  CREATE_ISSUE,
  ISSUE,
  ISSUE_ID,
  MY_ISSUES,
  MY_TEAMS,
  TEAM_BY_KEY,
  apiKey,
  createdIssue,
  graphql,
  linkedIssue,
  listedIssues,
  teamIds,
} from "./linear.ts";
import { descriptionOf, issueKeyOf, looksLikeCode, markdownLink, rowTitle, teamKeyOf, titleOf } from "./text.ts";

// Linear in yabbistir: the person's open issues as a column, an issue key turned into a Markdown link, and a copy
// turned into a new issue. The API key is read with yab.secrets.get when a call needs it, sent only to
// api.linear.app in the Authorization header, and never logged, kept or put in a message. Nothing here writes to the
// console, and every message is the extension's own: none of Linear's text reaches a notice.

/** How many open issues the column lists. */
export const LIST_LIMIT = 50;
/** How long a listing is reused: the panel opens often, and Linear allows an API key 2,500 requests an hour. */
export const LIFETIME = 60_000;
/** Where a personal API key is made: Linear's Settings › Security & access. */
export const KEY_PAGE = "https://linear.app/settings/account/security";

// The helper's memory only, never yab.storage or a file: the last rows, with a fingerprint of the key they were
// listed with, so a new key never shows the old one's issues.
let cached: { at: number; key: number; rows: SourceRow[] } | undefined;

/** FNV-1a over the key: tells one key from another without keeping it. */
function fingerprint(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}

/** The column's one calm row; ↵ or ⌘C on it copies a command that opens the page where API keys are made. */
function locked(message: string): SourceListing {
  cached = undefined;
  return { locked: true, message: yab.t(message), command: `open ${KEY_PAGE}` };
}

/** The person's words for a failed request. `failed` covers what Linear refused without saying why. */
function messageFor(failure: Failure, failed: string, special: { notFound?: string; forbidden?: string } = {}): string {
  switch (failure.kind) {
    case "badKey":
      return yab.t("badKey");
    case "forbidden":
      return special.forbidden ?? yab.t("forbidden");
    case "rateLimited":
      return failure.minutes === undefined ? yab.t("rateLimitedSoon") : yab.t("rateLimited", { minutes: failure.minutes });
    case "notFound":
      return special.notFound ?? failed;
    case "server":
      return yab.t("serverDown", { status: failure.status });
    case "unreadable":
      return yab.t("unreadable");
    case "failed":
      return failed;
  }
}

const none = (message: string): Result => ({ none: true, message });

/** "In Progress · Engineering · High": the parts Linear has, priority only when one is set. */
function subtitleOf(state: string, team: string, priority: number): string | undefined {
  const label = priority >= 1 && priority <= 4 && Number.isInteger(priority) ? yab.t(`priority.${priority}`) : "";
  const parts = [state.trim(), team.trim(), label].filter((part) => part !== "");
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** The team new issues go to: the one in Settings, or the viewer's only team; a message when neither is there. */
async function teamFor(key: string, ctx: Context): Promise<{ id: string } | { message: string }> {
  const typed = ctx.preferences.team;
  if (typeof typed !== "string" || typed.trim() === "") {
    const answer = await graphql(key, MY_TEAMS, {}, ctx.signal);
    if ("failure" in answer) return { message: messageFor(answer.failure, yab.t("teamFailed")) };
    const ids = teamIds(answer.data, "viewer", "teams");
    if (ids === undefined) return { message: yab.t("unreadable") };
    return ids.length === 1 ? { id: ids[0] } : { message: yab.t("noTeam") };
  }
  // The typed value is never echoed: a key pasted into the wrong field would show up in a notice.
  const teamKey = teamKeyOf(typed);
  if (teamKey === undefined) return { message: yab.t("badTeamKey") };
  const answer = await graphql(key, TEAM_BY_KEY, { key: teamKey }, ctx.signal);
  if ("failure" in answer) return { message: messageFor(answer.failure, yab.t("teamFailed")) };
  const ids = teamIds(answer.data, "teams");
  if (ids === undefined) return { message: yab.t("unreadable") };
  return ids.length === 0 ? { message: yab.t("teamNotFound", { team: teamKey }) } : { id: ids[0] };
}

/** "Cut to the first 50,000 characters.", the number in the app's language. */
function cutNote(limit: number, language: string): string {
  let count: string;
  try {
    count = new Intl.NumberFormat(language).format(limit);
  } catch {
    count = String(limit);
  }
  return yab.t("cut", { count });
}

export const actions: Actions = {
  link: {
    async run(item, ctx) {
      const issueKey = issueKeyOf(item?.url ?? item?.text ?? "");
      if (issueKey === undefined) return none(yab.t("noIssueKey"));
      const key = apiKey();
      if (key === undefined) return none(yab.t("noKey"));
      const answer = await graphql(key, ISSUE, { id: issueKey }, ctx.signal);
      if ("failure" in answer) {
        return none(messageFor(answer.failure, yab.t("lookupFailed", { issue: issueKey }), { notFound: yab.t("notFound", { issue: issueKey }) }));
      }
      const issue = linkedIssue(answer.data);
      if (issue === undefined) return none(answer.data.issue === null ? yab.t("notFound", { issue: issueKey }) : yab.t("unreadable"));
      return { text: markdownLink(issue) };
    },
  },

  create: {
    async run(item, ctx) {
      const text = item?.text ?? "";
      if (!/[\p{L}\p{N}]/u.test(text)) return none(yab.t("emptyText"));
      const key = apiKey();
      if (key === undefined) return none(yab.t("noKey"));
      const team = await teamFor(key, ctx);
      if ("message" in team) return none(team.message);

      const code = item?.kind === "code" || looksLikeCode(text);
      const input = {
        teamId: team.id,
        title: titleOf(text),
        description: descriptionOf(text, code, (limit) => cutNote(limit, ctx.language)),
      };
      const answer = await graphql(key, CREATE_ISSUE, { input }, ctx.signal);
      if ("failure" in answer) return none(messageFor(answer.failure, yab.t("notCreated"), { forbidden: yab.t("cantCreate") }));
      const created = createdIssue(answer.data);
      if (created === undefined) return none(yab.t("notCreated"));
      // The new issue may be the person's own (a team can assign new issues to their creator): list again next time.
      cached = undefined;
      yab.notify(yab.t("created", { issue: created.identifier }));
      return { text: created.url };
    },
  },
};

export const sources: Sources = {
  issues: {
    async list(ctx) {
      const key = apiKey();
      if (key === undefined) return locked("noKey");
      const print = fingerprint(key);
      const age = cached === undefined ? Infinity : Date.now() - cached.at;
      if (cached !== undefined && cached.key === print && age >= 0 && age <= LIFETIME) return { rows: cached.rows };

      const answer = await graphql(key, MY_ISSUES, { first: LIST_LIMIT }, ctx.signal);
      if ("failure" in answer) {
        if (answer.failure.kind === "badKey") return locked("badKey");
        if (answer.failure.kind === "forbidden") return locked("cantRead");
        // The app keeps the rows it has and says the list could not be read; the message goes to the log.
        throw new Error(messageFor(answer.failure, yab.t("listFailed")));
      }
      const issues = listedIssues(answer.data);
      if (issues === undefined) throw new Error(yab.t("unreadable"));

      // Linear sorts by updatedAt already; sorting again keeps "newest first" whatever order the page comes in.
      issues.sort((a, b) => b.updatedAt - a.updatedAt);
      const seen = new Set<string>();
      const rows: SourceRow[] = [];
      for (const issue of issues) {
        if (seen.has(issue.id) || rows.length >= LIST_LIMIT) continue;
        seen.add(issue.id);
        rows.push({ id: issue.id, title: rowTitle(issue.identifier, issue.title), subtitle: subtitleOf(issue.state, issue.team, issue.priority) });
      }
      cached = { at: Date.now(), key: print, rows };
      return { rows };
    },

    async run(rowId, actionId, ctx) {
      const key = apiKey();
      if (key === undefined) throw new Error(yab.t("noKey"));
      // Ids are Linear's own: anything else never reaches the request.
      if ((actionId !== "url" && actionId !== "markdown") || !ISSUE_ID.test(rowId)) throw new Error(yab.t("issueGone"));
      // Fetched again rather than kept from the list: a value lives for its run only, and a renamed issue reads right.
      const answer = await graphql(key, ISSUE, { id: rowId }, ctx.signal);
      if ("failure" in answer) {
        if (answer.failure.kind === "badKey") cached = undefined;
        throw new Error(messageFor(answer.failure, yab.t("readFailed"), { notFound: yab.t("issueGone") }));
      }
      const issue = linkedIssue(answer.data);
      if (issue === undefined) throw new Error(answer.data.issue === null ? yab.t("issueGone") : yab.t("unreadable"));
      return { text: actionId === "url" ? issue.url : markdownLink(issue) };
    },
  },
};
