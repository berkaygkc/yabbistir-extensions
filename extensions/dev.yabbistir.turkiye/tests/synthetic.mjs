// Synthetic numbers for the tests, built here with their check digits worked out from scratch. None of them belongs
// to anyone: the account parts are runs of the same digit or counters.
import { createFakeHost } from "@yabbistir/api/fake-host";

export const folder = new URL("..", import.meta.url);
export const id = "dev.yabbistir.turkiye";

export const hostIn = (language = "en", options = {}) => createFakeHost({ folder, context: { language }, ...options });

/** A text item, with the tags a test wants it to carry ("iban" means this extension's own iban tag). */
export const item = (text, ...tags) => ({
  id: 1, kind: "text", text, tags: tags.map((tag) => `${id}:${tag}`), copiedAt: "2026-01-01T00:00:00Z",
});

/** ISO 7064 MOD 97-10, written independently of src/iban.ts so the two check each other. */
function remainder(digits) {
  let rest = 0;
  for (const char of digits) rest = (rest * 10 + Number(char)) % 97;
  return rest;
}
const numeric = (text) => Array.from(text, (char) => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55))).join("");

/** An IBAN for `country` with this BBAN and the check digits it needs. */
export function iban(country, bban) {
  const check = 98 - remainder(numeric(`${bban}${country}00`));
  return `${country}${String(check).padStart(2, "0")}${bban}`;
}

/** A Turkish IBAN: the five-digit bank code, the reserve digit 0 and a sixteen-digit account number. */
export const turkishIban = (bank, account = "0000000000000001") => iban("TR", `${bank}0${account}`);

/** "TR330006…" → "TR33 0006 …" */
export const spaced = (compact) => compact.replace(/(.{4})(?=.)/g, "$1 ");

/** A TC Kimlik No built from its first nine digits. */
export function tckn(nine) {
  const d = Array.from(nine, Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = (d.reduce((sum, digit) => sum + digit, 0) + tenth) % 10;
  return `${nine}${tenth}${eleventh}`;
}

/** A VKN built from its first nine digits. */
export function vkn(nine) {
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    const position = index + 1;
    const p = (Number(nine[index]) + 10 - position) % 10;
    if (p === 0) continue;
    const q = (p * 2 ** (10 - position)) % 9;
    sum += q === 0 ? 9 : q;
  }
  return `${nine}${(10 - (sum % 10)) % 10}`;
}

/** A small deterministic generator, so the "many numbers" tests are the same on every run. */
export function digitsFrom(seed) {
  let state = seed >>> 0;
  return (count, firstNonZero = false) => {
    let out = "";
    for (let index = 0; index < count; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const digit = (state >>> 16) % 10;
      out += index === 0 && firstNonZero ? String(1 + (digit % 9)) : String(digit);
    }
    return out;
  };
}

/** Changes one digit of a number at `index`, to the next digit. */
export const bump = (number, index) =>
  `${number.slice(0, index)}${(Number(number[index]) + 1) % 10}${number.slice(index + 1)}`;
