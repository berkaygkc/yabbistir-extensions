import type { Actions, Detectors, Item, PreviewSection } from "@yabbistir/api";

// A safe calculator: a tokenizer and a recursive-descent parser that evaluates as it reads.
// No eval, no Function. Anything unexpected throws Fail, which the entry points turn into "not an expression".

const maxLength = 5000;
const maxDepth = 200;
const significant = 12;

class Fail extends Error {}
const fail = (): never => {
  throw new Fail();
};

type Style = { decimal: "." | ","; grouped: boolean };
type Token =
  | { type: "num"; raw: string }
  | { type: "op"; op: string }
  | { type: "word"; name: string }
  | { type: "(" | ")" | ";" | "," };

export type Calculation = { value: number; result: string; expression: string };

const decimalCache = new Map<string, "." | ",">();

/** The decimal separator the language writes: "," for Turkish, German, French and so on. */
function languageDecimal(language: string): "." | "," {
  const cached = decimalCache.get(language);
  if (cached !== undefined) return cached;
  let decimal: "." | "," = ".";
  try {
    decimal = new Intl.NumberFormat(language).format(1.1).includes(",") ? "," : ".";
  } catch {
    decimal = ["tr", "de", "fr", "es", "it", "pt", "nl", "ru", "pl", "sv", "da", "nb", "fi", "cs"].includes(language.slice(0, 2).toLowerCase()) ? "," : ".";
  }
  decimalCache.set(language, decimal);
  return decimal;
}

// ---- Tokenizer ----

const operatorChars: Record<string, string> = {
  "+": "+", "-": "-", "−": "-", "–": "-", "*": "*", "×": "*", "·": "*", "∗": "*", "/": "/", "÷": "/", "^": "^", "%": "%",
};
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isLetter = (c: string) => /^\p{L}$/u.test(c);

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === " ") {
      i++;
    } else if (isDigit(c) || ((c === "." || c === ",") && isDigit(text[i + 1]) && !isDigit(text[i - 1]))) {
      // A number: digits, with a separator only when a digit follows it.
      let j = i + 1;
      while (j < text.length && (isDigit(text[j]) || ((text[j] === "." || text[j] === ",") && isDigit(text[j + 1])))) j++;
      tokens.push({ type: "num", raw: text.slice(i, j) });
      i = j;
    } else if (operatorChars[c] !== undefined) {
      tokens.push({ type: "op", op: operatorChars[c] });
      i++;
    } else if (c === "(" || c === ")" || c === ";") {
      tokens.push({ type: c });
      i++;
    } else if (c === ",") {
      // An argument separator, only when it is followed by a space (otherwise it belongs to a number).
      if (text[i + 1] !== " ") fail();
      tokens.push({ type: "," });
      i++;
    } else if (c === "π" || isLetter(c)) {
      let j = i + 1;
      if (c !== "π") while (j < text.length && isLetter(text[j]) && text[j] !== "π") j++;
      tokens.push({ type: "word", name: text.slice(i, j).toLowerCase() });
      i = j;
    } else {
      fail();
    }
    if (tokens.length > maxLength) fail();
  }
  return tokens;
}

// ---- Numbers in either style ----

type Literal = { value: number; decimal: "." | ","; strong: boolean; grouped: boolean };

const validGroups = (groups: string[]) =>
  groups.length > 1 && /^[1-9][0-9]{0,2}$/.test(groups[0]) && groups.slice(1).every((g) => /^[0-9]{3}$/.test(g));

