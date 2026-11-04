// From Markdown's blocks to text. Inline formatting is written as a stack of delimiters over runs of text: the
// format that lasts longest opens first, so `**bold *and italic***` comes out nested, and formats that cross are
// closed and opened again. Spaces at the edge of a run move outside its delimiters, since `** bold**` is not bold,
// and text is escaped only where Markdown would otherwise read it as syntax.

import { type Block, convert, type Leaf, type Link, type TableCell } from "./convert.ts";

interface Options {
  monoIsCode: boolean;
}

type Format = "link" | "bold" | "italic" | "strike";
const FORMATS: Format[] = ["link", "bold", "italic", "strike"];

interface Piece {
  kind: "text" | "code" | "break" | "image" | "autolink";
  text: string;
  /** White space or a line break: it keeps only the formatting the content on both sides of it shares. */
  gap: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link: Link | null;
  src: string;
  alt: string;
  title: string;
}

/** The same `<a>`: two links next to each other stay two, even to one address. */
const sameLink = (a: Link | null, b: Link | null): boolean => a !== null && a === b;

function has(piece: Piece, format: Format): boolean {
  return format === "link" ? piece.link !== null : piece[format];
}

function shares(a: Piece, b: Piece, format: Format): boolean {
  return format === "link" ? sameLink(a.link, b.link) : a[format] && b[format];
}

function piece(kind: Piece["kind"], text: string, gap: boolean, leaf: Leaf): Piece {
  const { bold, italic, strike, link } = leaf.style;
  return { kind, text, gap, bold, italic, strike, link, src: "", alt: "", title: "" };
}

const AUTOLINK = /^(?:https?|ftp):\/\/[^\s<>]+$|^mailto:[^\s<>]+$/i;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/;

function toPieces(leaves: Leaf[], options: Options, stripBold: boolean): Piece[] {
  const pieces: Piece[] = [];
  for (const leaf of leaves) {
    if (leaf.type === "break") {
      pieces.push(piece("break", "", true, leaf));
      continue;
    }
    if (leaf.type === "image") {
      pieces.push({ ...piece("image", "", false, leaf), src: leaf.src, alt: leaf.alt, title: leaf.title });
      continue;
    }
    if (leaf.text === "") continue;
    if (leaf.text.trim() === "") {
      pieces.push(piece("text", " ", true, leaf));
      continue;
    }
    const code = leaf.style.code || (options.monoIsCode && leaf.style.mono);
    let text = leaf.text;
    const lead = text.startsWith(" ");
    const trail = text.endsWith(" ");
    if (lead) text = text.slice(1);
    if (trail) text = text.slice(0, -1);
    if (lead) pieces.push(piece("text", " ", true, leaf));
    pieces.push(piece(code ? "code" : "text", text, false, leaf));
    if (trail) pieces.push(piece("text", " ", true, leaf));
  }

  // White space and line breaks take only the formatting of the content on both sides.
  const count = pieces.length;
  const before = new Int32Array(count);
  const after = new Int32Array(count);
  for (let at = 0, last = -1; at < count; at++) {
    before[at] = last;
    if (!pieces[at].gap) last = at;
  }
  for (let at = count - 1, last = -1; at >= 0; at--) {
    after[at] = last;
    if (!pieces[at].gap) last = at;
  }
  for (let at = 0; at < count; at++) {
    const gap = pieces[at];
    if (!gap.gap) continue;
    const left = pieces[before[at]];
    const right = pieces[after[at]];
    const both = left !== undefined && right !== undefined;
    gap.bold = both && left.bold && right.bold;
    gap.italic = both && left.italic && right.italic;
    gap.strike = both && left.strike && right.strike;
    gap.link = both && sameLink(left.link, right.link) ? left.link : null;
  }

  // A heading or a header cell that is bold all through is bold already.
  if (stripBold && pieces.some((one) => !one.gap) && pieces.every((one) => one.gap || one.bold)) {
    for (const one of pieces) one.bold = false;
  }

  // A link whose text is its own address is written <https://…>.
  for (let at = 0; at < count; at++) {
    const one = pieces[at];
    const link = one.link;
    if (one.kind !== "text" || link === null || link.title !== "" || !AUTOLINK.test(link.href)) continue;
    if (sameLink(pieces[at - 1]?.link ?? null, link) || sameLink(pieces[at + 1]?.link ?? null, link)) continue;
    // An address written as itself, or an email address that links to itself (`<ada@example.com>` mails it).
    const email = `mailto:${one.text}` === link.href && one.text.length <= 254 && EMAIL.test(one.text);
    if (one.text !== link.href && !email) continue;
    pieces[at] = { ...one, kind: "autolink", text: email ? one.text : link.href, link: null };
  }

  // Runs with the same formatting become one.
  const merged: Piece[] = [];
  for (const one of pieces) {
    const last = merged[merged.length - 1];
    if (last && (one.kind === "text" || one.kind === "code") && last.kind === one.kind && last.bold === one.bold
      && last.italic === one.italic && last.strike === one.strike && last.link === one.link) {
      merged[merged.length - 1] = { ...last, text: last.text + one.text, gap: last.gap && one.gap };
    } else merged.push(one);
  }
  return merged;
}

