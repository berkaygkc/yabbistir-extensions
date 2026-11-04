// The shapes some answers are pasted in: a bullet list, a checklist, a commit message, a pull request description.
// The model is asked for each shape; these make sure of it, line by line.

import { changedPaths } from "./diff.ts";

/** A list marker the model may use at the start of a line: -, *, •, –, or a number. */
const marker = /^(\s*)(?:[-*•‣◦▪–—]|\d{1,3}[.)])\s+/;

/** One idea per line, each starting with "- ", with no blank lines between them. */
export function toBulletList(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const found = marker.exec(line);
    if (found) lines.push(`${found[1]}- ${line.slice(found[0].length).trim()}`);
    else lines.push(`- ${line.trim()}`);
  }
  return lines.join("\n");
}

/** What the model writes when there is no action item. */
const noItems = /^(?:none|no action items?(?: found)?|nothing|n\/a|yok|hiçbiri)\.?$/i;

/** A checkbox the model may write before an item: [ ], [x], ☐, □. */
const checkbox = /^(?:\[[ xX✓]?\]|☐|□|☑|✓|✔)\s*/;

/** The action items as "- [ ] …" lines, one per item, without headings or repeats; "" when there are none. */
export function toChecklist(text: string): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (line === "" || noItems.test(line)) continue;
    const found = marker.exec(line);
    if (found) line = line.slice(found[0].length);
    line = line.replace(checkbox, "").trim();
    // "Action items:" or "Tasks:" over the list is a heading, not an item; "- [ ] NONE" is no item either.
    if (line === "" || noItems.test(line) || (!found && line.endsWith(":") && line.length <= 40)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(`- [ ] ${line}`);
  }
  return items.join("\n");
}

/** Conventional Commits types, the first word of a commit subject. */
const commitTypes = new Set(["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"]);

export const subjectLimit = 72;

/** Lines of at most `width` characters, broken between words; a list item's next lines are indented under it. */
export function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const lead = /^\s*(?:[-*]\s+)?/.exec(line)?.[0] ?? "";
  const words = line.slice(lead.length).split(" ").filter((word) => word !== "");
  if (words.length < 2) return [line];
  const indent = " ".repeat(lead.length);
  const out: string[] = [];
  let current = lead + words[0];
  for (const word of words.slice(1)) {
    if (current.length + 1 + word.length > width) {
      out.push(current);
      current = indent + word;
    } else {
      current += ` ${word}`;
    }
  }
  out.push(current);
  return out;
}

