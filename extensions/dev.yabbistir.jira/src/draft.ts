// A new issue made from copied text: the summary is its first line, and the description holds the whole text in
// Atlassian Document Format (ADF), in a code block when the text looks like code or a log. Everything here is pure and
// close to linear in the text's length: no regular expression below can backtrack over more than one line, lines are
// looked at only up to a fixed count, and a cut builds a document of at most DESCRIPTION_LIMIT characters some fifteen
// times.

/** Jira refuses a summary of 255 characters or more. Counted in UTF-16 units, as Jira counts them. */
export const SUMMARY_LIMIT = 254;
/**
 * The longest description, counted as Jira counts it: on its document written out as JSON, structure included, not on
 * the text alone. Jira refuses one over 32,767 (JRACLOUD-78553, JRACLOUD-98152); this leaves room for what it adds.
 */
export const DESCRIPTION_LIMIT = 30_000;
/** How much of a copied text is read at all: far more than a description holds. */
const SOURCE_LIMIT = 100_000;
/** How many non-blank lines decide whether the text looks like code. */
const SAMPLE_LINES = 200;

export type Inline = { type: "text"; text: string } | { type: "hardBreak" };
export type Block =
  | { type: "paragraph"; content: Inline[] }
  | { type: "codeBlock"; content: [{ type: "text"; text: string }] };
export interface Doc {
  version: 1;
  type: "doc";
  content: Block[];
}

export interface Draft {
  summary: string;
  /** Left out when the text is one line that fits in the summary. */
  description?: Doc;
  /** Whether the description holds only the beginning of the text, so that its document fits in DESCRIPTION_LIMIT. */
  cut: boolean;
  /** When it is cut: how many characters of the text it holds, in Unicode characters. */
  kept?: number;
}

/** How long a document is as Jira counts it: written out as JSON. */
export const sizeOf = (doc: Doc): number => JSON.stringify(doc).length;

/** A terminal's color and cursor codes, which logs copied from a raw output carry. */
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
/** Control characters other than tab and line ends, which Jira's documents do not take. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** Half of a surrogate pair without its other half: JSON carries it, but it is not text. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const LINE_ENDS = /\r\n?|[\u0085\u2028\u2029]/g;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The text with every line end as "\n", without terminal codes, control characters or broken surrogates. */
export function cleaned(text: string): string {
  return text.replace(LINE_ENDS, "\n").replace(ANSI, "").replace(CONTROL, "").replace(LONE_SURROGATE, "\uFFFD");
}

/** Whether the text has anything an issue could be about. */
export function hasWords(text: string): boolean {
  return LETTER_OR_DIGIT.test(text);
}

/** All whitespace runs as one space, ends trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The first `limit` UTF-16 units, never ending in half of a surrogate pair. */
export function cutAt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const code = text.charCodeAt(limit - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit);
}

/** The line as an issue summary: on one line, cut with an ellipsis to fit. */
export function summaryOf(line: string): string {
  const text = oneLine(line);
  return text.length > SUMMARY_LIMIT ? `${cutAt(text, SUMMARY_LIMIT - 1)}…` : text;
}

/**
 * Stack frames and crash headers: one is enough to call the text a log. A JavaScript or Java frame is "at", a function
 * and where it is, in brackets: a file and line ("app.js:1:2", "Shop.java:12"), <anonymous>, native or Native Method.
 * Indented, the place may stand alone ("at /srv/app.js:1:2"). A line such as "at the office" or "at noon (12:30)" is no
 * frame: a frame's line number follows a file's name, never a digit.
 */
const STACK_FRAME =
  /^\s*at\s(?:(?:async|new)\s)?[^\s(]+\s?\((?:[^()]*[^\d\s():]:\d+(?::\d+)?|<anonymous>|native|Native Method|Unknown Source)\)(?:\s|$)|^\s+at\s(?:\S*[^\d\s:]:\d+:\d+|<anonymous>)\s*$|^Traceback \(most recent call last\)|^\s*File "[^"]*", line \d|^\s*#\d+\s+0x[0-9A-Fa-f]|^[\s*]*frame #\d+: 0x[0-9A-Fa-f]|^\d+\s+\S+\s+0x[0-9A-Fa-f]|^\s*Caused by:\s|^Exception in thread\s|^goroutine \d+ \[|^thread '[^']*' panicked at\s/;
