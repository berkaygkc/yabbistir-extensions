// A small HTML parser for clipboard HTML: a tokenizer and a tree builder that follow the HTML Standard where it
// matters for copied content (implied end tags, void and raw-text elements, misnested formatting, unclosed
// everything) and stay forgiving everywhere else. It runs in one pass, never backtracks, and keeps the tree at most
// MAX_DEPTH deep, so hostile input costs linear time and a bounded stack.

import { decodeEntities } from "./entities.ts";

export interface ElementNode {
  type: "element";
  name: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: ElementNode | null;
}

export interface TextNode {
  type: "text";
  text: string;
}

export type HtmlNode = ElementNode | TextNode;

/** The pseudo-element that holds a Word list item's own bullet or number (`<![if !supportLists]>…<![endif]>`). */
export const WORD_MARKER = "#marker";

/** Deeper elements are kept, but empty: their content joins the deepest open element. Copies nest a few dozen deep. */
const MAX_DEPTH = 100;
/** How many misnested formatting elements are carried over to the next text, at most. */
const MAX_REOPEN = 12;

const VOID = new Set(["area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img", "input",
  "keygen", "link", "meta", "param", "source", "track", "wbr"]);
/** Raw text whose content is never shown, so it is skipped whole. */
const RAW_DROPPED = new Set(["script", "style", "title", "textarea", "iframe", "noembed", "noframes", "noscript"]);
/** Start tags that close an open `<p>`. */
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div",
  "dl", "fieldset", "figcaption", "figure", "footer", "header", "hgroup", "main", "menu", "nav", "ol", "p", "search",
  "section", "summary", "ul", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "listing", "form", "table", "hr", "li", "dd",
  "dt"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
/** Elements a `<li>`, `<dd>` or `<dt>` start tag never closes past (the Standard's "special" category). */
const SPECIAL = new Set(["applet", "area", "article", "aside", "base", "basefont", "bgsound", "blockquote", "body",
  "br", "button", "caption", "center", "col", "colgroup", "dd", "details", "dir", "dl", "dt", "embed", "fieldset",
  "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header",
  "hgroup", "hr", "html", "iframe", "img", "input", "keygen", "li", "link", "listing", "main", "marquee", "menu",
  "meta", "nav", "noembed", "noframes", "noscript", "object", "ol", "param", "plaintext", "pre", "script", "search",
  "section", "select", "source", "style", "summary", "table", "tbody", "td", "template", "textarea", "tfoot", "th",
  "thead", "title", "tr", "track", "ul", "wbr", "xmp"]);
/** Elements that end tags, and `<p>` start tags, do not reach past. */
const SCOPE = new Set(["applet", "caption", "html", "table", "td", "th", "marquee", "object", "template"]);
const BUTTON_SCOPE = new Set([...SCOPE, "button"]);
const LIST_ITEM_SCOPE = new Set([...SCOPE, "ol", "ul"]);
const TABLE_SCOPE = new Set(["html", "table", "template"]);
const TABLE_PARTS = new Set(["table", "caption", "colgroup", "tbody", "thead", "tfoot", "tr", "td", "th"]);
/** Formatting that the Standard carries over when it is closed by mistake: `<b><i>x</b>y` makes y italic. */
const FORMATTING = new Set(["a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong",
  "tt", "u"]);
/** Formatting never leaks into or out of these. */
const MARKERS = new Set(["applet", "caption", "marquee", "object", "td", "th", "template"]);
const HEAD_CONTENT = new Set(["base", "basefont", "bgsound", "link", "meta", "noscript", "script", "style",
  "template", "title"]);
/** Elements that do not take part in the inline formatting that is carried over. */
const BLOCKS = new Set([...CLOSES_P, ...TABLE_PARTS, "body", "html", "head", "#root"]);

function element(name: string, attrs: Record<string, string>, parent: ElementNode | null): ElementNode {
  return { type: "element", name, attrs, children: [], parent };
}

class TreeBuilder {
  readonly root = element("#root", Object.create(null) as Record<string, string>, null);
  private readonly stack: ElementNode[] = [this.root];
  private readonly openCount = new Map<string, number>();
  /** Formatting closed by mistake, to open again before the next text. */
  private pending: ElementNode[] = [];
  /** A newline right after `<pre>` is not part of its content. */
  private dropNewline = false;
  private sawHead = false;

