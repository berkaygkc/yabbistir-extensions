/** Strict UTF-8, written out so it does not depend on how the host's TextDecoder treats bad bytes. */

/** Characters as a string, in chunks small enough for `String.fromCharCode.apply`. */
export function unitsToString(units: ArrayLike<number>): string {
  const chunk = 8192;
  let out = "";
  for (let i = 0; i < units.length; i += chunk) {
    out += String.fromCharCode.apply(null, Array.prototype.slice.call(units, i, i + chunk) as number[]);
  }
  return out;
}

/** The text with every lone surrogate replaced by U+FFFD, as `toWellFormed()` does. */
export function wellFormed(text: string): string {
  let out: string[] | undefined;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    } else if (c < 0xdc00 || c > 0xdfff) {
      continue;
    }
    out ??= [];
    out.push(text.slice(last, i), "�");
    last = i + 1;
  }
  if (!out) return text;
  out.push(text.slice(last));
  return out.join("");
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(wellFormed(text));
}

/**
 * The length and code point of the valid UTF-8 sequence starting at `bytes[i]`, or `null` when what starts
 * there is not valid (a stray continuation byte, an overlong form, a surrogate, past U+10FFFF, or a cut-off).
 */
export function sequenceAt(bytes: ArrayLike<number>, i: number): { length: number; point: number } | null {
  const first = bytes[i];
  if (first < 0x80) return { length: 1, point: first };
  let length: number;
  let point: number;
  let low = 0x80;
  let high = 0xbf;
  if (first >= 0xc2 && first <= 0xdf) {
    length = 2;
    point = first & 0x1f;
  } else if (first >= 0xe0 && first <= 0xef) {
    length = 3;
    point = first & 0x0f;
    if (first === 0xe0) low = 0xa0;
    if (first === 0xed) high = 0x9f;
  } else if (first >= 0xf0 && first <= 0xf4) {
    length = 4;
    point = first & 0x07;
    if (first === 0xf0) low = 0x90;
    if (first === 0xf4) high = 0x8f;
  } else {
    return null;
  }
  if (i + length > bytes.length) return null;
  for (let j = 1; j < length; j++) {
    const byte = bytes[i + j];
    if (byte < (j === 1 ? low : 0x80) || byte > (j === 1 ? high : 0xbf)) return null;
    point = (point << 6) | (byte & 0x3f);
  }
  return { length, point };
}

/** Appends a code point to a list of UTF-16 units. */
export function pushPoint(units: number[], point: number): void {
  if (point < 0x10000) {
    units.push(point);
  } else {
    const p = point - 0x10000;
    units.push(0xd800 + (p >> 10), 0xdc00 + (p & 0x3ff));
  }
}

/** The text, or `null` when the bytes are not valid UTF-8. */
export function decodeUtf8(bytes: ArrayLike<number>): string | null {
  const units: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const sequence = sequenceAt(bytes, i);
    if (!sequence) return null;
    pushPoint(units, sequence.point);
    i += sequence.length;
  }
  return unitsToString(units);
}