const ESCAPABLE = /[\\`*_[\]<&~]/g;
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
const ENTITY_LIKE = /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;

/** Escapes what Markdown would read as syntax in text, and leaves the rest alone (`snake_case` stays as it is). */
export function escapeText(text: string, tilde: boolean): string {
  return text.replace(ESCAPABLE, (char: string, at: number) => {
    switch (char) {
      case "\\": {
        const next = text[at + 1];
        return next === undefined || PUNCTUATION.test(next) ? "\\\\" : "\\";
      }
      case "_":
        return WORD.test(text[at - 1] ?? "") && WORD.test(text[at + 1] ?? "") ? "_" : "\\_";
      case "<": {
        const next = text[at + 1];
        return next === undefined || /[A-Za-z/!?]/.test(next) ? "\\<" : "<";
      }
      case "&":
        return ENTITY_LIKE.test(text.slice(at, at + 40)) ? "\\&" : "&";
      case "~":
        return tilde ? "\\~" : "~";
      default:
        return `\\${char}`;
    }
  });
}

function backtickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) === 96) {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }
  return longest;
}

function codeSpan(text: string): string {
  const fence = "`".repeat(backtickRun(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function balanced(url: string): boolean {
  let depth = 0;
  for (const char of url) {
    if (char === "(") depth++;
    else if (char === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/** A link's address as Markdown takes it: as it is, or in `<…>` when it has spaces or unpaired parentheses. */
function destination(url: string): string {
  if (url === "") return "<>";
  if (/[\s<>]/.test(url) || !balanced(url)) return `<${url.replace(/[<>]/g, "\\$&")}>`;
  return url;
}

function titlePart(title: string): string {
  return title === "" ? "" : ` "${title.replace(/["\\]/g, "\\$&")}"`;
}

interface Open {
  format: Format;
  char: string;
  delimiter: string;
  link: Link | null;
}

/** Writes the pieces with their delimiters. A line break is "\n", or `<br>` in a table cell. */
function renderPieces(pieces: Piece[], inCell: boolean): string {
  const count = pieces.length;
  const tilde = pieces.reduce((total, one) => total + (one.kind === "text" ? one.text.split("~").length - 1 : 0), 0) >= 2;
  // Where each format's run that covers a piece ends.
  const ends = new Map<Format, Int32Array>();
  for (const format of FORMATS) {
    const end = new Int32Array(count);
    for (let at = count - 1; at >= 0; at--) {
      end[at] = !has(pieces[at], format) ? at : at + 1 < count && shares(pieces[at], pieces[at + 1], format) ? end[at + 1] : at + 1;
    }
    ends.set(format, end);
  }

  const out: string[] = [];
  const stack: Open[] = [];
  // The `*` delimiters the output ends with, and whether one of them closes something. A closing run that grows to
  // four (`**a*b****c*`) reads wrong, so the opener that would make it so is written with `_` instead.
  let stars = 0;
  let starsClose = false;
  let lastWasText = false;
  const delimiterWritten = (text: string, char: string, closing: boolean) => {
    out.push(text);
    if (char === "*") {
      stars += text.length;
      starsClose ||= closing;
    } else {
      stars = 0;
      starsClose = false;
    }
    lastWasText = false;
  };
  const write = (text: string, isText: boolean) => {
    out.push(text);
    stars = 0;
    starsClose = false;
    lastWasText = isText;
  };
  const open = (format: Format, one: Piece, char: string) => {
    if (format === "link") {
      // "!" right before a link would make it an image.
      const last = out[out.length - 1];
      if (lastWasText && last?.endsWith("!")) out[out.length - 1] = `${last.slice(0, -1)}\\!`;
      delimiterWritten("[", "[", false);
      stack.push({ format, char: "[", delimiter: "[", link: one.link });
      return;
    }
    const delimiter = format === "bold" ? char + char : format === "italic" ? char : "~~";
    delimiterWritten(delimiter, format === "strike" ? "~" : char, false);
    stack.push({ format, char: format === "strike" ? "~" : char, delimiter, link: null });
  };
  const close = (entry: Open) => {
    if (entry.format === "link" && entry.link) {
      delimiterWritten(`](${destination(entry.link.href)}${titlePart(entry.link.title)})`, ")", true);
    } else delimiterWritten(entry.delimiter, entry.char, true);
  };
  const starLength = (format: Format) => format === "bold" ? 2 : format === "italic" ? 1 : 0;

  for (let at = 0; at < count; at++) {
    const one = pieces[at];
    const ending = stack.findIndex((entry) => entry.format === "link" ? !sameLink(entry.link, one.link) : !one[entry.format]);
    if (ending >= 0) {
      for (let top = stack.length - 1; top >= ending; top--) close(stack[top]);
      stack.length = ending;
    }
    const missing = FORMATS.filter((format) => has(one, format) && !stack.some((entry) => entry.format === format));
    missing.sort((a, b) => (ends.get(b)?.[at] ?? 0) - (ends.get(a)?.[at] ?? 0) || FORMATS.indexOf(a) - FORMATS.indexOf(b));
    for (let index = 0; index < missing.length; index++) {
      const format = missing[index];
      let char = "*";
      if (starLength(format) > 0 && starsClose) {
        let added = 0;
        for (let next = index; next < missing.length && starLength(missing[next]) > 0; next++) added += starLength(missing[next]);
        if (stars + added >= 4) char = "_";
      }
      open(format, one, char);
    }
    switch (one.kind) {
      case "text": write(escapeText(one.text, tilde), true); break;
      case "code": write(codeSpan(one.text), false); break;
      case "autolink": write(`<${one.text}>`, false); break;
      case "image": write(`![${escapeText(one.alt, tilde)}](${destination(one.src)}${titlePart(one.title)})`, false); break;
      case "break": write(inCell ? "<br>" : "\n", false); break;
    }
  }
  for (let top = stack.length - 1; top >= 0; top--) close(stack[top]);
  return out.join("");
}

/** A line of a paragraph that Markdown would read as a heading, a quote, a list item or a rule gets a backslash. */
export function escapeLineStart(line: string): string {
  if (/^(?:#{1,6}(?:\s|$)|>|[-+](?:\s|$)|(?:-+|=+)\s*$)/.test(line)) return `\\${line}`;
  const number = /^([0-9]{1,9})[.)](?:\s|$)/.exec(line);
  if (number) return `${number[1]}\\${line.slice(number[1].length)}`;
  return line;
}

function paragraph(leaves: Leaf[], options: Options): string {
  return renderPieces(toPieces(leaves, options, false), false).split("\n").map(escapeLineStart).join("  \n");
}

function heading(level: number, leaves: Leaf[], options: Options): string {
  const text = renderPieces(toPieces(leaves, options, true), false).replace(/\n/g, " ").trim();
  if (text === "") return "";
  // A heading's own closing #s are dropped: `# C #` keeps its last # with a backslash.
  return `${"#".repeat(level)} ${text.replace(/(^|\s)(#+)\s*$/, "$1\\$2")}`;
}

function codeFence(text: string, language: string): string {
  const fence = "`".repeat(Math.max(3, backtickRun(text) + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

/** Drops empty paragraphs, and turns monospaced paragraphs into code blocks, the lines of one block together. */
function prepare(blocks: Block[], options: Options): Block[] {
  const out: Block[] = [];
  for (let at = 0; at < blocks.length; at++) {
    const block = blocks[at];
    if (block.type === "blank") continue;
    if (block.type !== "mono") {
      out.push(block);
      continue;
    }
    if (!options.monoIsCode) {
      out.push({ type: "paragraph", leaves: block.leaves });
      continue;
    }
    const lines = [block.raw];
    let end = at;
    for (let next = at + 1; next < blocks.length; next++) {
      const following = blocks[next];
      if (following.type === "blank") continue;
      if (following.type !== "mono") break;
      for (let empty = end + 1; empty < next; empty++) lines.push("");
      lines.push(following.raw);
      end = next;
    }
    at = end;
    out.push({ type: "code", language: "", text: lines.join("\n") });
  }
  return out;
}

function renderBlocks(blocks: Block[], options: Options, tight: boolean): { text: string; first: Block["type"] | null } {
  const parts: string[] = [];
  let previous: Block["type"] | null = null;
  let first: Block["type"] | null = null;
  for (const block of prepare(blocks, options)) {
    const text = renderBlock(block, options);
    if (text === "") continue;
    if (previous !== null) parts.push(tight && previous === "paragraph" && block.type === "list" ? "\n" : "\n\n");
    parts.push(text);
    previous = block.type;
    first ??= block.type;
  }
  return { text: parts.join(""), first };
}

function renderBlock(block: Block, options: Options): string {
  switch (block.type) {
    case "paragraph": return paragraph(block.leaves, options);
    case "heading": return heading(block.level, block.leaves, options);
    case "code": return codeFence(block.text, block.language);
    case "hr": return "---";
    case "quote": return renderBlocks(block.blocks, options, false).text.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
    case "list": return listBlock(block, options);
    case "table": return tableBlock(block.rows, options);
    default: return "";
  }
}

function listBlock(block: Extract<Block, { type: "list" }>, options: Options): string {
  const lines: string[] = [];
  let number = block.start;
  for (const item of block.items) {
    const marker = block.ordered ? `${number}${block.delimiter} ` : "- ";
    number++;
    const task = item.task === true ? "[x] " : item.task === false ? "[ ] " : "";
    const body = renderBlocks(item.blocks, options, true);
    if (body.text === "") {
      lines.push((marker + task).trimEnd());
      continue;
    }
    const indent = " ".repeat(marker.length);
    const bodyLines = body.text.split("\n");
    const sameLine = body.first === "paragraph" || body.first === "heading" || (body.first === "code" && task === "");
    if (sameLine) lines.push(marker + task + bodyLines.shift());
    else lines.push((marker + task).trimEnd());
    for (const line of bodyLines) lines.push(line === "" ? "" : indent + line);
  }
  return lines.join("\n");
}

const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;
const ZERO_WIDTH = /[\p{M}\u200B-\u200F\uFE0F]/u;

/** How many columns a text takes in a monospaced editor: wide East Asian characters and emoji take two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += ZERO_WIDTH.test(char) ? 0 : WIDE.test(char) ? 2 : 1;
  return width;
}

/** Cells wider than this are not padded: one long cell would push every row out to its width. */
const MAX_PADDED = 50;

function cellText(cell: TableCell, header: boolean, options: Options): string {
  const parts: string[] = [];
  for (const block of prepare(cell.blocks, options)) {
    let text = "";
    if (block.type === "paragraph" || block.type === "heading") text = renderPieces(toPieces(block.leaves, options, header), true);
    else if (block.type === "code") text = codeSpan(block.text.replace(/\s*\n\s*/g, " "));
    if (text !== "") parts.push(text);
  }
  return parts.join("<br>").replace(/\|/g, "\\|");
}

function tableBlock(rows: TableCell[][], options: Options): string {
  const texts = rows.map((row, index) => row.map((cell) => cellText(cell, index === 0, options)));
  const columns = texts[0].length;
  const align = Array.from({ length: columns }, (_, column) => {
    if (rows[0][column].align) return rows[0][column].align;
    let shared: TableCell["align"] = null;
    for (const row of rows.slice(1)) {
      const value = row[column].align;
      if (value === null) continue;
      if (shared !== null && shared !== value) return null;
      shared = value;
    }
    return shared;
  });
  const widths = Array.from({ length: columns }, (_, column) =>
    texts.reduce((widest, row) => Math.max(widest, displayWidth(row[column])), 3));
  const pad = widths.every((width) => width <= MAX_PADDED);
  const cell = (text: string, column: number) => {
    if (!pad) return text;
    const space = widths[column] - displayWidth(text);
    if (align[column] === "right") return " ".repeat(space) + text;
    if (align[column] === "center") return " ".repeat(Math.floor(space / 2)) + text + " ".repeat(Math.ceil(space / 2));
    return text + " ".repeat(space);
  };
  const line = (row: string[]) => `| ${row.map(cell).join(" | ")} |`;
  const rule = align.map((value, column) => {
    const width = pad ? widths[column] : 3;
    if (value === "center") return `:${"-".repeat(width - 2)}:`;
    if (value === "right") return `${"-".repeat(width - 1)}:`;
    return "-".repeat(width);
  });
  return [line(texts[0]), `| ${rule.join(" | ")} |`, ...texts.slice(1).map(line)].join("\n");
}

/** Clipboard HTML as Markdown: "" when nothing in it can be written as text. */
export function htmlToMarkdown(html: string): string {
  const converted = convert(html);
  return renderBlocks(converted.blocks, { monoIsCode: converted.monoIsCode }, false).text.replace(/^\n+/, "").trimEnd();
}
