// From the parsed tree to Markdown's blocks. Formatting is worked out the way a browser shows it, from tags and from
// inline styles together, so the outer `<b style="font-weight:normal">` of Google Docs is not bold and a
// `<span style="font-weight:700">` is. Each run of text keeps the formatting it ends up with; the renderer decides
// where the `**` and `*` go.

import { type ElementNode, type HtmlNode, parseHTML, WORD_MARKER } from "./html.ts";

export interface Link {
  href: string;
  title: string;
}

export interface Style {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  /** Inside `<code>`, `<kbd>`, `<samp>` or `<tt>`. */
  code: boolean;
  /** In a monospaced font, in a copy from Google Docs or Word, where that is how code is written. */
  mono: boolean;
  link: Link | null;
}

export type Leaf =
  | { type: "text"; text: string; raw: string; style: Style }
  | { type: "break"; style: Style }
  | { type: "image"; src: string; alt: string; title: string; style: Style };

export type Align = "center" | "right" | null;

export interface ListItem {
  task: boolean | null;
  blocks: Block[];
}

export interface TableCell {
  blocks: Block[];
  align: Align;
}

export type Block =
  | { type: "paragraph"; leaves: Leaf[] }
  /** A paragraph all in a monospaced font: a line of code, unless the whole copy is in that font. */
  | { type: "mono"; leaves: Leaf[]; raw: string }
  /** An empty paragraph: dropped, except between lines of code. */
  | { type: "blank" }
  | { type: "heading"; level: number; leaves: Leaf[] }
  | { type: "code"; language: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "list"; ordered: boolean; start: number; delimiter: "." | ")"; items: ListItem[] }
  /** A paragraph Word marked as a list item, before the items are put together into lists. */
  | { type: "wordItem"; level: number; ordered: boolean; start: number; blocks: Block[] }
  | { type: "table"; rows: TableCell[][] }
  | { type: "hr" };

export interface Converted {
  blocks: Block[];
  /** Whether monospaced text is code: only when the copy also has text in another font. */
  monoIsCode: boolean;
}

interface Context {
  office: boolean;
  /** Checkboxes already read as a task list item's state. */
  skip: Set<HtmlNode>;
  sawPlainText: boolean;
}

const PLAIN: Style = { bold: false, italic: false, strike: false, code: false, mono: false, link: null };

/** Never shown, or not text: skipped with everything inside. */
const DROPPED = new Set(["head", "script", "style", "template", "svg", "math", "iframe", "object", "embed", "video",
  "audio", "canvas", "noscript", "select", "option", "optgroup", "datalist", "button", "textarea", "input", "title",
  "meta", "link", "base", "map", "area", "source", "track", "param", "frame", "frameset", "noframes", "noembed",
  "applet", "progress", "meter", "rt", "rp", "xml", WORD_MARKER]);
/** Elements that start and end a block of their own. */
const BLOCK = new Set(["address", "article", "aside", "body", "center", "dd", "details", "dialog", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "header", "hgroup", "legend", "main", "nav", "p", "section",
  "summary", "search", "caption", "tbody", "thead", "tfoot", "tr", "td", "th", "colgroup"]);
const HEADING = /^h([1-6])$/;
const LISTS = new Set(["ul", "ol", "dir", "menu"]);
/** Elements that start a new line inside a code block (some code editors put each line in a `<div>`). */
const CODE_LINE = new Set(["div", "p", "li", "tr", "pre", "table", "ul", "ol", "blockquote", "section", "article",
  "header", "footer", "dd", "dt", "h1", "h2", "h3", "h4", "h5", "h6"]);
