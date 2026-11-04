// A unified diff, condensed to what the model needs to describe it: which files changed and how much, and the
// changed lines, within a budget. Lock files and generated files are counted but not shown; context lines go first
// when the diff is too long, then each file keeps an even share of the room.

import { head } from "./text.ts";

/** The start of a diff: a `diff --git` header or a hunk header, at the start of a line. */
const diffStart = /(?:^|\n)(?:diff --git |@@ -\d{1,9}(?:,\d{1,9})? \+\d{1,9}(?:,\d{1,9})? @@)/;

/** How far into a text its first diff header may be, here and in the manifest's patterns. */
export const diffScan = 4000;

/** Whether the text is a unified diff: one of its first 4,000 characters starts a diff header. */
export function looksLikeDiff(text: string): boolean {
  return diffStart.test(text.slice(0, diffScan + 40));
}

/** Files whose changes say nothing a reader needs: the counts are kept, the lines are not. */
const lockFiles = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "Cargo.lock",
  "Gemfile.lock", "poetry.lock", "uv.lock", "composer.lock", "go.sum", "Podfile.lock", "Package.resolved", "mix.lock",
  "pubspec.lock", "flake.lock",
]);

function isGenerated(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return lockFiles.has(name) || name.endsWith(".min.js") || name.endsWith(".min.css") || name.endsWith(".map");
}

/** A line is cut to this many characters: a minified line says no more at 100,000. */
const lineLimit = 300;

interface FileDiff {
  path: string;
  header: string[];
  /** Hunk headers and changed lines; context lines are marked so they can be dropped first. */
  lines: { text: string; context: boolean }[];
  added: number;
  removed: number;
  binary: boolean;
}

function newFile(header: string[] = []): FileDiff {
  return { path: "", header, lines: [], added: 0, removed: 0, binary: false };
}

function shortLine(line: string): string {
  return line.length <= lineLimit ? line : `${line.slice(0, lineLimit)}…`;
}

/** The file a `diff --git a/x b/y` header names: what comes after its last " b/". */
function pathOf(line: string): string {
  const at = line.lastIndexOf(" b/");
  return at === -1 ? "" : line.slice(at + 3);
}

/**
 * The file a `--- ` or `+++ ` line names, without git's `a/` or `b/` and without the date `diff -u` adds after a
 * tab ("+++ new.txt\t2026-05-03 10:00:00"); "" for /dev/null, the side of a file that is added or deleted.
 */
function sidePath(line: string): string {
  const tab = line.indexOf("\t");
  const path = (tab === -1 ? line.slice(4) : line.slice(4, tab)).trim();
  if (path === "/dev/null") return "";
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
}

/** A hunk header's line counts, "@@ -12,7 +12,8 @@" → 7 old and 8 new; a count left out is 1. */
const hunkCounts = /^@@ -\d{1,9}(?:,(\d{1,9}))? \+\d{1,9}(?:,(\d{1,9}))? @@/;

/**
 * The diff's files, in order; the text before the first file (a `git show` header) is the preamble. Files start at
 * `diff --git`, or, in a diff git did not make (`diff -u`, `svn diff`), at a `--- ` line followed by a `+++ ` line
 * once the hunk before it has all the lines its header counts.
 */
