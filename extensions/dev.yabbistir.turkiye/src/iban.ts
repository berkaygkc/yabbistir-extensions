/**
 * IBAN lengths by country: the ISO 13616 country code and the length of its IBANs, from the SWIFT IBAN Registry
 * (Release 99, December 2024; 89 countries). Only these facts are taken from it.
 */
export const ibanLengths: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22,
  CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22,
  GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30,
  KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20,
  MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22,
  RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

export interface Iban {
  /** Upper case, without spaces: "TR330006100519786457841326". */
  compact: string;
  /** The ISO 3166 country code it starts with. */
  country: string;
}

/** Longer than any IBAN with its spaces and an "IBAN:" label in front. */
const maxText = 64;
const label = /^iban:?[ \u00A0]*/i;
const spaces = /[ \u00A0]/g;
const shape = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
/** A Turkish IBAN's BBAN is "5n, 1n, 16c": the bank code and the reserve digit are digits. */
const turkishStart = /^TR[0-9]{8}/;

/** ISO 7064 MOD 97-10 over the IBAN with its first four characters moved to the end; a valid IBAN gives 1. */
export function mod97(compact: string): number {
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let rest = 0;
  for (let index = 0; index < rearranged.length; index += 1) {
    const code = rearranged.charCodeAt(index);
    // Digits stand for themselves, letters for 10 (A) to 35 (Z).
    rest = code <= 57 ? (rest * 10 + (code - 48)) % 97 : (rest * 100 + (code - 55)) % 97;
  }
  return rest;
}

/**
 * The IBAN in the text, or null unless the whole text is one: its country's length, check digits that pass
 * MOD 97-10, with or without spaces, in either case, after an optional "IBAN:" label. A Turkish IBAN must also have
 * digits for its bank code and reserve digit, since the preview names the bank from them.
 */
export function parseIban(text: string): Iban | null {
  const trimmed = text.trim();
  if (trimmed.length > maxText) return null;
  const compact = trimmed.replace(label, "").replace(spaces, "").toUpperCase();
  if (!shape.test(compact)) return null;
  const country = compact.slice(0, 2);
  if (ibanLengths[country] !== compact.length) return null;
  if (country === "TR" && !turkishStart.test(compact)) return null;
  // 00, 01 and 99 can pass the remainder test but are never issued (ISO 13616 check digits run from 02 to 98).
  const check = compact.slice(2, 4);
  if (check === "00" || check === "01" || check === "99") return null;
  return mod97(compact) === 1 ? { compact, country } : null;
}

/** "TR330006100519786457841326" → "TR33 0006 1005 1978 6457 8413 26". */
export function grouped(compact: string): string {
  return compact.replace(/(.{4})(?=.)/g, "$1 ");
}

/** A Turkish IBAN's bank code: the five digits after the check digits (positions 5 to 9). */
export function turkishBankCode(iban: Iban): string | null {
  return iban.country === "TR" ? iban.compact.slice(4, 9) : null;
}
