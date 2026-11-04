import type { Actions, SourceRow, Sources } from "@yabbistir/api";

// GitHub through the official gh command-line tool, which signs in on its own: this extension never sees a token. The
// column lists open pull requests and issues that wait on the person; an action shares copied text as a gist.

/** The most rows of each group; a search is one call each, so this keeps the listing quick. */
const PER_GROUP = 25;
/** How long a listing is reused: the panel opens often, and GitHub limits searches to 30 a minute. */
const LIFETIME = 60_000;
/** A row id is at most 256 characters. */
const MAX_ID = 256;
/** The first part of a row id, and the only links a row holds: owner, repository, kind and number. */
const ITEM_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues)\/(\d+)$/;
/** A row id: the link, a space and the title. Stateless, so a restarted helper still pastes what the row shows. */
const ROW_ID = /^(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pull|issues)\/\d+) (.+)$/;
/** The same, for a link a person copied: query and fragment are allowed and dropped. */
const COPIED_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:pull|issues)\/(\d+)(?:[/?#].*)?$/;
/** The line gh gist create prints to standard output when it is done. */
const GIST_URL = /^https:\/\/gist\.github\.com\/\S+$/;

interface Group {
  label: (draft: boolean) => string;
  args: string[];
  fields: string;
}

/** `@me` is the signed-in user, resolved by GitHub; the rest is fixed. */
const GROUPS: Group[] = [
  { label: () => yab.t("group.review"), fields: "url,title", args: ["search", "prs", "--review-requested=@me", "--state=open", "--archived=false"] },
  { label: (draft) => yab.t(draft ? "group.draft" : "group.mine"), fields: "url,title,isDraft", args: ["search", "prs", "--author=@me", "--state=open", "--archived=false"] },
  { label: () => yab.t("group.assigned"), fields: "url,title", args: ["search", "issues", "--assignee=@me", "--state=open", "--archived=false"] },
];

// The helper's memory only, never yab.storage or a file: the last rows, for a minute.
let cached: { at: number; rows: SourceRow[] } | undefined;

/** A title on one line. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** gh was not signed in: exit code 4 is "requires authentication", and its message names `gh auth login`. */
function signedOut(result: { exitCode: number; stderr: string }): boolean {
  return result.exitCode === 4 || /gh auth login|HTTP 401/.test(result.stderr);
}

/** The rows of one group from `--json` output; undefined when gh printed something else. */
function rowsOf(stdout: string, group: Group): SourceRow[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const rows: SourceRow[] = [];
  for (const entry of parsed.slice(0, PER_GROUP)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { url, title, isDraft } = entry as { url?: unknown; title?: unknown; isDraft?: unknown };
    if (typeof url !== "string" || typeof title !== "string") continue;
    const match = ITEM_URL.exec(url);
    const text = oneLine(title);
    if (match === null || text === "") continue;
    const [, owner, repo, , number] = match;
    // A long title is cut in the id (never in the row's title) to keep the id within its limit.
    const room = MAX_ID - url.length - 1;
    const kept = text.length <= room ? text : `${text.slice(0, room - 1).trimEnd()}…`;
    rows.push({ id: `${url} ${kept}`, title: text, subtitle: `${group.label(isDraft === true)} · ${owner}/${repo} #${number}` });
  }
  return rows;
}

/** What a row id holds, or undefined when it is not one of ours. */
function parseRow(rowId: string): { url: string; title: string; reference: string } | undefined {
  const parts = ROW_ID.exec(rowId);
  if (parts === null) return undefined;
  const match = ITEM_URL.exec(parts[1] ?? "");
  if (match === null) return undefined;
  return { url: parts[1] ?? "", title: parts[2] ?? "", reference: `${match[1]}/${match[2]}#${match[4]}` };
}

/** A title inside the brackets of a Markdown link: backslash and brackets would end or bend it. */
const markdownText = (text: string): string => text.replace(/[\\[\]]/g, "\\$&");

export const sources: Sources = {
  work: {
    async list(ctx) {
      if (cached !== undefined) {
        const age = Date.now() - cached.at;
        if (age >= 0 && age <= LIFETIME) return { rows: cached.rows };
      }
      const results = await Promise.all(
        GROUPS.map((group) =>
          yab.exec("gh", [...group.args, "--sort=updated", `--limit=${PER_GROUP}`, `--json=${group.fields}`], { signal: ctx.signal }),
        ),
      );
      if (results.some(signedOut)) {
        cached = undefined;
        return { locked: true, message: yab.t("locked"), command: "gh auth login" };
      }
      const rows: SourceRow[] = [];
      const seen = new Set<string>();
      for (const [index, result] of results.entries()) {
        const group = GROUPS[index];
        const listed = result.exitCode === 0 && group !== undefined ? rowsOf(result.stdout, group) : undefined;
        if (listed === undefined) throw new Error(yab.t("listFailed"));
        for (const row of listed) {
          const link = row.id.slice(0, row.id.indexOf(" "));
          if (seen.has(link)) continue;
          seen.add(link);
          rows.push(row);
        }
      }
      cached = { at: Date.now(), rows };
      return { rows };
    },

    run(rowId, actionId) {
      const row = parseRow(rowId);
      if (row === undefined) throw new Error(yab.t("linkFailed"));
      if (actionId === "link") return { text: row.url };
      if (actionId === "markdown") return { text: `[${markdownText(`${row.reference}: ${row.title}`)}](${row.url})` };
      throw new Error(yab.t("linkFailed"));
    },
  },
};

/** A file extension for copied text, by a few plain signs; `.txt` when nothing is sure. */
function extensionFor(kind: string | undefined, text: string): string {
  if (kind !== "code") return "txt";
  const trimmed = text.trim();
  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not JSON after all: look at the other signs.
    }
  }
  const shebang = /^#!.*\b(bash|zsh|sh|python3?|node|ruby)\b/.exec(trimmed);
  if (shebang !== null) return { python: "py", python3: "py", node: "js", ruby: "rb" }[shebang[1] ?? ""] ?? "sh";
  if (/^<!doctype html|^<html[\s>]/i.test(trimmed)) return "html";
  if (/^<\?xml/i.test(trimmed)) return "xml";
  if (/^import (SwiftUI|Foundation|AppKit|UIKit)\b|^\s*(func|struct|guard let)\s/m.test(trimmed)) return "swift";
  if (/^(def|class) \w+.*:\s*$|^from \w+ import /m.test(trimmed)) return "py";
  if (/^\s*(interface|type) \w+|:\s*(string|number|boolean)\b/m.test(trimmed) && /\b(const|let|function|export|import)\b/.test(trimmed)) return "ts";
  if (/^\s*(const|let|function|export|import)\b|=>/m.test(trimmed)) return "js";
  return "txt";
}

