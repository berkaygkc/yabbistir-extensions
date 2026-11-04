import type { Actions } from "@yabbistir/api";

/** Which language's rules decide what i, İ, ı and I become. */
export type Rules = "tr" | "en";

type Kind = "upper" | "lower" | "digit" | "letter" | "mark" | "pict" | "apos" | "sep";
type Token = { w: boolean; t: string };

const upperLetter = /^[\p{Lu}\p{Lt}]$/u;
const lowerLetter = /^\p{Ll}$/u;
const digit = /^\p{N}$/u;
const otherLetter = /^\p{L}$/u;
const mark = /^\p{M}$/u;
// Emoji (and the joiners that build sequences) travel inside a word untouched.
const pictograph = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍]$/u;

function kindOf(c: string): Kind {
  if (c === "'" || c === "’" || c === "ʼ") return "apos";
  if (upperLetter.test(c)) return "upper";
  if (lowerLetter.test(c)) return "lower";
  if (digit.test(c)) return "digit";
  if (otherLetter.test(c)) return "letter";
  if (mark.test(c)) return "mark";
  if (pictograph.test(c)) return "pict";
  return "sep";
}

const isWordKind = (k: Kind | undefined): boolean => k === "upper" || k === "lower" || k === "digit" || k === "letter";

/**
 * Cuts a line into words and separators in one pass. A word ends at a separator, and, when `splitCamel` is on,
 * at a lower-case letter or digit followed by an upper-case letter ("fooBar", "v2Beta") and where an acronym
 * ends ("HTTPServer" is HTTP, Server). Digits stay with the letters beside them. An apostrophe inside a word is
 * kept when `keepApostrophes` is on and dropped otherwise.
 */
export function scan(text: string, splitCamel: boolean, keepApostrophes: boolean): Token[] {
  const cs = Array.from(text);
  const kinds = cs.map(kindOf);
  const tokens: Token[] = [];
  let current = "";
  let lastKind: Kind | null = null;
  const flush = () => {
    if (current !== "") tokens.push({ w: true, t: current });
    current = "";
    lastKind = null;
  };
  const addSeparator = (c: string) => {
    flush();
    const last = tokens[tokens.length - 1];
    if (last !== undefined && !last.w) last.t += c;
    else tokens.push({ w: false, t: c });
  };
  for (let i = 0; i < cs.length; i++) {
    const k = kinds[i];
    const c = cs[i];
    if (k === "sep") {
      addSeparator(c);
    } else if (k === "apos") {
      if (current !== "" && isWordKind(kinds[i + 1])) {
        if (keepApostrophes) current += c;
      } else {
        addSeparator(c);
      }
    } else {
      if (k === "upper" && splitCamel && current !== "") {
        if (lastKind === "lower" || lastKind === "digit" || (lastKind === "upper" && kinds[i + 1] === "lower")) flush();
      }
      current += c;
      if (k !== "mark") lastKind = k;
    }
  }
  flush();
  return tokens;
}

/** The casing functions for one set of rules. */
export function casing(rules: Rules) {
  const lower = (s: string): string => (rules === "tr" ? s.toLocaleLowerCase("tr") : s.toLowerCase().replace(/i̇/g, "i"));
  const upper = (s: string): string => (rules === "tr" ? s.toLocaleUpperCase("tr") : s.toUpperCase());
  const capital = (s: string): string => {
    if (s === "") return s;
    const first = String.fromCodePoint(s.codePointAt(0) as number);
    return upper(first) + lower(s.slice(first.length));
  };
  return { lower, upper, capital };
}

/** Short words that stay small in the middle of a title. */
const smallWords: Record<Rules, Set<string>> = {
  en: new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "via", "vs"]),
  tr: new Set(["ve", "ile", "veya"]),
};

// Slug transliteration for letters that do not decompose.
const transliteration: Record<string, string> = {
  "ı": "i", "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ð": "d", "ł": "l", "þ": "th", "ħ": "h", "ŧ": "t",
};

export function slugWord(word: string): string {
  const decomposed = word.normalize("NFD").replace(/\p{M}/gu, "");
  let out = "";
  for (const c of decomposed) {
    const mapped = transliteration[c] ?? c;
    for (const m of mapped) if ((m >= "a" && m <= "z") || (m >= "0" && m <= "9")) out += m;
  }
  return out;
}

const lineBreak = /(\r\n|\n|\r)/;

function isBlank(c: string): boolean {
  return c.trim() === "";
}