  private get current(): ElementNode {
    return this.stack[this.stack.length - 1];
  }

  private push(node: ElementNode): void {
    this.stack.push(node);
    this.openCount.set(node.name, (this.openCount.get(node.name) ?? 0) + 1);
  }

  /** Pops the stack down to (and including) `index`, keeping the misnested formatting above it for later. */
  private popThrough(index: number): void {
    const carried: ElementNode[] = [];
    for (let at = this.stack.length - 1; at >= index; at--) {
      const node = this.stack[at];
      this.openCount.set(node.name, (this.openCount.get(node.name) ?? 1) - 1);
      if (MARKERS.has(node.name)) {
        carried.length = 0;
        this.pending = [];
      } else if (at > index && FORMATTING.has(node.name)) carried.push(node);
    }
    this.stack.length = index;
    if (carried.length > 0) this.pending = [...this.pending, ...carried.reverse()].slice(-MAX_REOPEN);
  }

  /** Opens the carried-over formatting again, outermost first, inside the current element. */
  private reopen(): void {
    if (this.pending.length === 0) return;
    const pending = this.pending;
    this.pending = [];
    for (const node of pending) {
      if (this.stack.length >= MAX_DEPTH) break;
      const copy = element(node.name, node.attrs, this.current);
      this.current.children.push(copy);
      this.push(copy);
    }
  }

  /** Closes the nearest open element named `name` unless one of `boundary` comes first. */
  private close(name: string, boundary: Set<string>): boolean {
    if ((this.openCount.get(name) ?? 0) <= 0) return false;
    for (let at = this.stack.length - 1; at > 0; at--) {
      const node = this.stack[at];
      if (node.name === name) {
        this.popThrough(at);
        return true;
      }
      if (boundary.has(node.name)) return false;
    }
    return false;
  }

  private closeHead(): void {
    if (this.current.name === "head") this.popThrough(this.stack.length - 1);
  }

  /** `<li>` closes the open `<li>`; `<dd>` and `<dt>` close each other. */
  private closeItem(names: string[]): void {
    for (let at = this.stack.length - 1; at > 0; at--) {
      const node = this.stack[at];
      if (names.includes(node.name)) {
        this.popThrough(at);
        return;
      }
      if (SPECIAL.has(node.name) && node.name !== "address" && node.name !== "div" && node.name !== "p") return;
    }
  }

  /** `<tr>`, `<td>`, `<th>` and the row groups close their open siblings within the same table. */
  private closeTableParts(name: string): void {
    const targets = name === "td" || name === "th" ? ["td", "th"] : name === "tr" ? ["tr"] : ["tbody", "thead", "tfoot"];
    const stops = name === "td" || name === "th" ? ["tr", "table", "tbody", "thead", "tfoot"] : name === "tr"
      ? ["table", "tbody", "thead", "tfoot"] : ["table"];
    for (let at = this.stack.length - 1; at > 0; at--) {
      const node = this.stack[at];
      if (targets.includes(node.name)) {
        this.popThrough(at);
        return;
      }
      if (stops.includes(node.name)) return;
    }
  }

  text(value: string): void {
    let text = value;
    if (this.dropNewline) {
      this.dropNewline = false;
      if (text.startsWith("\n")) text = text.slice(1);
    }
    if (text === "") return;
    const blank = /^[ \t\n\f\r]*$/.test(text);
    if (!blank) {
      this.closeHead();
      this.reopen();
    }
    const parent = this.current;
    const last = parent.children[parent.children.length - 1];
    if (last?.type === "text") last.text += text;
    else parent.children.push({ type: "text", text });
  }

