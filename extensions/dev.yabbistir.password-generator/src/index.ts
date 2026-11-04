import type { Actions } from "@yabbistir/api";
import { wordList } from "./words.ts";

/** Fills a typed array with random bytes. The app's `crypto.getRandomValues` is the only source in use; tests pass their own. */
export type Fill = <T extends ArrayBufferView>(array: T) => T;

const secureFill: Fill = (array) => crypto.getRandomValues(array);

export const lengthRange = { min: 8, max: 128, fallback: 20 };
export const wordRange = { min: 4, max: 8, fallback: 5 };
export const pinRange = { min: 4, max: 12, fallback: 6 };
export const keyBytes = 32;

export const lowercase = "abcdefghijklmnopqrstuvwxyz";
export const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const digits = "0123456789";
export const symbols = "!@#$%^&*()-_=+[]{};:,.?~";
export const lookAlikes = "Il1O0";

export const separators: Record<string, string> = { dash: "-", space: " ", period: ".", underscore: "_", comma: ",", none: "" };

/**
 * A uniform integer in [0, max) by rejection sampling: a 32-bit draw is thrown away when it falls in the last,
 * incomplete block of 2^32 values, so every outcome is equally likely (no modulo bias).
 */
export function randomBelow(max: number, fill: Fill = secureFill): number {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) throw new RangeError("max out of range");
  if (max === 1) return 0;
  const limit = 0x100000000 - (0x100000000 % max);
  const draw = new Uint32Array(1);
  for (;;) {
    fill(draw);
    if (draw[0] < limit) return draw[0] % max;
  }
}

/** Fisher-Yates with unbiased indexes. */
function shuffle<T>(items: T[], fill: Fill): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, fill);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** A whole number from a preference (text or number), kept inside the range; anything else is the fallback. */
export function readInteger(value: unknown, range: { min: number; max: number; fallback: number }): number {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,9}$/.test(text)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, Number(text)));
}

function enabled(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export interface PasswordOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  noLookAlikes: boolean;
}

/** The character sets to draw from, look-alikes taken out; empty sets are dropped. */
export function characterSets(options: PasswordOptions): string[] {
  const chosen = [
    options.lowercase ? lowercase : "",
    options.uppercase ? uppercase : "",
    options.digits ? digits : "",
    options.symbols ? symbols : "",
  ];
  return chosen
    .map((set) => (options.noLookAlikes ? Array.from(set).filter((c) => !lookAlikes.includes(c)).join("") : set))
    .filter((set) => set !== "");
}

/** A password with at least one character of every enabled set; null when no set is enabled. */
export function generatePassword(options: PasswordOptions, fill: Fill = secureFill): string | null {
  const sets = characterSets(options);
  if (sets.length === 0) return null;
  const length = Math.max(options.length, sets.length);
  const pool = Array.from(sets.join(""));
  const characters = sets.map((set) => set[randomBelow(set.length, fill)]);
  while (characters.length < length) characters.push(pool[randomBelow(pool.length, fill)]);
  return shuffle(characters, fill).join("");
}

export function generatePassphrase(words: number, separator: string, fill: Fill = secureFill): string {
  const picked: string[] = [];
  for (let i = 0; i < words; i++) picked.push(wordList[randomBelow(wordList.length, fill)]);
  return picked.join(separator);
}

export function generatePin(length: number, fill: Fill = secureFill): string {
  let pin = "";
  for (let i = 0; i < length; i++) pin += digits[randomBelow(10, fill)];
  return pin;
}

export function generateHex(bytes: number, fill: Fill = secureFill): string {
  const data = fill(new Uint8Array(bytes));
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateBase64Url(bytes: number, fill: Fill = secureFill): string {
  const data = fill(new Uint8Array(bytes));
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The same `run` serves the hint, so the value shown on the row is the value that is pasted. Nothing here is
// logged, and no message ever contains a generated value.
export const actions: Actions = {
  generate: {
    run(_item, ctx) {
      const prefs = ctx.preferences;
      switch (ctx.variant) {
        case "passphrase": {
          const separator = separators[String(prefs.separator)] ?? separators.dash;
          return { text: generatePassphrase(readInteger(prefs.words, wordRange), separator) };
        }
        case "pin":
          return { text: generatePin(readInteger(prefs.pinLength, pinRange)) };
        case "hex":
          return { text: generateHex(keyBytes) };
        case "base64url":
          return { text: generateBase64Url(keyBytes) };
        default: {
          const password = generatePassword({
            length: readInteger(prefs.length, lengthRange),
            lowercase: enabled(prefs.lowercase, true),
            uppercase: enabled(prefs.uppercase, true),
            digits: enabled(prefs.digits, true),
            symbols: enabled(prefs.symbols, true),
            noLookAlikes: enabled(prefs.noLookAlikes, true),
          });
          if (password === null) return { none: true, message: yab.t("noSets") };
          return { text: password };
        }
      }
    },
  },
};