function proseCase(core: string, kind: "title" | "sentence", rules: Rules): string {
  const { lower, capital } = casing(rules);
  let tokens = scan(core, false, true);
  const identifierLike =
    !Array.from(core).some(isBlank) && tokens.every((token) => token.w || Array.from(token.t).every((c) => c === "_" || c === "-" || c === "."));
  if (identifierLike) {
    // One token such as "my-var_name" or "helloWorld" is an identifier: split it and join with spaces.
    const words = scan(core, true, true).filter((token) => token.w);
    // A lone leading lower-case letter before a capital ("iPhone", "eBay") is part of the name, not a word.
    if (words.length > 1 && !/[_\-.]/.test(core) && Array.from(words[0].t).length === 1 && lowerLetter.test(words[0].t)) {
      const merged = { w: true, t: words[0].t + words[1].t };
      words.splice(0, 2, merged);
    }
    tokens = [];
    words.forEach((word, index) => {
      if (index > 0) tokens.push({ w: false, t: " " });
      tokens.push(word);
    });
  }
  let afterBreak = true;
  let previousLength = 0;
  let out = "";
  for (const token of tokens) {
    if (!token.w) {
      out += token.t;
      const ends = kind === "title" ? /[.!?:…]/.test(token.t) : /[.!?…]/.test(token.t) && Array.from(token.t).some(isBlank);
      // A single letter before the stop is an abbreviation or an initial ("e.g. this"), not the end of a sentence.
      if (ends && !(kind === "sentence" && previousLength === 1)) afterBreak = true;
      continue;
    }
    const lowered = lower(token.t);
    if (kind === "title") {
      out += afterBreak || !smallWords[rules].has(lowered) ? capital(token.t) : lowered;
    } else if (afterBreak) {
      out += capital(token.t);
    } else if (rules === "en" && /^i('(m|ll|ve|d))?$/.test(lowered)) {
      out += "I" + lowered.slice(1);
    } else {
      out += lowered;
    }
    afterBreak = false;
    previousLength = Array.from(token.t).length;
  }
  return out;
}

export type Variant =
  | "camel" | "pascal" | "snake" | "constant" | "kebab" | "dot" | "title" | "sentence" | "upper" | "lower" | "slug";

export const variants: readonly Variant[] = [
  "camel", "pascal", "snake", "constant", "kebab", "dot", "title", "sentence", "upper", "lower", "slug",
];

/** One line, without its leading and trailing whitespace. */
function convertCore(core: string, variant: Variant, rules: Rules): string {
  switch (variant) {
    case "upper":
      return casing(rules).upper(core);
    case "lower":
      return casing(rules).lower(core);
    case "title":
    case "sentence":
      return proseCase(core, variant, rules);
    default:
      break;
  }
  const words = scan(core, true, false).filter((token) => token.w).map((token) => token.t);
  // Identifiers always use English rules: Turkish rules would turn "getUserID" into "get_user_ıd".
  const { lower, upper, capital } = casing(variant === "slug" ? rules : "en");
  if (variant === "slug") return words.map((word) => slugWord(lower(word))).filter((word) => word !== "").join("-");
  if (words.length === 0) return core;
  switch (variant) {
    case "camel":
      return words.map((word, index) => (index === 0 ? lower(word) : capital(word))).join("");
    case "pascal":
      return words.map(capital).join("");
    case "snake":
      return words.map(lower).join("_");
    case "constant":
      return words.map(upper).join("_");
    case "kebab":
      return words.map(lower).join("-");
    default:
      return words.map(lower).join(".");
  }
}

/** Every line on its own: line breaks and each line's edge whitespace stay as they are. */
export function convert(text: string, variant: Variant, rules: Rules): string {
  const parts = text.split(lineBreak);
  for (let p = 0; p < parts.length; p += 2) {
    const line = parts[p];
    let start = 0;
    while (start < line.length && isBlank(line[start])) start++;
    if (start === line.length) continue;
    let end = line.length;
    while (end > start && isBlank(line[end - 1])) end--;
    parts[p] = line.slice(0, start) + convertCore(line.slice(start, end), variant, rules) + line.slice(end);
  }
  return parts.join("");
}

/** The casing rules to use: the preference, or for "auto" the app's language. */
export function rulesFor(preference: unknown, language: string): Rules {
  if (preference === "tr" || preference === "en") return preference;
  return language.split(/[-_]/)[0].toLowerCase() === "tr" ? "tr" : "en";
}

export const actions: Actions = {
  changeCase: {
    run(item, ctx) {
      const text = item?.text ?? "";
      if (text.trim() === "") return { none: true, message: yab.t("empty") };
      const variant = (variants as readonly string[]).includes(ctx.variant ?? "") ? (ctx.variant as Variant) : "title";
      const rules = rulesFor(ctx.preferences.casing, ctx.language);
      const result = convert(text, variant, rules);
      if (variant === "slug" && result.trim() === "") return { none: true, message: yab.t("emptySlug") };
      return { text: result };
    },
  },
};
