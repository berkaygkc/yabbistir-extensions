import type { SourceRow, Sources } from "@yabbistir/api";

import { entityOf } from "./entities.ts";
import { KAOMOJI_GROUPS } from "./kaomoji-data.ts";
import { SYMBOL_GROUPS } from "./symbols-data.ts";

const SEPARATOR = " ‖ ";

/** Names and search words come in two languages; every other app language reads English. */
export type Lang = "en" | "tr";

export function langOf(language: string): Lang {
  return language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export interface SymbolEntry {
  /** Stable row id: the code points in hex, such as `u-2318`. */
  id: string;
  group: string;
  /** The characters to paste. */
  text: string;
  codePoints: number[];
  names: Record<Lang, string>;
}

export interface KaomojiEntry {
  /** Stable row id: the group and the place in the group, such as `shrug-1`. Add new ones at the end of a group. */
  id: string;
  group: string;
  text: string;
  words: Record<Lang, string>;
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, "0");

/** The characters a line's first field stands for: `U+XXXX …` for code points, or the characters themselves. */
function charactersOf(field: string): string {
  if (/^U\+[0-9A-F]{4,6}( U\+[0-9A-F]{4,6})*$/.test(field)) {
    return field.split(" ").map((part) => String.fromCodePoint(parseInt(part.slice(2), 16))).join("");
  }
  return field;
}

function linesOf(block: string): string[][] {
  return block.split("\n").filter((line) => line.trim() !== "").map((line) => line.split(SEPARATOR));
}

function buildSymbols(): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (const group of SYMBOL_GROUPS) {
    for (const [field = "", en = "", tr = ""] of linesOf(group.lines)) {
      const text = charactersOf(field);
      const codePoints = Array.from(text, (character) => character.codePointAt(0) ?? 0);
      entries.push({ id: "u-" + codePoints.map((point) => hex4(point)).join("-"), group: group.id, text, codePoints, names: { en, tr } });
    }
  }
  return entries;
}

function buildKaomoji(): KaomojiEntry[] {
  const entries: KaomojiEntry[] = [];
  for (const group of KAOMOJI_GROUPS) {
    linesOf(group.lines).forEach(([text = "", en = "", tr = ""], index) => {
      entries.push({ id: `${group.id}-${index + 1}`, group: group.id, text, words: { en, tr } });
    });
  }
  return entries;
}

/** Built once per helper; the tables are small. */
let symbols: SymbolEntry[] | undefined;
let kaomoji: KaomojiEntry[] | undefined;
let symbolsById: Map<string, SymbolEntry> | undefined;
let kaomojiById: Map<string, KaomojiEntry> | undefined;

export function allSymbols(): SymbolEntry[] {
  symbols ??= buildSymbols();
  return symbols;
}

export function allKaomoji(): KaomojiEntry[] {
  kaomoji ??= buildKaomoji();
  return kaomoji;
}

/** Characters that show as nothing (spaces, joiners, a soft hyphen): the row's title is their name instead. */
const INVISIBLE = /^[\p{Z}\p{Cf}\p{Cc}]+$/u;

export function isInvisible(text: string): boolean {
  return INVISIBLE.test(text);
}

/**
 * Spaces: the app treats a value of white space only as empty and pastes nothing, so ↵ on these says what to do
 * instead. (A zero-width space or joiner is not white space and pastes as it is.)
 */
export function isBlank(text: string): boolean {
  return /^\p{White_Space}+$/u.test(text);
}

/** `U+2318`, or `U+0041 U+0301` for several code points. */
export function codeOf(codePoints: number[]): string {
  return codePoints.map((point) => "U+" + hex4(point)).join(" ");
}

/** The symbol's HTML form: a named entity where the standard has one, `&#x…;` otherwise. */
export function entityFor(text: string): string {
  return Array.from(text, (character) => entityOf(character.codePointAt(0) ?? 0)).join("");
}

/**
 * Text for Markdown so that a kaomoji survives: a backslash, an underscore, an asterisk, a backtick and a tilde
 * (a double tilde would strike text through) each get a backslash in front.
 */
export function markdownEscape(text: string): string {
  return text.replace(/[\\_*`~]/g, "\\$&");
}

export const sources: Sources = {
  symbols: {
    list(ctx) {
      const lang = langOf(ctx.language);
      const rows: SourceRow[] = allSymbols().map((entry) => {
        const name = entry.names[lang] || entry.names.en;
        // The other language's name rides along when it differs, so a search finds the symbol in both languages.
        const otherName = entry.names[lang === "tr" ? "en" : "tr"];
        const names = otherName && otherName !== name ? `${name} · ${otherName}` : name;
        return {
          id: entry.id,
          title: isInvisible(entry.text) ? `[${name}]` : entry.text,
          subtitle: `${names} · ${codeOf(entry.codePoints)}`,
        };
      });
      return { rows };
    },
    run(rowId, actionId) {
      symbolsById ??= new Map(allSymbols().map((entry) => [entry.id, entry]));
      const entry = symbolsById.get(rowId);
      if (entry === undefined) throw new Error(yab.t("symbolGone"));
      if (actionId === "entity") return { text: entityFor(entry.text) };
      if (isBlank(entry.text)) throw new Error(yab.t("blankSymbol"));
      return { text: entry.text };
    },
  },
  kaomoji: {
    list(ctx) {
      const lang = langOf(ctx.language);
      const rows: SourceRow[] = allKaomoji().map((entry) => {
        const words = entry.words[lang] || entry.words.en;
        const otherWords = entry.words[lang === "tr" ? "en" : "tr"];
        const all = otherWords && otherWords !== words ? `${words} · ${otherWords}` : words;
        return { id: entry.id, title: entry.text, subtitle: `${yab.t(`group.${entry.group}`)} · ${all}` };
      });
      return { rows };
    },
    run(rowId, actionId) {
      kaomojiById ??= new Map(allKaomoji().map((entry) => [entry.id, entry]));
      const entry = kaomojiById.get(rowId);
      if (entry === undefined) throw new Error(yab.t("kaomojiGone"));
      return { text: actionId === "markdown" ? markdownEscape(entry.text) : entry.text };
    },
  },
};