export function parseDiff(diff: string): { preamble: string; files: FileDiff[] } {
  const files: FileDiff[] = [];
  const preamble: string[] = [];
  let file: FileDiff | null = null;
  let inHunk = false;
  // The lines the current hunk's header says are still to come, on each side.
  let oldLeft = 0;
  let newLeft = 0;
  const lines = diff.split("\n").map((raw) => (raw.endsWith("\r") ? raw.slice(0, -1) : raw));
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("diff --git ")) {
      file = newFile([shortLine(line)]);
      file.path = pathOf(line);
      files.push(file);
      inHunk = false;
      continue;
    }
    const hunkDone = !inHunk || (oldLeft <= 0 && newLeft <= 0);
    if (hunkDone && line.startsWith("--- ") && (lines[index + 1] ?? "").startsWith("+++ ")) {
      // A new file's header, unless a `diff --git` line has just opened this file and it has no hunk yet.
      if (file === null || file.lines.length > 0) {
        file = newFile();
        files.push(file);
      }
      file.path = file.path || sidePath(lines[index + 1]) || sidePath(line);
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (file === null) {
        file = newFile();
        files.push(file);
      }
      const counts = hunkCounts.exec(line);
      oldLeft = counts ? Number(counts[1] ?? "1") : Infinity;
      newLeft = counts ? Number(counts[2] ?? "1") : Infinity;
      inHunk = true;
      file.lines.push({ text: shortLine(line), context: false });
      continue;
    }
    if (file === null) {
      preamble.push(line);
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("+++ ")) {
        if (file.path === "") file.path = sidePath(line);
      } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
        file.binary = true;
      } else if (/^(?:new|deleted) file mode|^rename (?:from|to) |^similarity index/.test(line)) {
        file.header.push(shortLine(line));
      }
      // "index …" and "--- a/…" lines say nothing the header does not.
      continue;
    }
    if (line.startsWith("+")) {
      file.added++;
      newLeft--;
      file.lines.push({ text: shortLine(line), context: false });
    } else if (line.startsWith("-")) {
      file.removed++;
      oldLeft--;
      file.lines.push({ text: shortLine(line), context: false });
    } else if (line.startsWith(" ") || line === "") {
      oldLeft--;
      newLeft--;
      file.lines.push({ text: shortLine(line), context: true });
    }
    // "\ No newline at end of file" and anything else inside a hunk is left out.
  }
  return { preamble: preamble.join("\n").trim(), files };
}

/** "Files changed: 2" and one line per file with its counts, for a diff with named files. */
function summary(files: FileDiff[]): string[] {
  const named = files.filter((file) => file.path !== "");
  if (named.length === 0) return [];
  const shown = named.slice(0, 40).map((file) => {
    const notes = [`+${file.added} -${file.removed}`];
    if (file.binary) notes.push("binary");
    else if (isGenerated(file.path)) notes.push("generated, not shown");
    return `- ${file.path} (${notes.join(", ")})`;
  });
  if (named.length > 40) shown.push(`- [${named.length - 40} more files]`);
  return [`Files changed: ${named.length}`, ...shown];
}

/** One file's part of the condensed diff, with at most `room` characters of changed lines. */
function render(file: FileDiff, withContext: boolean, room = Infinity): string[] {
  const out = [...file.header];
  if (file.binary || isGenerated(file.path)) return out;
  let used = 0;
  let left = 0;
  for (const line of file.lines) {
    if (line.context && !withContext) continue;
    if (left > 0 || used + line.text.length + 1 > room) {
      left++;
      continue;
    }
    out.push(line.text);
    used += line.text.length + 1;
  }
  if (left > 0) out.push(`[${left} more lines]`);
  return out;
}

const join = (blocks: string[][]) => blocks.map((block) => block.join("\n")).filter((block) => block !== "").join("\n\n");

/** The diff in at most `budget` characters: whole when it fits, else without context lines, else shared out. */
export function condenseDiff(diff: string, budget: number): string {
  const { preamble, files } = parseDiff(diff);
  if (files.length === 0) return head(diff, budget);
  const top = [head(preamble, 400).split("\n"), summary(files)].filter((block) => block.join("") !== "");
  const whole = join([...top, ...files.map((file) => render(file, true))]);
  if (whole.length <= budget) return whole;
  const changed = join([...top, ...files.map((file) => render(file, false))]);
  if (changed.length <= budget) return changed;
  // Each file gets an even share; a file that needs less leaves the rest to the files after it.
  const fixed = join([...top, ...files.map((file) => render(file, false, 0))]).length;
  let room = Math.max(0, budget - fixed - files.length * 24);
  const sizes = files.map((file) => render(file, false).join("\n").length);
  const order = files.map((_, index) => index).sort((a, b) => sizes[a] - sizes[b]);
  const shares = new Array<number>(files.length).fill(0);
  order.forEach((index, position) => {
    const share = Math.min(sizes[index], Math.floor(room / (files.length - position)));
    shares[index] = share;
    room -= share;
  });
  return head(join([...top, ...files.map((file, index) => render(file, false, shares[index]))]), budget);
}