/** Reads "1.234,56", "1,234.56", "1,5", "1.5", "1.234"; null when the separators make no sense (1.2.3, 192.168.1.1). */
function readNumber(raw: string, language: "." | ","): Literal | null {
  if (/^0[0-9]/.test(raw)) return null; // zero-padded numbers are identifiers and dates, not sums
  const dots = raw.split(".").length - 1;
  const commas = raw.split(",").length - 1;
  const finish = (integer: string, fraction: string, decimal: "." | ",", strong: boolean, grouped: boolean): Literal | null => {
    const value = Number(`${integer || "0"}.${fraction || "0"}`);
    return Number.isFinite(value) ? { value, decimal, strong, grouped } : null;
  };
  if (dots === 0 && commas === 0) return finish(raw, "", language, false, false);
  if (dots > 0 && commas > 0) {
    const decimal = raw.lastIndexOf(".") > raw.lastIndexOf(",") ? "." : ",";
    const group = decimal === "." ? "," : ".";
    const at = raw.lastIndexOf(decimal);
    const groups = raw.slice(0, at).split(group);
    if (groups.some((g) => g.includes(decimal)) || !validGroups(groups)) return null;
    return finish(groups.join(""), raw.slice(at + 1), decimal, true, true);
  }
  const sep = dots > 0 ? "." : ",";
  const other = sep === "." ? "," : ".";
  const parts = raw.split(sep);
  if (parts.length > 2) {
    // Repeated: a grouping separator.
    return validGroups(parts) ? finish(parts.join(""), "", other, true, true) : null;
  }
  const [head, tail] = parts;
  const ambiguous = tail.length === 3 && /^[1-9][0-9]{0,2}$/.test(head);
  if (!ambiguous) return finish(head, tail, sep, true, false);
  if (sep === language) return finish(head, tail, sep, false, false);
  return finish(head + tail, "", other, false, true);
}

const group3 = (digits: string, separator: string) => digits.replace(/\B(?=(\d{3})+$)/g, separator);

