// The shapes some answers are pasted in: a bullet list, a checklist, a commit message, a pull request description.
// The model is asked for each shape; these make sure of it, line by line.

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
    // "Action items:" or "Tasks:" over the list is a heading, not an item.
    if (line === "" || (!found && line.endsWith(":") && line.length <= 40)) continue;
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

/** A subject of at most 72 characters, cut between words, without a closing full stop. */
function tidySubject(raw: string): string {
  let subject = raw.replace(/^#{1,6}\s+/, "").replace(/^(?:subject|başlık)\s*:\s*/i, "").trim();
  if (subject.startsWith("**") && subject.endsWith("**") && subject.length > 4) subject = subject.slice(2, -2).trim();
  if (subject.startsWith("`") && subject.endsWith("`") && subject.length > 2) subject = subject.slice(1, -1).trim();
  subject = subject.split(/\s+/).join(" ");
  const typed = /^([A-Za-z]+)(\([^()\n]{0,40}\))?(!)?:\s*/.exec(subject);
  if (typed && commitTypes.has(typed[1].toLowerCase())) {
    subject = `${typed[1].toLowerCase()}${typed[2] ?? ""}${typed[3] ?? ""}: ${subject.slice(typed[0].length)}`;
  }
  subject = trimEndOf(subject, ".。");
  if (subject.length <= subjectLimit) return subject;
  const cut = subject.lastIndexOf(" ", subjectLimit);
  return trimEndOf(subject.slice(0, cut > subjectLimit / 2 ? cut : subjectLimit), " ,;:.-");
}

/** A commit message as git expects it: a subject of at most 72 characters, a blank line, a body wrapped at 72. */
export function toCommitMessage(text: string): string {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return "";
  const subject = tidySubject(lines[first]);
  const body: string[] = [];
  for (const raw of lines.slice(first + 1)) {
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