  start(tagName: string, attrs: Record<string, string>, selfClosing: boolean): void {
    this.dropNewline = false;
    const name = tagName === "image" ? "img" : tagName;
    if (name === "html") return;
    if (name === "body") {
      this.closeHead();
      return;
    }
    if (name === "head") {
      if (this.sawHead || this.stack.length > 1) return;
      this.sawHead = true;
    } else if (this.current.name === "head" && !HEAD_CONTENT.has(name)) this.closeHead();

    if (name === "li") this.closeItem(["li"]);
    else if (name === "dd" || name === "dt") this.closeItem(["dd", "dt"]);
    if (CLOSES_P.has(name)) this.close("p", BUTTON_SCOPE);
    if (HEADINGS.has(name) && HEADINGS.has(this.current.name)) this.popThrough(this.stack.length - 1);
    if (name === "a") this.close("a", SCOPE); // links do not nest
    if (name === "tr" || name === "td" || name === "th" || name === "tbody" || name === "thead" || name === "tfoot") {
      this.closeTableParts(name);
    }
    if (MARKERS.has(name)) this.pending = [];
    else if (!BLOCKS.has(name)) this.reopen();

    const node = element(name, attrs, this.current);
    this.current.children.push(node);
    if (VOID.has(name)) return;
    if (selfClosing && name.includes(":")) return; // `<o:p/>` from Office is an empty element
    if (this.stack.length >= MAX_DEPTH) return;
    this.push(node);
    if (name === "pre" || name === "listing") this.dropNewline = true;
  }

  end(tagName: string): void {
    this.dropNewline = false;
    const name = tagName === "image" ? "img" : tagName;
    if (name === "br") {
      this.start("br", Object.create(null) as Record<string, string>, false);
      return;
    }
    if (name === "html" || name === "body" || VOID.has(name)) return;
    if (name === "head") {
      this.closeHead();
      return;
    }
    if (name === "p") {
      if (!this.close("p", BUTTON_SCOPE)) {
        // A `</p>` with no `<p>` open is an empty paragraph, as in a browser: the text around it is on two lines.
        this.start("p", Object.create(null) as Record<string, string>, false);
        this.close("p", BUTTON_SCOPE);
      }
      return;
    }
    if ((this.openCount.get(name) ?? 0) <= 0) {
      // `</b>` for a `<b>` that is waiting to be opened again cancels it.
      const waiting = this.pending.map((node) => node.name).lastIndexOf(name);
      if (waiting >= 0) this.pending.splice(waiting, 1);
      return;
    }
    const boundary = name === "li" ? LIST_ITEM_SCOPE : TABLE_PARTS.has(name) ? TABLE_SCOPE : SCOPE;
    this.close(name, boundary);
  }
}

const SPACE = new Set([9, 10, 12, 13, 32]);

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  end: number;
}

/** Reads a tag from just after `<` (or `</`). Null when the input ends inside it: the Standard then drops the tag. */
function readTag(html: string, start: number): Tag | null {
  const length = html.length;
  let at = start;
  while (at < length) {
    const code = html.charCodeAt(at);
    if (SPACE.has(code) || code === 47 || code === 62) break;
    at++;
  }
  const name = html.slice(start, at).toLowerCase();
  const attrs = Object.create(null) as Record<string, string>;
  let selfClosing = false;
  for (;;) {
    while (at < length && SPACE.has(html.charCodeAt(at))) at++;
    if (at >= length) return null;
    const code = html.charCodeAt(at);
    if (code === 62) {
      at++;
      break;
    }
    if (code === 47) {
      at++;
      if (html.charCodeAt(at) === 62) {
        selfClosing = true;
        at++;
        break;
      }
      continue;
    }
    const nameStart = at;
    at++; // the first character can be anything, even "="
    while (at < length) {
      const next = html.charCodeAt(at);
      if (SPACE.has(next) || next === 47 || next === 62 || next === 61) break;
      at++;
    }
    const attribute = html.slice(nameStart, at).toLowerCase();
    while (at < length && SPACE.has(html.charCodeAt(at))) at++;
    let value = "";
    if (html.charCodeAt(at) === 61) {
      at++;
      while (at < length && SPACE.has(html.charCodeAt(at))) at++;
      const quote = html.charCodeAt(at);
      if (quote === 34 || quote === 39) {
        const close = html.indexOf(quote === 34 ? '"' : "'", at + 1);
        if (close < 0) return null;
        value = html.slice(at + 1, close);
        at = close + 1;
      } else {
        const valueStart = at;
        while (at < length) {
          const next = html.charCodeAt(at);
          if (SPACE.has(next) || next === 62) break;
          at++;
        }
        value = html.slice(valueStart, at);
      }
    }
    if (!(attribute in attrs)) attrs[attribute] = decodeEntities(value, true);
  }
  return { name, attrs, selfClosing, end: at };
}

const endTagPatterns = new Map<string, RegExp>();