export const actions: Actions = {
  reference: {
    run(item) {
      const match = COPIED_URL.exec((item?.url ?? item?.text ?? "").trim());
      if (match === null) return { none: true, message: yab.t("notReference") };
      return { text: `${match[1]}/${match[2]}#${match[3]}` };
    },
  },

  gist: {
    async run(item, ctx) {
      const text = item?.text ?? "";
      if (text.trim() === "") return { none: true, message: yab.t("empty") };
      const path = yab.files.write(`clipboard.${extensionFor(item?.kind, text)}`, text);
      // Secret is gh's own default; --public is the one deliberate step away from it.
      const args = ["gist", "create", "--desc", yab.t("gist.description"), ...(ctx.variant === "public" ? ["--public"] : []), path];
      const result = await yab.exec("gh", args, { signal: ctx.signal });
      // Expected failures are a calm notice, not a thrown error: three thrown errors in a row turn an extension off.
      if (signedOut(result)) return { none: true, message: yab.t("signedOut") };
      if (result.exitCode !== 0) return { none: true, message: yab.t("gistFailed") };
      const url = result.stdout.split("\n").map((line) => line.trim()).reverse().find((line) => GIST_URL.test(line));
      if (url === undefined) return { none: true, message: yab.t("gistFailed") };
      return { text: url };
    },
  },
};
