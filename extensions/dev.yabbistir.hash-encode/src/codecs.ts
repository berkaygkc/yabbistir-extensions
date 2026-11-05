/** The text transforms: URL, HTML entities, Unicode escapes, hex and ROT13. All linear in the input. */

import { namedEntities, windows1252 } from "./entities.ts";
import { decodeUtf8, pushPoint, sequenceAt, unitsToString, utf8Bytes, wellFormed } from "./utf8.ts";

// ---------------------------------------------------------------------------------------------------------
// URL

/** `encodeURIComponent`, after replacing lone surrogates (which it would throw on) with U+FFFD. */
export function urlEncode(text: string): string {
  return encodeURIComponent(wellFormed(text));
}

const hexDigit = /[0-9A-Fa-f]/;

/**
 * Decodes every run of `%XX` escapes that is valid UTF-8. A byte that is not part of a valid sequence (and a
 * `%` that is not followed by two hex digits) stays as it was, so one stray `%` does not stop the rest.
 * `+` is left alone: this is component decoding, not form decoding.
 */
export function urlDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    const units: number[] = [];
    let kept = "";
    for (let i = 0; i < bytes.length; ) {
      const sequence = sequenceAt(bytes, i);
      if (sequence) {
        if (kept) {
          for (const c of kept) units.push(c.charCodeAt(0));
          kept = "";
        }
        pushPoint(units, sequence.point);
        i += sequence.length;
      } else {
        kept += run.slice(i * 3, i * 3 + 3);
        i++;
      }
    }
    return unitsToString(units) + kept;
  });
}

// ---------------------------------------------------------------------------------------------------------
// HTML entities

/** `& < > " '` as entities and every character past ASCII as a decimal numeric reference. */
export function htmlEncode(text: string): string {
  let out = "";
  for (const character of wellFormed(text)) {
    const point = character.codePointAt(0)!;
    if (character === "&") out += "&amp;";
    else if (character === "<") out += "&lt;";
    else if (character === ">") out += "&gt;";
    else if (character === '"') out += "&quot;";
    else if (character === "'") out += "&#39;";
    else if (point > 0x7f) out += `&#${point};`;
    else out += character;
  }
  return out;
}

/** Named references from the common set, and `&#N;` and `&#xH;`. Anything else is left as written. */
export function htmlDecode(text: string): string {
  return text.replace(/&(?:#([0-9]{1,8})|#[xX]([0-9A-Fa-f]{1,8})|([A-Za-z][A-Za-z0-9]{0,31}));/g, (whole, decimal, hexa, name) => {
    let point: number | undefined;
    if (name !== undefined) point = namedEntities.get(name);
    else point = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hexa, 16);
    if (point === undefined) return whole;
    if (name === undefined) {
      if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return whole;
      point = windows1252[point] ?? point;
    }
    return String.fromCodePoint(point);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Unicode escapes

/** Every character past ASCII as `\uXXXX` (lowercase hex, an astral character as its surrogate pair). */
export function unicodeEscape(text: string): string {
  let out = "";
  let plain = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x7f) continue;
    out += text.slice(plain, i) + "\\u" + c.toString(16).padStart(4, "0");
    plain = i + 1;
  }
  return out + text.slice(plain);
}

/**
 * `\uXXXX`, `\u{X…}` and `\xXX` back to characters. An escaped backslash (`\\`) is skipped, so `\\u0041` is
 * not decoded. A surrogate pair of two `\u` escapes becomes one character; a lone surrogate, a code point
 * past U+10FFFF and a malformed escape are left as written.
 */
export function unicodeUnescape(text: string): string {
  const units: number[] = [];
  let out = "";
  let i = 0;
  const push = (code: number): void => {
    units.push(code);
    if (units.length >= 8192) {
      out += unitsToString(units);
      units.length = 0;
    }
  };
  const isHex = (from: number, to: number): boolean => {
    if (to > text.length) return false;
    for (let j = from; j < to; j++) if (!hexDigit.test(text[j])) return false;
    return true;
  };
  while (i < text.length) {
    const c = text[i];
    if (c !== "\\") {
      push(text.charCodeAt(i++));
      continue;
    }
    const next = text[i + 1];
    if (next === "\\") {
      push(0x5c);
      push(0x5c);
      i += 2;
    } else if (next === "u" && text[i + 2] === "{") {
      const close = text.indexOf("}", i + 3);
      const digits = close < 0 ? "" : text.slice(i + 3, close);
      if (close > 0 && digits.length >= 1 && digits.length <= 8 && isHex(i + 3, close) && parseInt(digits, 16) <= 0x10ffff) {
        const point = parseInt(digits, 16);
        if (point >= 0xd800 && point <= 0xdfff) {
          for (let j = i; j <= close; j++) push(text.charCodeAt(j));
        } else {
          pushPoint(units, point);
        }
        i = close + 1;
      } else {
        push(0x5c);
        i++;
      }
    } else if (next === "u" && isHex(i + 2, i + 6)) {
      const code = parseInt(text.slice(i + 2, i + 6), 16);
      if (code >= 0xd800 && code <= 0xdbff) {
        // A high surrogate needs a following \uDC00..\uDFFF.
        const low = text[i + 6] === "\\" && text[i + 7] === "u" && isHex(i + 8, i + 12) ? parseInt(text.slice(i + 8, i + 12), 16) : -1;
        if (low >= 0xdc00 && low <= 0xdfff) {
          push(code);
          push(low);
          i += 12;
        } else {
          for (let j = i; j < i + 6; j++) push(text.charCodeAt(j));
          i += 6;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        for (let j = i; j < i + 6; j++) push(text.charCodeAt(j));
        i += 6;
      } else {
        push(code);
        i += 6;
      }
    } else if (next === "x" && isHex(i + 2, i + 4)) {
      push(parseInt(text.slice(i + 2, i + 4), 16));
      i += 4;
    } else {
      push(0x5c);
      i++;
    }
  }
  return out + unitsToString(units);
}

// ---------------------------------------------------------------------------------------------------------
// Hex

const digits = "0123456789abcdef";

/** UTF-8 bytes as lowercase hex, two digits each, no separators. */
export function hexEncode(text: string): string {
  const bytes = utf8Bytes(text);
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 4096) {
    let part = "";
    for (let j = i; j < Math.min(i + 4096, bytes.length); j++) part += digits[bytes[j] >> 4] + digits[bytes[j] & 15];
    out.push(part);
  }
  return out.join("");
}

export type HexResult = { ok: true; text: string } | { ok: false; reason: "invalid" | "notText" };

/**
 * Hex back to text. Whitespace, colons and a leading `0x` are allowed; the digits must come in pairs and
 * the bytes must be valid UTF-8.
 */
export function hexDecode(text: string): HexResult {
  const compact = text.trim().replace(/^0[xX]/, "").replace(/[\s:]+/g, "");
  if (compact === "" || compact.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(compact)) return { ok: false, reason: "invalid" };
  const bytes = new Uint8Array(compact.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  const decoded = decodeUtf8(bytes);
  // Control characters (other than tab and line breaks) mean the bytes are not text, e.g. the digits of "0102".
  if (decoded === null || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(decoded)) return { ok: false, reason: "notText" };
  return { ok: true, text: decoded };
}

// ---------------------------------------------------------------------------------------------------------
// ROT13

export function rot13(text: string): string {
  return text.replace(/[A-Za-z]/g, (letter) => {
    const base = letter <= "Z" ? 65 : 97;
    return String.fromCharCode(((letter.charCodeAt(0) - base + 13) % 26) + base);
  });
}
