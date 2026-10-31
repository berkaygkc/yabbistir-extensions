// Whether a pattern compiles as an ICU regular expression, the way the app's NSRegularExpression compiles
// accepts.pattern. JavaScript's RegExp is not a stand-in: "(?i)abc", "a++" and "(?>a)" are fine in ICU and errors in
// JavaScript, while "{", "\\0" and the empty pattern are the other way round. This is a syntax check only.
//
// It follows ICU's rules for groups, flags, quantifiers (and what they may follow), intervals, escapes, back
// references, look-behind (bounded length), sets with ranges, nested sets, POSIX classes, && and --, and the x flag.
// Unicode names are not looked up: \N{…} and Name=… accept any name made of letters, digits, spaces and dashes.

class PatternError extends Error {}
const fail = () => {
  throw new PatternError();
};

export function isValidICUPattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  try {
    const state = { chars: [...pattern], i: 0, x: false, groups: 0, names: new Set(), backrefs: [], lookbehind: 0 };
    alternation(state);
    if (state.i < state.chars.length) fail(); // a ")" with no "("
    if (state.backrefs.some((group) => group > state.groups)) fail();
    return true;
  } catch (error) {
    if (error instanceof PatternError) return false;
    throw error;
  }
}

const peek = (state, ahead = 0) => state.chars[state.i + ahead];
const next = (state) => state.chars[state.i++];
const isSpace = (c) => c !== undefined && /\s/u.test(c);
const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";
const isOctal = (c) => c !== undefined && c >= "0" && c <= "7";
const isHex = (c) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isLetter = (c) => c !== undefined && /^[A-Za-z]$/.test(c);

/** In x mode, skips white space and # comments. */
function skipFree(state) {
  if (!state.x) return;
  for (;;) {
    const c = peek(state);
    if (isSpace(c)) state.i++;
    else if (c === "#") {
      while (peek(state) !== undefined && peek(state) !== "\n") state.i++;
    } else return;
  }
}

function alternation(state) {
  for (;;) {
    sequence(state);
    if (peek(state) !== "|") return;
    state.i++;
  }
}

// Stops at the end, "|" or ")".
function sequence(state) {
  let quantifiable = false;
  for (;;) {
    skipFree(state);
    const c = peek(state);
    if (c === undefined || c === "|" || c === ")") return;
    if (c === "*" || c === "+" || c === "?" || c === "{") {
      if (!quantifiable) fail();
      quantifier(state);
      quantifiable = false;
      continue;
    }
    const result = atom(state);
    if (result !== "transparent") quantifiable = result;
  }
}

const MAX_INTERVAL = 0xffffff;

function quantifier(state) {
  const c = next(state);
  let unbounded = c === "*" || c === "+";
  if (c === "{") {
    const number = () => {
      skipFree(state);
      let text = "";
      while (isDigit(peek(state))) text += next(state);
      skipFree(state);
      if (text === "") return null;
      const value = Number(text);
      if (value > MAX_INTERVAL) fail();
      return value;
    };
    const min = number();
    if (min === null) fail();
    let max = min;
    if (peek(state) === ",") {
      state.i++;
      max = number();
      if (max === null) unbounded = true;
      else if (max < min) fail();
    }
    if (next(state) !== "}") fail();
  }
  if (unbounded && state.lookbehind > 0) fail();
  if (peek(state) === "?" || peek(state) === "+") state.i++;
}

/** Reads one atom; returns whether a quantifier may follow it, or "transparent" for a comment. */
function atom(state) {
  const c = next(state);
  switch (c) {
    case "(":
      return group(state);
    case "[":
      characterClass(state);
      return true;
    case "\\":
      return escape(state);
    case "}":
      return fail();
    default:
      return true; // a literal, ".", "^", "$" or a lone "]"
  }
}

const FLAGS = new Set(["i", "m", "s", "x", "w", "d", "u"]);

