import type { SourceRow, Sources } from "@yabbistir/api";

// Snippets from a Markdown file in a folder the person chose. Each `## Title` starts a snippet, an optional `# Group`
// names the ones after it. The file is read again on every list and every run, so an edit shows at once and nothing
// is kept between calls: no cache, no storage.

const DEFAULT_FILE = "snippets.md";
/** The app keeps at most this many rows of a listing. */
const MAX_ROWS = 10_000;
/** How much of a body's first line, and of a group, a row's subtitle shows. */
const PREVIEW_LENGTH = 90;
const GROUP_LENGTH = 30;

export interface Snippet {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly body: string;
}

/** What the app turns into a space in a title, and what it trims from its ends after that. */
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const EDGE_SPACE = /^[\p{Z}\t-\r\u0085]+|[\p{Z}\t-\r\u0085]+$/gu;
const cleaned = (text: string): string => text.replace(LINE_BREAKS, " ").replace(EDGE_SPACE, "");

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const GROUP_HEADING = /^# +(\S.*)$/;
const SNIPPET_HEADING = /^## +(\S.*)$/;

/** Two 32-bit FNV-1a hashes of `text`, as 16 hex digits: a row id that stays the same and is short. */
function hashOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Lines without their blank ends; every other line stays exactly as written. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * The snippets in a file. A `## Title` line starts one and its body runs to the next `##` or `#` heading; a `# Group`
 * names the snippets after it. A heading inside a fenced code block is text. Snippets with an empty body, and
 * titles that are blank once the app has cleaned them, are left out. An id comes from the group and the title, and a
 * repeat gets a number, so ids are unique and stay with their snippet while the file around it changes.
 */
export function parseSnippets(source: string): Snippet[] {
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const found: Array<{ group: string; title: string; lines: string[] }> = [];
  let group = "";
  let current: { group: string; title: string; lines: string[] } | undefined;
  let fence: { char: string; length: number } | undefined;

  for (const line of lines) {
    const marker = FENCE.exec(line);
    if (fence !== undefined) {
      current?.lines.push(line);
      if (marker !== null && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && marker[2]!.trim() === "") fence = undefined;
      continue;
    }
    if (marker !== null && !(marker[1]![0] === "`" && marker[2]!.includes("`"))) {
      fence = { char: marker[1]![0]!, length: marker[1]!.length };
      current?.lines.push(line);
      continue;
    }
    const groupHeading = GROUP_HEADING.exec(line);
    if (groupHeading !== null) {
      group = cleaned(groupHeading[1]!);
      current = undefined;
      continue;
    }
    const snippetHeading = SNIPPET_HEADING.exec(line);
    if (snippetHeading !== null) {
      current = { group, title: snippetHeading[1]!.trimEnd(), lines: [] };
      found.push(current);
      continue;
    }
    current?.lines.push(line);
  }

  const seen = new Map<string, number>();
  const snippets: Snippet[] = [];
  for (const entry of found) {
    const title = cleaned(entry.title);
    const body = trimBlankLines(entry.lines).join("\n");
    if (title === "" || body.trim() === "") continue;
    const key = hashOf(`${entry.group}\u0000${entry.title}`);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    snippets.push({ id: count === 0 ? key : `${key}-${count + 1}`, group: entry.group, title, body });
  }
  return snippets;
}

/** At most `length` characters (whole code points), with an ellipsis when something was cut. */
function shortened(text: string, length: number): string {
  const characters = Array.from(text);
  return characters.length <= length ? text : `${characters.slice(0, length - 1).join("").trimEnd()}…`;
}

/** The first line of a body worth showing: not blank and not a code fence. */
function previewOf(body: string): string {
  for (const line of body.split("\n")) {
    const text = line.trim();
    if (text !== "" && !FENCE.test(line)) return shortened(text, PREVIEW_LENGTH);
  }
  return "";
}

