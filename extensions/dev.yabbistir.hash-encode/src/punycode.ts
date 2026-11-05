/** Punycode (RFC 3492) and the domain handling around it. */

import { pushPoint, unitsToString } from "./utf8.ts";

const base = 36;
const tMin = 1;
const tMax = 26;
const skew = 38;
const damp = 700;
const initialBias = 72;
const initialN = 128;

function digitToCharacter(digit: number): string {
  return String.fromCharCode(digit < 26 ? digit + 97 : digit + 22);
}

function characterToDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return base;
}

function adapt(delta: number, points: number, first: boolean): number {
  delta = first ? Math.floor(delta / damp) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  while (delta > ((base - tMin) * tMax) >> 1) {
    delta = Math.floor(delta / (base - tMin));
    k += base;
  }
  return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
}

/** The code points of a string (a surrogate pair counts once). */
function codePoints(text: string): number[] {
  const points: number[] = [];
  for (const character of text) points.push(character.codePointAt(0)!);
  return points;
}

/** Punycode for one label, without the `xn--` prefix. */
export function punycodeEncode(label: string): string {
  const input = codePoints(label);
  const out: string[] = [];
  for (const point of input) if (point < 0x80) out.push(String.fromCharCode(point));
  const basicCount = out.length;
  let handled = basicCount;
  if (basicCount > 0) out.push("-");
  let n = initialN;
  let delta = 0;
  let bias = initialBias;
  while (handled < input.length) {
    let m = 0x7fffffff;
    for (const point of input) if (point >= n && point < m) m = point;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const point of input) {
      if (point < n) delta++;
      if (point === n) {
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
          if (q < t) break;
          out.push(digitToCharacter(t + ((q - t) % (base - t))));
          q = Math.floor((q - t) / (base - t));
        }
        out.push(digitToCharacter(q));
        bias = adapt(delta, handled + 1, handled === basicCount);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return out.join("");
}

/** The label a Punycode string stands for, or `null` when it is not valid Punycode. */
export function punycodeDecode(encoded: string): string | null {
  const output: number[] = [];
  const delimiter = encoded.lastIndexOf("-");
  for (let j = 0; j < delimiter; j++) {
    const code = encoded.charCodeAt(j);
    if (code >= 0x80) return null;
    output.push(code);
  }
  let n = initialN;
  let i = 0;
  let bias = initialBias;
  for (let index = delimiter > 0 ? delimiter + 1 : 0; index < encoded.length; ) {
    const oldI = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (index >= encoded.length) return null;
      const digit = characterToDigit(encoded.charCodeAt(index++));
      if (digit >= base) return null;
      i += digit * w;
      if (i > 0x7fffffff) return null;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
      if (w > 0x7fffffff) return null;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i++, 0, n);
  }
  const units: number[] = [];
  for (const point of output) pushPoint(units, point);
  return unitsToString(units);
}

/** The pieces of a link or a bare domain: what comes before the host, the host, and what follows. */
const hostPattern = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?([^/?#\s@]*@)?([^/?#\s:]*)(:\d*)?([/?#]\S*)?$/;

export type DomainResult =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; reason: "notDomain" | "invalid" | "tooLong" };

function mapDomain(text: string, convert: (label: string) => string | "invalid" | "tooLong"): DomainResult {
  const match = hostPattern.exec(text.trim());
  if (!match || match[3] === "") return { ok: false, reason: "notDomain" };
  const [, scheme = "", userinfo = "", host, port = "", rest = ""] = match;
  const labels = host.replace(/[。．｡]/g, ".").split(".");
  const converted: string[] = [];
  for (const label of labels) {
    const result = convert(label);
    if (result === "invalid" || result === "tooLong") return { ok: false, reason: result };
    converted.push(result);
  }
  const mapped = converted.join(".");
  return { ok: true, text: scheme + userinfo + mapped + port + rest, changed: mapped !== host };
}

/** `bücher.example` to `xn--bcher-kva.example`. Labels that are already ASCII stay as they are. */
export function domainToAscii(text: string): DomainResult {
  return mapDomain(text, (label) => {
    // eslint-disable-next-line no-control-regex
    if (/^[\u0000-\u007f]*$/.test(label)) return label;
    // A DNS label is at most 63 characters; stop early on anything far past that.
    if (label.length > 126) return "tooLong";
    const encoded = "xn--" + punycodeEncode(label.normalize("NFC").toLowerCase());
    return encoded.length > 63 ? "tooLong" : encoded;
  });
}

/** `xn--bcher-kva.example` to `bücher.example`. */
export function domainToUnicode(text: string): DomainResult {
  return mapDomain(text, (label) => {
    if (!/^xn--/i.test(label)) return label;
    if (label.length > 63) return "tooLong";
    const decoded = punycodeDecode(label.slice(4));
    return decoded === null || decoded === "" ? "invalid" : decoded.toLowerCase();
  });
}