function group(state) {
  if (peek(state) !== "?") {
    state.groups++;
    body(state);
    return true;
  }
  state.i++;
  const c = next(state);
  if (c === "#") {
    while (peek(state) !== ")") if (next(state) === undefined) fail();
    state.i++;
    return "transparent";
  }
  if (c === ":" || c === ">") {
    body(state);
    return true;
  }
  if (c === "=" || c === "!") {
    body(state);
    return false;
  }
  if (c === "<") {
    if (peek(state) === "=" || peek(state) === "!") {
      state.i++;
      state.lookbehind++;
      body(state);
      state.lookbehind--;
      return false;
    }
    const name = groupName(state, ">");
    if (state.names.has(name)) fail();
    state.names.add(name);
    state.groups++;
    body(state);
    return true;
  }
  if (c === "-" || FLAGS.has(c)) {
    let x = state.x;
    let on = true;
    for (let flag = c; ; flag = next(state)) {
      if (flag === ")") {
        state.x = x;
        return false;
      }
      if (flag === ":") {
        const saved = state.x;
        state.x = x;
        body(state);
        state.x = saved;
        return true;
      }
      if (flag === "-") {
        if (!on) fail();
        on = false;
      } else if (FLAGS.has(flag)) {
        if (flag === "x") x = on;
      } else fail();
    }
  }
  return fail();
}

/** A group's alternatives and its ")". Flags set inside end with it. */
function body(state) {
  const saved = state.x;
  alternation(state);
  if (next(state) !== ")") fail();
  state.x = saved;
}

/** ASCII letters and digits, starting with a letter, up to `end`. */
function groupName(state, end) {
  let name = "";
  while (peek(state) !== end) {
    const c = next(state);
    if (!(isLetter(c) || (name !== "" && isDigit(c)))) fail();
    name += c;
  }
  state.i++;
  if (name === "") fail();
  return name;
}

function braced(state) {
  if (next(state) !== "{") fail();
  let text = "";
  while (peek(state) !== "}") {
    const c = next(state);
    if (c === undefined) fail();
    text += c;
  }
  state.i++;
  return text;
}

function hexDigits(state, count) {
  let text = "";
  for (let n = 0; n < count; n++) {
    if (!isHex(peek(state))) fail();
    text += next(state);
  }
  const value = parseInt(text, 16);
  if (value > 0x10ffff) fail();
  return value;
}

/** \x{…} or \xh / \xhh. */
function hexEscape(state) {
  if (peek(state) === "{") {
    const text = braced(state).trim();
    if (!/^[0-9a-fA-F]+$/.test(text) || parseInt(text, 16) > 0x10ffff) fail();
    return parseInt(text, 16);
  }
  if (!isHex(peek(state))) fail();
  let text = next(state);
  if (isHex(peek(state))) text += next(state);
  return parseInt(text, 16);
}

/** \0 with one to three octal digits. */
function octalEscape(state) {
  if (!isOctal(peek(state))) fail();
  let text = "";
  while (text.length < 3 && isOctal(peek(state))) text += next(state);
  return parseInt(text, 8);
}

function escape(state) {
  const c = next(state);
  switch (c) {
    case undefined:
      return fail();
    case "Q":
      quoted(state);
      return true;
    case "E":
      return "transparent";
    case "0":
      octalEscape(state);
      return true;
    case "1": case "2": case "3": case "4": case "5": case "6": case "7": case "8": case "9": {
      // As many digits as still name a group defined so far; the rest are literals.
      let group = Number(c);
      while (group < state.groups && isDigit(peek(state))) group = group * 10 + Number(next(state));
      if (state.lookbehind > 0) fail();
      state.backrefs.push(group);
      return true;
    }
    case "k": {
      if (next(state) !== "<") fail();
      if (!state.names.has(groupName(state, ">"))) fail();
      if (state.lookbehind > 0) fail();
      return true;
    }
    case "p": case "P":
      if (!isPropertyName(braced(state))) fail();
      return true;
    case "N":
      if (!isCharacterName(braced(state))) fail();
      return true;
    case "x":
      hexEscape(state);
      return true;
    case "u":
      hexDigits(state, 4);
      return true;
    case "U":
      hexDigits(state, 8);
      return true;
    case "c":
      if (peek(state) !== undefined) state.i++;
      return true;
    case "b": case "B": case "A": case "z": case "Z": case "G":
      return false;
    case "X":
      if (state.lookbehind > 0) fail();
      return true;
    default:
      return true;
  }
}

/** \Q…\E (or to the end); returns the quoted characters. */
function quoted(state) {
  const chars = [];
  while (peek(state) !== undefined && !(peek(state) === "\\" && peek(state, 1) === "E")) chars.push(next(state));
  if (peek(state) !== undefined) state.i += 2;
  return chars;
}

// ---------------------------------------------------------------------------------------------------------------
// Sets: [abc], [^a-z], [[a][b]], [\p{L}&&[a-z]], [a-z--[aeiou]], [[:alpha:]], [:alpha:].

