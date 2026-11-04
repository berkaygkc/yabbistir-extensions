import type { Actions, SourceRow, Sources } from "@yabbistir/api";

// GitHub through the official gh command-line tool, which signs in on its own: this extension never sees a token. The
// column lists open pull requests and issues that wait on the person; an action shares copied text as a gist.

/** The most rows of each group; a search is one call each, so this keeps the listing quick. */
const PER_GROUP = 25;
/** How long a listing is reused: the panel opens often, and GitHub limits searches to 30 a minute. */
const LIFETIME = 60_000;
/** A row id is at most 256 characters; it is the item's link. */
const MAX_ID = 256;
/** A row's link, and the only links a row holds: owner, repository, kind and number. */
const ITEM_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues)\/(\d+)$/;
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

// The helper's memory only, never yab.storage or a file: the last rows and their titles, for a minute. The titles are
// kept apart from the rows because a row's id is its link alone: stable when a pull request is retitled.
let cached: { at: number; rows: SourceRow[]; titles: Map<string, string> } | undefined;
let titles = new Map<string, string>();

/** A title on one line. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** gh was not signed in: exit code 4 is "requires authentication", and its message names `gh auth login`. */
function signedOut(result: { exitCode: number; stderr: string }): boolean {
  return result.exitCode === 4 || /gh auth login|HTTP 401/.test(result.stderr);
}

/** The rows of one group from `--json` output, with each link's title; undefined when gh printed something else. */
function rowsOf(stdout: string, group: Group): { rows: SourceRow[]; titles: Map<string, string> } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const rows: SourceRow[] = [];
  const found = new Map<string, string>();
  for (const entry of parsed.slice(0, PER_GROUP)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { url, title, isDraft } = entry as { url?: unknown; title?: unknown; isDraft?: unknown };
    if (typeof url !== "string" || typeof title !== "string" || url.length > MAX_ID) continue;
    const match = ITEM_URL.exec(url);
    const text = oneLine(title);
    if (match === null || text === "") continue;
    const [, owner, repo, , number] = match;
    rows.push({ id: url, title: text, subtitle: `${group.label(isDraft === true)} · ${owner}/${repo} #${number}` });
    found.set(url, text);
  }
  return { rows, titles: found };
}

/** What a row id holds, or undefined when it is not one of ours. */
function parseRow(rowId: string): { url: string; reference: string } | undefined {
  const match = ITEM_URL.exec(rowId);
  if (match === null) return undefined;
  return { url: rowId, reference: `${match[1]}/${match[2]}#${match[4]}` };
}

const MARKDOWN_SPECIAL = /[\\[\]<>&*_]/g;

/**
 * Text inside the brackets of a Markdown link: these characters would end the link, start a tag, an entity or
 * emphasis, so they get a backslash. A backtick code span is kept as it is (inside it they mean nothing); a backtick
 * run with no matching closing run is plain text.
 */
function markdownText(text: string): string {
  let out = "";
  let plain = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === "`") end += 1;
    const fence = text.slice(index, end);
    // The closing run must be exactly as long as the opening one.
    let close = -1;
    for (let from = text.indexOf(fence, end); from !== -1; from = text.indexOf(fence, from + 1)) {
      if (text[from - 1] !== "`" && text[from + fence.length] !== "`") {
        close = from;
        break;
      }
    }
    if (close === -1) {
      index = end;
      continue;
    }
    out += text.slice(plain, index).replace(MARKDOWN_SPECIAL, "\\$&") + text.slice(index, close + fence.length);
    index = plain = close + fence.length;
  }
  return out + text.slice(plain).replace(MARKDOWN_SPECIAL, "\\$&");
}

export const sources: Sources = {
  work: {
    async list(ctx) {
      if (cached !== undefined) {
        const age = Date.now() - cached.at;
        if (age >= 0 && age <= LIFETIME) {
          titles = cached.titles;
          return { rows: cached.rows };
        }
        cached = undefined;
        titles = new Map();
      }
      const results = await Promise.all(
        GROUPS.map((group) =>
          yab.exec("gh", [...group.args, "--sort=updated", `--limit=${PER_GROUP}`, `--json=${group.fields}`], { signal: ctx.signal }),
        ),
      );
      if (results.some(signedOut)) {
        cached = undefined;
        titles = new Map();
        return { locked: true, message: yab.t("locked"), command: "gh auth login" };
      }
      const rows: SourceRow[] = [];
      const found = new Map<string, string>();
      let failed = 0;
      for (const [index, result] of results.entries()) {
        const group = GROUPS[index];
        const listed = result.exitCode === 0 && group !== undefined ? rowsOf(result.stdout, group) : undefined;
        if (listed === undefined) {
          failed += 1;
          continue;
        }
        for (const row of listed.rows) {
          if (found.has(row.id)) continue;
          found.set(row.id, listed.titles.get(row.id) ?? row.title);
          rows.push(row);
        }
      }
      // The groups that worked are listed; only when every search failed is the listing an error.
      if (failed === GROUPS.length) throw new Error(yab.t("listFailed"));
      titles = found;
      // A partial listing is not kept: the next opening asks again.
      cached = failed === 0 ? { at: Date.now(), rows, titles: found } : undefined;
      return { rows };
    },

    run(rowId, actionId) {
      const row = parseRow(rowId);
      if (row === undefined) throw new Error(yab.t("linkFailed"));
      if (actionId === "link") return { text: row.url };
      if (actionId === "markdown") {
        // Without a title (the helper restarted since the listing) the link still works, with the reference alone.
        const title = titles.get(row.url);
        return { text: `[${markdownText(title === undefined ? row.reference : `${row.reference}: ${title}`)}](${row.url})` };
      }
      throw new Error(yab.t("linkFailed"));
    },
  },
};

/** A file extension for copied text, by a few sure signs; `.txt` whenever it is not sure. */
function extensionFor(kind: string | undefined, text: string): string {
  if (kind !== "code") return "txt";
  const trimmed = text.trim();
  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      return "txt";
    }
  }
  const shebang = /^#!.*\b(bash|zsh|sh|python3?|node|ruby)\b/.exec(trimmed);
  if (shebang !== null) return { python: "py", python3: "py", node: "js", ruby: "rb" }[shebang[1] ?? ""] ?? "sh";
  if (/^<!doctype html|^<html[\s>]/i.test(trimmed)) return "html";
  if (/^<\?xml/i.test(trimmed)) return "xml";
  if (trimmed.startsWith("<?php") || trimmed.includes("<?php")) return "php";
  if (/^import (SwiftUI|AppKit|UIKit|Foundation)\s*$/m.test(trimmed)) return "swift";
  if (/^def \w+\(.*\):\s*$/m.test(trimmed) || /^from [\w.]+ import \w+/m.test(trimmed)) return "py";
  const script = /^import .+ from ["'].+["'];?\s*$|^export (default |const |function |async |interface |type )|^\s*(const|let) \w+ = (require\(|async\b|function\b|\([^)]*\) =>)|^\s*function \w*\(.*\)\s*\{/m.test(trimmed);
  if (script) return /^\s*(interface|type) \w+|\w\??: (string|number|boolean)\b/m.test(trimmed) ? "ts" : "js";
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
      const args = ["gist", "create", ...(ctx.variant === "public" ? ["--public"] : []), path];
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
