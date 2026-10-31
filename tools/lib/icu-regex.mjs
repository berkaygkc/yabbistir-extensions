// Whether a pattern compiles as an ICU regular expression, the way the app's NSRegularExpression compiles
// accepts.pattern. JavaScript's RegExp is not a stand-in: "(?i)abc", "a++" and "(?>a)" are fine in ICU and errors in
// JavaScript, while "{", "\\0" and the empty pattern are the other way round. This is a syntax check only.
//
// It follows ICU's rules for groups, flags, quantifiers (and what they may follow), intervals, escapes, back
// references, look-behind (bounded length), sets with ranges, nested sets, POSIX classes, && and --, and the x flag.
//
// It fails closed: what it cannot verify, it rejects. A Unicode property is accepted only when it is spelled as in
// icu-properties.json, every spelling of which NSRegularExpression compiled; a character name (\N{…}) never is, as
// there is no list of names to check it against. Such a pattern may compile in the app, but the store does not guess.

import fs from "node:fs";

class PatternError extends Error {}
class Unverifiable extends Error {
  constructor(construct) {
    super(construct);
    this.construct = construct;
  }
}
const fail = () => {
  throw new PatternError();
};

const properties = JSON.parse(fs.readFileSync(new URL("./icu-properties.json", import.meta.url), "utf8"));
const NAMES = new Set(properties.names);
const VALUED = ["gc", "sc", "scx", "blk"].map((kind) => ({ properties: new Set(properties[kind].properties), values: new Set(properties[kind].values) }));

/**
 * { valid: true }, or { valid: false, reason: "invalid" } for a pattern ICU refuses, or
 * { valid: false, reason: "unverifiable", construct } for one using a construct this check cannot verify.
 */
export function checkICUPattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return { valid: false, reason: "invalid" };
  try {
    const state = { chars: [...pattern], i: 0, x: false, groups: 0, names: new Set(), backrefs: [], lookbehind: 0 };
    alternation(state);
    if (state.i < state.chars.length) fail(); // a ")" with no "("
    if (state.backrefs.some((group) => group > state.groups)) fail();
    return { valid: true };
  } catch (error) {
    if (error instanceof PatternError) return { valid: false, reason: "invalid" };
    if (error instanceof Unverifiable) return { valid: false, reason: "unverifiable", construct: error.construct };
    throw error;
  }
}

export function isValidICUPattern(pattern) {
  return checkICUPattern(pattern).valid;
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
      property(braced(state), `\\${c}`);
      return true;
    case "N":
      characterName(braced(state));
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
  const body = rest.slice(0, end);
  property(body.startsWith("^") ? body.slice(1) : body, "[:", ":]");
  state.i += 1 + [...body].length + 2;
  return true;
}

function setEscape(state) {
  const c = next(state);
  if (c === undefined) fail();
  if (c === "Q") return quoted(state).map((q) => ({ kind: "char", code: q.codePointAt(0) }));
  if (c === "E") return [];
  if (c === "0") return [{ kind: "char", code: octalEscape(state) }];
  if (c === "p" || c === "P") {
    property(braced(state), `\\${c}`);
    return [{ kind: "set", bracket: false }];
  }
  if (SET_ESCAPES.has(c)) return [{ kind: "set", bracket: false }];
  if (c === "N") {
    characterName(braced(state));
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
// Unicode properties and character names.

/** A property as written inside \p{…}, \P{…} or [:…:]: one of the verified spellings, or the pattern is rejected. */
function property(raw, open, close = "}") {
  const construct = `${open}${open === "[:" ? "" : "{"}${raw}${close}`;
  if (raw.trim() === "" || raw.trim().startsWith("^")) fail(); // ICU refuses these outright
  if (NAMES.has(raw)) return;
  const equals = raw.indexOf("=");
  if (equals > 0) {
    const name = raw.slice(0, equals);
    const value = raw.slice(equals + 1);
    if (VALUED.some((kind) => kind.properties.has(name) && kind.values.has(value))) return;
  }
  throw new Unverifiable(construct);
}

/** \N{…}: a Unicode character name, which cannot be checked here. */
function characterName(raw) {
  if (raw.trim() === "") fail();
  throw new Unverifiable(`\\N{${raw}}`);
}