const CHAR_ESCAPES = { a: 0x07, b: 0x08, e: 0x1b, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09 };
const SET_ESCAPES = new Set(["d", "D", "s", "S", "w", "W", "h", "H", "v", "V"]);

/** After "[": reads the set up to its "]". */
function characterClass(state) {
  if (peek(state) === ":" && posix(state)) return;
  if (peek(state) === "^") state.i++;
  const tokens = [];
  let first = true;
  for (;;) {
    if (state.x) while (isSpace(peek(state))) state.i++;
    const c = next(state);
    if (c === undefined) fail();
    if (c === "]" && !first) break;
    first = false;
    if (c === "[") {
      if (!(peek(state) === ":" && posix(state))) characterClass(state);
      tokens.push({ kind: "set", bracket: true });
    } else if (c === "\\") {
      tokens.push(...setEscape(state));
    } else if (c === "-" && peek(state) === "-") {
      state.i++;
      tokens.push({ kind: "op" });
    } else if (c === "&" && peek(state) === "&") {
      state.i++;
      tokens.push({ kind: "op" });
    } else if (c === "-") {
      tokens.push({ kind: "dash" });
    } else {
      tokens.push({ kind: "char", code: c.codePointAt(0) });
    }
  }
  checkSet(tokens);
}

/** After "[" with ":" next: a POSIX class "[:name:]" or "[:^name:]". False (nothing read) when there is no ":]". */
function posix(state) {
  const rest = state.chars.slice(state.i + 1).join("");
  const end = rest.indexOf(":]");
  if (end < 0) return false;
  let name = rest.slice(0, end);
  if (name.startsWith("^")) name = name.slice(1);
  if (!isPropertyName(name)) fail();
  state.i += 1 + [...rest.slice(0, end)].length + 2;
  return true;
}

function setEscape(state) {
  const c = next(state);
  if (c === undefined) fail();
  if (c === "Q") return quoted(state).map((q) => ({ kind: "char", code: q.codePointAt(0) }));
  if (c === "E") return [];
  if (c === "0") return [{ kind: "char", code: octalEscape(state) }];
  if (c === "p" || c === "P") {
    if (!isPropertyName(braced(state))) fail();
    return [{ kind: "set", bracket: false }];
  }
  if (SET_ESCAPES.has(c)) return [{ kind: "set", bracket: false }];
  if (c === "N") {
    if (!isCharacterName(braced(state))) fail();
    return [{ kind: "char", code: null }];
  }
  if (c === "x") return [{ kind: "char", code: hexEscape(state) }];
  if (c === "u") return [{ kind: "char", code: hexDigits(state, 4) }];
  if (c === "U") return [{ kind: "char", code: hexDigits(state, 8) }];
  if (c === "c") {
    const control = next(state);
    if (control === undefined) fail();
    return [{ kind: "char", code: control.codePointAt(0) & 0x1f }];
  }
  if (Object.hasOwn(CHAR_ESCAPES, c)) return [{ kind: "char", code: CHAR_ESCAPES[c] }];
  return [{ kind: "char", code: c.codePointAt(0) }];
}