/** Where the end tag of a raw-text element starts (`</script`, any case), or -1. */
function findEndTag(html: string, name: string, from: number): number {
  let pattern = endTagPatterns.get(name);
  if (!pattern) {
    pattern = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi");
    endTagPatterns.set(name, pattern);
  }
  pattern.lastIndex = from;
  const match = pattern.exec(html);
  return match ? match.index : -1;
}

/** Just past the `>` that ends the tag starting at `at`, or the end of the input. */
function pastTag(html: string, at: number): number {
  const close = html.indexOf(">", at);
  return close < 0 ? html.length : close + 1;
}

const ENDIF = /<!\[endif\]>/gi;

/** Parses clipboard HTML into a tree whose root is a `#root` element. */
export function parseHTML(source: string): ElementNode {
  const html = source.replace(/\r\n?/g, "\n").replace(/\0/g, "");
  const builder = new TreeBuilder();
  const length = html.length;
  const conditions: boolean[] = []; // true for an open Word list marker
  let at = 0;
  while (at < length) {
    const open = html.indexOf("<", at);
    if (open < 0) {
      builder.text(decodeEntities(html.slice(at)));
      break;
    }
    if (open > at) builder.text(decodeEntities(html.slice(at, open)));
    at = open;
    const next = html.charCodeAt(at + 1);
    if (next === 33) { // "!"
      if (html.startsWith("<!--", at)) {
        if (html.startsWith("<!-->", at)) at += 5;
        else if (html.startsWith("<!--->", at)) at += 6;
        else {
          const close = html.indexOf("-->", at + 4);
          at = close < 0 ? length : close + 3;
        }
        continue;
      }
      if (html.startsWith("<![CDATA[", at)) {
        const close = html.indexOf("]]>", at + 9);
        builder.text(html.slice(at + 9, close < 0 ? length : close));
        at = close < 0 ? length : close + 3;
        continue;
      }
      const close = html.indexOf(">", at + 2);
      const body = html.slice(at + 2, close < 0 ? length : close);
      at = close < 0 ? length : close + 1;
      // Word's conditionals show their content in browsers: `<![if !supportLists]>·<![endif]>` is a list bullet.
      const condition = /^\[if\s+([^\]]*)\]$/i.exec(body);
      if (condition) {
        const test = condition[1].trim().toLowerCase();
        if (test === "!supportlists") {
          conditions.push(true);
          builder.start(WORD_MARKER, Object.create(null) as Record<string, string>, false);
        } else if (test.startsWith("!support")) {
          // Fallbacks for other programs: an empty paragraph's &nbsp;, a spacer row, a doubled line break.
          ENDIF.lastIndex = at;
          const endif = ENDIF.exec(html);
          at = endif ? endif.index + endif[0].length : length;
        } else conditions.push(false);
      } else if (/^\[endif\]$/i.test(body)) {
        if (conditions.pop()) builder.end(WORD_MARKER);
      }
      continue; // a doctype, or a comment of another kind
    }
    if (next === 63) { // "?", such as Word's <?xml:namespace …>
      at = pastTag(html, at);
      continue;
    }
    if (next === 47) { // "/"
      const after = html.charCodeAt(at + 2);
      if (isLetter(after)) {
        const tag = readTag(html, at + 2);
        if (!tag) break;
        builder.end(tag.name);
        at = tag.end;
      } else if (after === 62) at += 3;
      else at = pastTag(html, at);
      continue;
    }
    if (isLetter(next)) {
      const tag = readTag(html, at + 1);
      if (!tag) break;
      at = tag.end;
      if (RAW_DROPPED.has(tag.name)) {
        if (tag.selfClosing && tag.name.includes(":")) continue;
        const close = findEndTag(html, tag.name, at);
        at = close < 0 ? length : pastTag(html, close);
        continue;
      }
      if (tag.name === "xmp" || tag.name === "plaintext") {
        const close = tag.name === "xmp" ? findEndTag(html, "xmp", at) : -1;
        builder.start("pre", Object.create(null) as Record<string, string>, false);
        builder.text(html.slice(at, close < 0 ? length : close));
        builder.end("pre");
        at = close < 0 ? length : pastTag(html, close);
        continue;
      }
      builder.start(tag.name, tag.attrs, tag.selfClosing);
      continue;
    }
    builder.text("<");
    at += 1;
  }
  return builder.root;
}