/** The text without any of `characters` at its end; a loop, so a long run of them costs no more than its length. */
function trimEndOf(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

/**
 * The verbs a commit summary starts with, by the forms the model writes them in ("Added", "Fixes"), with their
 * imperative, which Conventional Commits and git ask for: "add", "fix".
 */
const imperatives = new Map<string, string>();
for (const verb of [
  "add", "fix", "update", "remove", "change", "improve", "refactor", "implement", "introduce", "create", "rename", "move",
  "replace", "delete", "bump", "upgrade", "convert", "clean", "document", "allow", "enable", "disable", "prevent",
  "handle", "support", "ensure", "use", "switch", "drop", "rework", "adjust", "correct", "resolve", "retry", "show",
  "hide", "make", "set", "simplify", "split", "merge", "revert", "extract", "avoid", "keep", "let", "stop", "start",
]) {
  const stem = verb.endsWith("e") ? verb.slice(0, -1) : verb;
  const forms = [verb, `${verb}s`, verb.endsWith("e") ? `${verb}d` : `${verb}ed`, `${stem}ing`];
  if (verb.endsWith("y")) forms.push(`${verb.slice(0, -1)}ies`, `${verb.slice(0, -1)}ied`);
  if (/(?:x|sh|ch|ss)$/.test(verb)) forms.push(`${verb}es`);
  for (const form of forms) imperatives.set(form, verb);
}
for (const [form, verb] of [["made", "make"], ["kept", "keep"], ["split", "split"], ["set", "set"], ["let", "let"], ["dropped", "drop"], ["stopped", "stop"], ["shown", "show"]]) imperatives.set(form, verb);

/** Whether every changed file is documentation, or every one a test, by its path. */
const docsFile = /(?:\.(?:md|mdx|markdown|rst|adoc)$|(?:^|\/)docs?\/)/i;
const testFile = /(?:(?:^|\/)(?:tests?|__tests__|specs?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$|(?:^|\/)test_[^/]{1,200}\.py$)/i;

/**
 * The type and summary, made to agree with Conventional Commits: the summary's first verb in the imperative and in
 * lower case ("Added retry logic" → "add retry logic"), "feat" that only fixes made "fix", and "docs" or "test"
 * when every changed file is documentation or a test.
 */
function settleType(type: string, summary: string, paths: string[]): [string, string] {
  const space = summary.indexOf(" ");
  const first = space === -1 ? summary : summary.slice(0, space);
  const verb = imperatives.get(first.toLowerCase());
  const rest = verb === undefined ? summary : verb + summary.slice(first.length);
  let settled = type;
  if (type === "feat" && verb === "fix") settled = "fix";
  if (paths.length > 0 && type !== "revert") {
    if (paths.every((path) => docsFile.test(path))) settled = "docs";
    else if (paths.every((path) => testFile.test(path))) settled = "test";
  }
  return [settled, rest];
}

/** A subject of at most 72 characters, cut between words, without a closing full stop. */
function tidySubject(raw: string, paths: string[]): string {
  let subject = raw.replace(/^#{1,6}\s+/, "").replace(/^(?:subject|başlık)\s*:\s*/i, "").trim();
  if (subject.startsWith("**") && subject.endsWith("**") && subject.length > 4) subject = subject.slice(2, -2).trim();
  if (subject.startsWith("`") && subject.endsWith("`") && subject.length > 2) subject = subject.slice(1, -1).trim();
  subject = subject.split(/\s+/).join(" ");
  const typed = /^([A-Za-z]+)(\([^()\n]{0,40}\))?(!)?:\s*/.exec(subject);
  if (typed && commitTypes.has(typed[1].toLowerCase())) {
    const [type, summary] = settleType(typed[1].toLowerCase(), subject.slice(typed[0].length), paths);
    subject = `${type}${typed[2] ?? ""}${typed[3] ?? ""}: ${summary}`;
  }
  subject = trimEndOf(subject, ".。");
  if (subject.length <= subjectLimit) return subject;
  const cut = subject.lastIndexOf(" ", subjectLimit);
  return trimEndOf(subject.slice(0, cut > subjectLimit / 2 ? cut : subjectLimit), " ,;:.-");
}

/** The lines a diff adds, without their "+", that are long enough to tell apart: what a body must not repeat. */
function addedLines(diff: string): Set<string> {
  const added = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const content = line.slice(1).trim();
    if (content.length >= 16) added.add(content);
  }
  return added;
}

/**
 * A commit message as git expects it: a subject of at most 72 characters, a blank line, a body wrapped at 72.
 * `diff` is the diff it describes: its files can settle the type, and a body line that only repeats a line it adds
 * is left out, as is a code block, which the model sometimes copies from the diff.
 */
export function toCommitMessage(text: string, diff = ""): string {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return "";
  const subject = tidySubject(lines[first], diff === "" ? [] : changedPaths(diff));
  const copied = diff === "" ? new Set<string>() : addedLines(diff);
  const body: string[] = [];
  let inCode = false;
  for (const raw of lines.slice(first + 1)) {
    if (raw.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || copied.has(raw.trim())) continue;
    const line = raw.trimEnd().replace(/^(?:body|gövde)\s*:\s*/i, "");
    if (line.trim() === "") {
      if (body.length > 0 && body[body.length - 1] !== "") body.push("");
      continue;
    }
    body.push(...wrap(line, subjectLimit));
  }
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  return body.length === 0 ? subject : `${subject}\n\n${body.join("\n")}`;
}

/** A heading the model may write as "Summary:" or "**Changes**", with what it becomes. */
const headings: [RegExp, string][] = [
  [/^(?:#{1,6}\s*)?(?:\*\*)?summary(?:\*\*)?\s*:?\s*(?:\*\*)?$/i, "## Summary"],
  [/^(?:#{1,6}\s*)?(?:\*\*)?(?:changes|what changed)(?:\*\*)?\s*:?\s*(?:\*\*)?$/i, "## Changes"],
];

/** A pull request description in Markdown: "## Summary", then "## Changes" with "- " items. */
export function toPullRequestDescription(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const heading = line.length <= 40 ? headings.find(([pattern]) => pattern.test(line.trim())) : undefined;
    if (heading) {
      while (out.length > 0 && out[out.length - 1] === "") out.pop();
      if (out.length > 0) out.push("");
      out.push(heading[1], "");
      continue;
    }
    if (line.trim() === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const found = marker.exec(line);
    out.push(found ? `${found[1]}- ${line.slice(found[0].length).trim()}` : line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