const OFFICE = /docs-internal-guid|urn:schemas-microsoft-com:office|\bmso-[a-z]|class=["']?Mso/i;
const MONO_FAMILY = /(^|[\s-])mono(space|spaced)?$|^courier|^consolas$|^menlo$|^monaco$|^ui-monospace$|^sfmono|^sf mono$|^source code pro$|^fira code$|^inconsolata$|^lucida (console|sans typewriter)$|^cascadia code$|^hack$|^anonymous pro$/;
const NO_LANGUAGE = new Set(["none", "nohighlight", "no-highlight", "plain", "plaintext", "plain-text", "text", "txt"]);

/** The declarations of a `style` attribute, names and values in lowercase; the last of a name wins. */
function cssOf(node: ElementNode): Map<string, string> | null {
  const text = node.attrs.style;
  if (!text) return null;
  const css = new Map<string, string>();
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).replace(/!\s*important\s*$/i, "").trim().toLowerCase();
    if (name !== "" && value !== "") css.set(name, value);
  }
  return css;
}

export function isMonoFamily(family: string): boolean {
  const first = family.split(",")[0].trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  return MONO_FAMILY.test(first);
}

function fontWeight(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "bold" || value === "bolder") return true;
  if (value === "normal" || value === "lighter") return false;
  const weight = Number.parseFloat(value);
  return Number.isFinite(weight) ? weight >= 600 : undefined;
}

function linkOf(node: ElementNode): Link | null {
  const href = node.attrs.href;
  if (href === undefined) return null;
  const url = href.replace(/[\t\n\r]/g, "").trim();
  if (url === "" || url === "#") return null;
  // A link that runs code when clicked keeps its text and loses the link.
  if (/^(javascript|vbscript|data):/i.test(url.replace(/[\u0000-\u0020]/g, ""))) return null;
  return { href: url, title: (node.attrs.title ?? "").replace(/\s+/g, " ").trim() };
}

/** The formatting inside `node`: its tag first, then its inline style, which wins as it does in a browser. */
function styleOf(node: ElementNode, css: Map<string, string> | null, parent: Style, ctx: Context): Style {
  let { bold, italic, strike, code, mono, link } = parent;
  switch (node.name) {
    case "b": case "strong": bold = true; break;
    case "i": case "em": case "cite": case "dfn": case "var": italic = true; break;
    case "s": case "strike": case "del": strike = true; break;
    case "code": case "kbd": case "samp": case "tt": code = true; break;
    case "a": link = linkOf(node) ?? link; break;
  }
  if (css) {
    bold = fontWeight(css.get("font-weight")) ?? bold;
    const fontStyle = css.get("font-style");
    if (fontStyle !== undefined) italic = /^(italic|oblique)/.test(fontStyle) ? true : fontStyle === "normal" ? false : italic;
    // A line-through cannot be taken off by an element inside it, so "none" changes nothing.
    if (`${css.get("text-decoration") ?? ""} ${css.get("text-decoration-line") ?? ""}`.includes("line-through")) strike = true;
    const family = css.get("font-family");
    if (ctx.office && family !== undefined) mono = isMonoFamily(family);
  }
  if (bold === parent.bold && italic === parent.italic && strike === parent.strike && code === parent.code
    && mono === parent.mono && link === parent.link) return parent;
  return { bold, italic, strike, code, mono, link };
}

/** Whether the element is shown at all: not hidden, not `display: none`, not one of Word's list markers. */
function shown(node: ElementNode, css: Map<string, string> | null): boolean {
  if (DROPPED.has(node.name) || node.name.startsWith("v:") || "hidden" in node.attrs) return false;
  if (node.name === "dialog" && !("open" in node.attrs)) return false;
  if (!css) return true;
  return css.get("display") !== "none" && css.get("mso-hide") !== "all" && css.get("mso-list") !== "ignore";
}

const hasText = (text: string): boolean => /[^ \t\n\f\r\u00a0\u200b\ufeff]/.test(text);

export function hasContent(leaves: Leaf[]): boolean {
  return leaves.some((leaf) => leaf.type === "image" || (leaf.type === "text" && leaf.text !== ""));
}

