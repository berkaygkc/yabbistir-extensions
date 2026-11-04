// Pure text work: issue keys, Markdown links, and a new issue's title and description from a copy. Every regular
// expression here is anchored or made of single steps that cannot overlap, so each runs in time linear in its line,
// and the long ones only ever see a bounded part of the copy.

/** An issue's identifier, as Linear writes it: a team key, a dash and a number ("ENG-123"). */
const IDENTIFIER = /^[A-Z][A-Z0-9]{1,9}-[0-9]{1,6}$/;
/** A link to an issue in Linear's web app: https://linear.app/<workspace>/issue/ENG-123/<slug>. */
const ISSUE_LINK = /^https:\/\/linear\.app\/[A-Za-z0-9_-]+\/issue\/([A-Z][A-Z0-9]{1,9}-[0-9]{1,6})(?:[/?#]|$)/;

/** The issue a copy names, as an identifier, or undefined when it names none. */
export function issueKeyOf(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length > 2048) return undefined;
  if (IDENTIFIER.test(trimmed)) return trimmed;
  return ISSUE_LINK.exec(trimmed)?.[1];
}

/** A team key as the person typed it in Settings, in capitals, or undefined when it can't be one. */
export function teamKeyOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,10}$/.test(key) ? key : undefined;
}

/** What the app turns into spaces in a row's title, and the like: tabs, line ends and separators. */
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;

/** One line, its runs of spaces made one. */
export const oneLine = (value: string): string => value.replace(BREAKS, " ").replace(/ {2,}/g, " ").trim();