function rowOf(snippet: Snippet): SourceRow {
  const preview = previewOf(snippet.body);
  const group = snippet.group === "" ? "" : shortened(snippet.group, GROUP_LENGTH);
  const subtitle = group !== "" && preview !== "" ? `${group} · ${preview}` : group || preview;
  return { id: snippet.id, title: snippet.title, subtitle: subtitle === "" ? undefined : subtitle };
}

const PLACEHOLDER = /\{\{|\}\}|\{(datetime|date|time|weekday|clipboard)\}/g;

/**
 * The body with its placeholders filled. `{{` and `}}` are literal braces, and a name that is not a placeholder stays
 * as written. One pass, so a filled value (a copied `{date}`) is never filled again.
 */
export function fill(body: string, values: { language: string; now: Date; clipboard: string }): string {
  const format = (options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(values.language, options).format(values.now);
  return body.replace(PLACEHOLDER, (match, name?: string) => {
    switch (name) {
      case undefined: return match === "{{" ? "{" : "}";
      case "date": return format({ dateStyle: "long" });
      case "time": return format({ timeStyle: "short" });
      case "datetime": return format({ dateStyle: "long", timeStyle: "short" });
      case "weekday": return format({ weekday: "long" });
      default: return values.clipboard;
    }
  });
}

/** Whether the body uses {clipboard}, so history is read only when it is needed. */
const usesClipboard = (body: string): boolean => /\{clipboard\}/.test(body.replace(/\{\{|\}\}/g, ""));

/** The newest history item's text; empty when there is none, it has no text, or history cannot be read. */
async function clipboardText(): Promise<string> {
  try {
    const [newest] = await yab.history.recent(1);
    return typeof newest?.text === "string" ? newest.text : "";
  } catch {
    return "";
  }
}

type Located = { path: string; name: string } | { message: string };

function locate(preferences: Readonly<Record<string, unknown>>): Located {
  const folder = typeof preferences.folder === "string" ? preferences.folder.replace(/\/+$/, "") : "";
  if (folder === "") return { message: yab.t("noFolder") };
  const chosen = typeof preferences.file === "string" ? preferences.file.trim() : "";
  const name = chosen === "" ? DEFAULT_FILE : chosen;
  if (/[/\\:\u0000]/.test(name) || name === "." || name === "..") return { message: yab.t("badFileName") };
  return { path: `${folder}/${name}`, name };
}

/** The file's snippets, or what to tell the person. */
function snippetsOf(preferences: Readonly<Record<string, unknown>>): { snippets: Snippet[] } | { message: string } {
  const where = locate(preferences);
  if ("message" in where) return where;
  let text: string;
  try {
    if (!yab.files.exists(where.path)) return { message: yab.t("noFile", { file: where.name }) };
    text = new TextDecoder().decode(yab.files.read(where.path));
  } catch {
    return { message: yab.t("unreadable", { file: where.name }) };
  }
  const snippets = parseSnippets(text);
  return snippets.length === 0 ? { message: yab.t("noSnippets", { file: where.name }) } : { snippets };
}

export const sources: Sources = {
  snippets: {
    list(ctx) {
      const result = snippetsOf(ctx.preferences);
      if ("message" in result) return { locked: true, message: result.message };
      return { rows: result.snippets.slice(0, MAX_ROWS).map(rowOf) };
    },

    async run(rowId, actionId, ctx) {
      const result = snippetsOf(ctx.preferences);
      if ("message" in result) throw new Error(result.message);
      const snippet = result.snippets.find((entry) => entry.id === rowId);
      if (snippet === undefined) throw new Error(yab.t("gone"));
      const clipboard = usesClipboard(snippet.body) ? await clipboardText() : "";
      const text = fill(snippet.body, { language: ctx.language, now: new Date(), clipboard });
      if (text.trim() === "") throw new Error(yab.t("emptyResult"));
      return { text };
    },
  },
};