/** && and -- need a set on each side; a range runs from a character to a character, in order. */
function checkSet(tokens) {
  if (tokens.length === 0) fail();
  const operands = [[]];
  for (const token of tokens) {
    if (token.kind === "op") operands.push([]);
    else operands.at(-1).push(token);
  }
  for (const operand of operands) {
    if (operand.length === 0) fail();
    let previous = null;
    for (let index = 0; index < operand.length; index++) {
      const token = operand[index];
      const following = operand[index + 1];
      if (token.kind === "dash" && previous?.kind === "char" && !previous.ranged && following) {
        if (following.kind === "char") {
          if (previous.code !== null && following.code !== null && previous.code > following.code) fail();
          previous = { kind: "range" };
          index++;
          continue;
        }
        if (following.kind === "set" && !following.bracket) fail();
      }
      previous = token.kind === "dash" ? { kind: "char", code: 0x2d, ranged: true } : token;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Unicode property names, matched loosely as ICU does: case, spaces, "_" and "-" do not count.

const loose = (name) => name.toLowerCase().replace(/[\s_-]/g, "");

const ICU_ONLY = new Set([
  "all", "alnum", "blank", "cntrl", "digit", "graph", "print", "punct", "word", "xdigit",
  ...["defined", "digit", "identifierignorable", "isocontrol", "javaidentifierpart", "javaidentifierstart", "letter", "letterordigit",
    "lowercase", "mirrored", "spacechar", "supplementarycodepoint", "titlecase", "unicodeidentifierpart", "unicodeidentifierstart",
    "uppercase", "validcodepoint", "whitespace"].map((name) => `java${name}`),
]);

const BLOCKS = new Set([
  "basiclatin", "latin1supplement", "latinextendeda", "latinextendedb", "latinextendedadditional", "ipaextensions",
  "spacingmodifierletters", "combiningdiacriticalmarks", "greekandcoptic", "greek", "cyrillic", "armenian", "hebrew", "arabic",
  "devanagari", "bengali", "thai", "georgian", "hanguljamo", "generalpunctuation", "superscriptsandsubscripts", "currencysymbols",
  "letterlikesymbols", "numberforms", "arrows", "mathematicaloperators", "miscellaneoustechnical", "boxdrawing", "blockelements",
  "geometricshapes", "miscellaneoussymbols", "dingbats", "cjksymbolsandpunctuation", "hiragana", "katakana", "cjkunifiedideographs",
  "hangulsyllables", "privateusearea", "alphabeticpresentationforms", "halfwidthandfullwidthforms", "specials", "emoticons",
  "miscellaneoussymbolsandpictographs", "transportandmapsymbols", "supplementalsymbolsandpictographs", "ascii",
]);

const VALUED = new Map([
  ["generalcategory", "gc"], ["gc", "gc"], ["script", "sc"], ["sc", "sc"], ["scriptextensions", "sc"], ["scx", "sc"],
  ...["block", "blk", "bidiclass", "bc", "eastasianwidth", "ea", "linebreak", "lb", "numericvalue", "nv", "age", "hangulsyllabletype",
    "hst", "joiningtype", "jt", "joininggroup", "jg", "decompositiontype", "dt", "wordbreak", "wb", "sentencebreak", "sb",
    "graphemeclusterbreak", "gcb", "canonicalcombiningclass", "ccc", "numerictype", "nt", "indicpositionalcategory", "inpc",
    "indicsyllabiccategory", "insc", "verticalorientation", "vo", "bidipairedbrackettype", "bpt"].map((name) => [name, "any"]),
  ["name", "name"], ["na", "name"],
]);

const known = new Map();

/** Whether JavaScript knows the name in one of its spellings: as written, Title_Case, ALL CAPS or FIRSTword_Title. */
function javascriptKnows(name, as) {
  const key = `${as}:${name}`;
  if (known.has(key)) return known.get(key);
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  const title = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  const spellings = new Set([
    name.trim().replace(/\s+/g, "_"),
    words.map(title).join("_"),
    words.join("_").toUpperCase(),
    words.map((word, index) => (index === 0 ? word.toUpperCase() : title(word))).join("_"),
  ]);
  const compiles = (source, flags) => {
    try {
      new RegExp(source, flags);
      return true;
    } catch {
      return false;
    }
  };
  let result = false;
  for (const spelling of spellings) {
    if (!/^[A-Za-z0-9_]+$/.test(spelling)) continue;
    const sources = as === "gc" ? [`\\p{General_Category=${spelling}}`] : as === "sc" ? [`\\p{Script=${spelling}}`]
      : [`\\p{${spelling}}`, `\\p{Script=${spelling}}`];
    if (sources.some((source) => compiles(source, "u") || compiles(source, "v"))) {
      result = true;
      break;
    }
  }
  known.set(key, result);
  return result;
}

function isCharacterName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(name.trim());
}

export function isPropertyName(raw) {
  const name = raw.trim();
  if (name === "" || name.startsWith("^")) return false;
  const equals = name.indexOf("=");
  if (equals >= 0) {
    const kind = VALUED.get(loose(name.slice(0, equals)));
    const value = name.slice(equals + 1).trim();
    if (!kind || value === "") return false;
    if (kind === "any") return true;
    if (kind === "name") return isCharacterName(value);
    return javascriptKnows(value, kind);
  }
  const flat = loose(name);
  if (ICU_ONLY.has(flat) || javascriptKnows(name, "any")) return true;
  if (flat.startsWith("in")) return BLOCKS.has(flat.slice(2)) || javascriptKnows(name.trim().slice(2), "sc");
  if (flat.startsWith("is")) return javascriptKnows(name.trim().slice(2), "any");
  return false;
}
