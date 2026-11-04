// Cutting and splitting text for the on-device model, which reads a few thousand words at most.
// Everything here is linear in the text's length: no regular expression runs over the whole text.

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The marker put where a part of a long text is left out. The instructions tell the model what it means. */
export const omitted = "[…]";

/** The last grapheme boundary at or before `index`, so a cut never splits an accented letter or an emoji. */
function boundaryBefore(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  const from = Math.max(0, index - 64);
  let boundary = from;
  for (const { index: at } of graphemes.segment(text.slice(from, index + 64))) {
    if (from + at > index) break;
    boundary = from + at;
  }
  return boundary;
}

/** The first `limit` characters, ended at a line break or a space near the limit when there is one. */
export function head(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const end = boundaryBefore(text, limit);
  const line = text.lastIndexOf("\n", end);
  if (line > end * 0.75) return text.slice(0, line).trimEnd();
  const space = text.lastIndexOf(" ", end);
  if (space > 0 && space >= end - Math.max(40, end * 0.1)) return text.slice(0, space).trimEnd();
  return text.slice(0, end);
}

/** The last `limit` characters, started after a line break or a space near the limit when there is one. */
export function tail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const start = boundaryBefore(text, text.length - limit);
  const window = text.length - start;
  const line = text.indexOf("\n", start);
  if (line !== -1 && text.length - line > window * 0.75) return text.slice(line + 1).trimStart();
  const space = text.indexOf(" ", start);
  if (space !== -1 && space - start <= Math.max(40, window * 0.1)) return text.slice(space + 1).trimStart();
  return text.slice(start);
}

/** A text of at most `budget` characters: its start and its end, with the marker where the middle was. */
export function shortenMiddle(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const room = budget - omitted.length - 2;
  return `${head(text, Math.floor(room * 0.65))}\n${omitted}\n${tail(text, Math.floor(room * 0.35))}`;
}

/** One stretch of the text the model rewrites on its own, with the whitespace around it kept aside. */
export interface Part {
  before: string;
  core: string;
  after: string;
}

/** Where to end a part that starts at `start`: a paragraph break, else a sentence or line end, else a space. */
function partEnd(text: string, start: number, size: number): number {
  const limit = start + size;
  if (limit >= text.length) return text.length;
  const floor = start + Math.floor(size / 2);
  const paragraph = text.lastIndexOf("\n\n", limit);
  if (paragraph >= floor) return paragraph;
  const sentence = Math.max(text.lastIndexOf(". ", limit), text.lastIndexOf("! ", limit), text.lastIndexOf("? ", limit),
    text.lastIndexOf("。", limit), text.lastIndexOf("！", limit), text.lastIndexOf("？", limit), text.lastIndexOf("\n", limit));
  if (sentence >= floor) return sentence + 1;
  const space = text.lastIndexOf(" ", limit);
  if (space >= floor) return space;
  return Math.max(start + 1, boundaryBefore(text, limit));
}

/** How a part is measured in tokens: the most a part may hold, and what each code point counts. */
export interface Measure {
  tokens: number;
  weigh: (point: number) => number;
}

/** How many characters from `start` stay within `size` characters and the measure's tokens. */
function windowFrom(text: string, start: number, size: number, measure: Measure | undefined): number {
  const end = Math.min(text.length, start + size);
  if (measure === undefined) return end - start;
  let used = 0;
  let index = start;
  while (index < end) {
    const point = text.codePointAt(index) ?? 0;
    used += measure.weigh(point);
    if (used > measure.tokens) break;
    index += point > 0xffff ? 2 : 1;
  }
  return Math.max(1, index - start);
}

/**
 * The text in parts of at most `size` characters, and at most `measure.tokens` tokens when a measure is given, cut
 * where paragraphs, then sentences, then words end. Joining every part's `before`, `core` and `after` gives the
 * text back exactly.
 */
export function splitIntoParts(text: string, size: number, measure?: Measure): Part[] {
  const parts: Part[] = [];
  let start = 0;
  while (start < text.length) {
    const end = partEnd(text, start, windowFrom(text, start, size, measure));
    const piece = text.slice(start, end);
    const core = piece.trim();
    if (core === "" && parts.length > 0) {
      parts[parts.length - 1].after += piece;
    } else {
      const before = piece.slice(0, piece.length - piece.trimStart().length);
      parts.push({ before, core, after: piece.slice(before.length + core.length) });
    }
    start = end;
  }
  return parts;
}

/** A text with its line ends made plain and the spaces at the end of each line and of the whole taken off. */
function plain(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
}

/**
 * Whether two texts are the same, letter for letter. Only the spaces at line ends and around the whole are set
 * aside: a change of case or of a full stop is a change, and Fix's whole point.
 */
export function sameText(a: string, b: string): boolean {
  return plain(a) === plain(b);
}