/** Drops the spaces at the end of each line, and line breaks before the first and after the last content. */
function trimLeaves(leaves: Leaf[]): Leaf[] {
  const out: Leaf[] = [];
  const trimLine = () => {
    for (let at = out.length - 1; at >= 0; at--) {
      const leaf = out[at];
      if (leaf.type !== "text") break;
      const text = leaf.text.replace(/ +$/, "");
      out[at] = { ...leaf, text };
      if (text !== "") break;
    }
  };
  for (const leaf of leaves) {
    if (leaf.type === "break") {
      trimLine();
      if (hasContent(out)) out.push(leaf);
    } else out.push(leaf);
  }
  trimLine();
  while (out.length > 0 && out[out.length - 1].type === "break") out.pop();
  // Leaves made empty by the trimming go, unless they hold a code line's indentation.
  return out.filter((leaf) => leaf.type !== "text" || leaf.text !== "" || leaf.raw !== "");
}

/** Collects the inline content of a block, and the blocks it holds. */
class Sink {
  readonly blocks: Block[] = [];
  private leaves: Leaf[] = [];
  /** The last thing written was a space or a line's start: a space now would be one too many. */
  private space = true;
  /** Something went in since the last block, if only white space or a line break. */
  private touched = false;
  private readonly ctx: Context;
  /** A heading's sink: line breaks and blocks inside become spaces. */
  readonly inline: boolean;

  constructor(ctx: Context, inline = false) {
    this.ctx = ctx;
    this.inline = inline;
  }

  text(value: string, style: Style): void {
    if (value === "") return;
    this.touched = true;
    const clean = value.replace(/\u00a0/g, " ").replace(/[\u200b\ufeff]/g, "");
    let text = clean.replace(/[ \t\n\f\r]+/g, " ");
    const raw = this.ctx.office && style.mono ? clean.replace(/\n/g, " ") : "";
    if (this.space && text.startsWith(" ")) text = text.slice(1);
    if (text === "") {
      if (raw !== "") this.leaves.push({ type: "text", text: "", raw, style });
      return;
    }
    if (!style.mono && text !== " ") this.ctx.sawPlainText = true;
    this.leaves.push({ type: "text", text, raw, style });
    this.space = text.endsWith(" ");
  }

  lineBreak(style: Style): void {
    if (this.inline) {
      this.text(" ", style);
      return;
    }
    this.touched = true;
    this.leaves.push({ type: "break", style });
    this.space = true;
  }

  image(src: string, alt: string, title: string, style: Style): void {
    this.touched = true;
    this.leaves.push({ type: "image", src, alt, title, style });
    this.space = false;
  }

  /** Ends the paragraph being collected. */
  flush(): void {
    const leaves = trimLeaves(this.leaves);
    const touched = this.touched;
    this.leaves = [];
    this.space = true;
    this.touched = false;
    if (!hasContent(leaves)) {
      if (touched) this.blocks.push({ type: "blank" });
      return;
    }
    if (this.ctx.office && isMono(leaves)) {
      this.blocks.push({ type: "mono", leaves, raw: monoText(leaves) });
      return;
    }
    // Two line breaks in a row look like the end of a paragraph, and become one.
    let part: Leaf[] = [];
    for (let at = 0; at < leaves.length; at++) {
      const leaf = leaves[at];
      if (leaf.type === "break" && leaves[at + 1]?.type === "break") {
        while (leaves[at + 1]?.type === "break") at++;
        this.paragraph(part);
        part = [];
        continue;
      }
      part.push(leaf);
    }
    this.paragraph(part);
  }

  private paragraph(leaves: Leaf[]): void {
    const trimmed = trimLeaves(leaves);
    if (hasContent(trimmed)) this.blocks.push({ type: "paragraph", leaves: trimmed });
  }

  /** The leaves of an inline-only sink (a heading), trimmed. */
  inlineLeaves(): Leaf[] {
    const leaves = trimLeaves(this.leaves);
    this.leaves = [];
    return leaves;
  }

  finish(): Block[] {
    this.flush();
    return mergeLists(groupWordItems(this.blocks));
  }
}

function isMono(leaves: Leaf[]): boolean {
  let any = false;
  for (const leaf of leaves) {
    if (leaf.type === "image") return false;
    if (leaf.type !== "text" || leaf.text.trim() === "") continue;
    if (!leaf.style.mono) return false;
    any = true;
  }
  return any;
}