/** Twelve significant digits, no exponent unless the number is huge or tiny, in the input's style. */
export function formatNumber(value: number, style: Style): string {
  if (value === 0 || Object.is(value, -0)) return "0";
  const sign = value < 0 ? "-" : "";
  const [mantissa, exponentText] = Math.abs(value).toExponential(significant - 1).split("e");
  const exponent = Number(exponentText);
  const digits = mantissa.replace(".", "").replace(/0+$/, "") || "0";
  if (exponent > 20 || exponent < -9) {
    const body = digits.length > 1 ? `${digits[0]}${style.decimal}${digits.slice(1)}` : digits;
    return `${sign}${body}e${exponent}`;
  }
  const point = exponent + 1;
  let integer: string;
  let fraction: string;
  if (point <= 0) {
    integer = "0";
    fraction = "0".repeat(-point) + digits;
  } else if (point >= digits.length) {
    integer = digits + "0".repeat(point - digits.length);
    fraction = "";
  } else {
    integer = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  if (style.grouped) integer = group3(integer, style.decimal === "." ? "," : ".");
  return sign + integer + (fraction === "" ? "" : style.decimal + fraction);
}

// ---- Parser ----

type Value = { v: number; percent: boolean };
const constants: Record<string, number> = { pi: Math.PI, "π": Math.PI, e: Math.E };
const functions: Record<string, { min: number; max: number; apply: (args: number[]) => number }> = {
  sqrt: { min: 1, max: 1, apply: ([x]) => Math.sqrt(x) },
  abs: { min: 1, max: 1, apply: ([x]) => Math.abs(x) },
  round: {
    min: 1,
    max: 2,
    apply([x, digits]) {
      if (digits === undefined) return Math.round(x);
      if (!Number.isInteger(digits) || digits < 0 || digits > 15) return fail();
      const factor = 10 ** digits;
      return Math.round(x * factor) / factor;
    },
  },
  floor: { min: 1, max: 1, apply: ([x]) => Math.floor(x) },
  ceil: { min: 1, max: 1, apply: ([x]) => Math.ceil(x) },
  sin: { min: 1, max: 1, apply: ([x]) => Math.sin(x) },
  cos: { min: 1, max: 1, apply: ([x]) => Math.cos(x) },
  tan: { min: 1, max: 1, apply: ([x]) => Math.tan(x) },
  log: { min: 1, max: 1, apply: ([x]) => Math.log10(x) },
  ln: { min: 1, max: 1, apply: ([x]) => Math.log(x) },
  exp: { min: 1, max: 1, apply: ([x]) => Math.exp(x) },
  min: { min: 1, max: 64, apply: (xs) => Math.min(...xs) },
  max: { min: 1, max: 64, apply: (xs) => Math.max(...xs) },
};

class Parser {
  private pos = 0;
  private depth = 0;
  private out: string[] = [];
  /** True once a binary operator or a function call was read: a lone number or "50%" is not a calculation. */
  meaningful = false;
  private strong: "." | "," | null = null;
  private weak: "." | "," | null = null;
  private grouped = false;
  private inCall = 0;

  private tokens: Token[];
  private language: "." | ",";

  constructor(tokens: Token[], language: "." | ",") {
    this.tokens = tokens;
    this.language = language;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }
  private isOp(token: Token | undefined, ...ops: string[]): boolean {
    return token !== undefined && token.type === "op" && ops.includes(token.op);
  }
  private isWord(token: Token | undefined, name: string): boolean {
    return token !== undefined && token.type === "word" && token.name === name;
  }
  private emit(text: string) {
    this.out.push(text);
  }
  private check(v: number): number {
    return Number.isFinite(v) ? v : fail();
  }
  /** Adds or subtracts; a result that is only float noise next to its operands becomes 0. */
  private sum(a: number, b: number): number {
    const r = this.check(a + b);
    return Math.abs(r) < 1e-14 * Math.max(Math.abs(a), Math.abs(b)) ? 0 : r;
  }

  get style(): Style {
    return { decimal: this.strong ?? this.weak ?? this.language, grouped: this.grouped };
  }
  get expression(): string {
    return this.out.join("");
  }

  parse(): number {
    if (this.tokens.length === 0) fail();
    const value = this.expr();
    if (this.pos !== this.tokens.length) fail();
    return value.v;
  }

  private expr(): Value {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (!this.isOp(token, "+", "-")) return left;
      const op = (token as { op: string }).op;
      this.pos++;
      this.emit(` ${op} `);
      const right = this.term();
      this.meaningful = true;
      // "80 + 15%" is 80 plus 15 percent of 80.
      const amount = right.percent && !left.percent ? left.v * right.v : right.v;
      left = { v: this.sum(left.v, op === "+" ? amount : -amount), percent: false };
    }
  }

  private term(): Value {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      let op: string;
      if (this.isOp(token, "*", "/")) op = (token as { op: string }).op;
      else if (this.isOp(token, "%")) op = "%"; // the postfix reading was already taken in postfix()
      else if (this.isWord(token, "of")) op = "of";
      else return left;
      this.pos++;
      this.emit(op === "of" ? " of " : ` ${op} `);
      const right = this.unary();
      this.meaningful = true;
      if (op === "%" && right.percent) fail(); // a remainder followed by a percentage is not a sum
      if (op === "of") {
        if (!left.percent) fail();
        left = { v: this.check(left.v * right.v), percent: false };
      } else if (op === "*") left = { v: this.check(left.v * right.v), percent: false };
      else {
        if (right.v === 0) fail();
        left = { v: this.check(op === "/" ? left.v / right.v : left.v % right.v), percent: false };
      }
    }
  }

  private unary(): Value {
    if (++this.depth > maxDepth) fail();
    try {
      const token = this.peek();
      if (this.isOp(token, "-", "+")) {
        this.pos++;
        this.emit((token as { op: string }).op);
        const inner = this.unary();
        return { v: (token as { op: string }).op === "-" ? -inner.v : inner.v, percent: inner.percent };
      }
      return this.power();
    } finally {
      this.depth--;
    }
  }

  private power(): Value {
    const base = this.postfix();
    if (!this.isOp(this.peek(), "^")) return base;
    this.pos++;
    this.emit("^");
    this.meaningful = true;
    const exponent = this.unary(); // right-associative, and 2^-1 works
    const v = Math.pow(base.v, exponent.v);
    return { v: this.check(v), percent: false };
  }

  private operandStarts(token: Token | undefined): boolean {
    return token !== undefined && (token.type === "num" || token.type === "(" || (token.type === "word" && token.name !== "of"));
  }

  private postfix(): Value {
    let value = this.primary();
    // "%" right before an operand is a remainder (10 % 3); anywhere else it is a percentage.
    while (this.isOp(this.peek(), "%") && !this.operandStarts(this.peek(1))) {
      this.pos++;
      this.emit("%");
      value = { v: value.v / 100, percent: true };
    }
    return value;
  }

  private primary(): Value {
    const token = this.peek();
    if (token === undefined) return fail();
    if (token.type === "num") {
      this.pos++;
      const literal = readNumber(token.raw, this.language);
      if (literal === null) return fail();
      // "max(1,7)": in a dot-decimal language a lone comma inside a call is an argument separator written without a space; refuse rather than read 1.7.
      if (this.inCall > 0 && this.language === "." && /^[0-9]+,[0-9]+$/.test(token.raw)) return fail();
      if (literal.strong) this.strong ??= literal.decimal;
      else this.weak ??= literal.decimal;
      if (literal.grouped) this.grouped = true;
      this.emit(token.raw);
      return { v: literal.value, percent: false };
    }
    if (token.type === "(") {
      if (++this.depth > maxDepth) fail();
      this.pos++;
      this.emit("(");
      const inner = this.expr();
      if (this.peek()?.type !== ")") fail();
      this.pos++;
      this.emit(")");
      this.depth--;
      return { v: inner.v, percent: false };
    }
    if (token.type === "word") {
      const fn = functions[token.name];
      if (fn !== undefined && this.peek(1)?.type === "(") {
        this.pos += 2;
        this.emit(`${token.name}(`);
        if (++this.depth > maxDepth) fail();
        this.inCall++;
        const args: number[] = [this.expr().v];
        while (this.peek()?.type === ";" || this.peek()?.type === ",") {
          this.pos++;
          this.emit(", ");
          args.push(this.expr().v);
        }
        if (this.peek()?.type !== ")") fail();
        this.pos++;
        this.emit(")");
        this.depth--;
        this.inCall--;
        if (args.length < fn.min || args.length > fn.max) fail();
        this.meaningful = true;
        return { v: this.check(fn.apply(args)), percent: false };
      }
      const constant = constants[token.name];
      if (constant !== undefined) {
        this.pos++;
        this.emit(token.name);
        return { v: constant, percent: false };
      }
    }
    return fail();
  }
}