/** Link text that Markdown shows as it is: the characters that would start a link, emphasis, code or HTML escaped. */
export const escapeMarkdown = (value: string): string => value.replace(/[\\`*_[\]<>]/g, "\\$&");

/** A link address Markdown reads to its end: spaces, parentheses and angle brackets percent-encoded. */
const escapeAddress = (url: string): string =>
  url.replace(/[ ()<>]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

/** `[ENG-123: Title](url)`, the title kept as it reads. */
export function markdownLink(issue: { identifier: string; title: string; url: string }): string {
  const title = oneLine(issue.title);
  const label = title === "" ? issue.identifier : `${issue.identifier}: ${title}`;
  return `[${escapeMarkdown(label)}](${escapeAddress(issue.url)})`;
}

/** A source row's title: "ENG-123 Title". */
export const rowTitle = (identifier: string, title: string): string => oneLine(`${identifier} ${title}`);

/** The longest a new issue's title gets, in characters, its "…" included. */
export const TITLE_LIMIT = 100;
/** The longest a new issue's description gets, in UTF-16 units, before it is cut at a line. */
export const DESCRIPTION_LIMIT = 50_000;
/** How much of a copy is read to choose the title and to tell code from prose. */
const SCAN_LINES = 300;
const SCAN_WIDTH = 500;

/** A code fence line, with or without a language: ``` or ~~~ or ```ts. */
const FENCE = /^(?:`{3,}|~{3,})[^`~]*$/;
/** A log line's leading time stamp: 2026-01-02 10:11:12, [2026-01-02T10:11:12.345Z], with or without a zone. */
const TIMESTAMP = /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?\]?[ \t]*/;
const HEADING = /^#{1,6}[ \t]+/;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** The copy's lines with Windows and old Mac line ends made "\n". */
const linesOf = (text: string): string[] => text.replace(/\r\n?/g, "\n").split("\n");

/** At most `limit` characters (code points), cut at a word when one ends near the limit, with "…" after. */
function cutTo(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  let kept = characters.slice(0, limit - 1).join("");
  const space = kept.lastIndexOf(" ");
  if (space >= kept.length * 0.6) kept = kept.slice(0, space);
  return `${kept.replace(/[\s,;:.-]+$/u, "")}…`;
}

/**
 * A new issue's title: the first line with a letter or a digit (code fences skipped), without a Markdown heading's
 * "#" or a log line's time stamp, on one line and cut to TITLE_LIMIT characters.
 */
export function titleOf(text: string): string {
  const candidates: string[] = [];
  for (const line of linesOf(text)) {
    if (candidates.length >= SCAN_LINES) break;
    const trimmed = line.trim();
    if (trimmed !== "" && !FENCE.test(trimmed.slice(0, SCAN_WIDTH))) candidates.push(trimmed);
  }
  const line = candidates.find((candidate) => HAS_WORD.test(candidate)) ?? candidates[0] ?? "";
  let title = line.slice(0, 4 * TITLE_LIMIT);
  title = title.replace(HEADING, "");
  const unstamped = title.replace(TIMESTAMP, "");
  if (HAS_WORD.test(unstamped)) title = unstamped;
  return cutTo(oneLine(title), TITLE_LIMIT);
}

/** Lines that only stack traces and logs have. */
const TRACE_LINES: RegExp[] = [
  /^\s+at\s+\S/, // a stack frame: JavaScript, Java, .NET
  /^\s*File "[^"]*", line \d+/, // Python
  /^Traceback \(most recent call last\)/,
  /^\s*#\d+\s+0x[0-9a-fA-F]+/, // a native backtrace
  /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, // a time-stamped log line
  /^\s*\[?(?:ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)\]?[\s:]/,
  /^\s*[\w$.]*(?:Error|Exception)(?::|$)/, // TypeError: …, java.lang.IllegalStateException
  /^\s*(?:panic:|fatal error:|Caused by:|goroutine \d+ \[)/,
];

/** Lines that read as code rather than prose. */
const CODE_LINES: RegExp[] = [
  /^\s*[{}[\]()]+[,;]?$/, // a line of brackets
  /^\s*"[^"]*"\s*:/, // a JSON key
  /=>|::|===?|!==?|&&|\|\||<\/|\/>/, // operators prose rarely has
  /^\s*(?:\$|%|>>>) \S/, // a shell or Python prompt
  /^\s*(?:import|export|const|var|function|def|class|public|private|protected|static|func|fn|impl|struct|enum|package|interface|SELECT|INSERT|UPDATE|DELETE|CREATE)\b[^\n]*[(={:]/,
];

function codeLine(line: string): boolean {
  const end = line.trimEnd().at(-1);
  if (end === ";" || end === "{" || end === "}") return true;
  return CODE_LINES.some((pattern) => pattern.test(line));
}

/**
 * Whether a copy reads as code or a log, and so belongs in a code block: one line that only a trace or a log has, or
 * at least half of its first lines reading as code or log (an indented line counts once there is more than one).
 */
export function looksLikeCode(text: string): boolean {
  const lines: string[] = [];
  for (const line of linesOf(text)) {
    if (lines.length >= SCAN_LINES) break;
    if (line.trim() !== "") lines.push(line.slice(0, SCAN_WIDTH));
  }
  if (lines.length === 0) return false;
  const trace = (line: string) => TRACE_LINES.some((pattern) => pattern.test(line));
  if (lines.length === 1) return trace(lines[0]) || codeLine(lines[0]);
  const technical = lines.filter((line) => trace(line) || codeLine(line) || /^(?: {2,}|\t)\S/.test(line)).length;
  return technical * 2 >= lines.length;
}

/** A fence longer than any run of backticks in the code, so nothing inside can close it. */
function fenceFor(code: string): string {
  let longest = 0;
  let run = 0;
  for (let index = 0; index < code.length; index++) {
    run = code.charCodeAt(index) === 96 ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** At most DESCRIPTION_LIMIT units: cut at the last line end before it when one is near, never inside a surrogate pair. */
function cutDescription(text: string): { text: string; cut: boolean } {
  if (text.length <= DESCRIPTION_LIMIT) return { text, cut: false };
  let end = text.lastIndexOf("\n", DESCRIPTION_LIMIT);
  if (end < DESCRIPTION_LIMIT / 2) {
    end = DESCRIPTION_LIMIT;
    const unit = text.charCodeAt(end - 1);
    if (unit >= 0xd800 && unit <= 0xdbff) end -= 1;
  }
  return { text: text.slice(0, end).trimEnd(), cut: true };
}

/**
 * A new issue's description: the whole copy, blank lines at its ends left out, in a code block when it is code or a
 * log and as it is otherwise. A copy over DESCRIPTION_LIMIT is cut, and `cutNote` says so under it.
 */
export function descriptionOf(text: string, code: boolean, cutNote: (limit: number) => string): string {
  const lines = linesOf(text);
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && lines[first].trim() === "") first++;
  while (last >= first && lines[last].trim() === "") last--;
  const body = lines.slice(first, last + 1).map((line) => line.trimEnd()).join("\n");
  const { text: kept, cut } = cutDescription(body);
  let description = kept;
  if (code) {
    const fence = fenceFor(kept);
    description = `${fence}\n${kept}\n${fence}`;
  }
  return cut ? `${description}\n\n_${cutNote(DESCRIPTION_LIMIT)}_` : description;
}