function monoText(leaves: Leaf[]): string {
  const text = leaves.map((leaf) => leaf.type === "break" ? "\n" : leaf.type === "text" ? (leaf.style.mono ? leaf.raw : leaf.text) : "")
    .join("");
  return text.split("\n").map((line) => line.replace(/\s+$/, "")).join("\n");
}

/** Word writes a list as paragraphs with a level each; this puts them back together as nested lists. */
function groupWordItems(blocks: Block[]): Block[] {
  if (!blocks.some((block) => block.type === "wordItem")) return blocks;
  const out: Block[] = [];
  let at = 0;
  while (at < blocks.length) {
    if (blocks[at].type !== "wordItem") {
      out.push(blocks[at]);
      at++;
      continue;
    }
    const run: Extract<Block, { type: "wordItem" }>[] = [];
    while (at < blocks.length) {
      const block = blocks[at];
      if (block.type === "wordItem") {
        run.push(block);
        at++;
        continue;
      }
      // Empty paragraphs between two items stay inside the list.
      let next = at;
      while (next < blocks.length && blocks[next].type === "blank") next++;
      if (next > at && blocks[next]?.type === "wordItem") {
        at = next;
        continue;
      }
      break;
    }
    out.push(...buildWordLists(run));
  }
  return out;
}

type ListBlock = Extract<Block, { type: "list" }>;

function buildWordLists(items: Extract<Block, { type: "wordItem" }>[]): Block[] {
  const top: Block[] = [];
  const stack: ListBlock[] = [];
  for (const item of items) {
    const level = Math.min(Math.max(item.level, 1), 9);
    while (stack.length > level) stack.pop();
    if (stack.length === level && stack[level - 1].ordered !== item.ordered) stack.pop();
    while (stack.length < level) {
      const list: ListBlock = { type: "list", ordered: item.ordered, start: item.start, delimiter: ".", items: [] };
      const parent = stack[stack.length - 1];
      if (!parent) top.push(list);
      else {
        if (parent.items.length === 0) parent.items.push({ task: null, blocks: [] });
        parent.items[parent.items.length - 1].blocks.push(list);
      }
      stack.push(list);
    }
    stack[stack.length - 1].items.push({ task: null, blocks: item.blocks });
  }
  return top;
}

/**
 * Lists next to each other become one: Notion writes each item as a list of its own, and Google Docs splits lists
 * too. A numbered list that does not carry on from the one before gets the other delimiter, to stay apart.
 */
function mergeLists(blocks: Block[]): Block[] {
  if (!blocks.some((block) => block.type === "list")) return blocks;
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.type !== "list") {
      out.push(block);
      continue;
    }
    let previous = out.length - 1;
    while (previous >= 0 && out[previous].type === "blank") previous--;
    const before = out[previous];
    if (before?.type === "list" && before.ordered === block.ordered) {
      if (!block.ordered || block.start === before.start + before.items.length) {
        out.length = previous + 1;
        before.items.push(...block.items);
        continue;
      }
      out.push({ ...block, delimiter: before.delimiter === "." ? ")" : "." });
      continue;
    }
    out.push(block);
  }
  return out;
}

function walkChildren(node: ElementNode, style: Style, sink: Sink, ctx: Context): void {
  for (const child of node.children) walk(child, style, sink, ctx);
}

/** A block element inside a heading or other inline-only place: its content with a space on each side. */
function inlineBlock(node: ElementNode, style: Style, sink: Sink, ctx: Context): void {
  sink.text(" ", style);
  walkChildren(node, style, sink, ctx);
  sink.text(" ", style);
}