/** Looks like a date, a phone number or an identifier written without spaces rather than a sum. */
function looksLikeAnIdentifier(text: string): boolean {
  if (/^\+?[0-9]+([-/][0-9]+){2,}$/.test(text)) return true; // 2024-11-04, 11/04/2024, 555-123-4567
  if (/^(19|20)[0-9]{2}-[0-9]{1,2}$/.test(text)) return true; // 2024-11
  if (/^[0-9]{1,4}-[0-9]{1,4}$/.test(text)) return true; // 2-1 (a score), 10-12 (a page range or hours)
  if (/^(e|pi|π)-[0-9][0-9.,]*$/i.test(text) || /^[0-9][0-9.,]*-(e|pi|π)$/i.test(text)) return true; // e-1, 2-pi
  return /^[0-9]{3,}-[0-9]{3,}$/.test(text); // 555-1234
}

/** The result of a copied calculation, or null when the text is not one. Never throws. */
export function calculate(input: string, language: string): Calculation | null {
  try {
    let text = input.trim();
    if (text.length < 3 || text.length > maxLength || /[\r\n]/.test(text)) return null;
    text = text.replace(/\s*=$/, "").replace(/^=\s*/, "");
    if (looksLikeAnIdentifier(text)) return null;
    const parser = new Parser(tokenize(text), languageDecimal(language));
    const value = parser.parse();
    if (!parser.meaningful || !Number.isFinite(value)) return null;
    const result = formatNumber(value, parser.style);
    return { value, result, expression: parser.expression };
  } catch {
    return null;
  }
}

function languageNow(): string {
  try {
    return yab.language || "en";
  } catch {
    return "en";
  }
}

const textOf = (item: Item | null) => item?.text ?? "";

export const detectors: Detectors = {
  expression: {
    validate: (item) => calculate(textOf(item), languageNow()) !== null,
    preview(item, ctx): PreviewSection[] {
      const calculation = calculate(textOf(item), ctx.language);
      if (calculation === null) return [];
      return [{
        type: "keyValue",
        title: yab.t("preview"),
        rows: [[yab.t("result"), calculation.result], [yab.t("expression"), calculation.expression]],
      }];
    },
  },
};

export const actions: Actions = {
  result: {
    run(item, ctx) {
      const calculation = calculate(textOf(item), ctx.language);
      if (calculation === null) return { none: true, message: yab.t("notAnExpression") };
      return { text: calculation.result };
    },
  },
  full: {
    run(item, ctx) {
      const calculation = calculate(textOf(item), ctx.language);
      if (calculation === null) return { none: true, message: yab.t("notAnExpression") };
      return { text: `${calculation.expression} = ${calculation.result}` };
    },
  },
};
