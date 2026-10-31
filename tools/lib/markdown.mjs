// Just enough Markdown for the docs' tools: fenced code blocks, links, and the anchors GitHub gives headings.
import fs from "node:fs";
import path from "node:path";

/** The repository's own documentation: what an author reads. Extension and template READMEs belong to those. */
export function markdownFiles(root) {
  const found = [];
  const walk = (relative) => {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".md")) found.push(child);
    }
  };
  for (const file of ["README.md", "AGENTS.md", "CLAUDE.md"]) if (fs.existsSync(path.join(root, file))) found.push(file);
  for (const directory of ["docs", ".claude", ".github"]) walk(directory);
  return found.sort();
}

/**
 * The fenced code blocks of `text`, in order. The info string's first word is the language; `file=<path>` names the
 * file the block is, and any other word is a flag (`ts snippet`). `line` is the line of the opening fence (1-based).
 * @returns {{ lang: string, flags: string[], file?: string, code: string, line: number }[]}
 */
export function codeBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (!open) continue;
    const fence = open[1];
    const words = open[2].trim().split(/\s+/).filter(Boolean);
    const [lang = "", ...rest] = words;
    let file;
    const flags = [];
    for (const word of rest) {
      if (word.startsWith("file=")) file = word.slice("file=".length);
      else flags.push(word);
    }
    const body = [];
    let end = index + 1;
    const closing = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    while (end < lines.length && !closing.test(lines[end])) body.push(lines[end++]);
    blocks.push({ lang, flags, file, code: body.length === 0 ? "" : `${body.join("\n")}\n`, line: index + 1 });
    index = end;
  }
  return blocks;
}

/** `text` with its code blocks' lines emptied, so headings and links are only read from prose. */
function prose(text) {
  const lines = text.split("\n");
  for (const block of codeBlocks(text)) {
    const last = block.line + block.code.split("\n").length - 1;
    for (let index = block.line - 1; index <= Math.min(last, lines.length - 1); index++) lines[index] = "";
  }
  return lines;
}

/** The anchor GitHub gives a heading with this text. */
export function slug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every anchor a link into `text` can use: the headings' (repeats get -1, -2, …) and explicit `<a id>` or `<a name>`. */
export function anchorsOf(text) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of prose(text)) {
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = slug(heading[1]);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1]);
  }
  return anchors;
}

/** The inline links and images of `text`, outside code: `[x](target)`, with the line they are on. */
export function linksOf(text) {
  const links = [];
  prose(text).forEach((line, index) => {
    const outsideCode = line.replace(/`[^`]*`/g, "");
    for (const match of outsideCode.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) links.push({ target: match[1], line: index + 1 });
  });
  return links;
}