function walk(node: HtmlNode, style: Style, sink: Sink, ctx: Context): void {
  if (node.type === "text") {
    sink.text(node.text, style);
    return;
  }
  if (ctx.skip.has(node)) return;
  const css = cssOf(node);
  if (!shown(node, css)) return;
  const own = styleOf(node, css, style, ctx);
  const name = node.name;

  if (name === "br") return sink.lineBreak(own);
  if (name === "img") return image(node, own, sink);
  const heading = HEADING.exec(name);
  if (sink.inline && (heading || name === "hr" || name === "pre" || name === "listing" || name === "ul" || name === "ol"
    || name === "li" || name === "blockquote" || name === "table" || name === "dir" || name === "menu")) {
    return inlineBlock(node, own, sink, ctx);
  }
  if (name === "hr") {
    sink.flush();
    sink.blocks.push({ type: "hr" });
    return;
  }
  if (heading) return headingBlock(node, Number(heading[1]), own, sink, ctx);
  if (name === "ul" || name === "ol" || name === "dir" || name === "menu") return list(node, name === "ol", own, sink, ctx);
  if (name === "li") return orphanItem(node, own, sink, ctx);
  if (name === "blockquote") {
    sink.flush();
    const inner = new Sink(ctx);
    walkChildren(node, own, inner, ctx);
    const blocks = inner.finish();
    if (blocks.some((block) => block.type !== "blank")) sink.blocks.push({ type: "quote", blocks });
    return;
  }
  if (name === "pre" || name === "listing") return codeBlock(node, languageOf(node), sink);
  if (name === "table") return table(node, own, sink, ctx);

  if (name === "p" || name === "div") {
    const level = /level(\d+)/.exec(css?.get("mso-list") ?? "");
    if (level && !sink.inline) return wordItem(node, Number(level[1]), own, sink, ctx);
    if (!sink.inline && /(^|\s)MsoTitle(\s|$)/.test(node.attrs.class ?? "")) return headingBlock(node, 1, own, sink, ctx);
    // Code copied from a code editor: lines in a monospaced, preformatted block.
    const whiteSpace = css?.get("white-space");
    const family = css?.get("font-family");
    if (!sink.inline && (whiteSpace === "pre" || whiteSpace === "pre-wrap") && family !== undefined && isMonoFamily(family)) {
      return codeBlock(node, "", sink);
    }
  }

  const display = css?.get("display");
  const block = display === undefined ? BLOCK.has(name)
    : display.startsWith("inline") || display === "contents" ? false
    : /^(block|flex|grid|flow-root|list-item|table)/.test(display) ? true : BLOCK.has(name);
  if (!block) return walkChildren(node, own, sink, ctx);
  if (sink.inline) return inlineBlock(node, own, sink, ctx);
  sink.flush();
  walkChildren(node, own, sink, ctx);
  sink.flush();
}

function image(node: ElementNode, style: Style, sink: Sink): void {
  const attrs = node.attrs;
  if (/checkbox/i.test(attrs["aria-roledescription"] ?? attrs.roledescription ?? "")) return;
  // A one-pixel image is a tracking pixel or a spacer.
  if (/^[01](px)?$/.test(attrs.width ?? "") && /^[01](px)?$/.test(attrs.height ?? "")) return;
  let src = (attrs.src ?? "").replace(/[\t\n\r]/g, "").trim();
  if ((src === "" || /^data:/i.test(src)) && attrs["data-src"]) src = attrs["data-src"].replace(/[\t\n\r]/g, "").trim();
  const alt = (attrs.alt ?? "").replace(/\s+/g, " ").trim();
  // An image inside the copy itself would be pages of base64; its description stays.
  if (src === "" || /^(data|javascript|vbscript):/i.test(src.replace(/[\u0000-\u0020]/g, ""))) {
    if (alt !== "") sink.text(alt, style);
    return;
  }
  sink.image(src, alt, (attrs.title ?? "").replace(/\s+/g, " ").trim(), style);
}

function headingBlock(node: ElementNode, level: number, style: Style, sink: Sink, ctx: Context): void {
  sink.flush();
  const inner = new Sink(ctx, true);
  walkChildren(node, style, inner, ctx);
  const leaves = inner.inlineLeaves();
  if (hasContent(leaves)) sink.blocks.push({ type: "heading", level, leaves });
}