/** Lines a log writes: a timestamp, a level, an error class at the start. */
const LOG_LINE =
  /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^\[?\d{2}:\d{2}:\d{2}\b|^\s*\[?(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|SEVERE)\]?(?:[\s:]|$)|^npm (?:ERR!|WARN)\s|^\S*(?:Error|Exception)(?::|$)/;
/**
 * How lines of code start: a keyword that rarely starts a line of prose, a comment, a shell prompt or a tag. Checked on
 * a line's first 40 characters only.
 */
const CODE_START =
  /^(?:(?:import|export|def|class|function|const|var|elif|func|fn|namespace|struct|enum|interface|return)\b|#include\b|#!|\/\/|\/\*|\$ \S|<\/?[A-Za-z][\w:-]*[\s>/])/;
/** A list item's marker, a bullet or a number, then a space: indented, it is a nested list rather than code. */
const LIST_ITEM = /^(?:[-*+•◦▪‣–]|\d{1,3}[.)])\s/;

/** Whether the line reads as code by what it holds. */
function codeLine(line: string): boolean {
  const start = line.trimStart();
  const end = start.trimEnd();
  if ("{}])".includes(end[0] ?? " ")) return true;
  if (";{}".includes(end.at(-1) ?? " ")) return true;
  if (end.includes("=>")) return true;
  return CODE_START.test(start.slice(0, 40));
}

/** Whether the line is indented as code is, by a tab or four spaces, and is not a nested list item. */
function indentedLine(line: string): boolean {
  return (line.startsWith("\t") || line.startsWith("    ")) && !LIST_ITEM.test(line.trimStart().slice(0, 8));
}

/**
 * Whether the text reads as code or a log rather than prose: an item the app marked as code, a JSON document, a stack
 * frame, two log lines, or lines of code making up two fifths of the text. Indented lines count toward those two fifths
 * only beside a line that is code or a log by what it holds: a note with an indented list is prose.
 */
export function looksLikeCode(text: string, kind: string | undefined): boolean {
  if (kind === "code") return true;
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // Not JSON; the lines decide.
    }
  }
  let lines = 0;
  let logs = 0;
  let code = 0;
  let indented = 0;
  let from = 0;
  while (from <= text.length && lines < SAMPLE_LINES) {
    const next = text.indexOf("\n", from);
    const line = text.slice(from, next === -1 ? text.length : next);
    from = next === -1 ? text.length + 1 : next + 1;
    if (line.trim() === "") continue;
    lines += 1;
    if (STACK_FRAME.test(line)) return true;
    if (LOG_LINE.test(line)) logs += 1;
    else if (codeLine(line)) code += 1;
    else if (indentedLine(line)) indented += 1;
  }
  if (logs >= 2) return true;
  const signs = logs + code + indented;
  return logs + code >= 1 && signs >= 2 && signs * 5 >= lines * 2;
}

/** The text in one code block. */
export function codeDoc(text: string): Doc {
  return { version: 1, type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text }] }] };
}

/** The text as paragraphs: blank lines part them, and a single line end is a hard break. */
export function proseDoc(text: string): Doc {
  const content: Block[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length === 0) return;
    const inline: Inline[] = [];
    for (const line of lines) {
      if (inline.length > 0) inline.push({ type: "hardBreak" });
      inline.push({ type: "text", text: line });
    }
    content.push({ type: "paragraph", content: inline });
    lines = [];
  };
  for (const line of text.split("\n")) {
    // A text node must not be empty, so blank lines only part paragraphs.
    if (line.trim() === "") flush();
    else lines.push(line.trimEnd());
  }
  flush();
  return { version: 1, type: "doc", content };
}

/** The text from its first line that is not blank, with that line's indentation (which matters in code), trimmed at the end. */
function withoutBlankEnds(text: string): string {
  let from = 0;
  while (from < text.length) {
    const next = text.indexOf("\n", from);
    if (next === -1 || text.slice(from, next).trim() !== "") break;
    from = next + 1;
  }
  return text.slice(from).trimEnd();
}

/** How many characters the text has, counted in Unicode characters rather than UTF-16 units: 😀 is one. */
const charactersIn = (text: string): number => Array.from(text).length;

/**
 * The summary and description of a new issue made from `text`, or undefined when no line has a letter or a digit in
 * it. Only the first SOURCE_LIMIT characters are read. The summary is the first line with a letter or a digit, so a
 * line holding only `{` is skipped. The description is the whole text, unless the text is that one line and it fits in
 * the summary, or its longest beginning whose document fits in DESCRIPTION_LIMIT, followed by "…".
 */
export function draftOf(text: string, kind: string | undefined): Draft | undefined {
  const source = cleaned(cutAt(text, SOURCE_LIMIT));
  const lines = source.split("\n");
  const first = lines.find((line) => LETTER_OR_DIGIT.test(line));
  if (first === undefined) return undefined;
  const summary = summaryOf(first);
  let filled = 0;
  for (const line of lines) {
    if (line.trim() !== "" && ++filled > 1) break;
  }
  if (filled === 1 && oneLine(first).length <= SUMMARY_LIMIT) return { summary, cut: false };

  const body = withoutBlankEnds(source);
  const docOf = looksLikeCode(body, kind) ? codeDoc : proseDoc;
  // A document is never shorter than its text, so a longer text is cut without building its document.
  if (body.length <= DESCRIPTION_LIMIT) {
    const description = docOf(body);
    if (sizeOf(description) <= DESCRIPTION_LIMIT) return { summary, description, cut: false };
  }
  // Each line of prose adds a node or two, and each quote or line end in code an escape, so the cut is found on the
  // document itself: it grows with the text, so halving the range a few times finds the longest beginning that fits.
  const beginning = (length: number) => cutAt(body, length).trimEnd();
  let low = 0;
  let high = Math.min(body.length, DESCRIPTION_LIMIT);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (sizeOf(docOf(`${beginning(middle)}\n…`)) <= DESCRIPTION_LIMIT) low = middle;
    else high = middle - 1;
  }
  const kept = beginning(low);
  return { summary, description: docOf(`${kept}\n…`), cut: true, kept: charactersIn(kept) };
}