/** A Word list paragraph: its bullet or number says whether the list is numbered, its style gives the level. */
function wordItem(node: ElementNode, level: number, style: Style, sink: Sink, ctx: Context): void {
  sink.flush();
  const marker = markerText(node, 0) ?? "";
  const number = /^\(?([0-9]{1,9})[.)]/.exec(marker);
  const ordered = /^\(?([0-9]{1,9}|[a-z]{1,3}|[ivxlcdm]{1,8})[.)]$/i.test(marker);
  const inner = new Sink(ctx);
  walkChildren(node, style, inner, ctx);
  sink.blocks.push({ type: "wordItem", level, ordered, start: number ? Number(number[1]) : 1, blocks: inner.finish() });
}

/** The text of a Word list paragraph's own bullet or number. */
function markerText(node: ElementNode, depth: number): string | null {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const css = cssOf(child);
    if (child.name === WORD_MARKER || css?.get("mso-list") === "ignore") {
      return textOf(child).replace(/[\s\u00a0]+/g, " ").trim();
    }
    if (depth < 3) {
      const found = markerText(child, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function textOf(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  return node.children.map(textOf).join("");
}

function parseStart(value: string | undefined): number {
  const start = Number.parseInt(value ?? "", 10);
  return Number.isFinite(start) ? Math.min(Math.max(start, 0), 999_999_999) : 1;
}

function list(node: ElementNode, ordered: boolean, style: Style, sink: Sink, ctx: Context): void {
  sink.flush();
  const items: { task: boolean | null; sink: Sink }[] = [];
  const last = () => {
    if (items.length === 0) items.push({ task: null, sink: new Sink(ctx) });
    return items[items.length - 1].sink;
  };
  const visit = (parent: ElementNode, parentStyle: Style) => {
    for (const child of parent.children) {
      if (child.type === "text") {
        if (hasText(child.text)) walk(child, parentStyle, last(), ctx);
        continue;
      }
      if (ctx.skip.has(child)) continue;
      const css = cssOf(child);
      if (!shown(child, css)) continue;
      const childStyle = styleOf(child, css, parentStyle, ctx);
      if (child.name === "li") {
        const task = taskOf(child, ctx);
        const itemSink = new Sink(ctx);
        walkChildren(child, childStyle, itemSink, ctx);
        items.push({ task, sink: itemSink });
      } else if (!BLOCK.has(child.name) && !LISTS.has(child.name)
        && child.children.some((inner) => inner.type === "element" && inner.name === "li")) {
        visit(child, childStyle); // items wrapped in a stray inline element
      } else {
        walk(child, parentStyle, last(), ctx); // a nested list right inside the list belongs to the item before it
      }
    }
  };
  visit(node, style);
  if (items.length === 0) return;
  const start = ordered ? parseStart(node.attrs.start) : 1;
  sink.blocks.push({ type: "list", ordered, start, delimiter: ".", items: items.map(({ task, sink: itemSink }) => ({ task, blocks: itemSink.finish() })) });
}

/** A `<li>` outside any list is a bullet of its own. */
function orphanItem(node: ElementNode, style: Style, sink: Sink, ctx: Context): void {
  sink.flush();
  const task = taskOf(node, ctx);
  const inner = new Sink(ctx);
  walkChildren(node, style, inner, ctx);
  sink.blocks.push({ type: "list", ordered: false, start: 1, delimiter: ".", items: [{ task, blocks: inner.finish() }] });
}

type Checkbox = { node: ElementNode; checked: boolean | null } | "stop" | null;

/**
 * A task list item's state: `aria-checked` (Google Docs), `data-checked` or `data-list` (web editors), or a
 * checkbox before the text: an `<input type="checkbox">` (rendered Markdown) or a `div.checkbox` (Notion).
 */
function taskOf(item: ElementNode, ctx: Context): boolean | null {
  const flag = (value: string | undefined) => value === "true" ? true : value === "false" ? false : null;
  const list = item.attrs["data-list"];
  let state = flag(item.attrs["aria-checked"]) ?? flag(item.attrs["data-checked"])
    ?? (list === "checked" ? true : list === "unchecked" ? false : null);
  const box = leadingCheckbox(item, 0, state !== null);
  if (box !== null && box !== "stop") {
    ctx.skip.add(box.node);
    state ??= box.checked ?? false;
  }
  return state;
}

function leadingCheckbox(node: ElementNode, depth: number, isTask: boolean): Checkbox {
  for (const child of node.children) {
    if (child.type === "text") {
      if (hasText(child.text)) return "stop";
      continue;
    }
    const attrs = child.attrs;
    if (child.name === "input") {
      if ((attrs.type ?? "").toLowerCase() === "checkbox") return { node: child, checked: "checked" in attrs };
      continue;
    }
    if (child.name === "img") {
      const described = /checkbox/i.test(attrs["aria-roledescription"] ?? attrs.roledescription ?? "");
      return described || isTask ? { node: child, checked: null } : "stop";
    }
    const classes = ` ${(attrs.class ?? "").toLowerCase()} `;
    if (classes.includes(" checkbox ")) return { node: child, checked: classes.includes(" checkbox-on ") };
    if (attrs.role === "checkbox") return { node: child, checked: attrs["aria-checked"] === "true" };
    if (depth >= 3 || !/^(span|div|p|label|a|b|strong|i|em|font)$/.test(child.name)) return "stop";
    const found = leadingCheckbox(child, depth + 1, isTask);
    if (found !== null) return found;
  }
  return null;
}

/** The text of a code block, its line breaks kept. */
function codeText(node: ElementNode): string {
  const parts: string[] = [];
  let atLineStart = true;
  const write = (text: string) => {
    if (text === "") return;
    parts.push(text);
    atLineStart = text.endsWith("\n");
  };
  const newLine = () => {
    if (!atLineStart) write("\n");
  };
  const visit = (current: HtmlNode) => {
    if (current.type === "text") return write(current.text);
    const css = cssOf(current);
    if (!shown(current, css)) return;
    if (current.name === "br") return write("\n");
    const line = CODE_LINE.has(current.name);
    if (line) newLine();
    for (const child of current.children) visit(child);
    if (line) newLine();
  };
  for (const child of node.children) visit(child);
  return parts.join("").replace(/\u00a0/g, " ").replace(/[\u200b\ufeff]/g, "").replace(/^\n+/, "").replace(/\s+$/, "");
}

function codeBlock(node: ElementNode, language: string, sink: Sink): void {
  sink.flush();
  const text = codeText(node);
  if (hasText(text)) sink.blocks.push({ type: "code", language, text });
}

function languageName(value: string): string {
  const name = value.trim().toLowerCase();
  return /^[a-z0-9_+#.-]{1,30}$/.test(name) && !NO_LANGUAGE.has(name) ? name : "";
}

/** A code block's language: `language-js` (syntax highlighters, Notion), `highlight-source-js` (rendered READMEs), `data-lang`. */
function languageOf(pre: ElementNode): string {
  const candidates: ElementNode[] = [pre];
  const code = pre.children.find((child): child is ElementNode => child.type === "element" && child.name === "code");
  if (code) candidates.push(code);
  if (pre.parent) candidates.push(pre.parent);
  if (pre.parent?.parent) candidates.push(pre.parent.parent);
  for (const candidate of candidates) {
    const data = candidate.attrs["data-language"] ?? candidate.attrs["data-lang"];
    if (data && languageName(data)) return languageName(data);
    for (const token of (candidate.attrs.class ?? "").split(/\s+/)) {
      const match = /^(?:language|lang)-(.+)$/i.exec(token) ?? /^highlight-(?:source|text)-([a-z0-9+#]+)/i.exec(token);
      if (match && languageName(match[1])) return languageName(match[1]);
    }
  }
  return "";
}

function alignOf(cell: ElementNode, css: Map<string, string> | null): Align {
  const value = (css?.get("text-align") ?? cell.attrs.align ?? "").toLowerCase();
  if (value.includes("center")) return "center";
  if (value === "right" || value === "end") return "right";
  return null; // left is how Markdown tables are drawn anyway
}

const MAX_COLUMNS = 100;

interface PlacedCell extends TableCell {
  colspan: number;
  rowspan: number;
}

function span(value: string | undefined, limit: number): number {
  const count = Number.parseInt(value ?? "", 10);
  return Number.isFinite(count) && count > 1 ? Math.min(count, limit) : 1;
}

function table(node: ElementNode, style: Style, sink: Sink, ctx: Context): void {
  sink.flush();
  const rows: { row: ElementNode; style: Style }[] = [];
  const collect = (parent: ElementNode, parentStyle: Style) => {
    for (const child of parent.children) {
      if (child.type !== "element") continue;
      const css = cssOf(child);
      if (!shown(child, css)) continue;
      const childStyle = styleOf(child, css, parentStyle, ctx);
      if (child.name === "tr") rows.push({ row: child, style: childStyle });
      else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot" || child.name === "form") collect(child, childStyle);
      else if (child.name === "caption") walk(child, parentStyle, sink, ctx);
    }
  };
  collect(node, style);
  sink.flush();

  const grid: PlacedCell[][] = [];
  let cells = 0;
  let layout = false;
  for (const { row, style: rowStyle } of rows) {
    const line: PlacedCell[] = [];
    for (const cell of row.children) {
      if (cell.type !== "element" || (cell.name !== "td" && cell.name !== "th")) continue;
      const css = cssOf(cell);
      if (!shown(cell, css)) continue;
      const inner = new Sink(ctx);
      walkChildren(cell, styleOf(cell, css, rowStyle, ctx), inner, ctx);
      const blocks = inner.finish();
      // A table used for layout (an email's columns, a cell holding a list or a heading) is read as its content.
      if (blocks.some((block) => block.type !== "paragraph" && block.type !== "mono" && block.type !== "blank")) layout = true;
      line.push({ blocks, align: alignOf(cell, css), colspan: span(cell.attrs.colspan, 50), rowspan: span(cell.attrs.rowspan, 1000) });
      cells++;
    }
    if (line.length > 0) grid.push(line);
  }
  if (cells === 0) return;
  const placed = layout || cells === 1 ? null : place(grid);
  if (placed === null) {
    for (const line of grid) for (const cell of line) sink.blocks.push(...cell.blocks);
    return;
  }
  const columns = placed.reduce((widest, line) => Math.max(widest, line.length), 0);
  sink.blocks.push({ type: "table", rows: placed.map((line) => Array.from({ length: columns }, (_, at) => line[at] ?? { blocks: [], align: null })) });
}

/**
 * Puts cells on a grid, leaving empty cells where an earlier cell spans rows or columns. Null when the grid grows
 * wider than MAX_COLUMNS: no one reads a Markdown table that wide, and spans could make it grow without end.
 */
function place(grid: PlacedCell[][]): TableCell[][] | null {
  const placed: TableCell[][] = [];
  const carry: number[] = [];
  const empty = (): TableCell => ({ blocks: [], align: null });
  for (const cells of grid) {
    const line: TableCell[] = [];
    let column = 0;
    const skipCarried = () => {
      while ((carry[column] ?? 0) > 0) {
        line[column] = empty();
        carry[column]--;
        column++;
      }
    };
    for (const cell of cells) {
      skipCarried();
      line[column] = cell;
      for (let offset = 0; offset < cell.colspan; offset++) {
        if (offset > 0) line[column + offset] = empty();
        if (cell.rowspan > 1) carry[column + offset] = cell.rowspan - 1;
      }
      column += cell.colspan;
    }
    for (let at = column; at < carry.length; at++) {
      if ((carry[at] ?? 0) > 0) {
        line[at] = empty();
        carry[at]--;
      }
    }
    if (line.length > MAX_COLUMNS) return null;
    placed.push(line);
  }
  return placed;
}

/** Parses clipboard HTML and turns it into Markdown's blocks. */
export function convert(html: string): Converted {
  const ctx: Context = { office: OFFICE.test(html), skip: new Set(), sawPlainText: false };
  const sink = new Sink(ctx);
  walkChildren(parseHTML(html), PLAIN, sink, ctx);
  const blocks = sink.finish();
  return { blocks, monoIsCode: ctx.office && ctx.sawPlainText };
}
