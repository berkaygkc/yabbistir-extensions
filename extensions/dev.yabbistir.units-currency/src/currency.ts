// Money parsing, the European Central Bank's rates and their cache. Parsing and the cache are pure; only
// `loadRates` talks to the network, and only from an action.

import { numberChar, parseNumber, plainSpaces, splitSign } from "./units.ts";

/** Where the ECB serves its daily reference rates (euro foreign exchange reference rates, XML). */
export const ecbUrl = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** The currencies the ECB publishes a daily rate for, plus the euro itself. */
export const currencyCodes = [
  "EUR", "USD", "JPY", "BGN", "CZK", "DKK", "GBP", "HUF", "PLN", "RON", "SEK", "CHF", "ISK", "NOK", "TRY",
  "AUD", "BRL", "CAD", "CNY", "HKD", "IDR", "ILS", "INR", "KRW", "MXN", "MYR", "NZD", "PHP", "SGD", "THB", "ZAR",
];

export const defaultTargets = ["TRY", "EUR", "USD", "GBP"];

const symbols: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "₺": "TRY", "¥": "JPY", "₩": "KRW", "₹": "INR" };

export const limits = { fetchMs: 8000, cacheMs: 6 * 60 * 60 * 1000 };

export interface Money {
  amount: number;
  code: string;
}

export function codeOf(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 1) return symbols[trimmed] ?? null;
  const upper = trimmed.toUpperCase();
  if (upper === "TL") return "TRY";
  return currencyCodes.includes(upper) ? upper : null;
}

const isLetter = (char: string) => /[A-Za-z]/.test(char);

/** `120 USD`, `USD 120`, `$120`, `120€`, `₺1.250,50`, `100 TL`: a whole text that is an amount of money. */
export function parseMoney(input: string, commaDecimal = false): Money | null {
  const text = input.trim();
  if (text === "" || text.length > 64) return null;
  const { sign, rest } = splitSign(text);
  let code: string | null = null;
  let numeric: string;
  if (symbols[rest[0]] !== undefined) {
    code = symbols[rest[0]];
    numeric = rest.slice(1);
  } else if (isLetter(rest[0] ?? "")) {
    let end = 0;
    while (end < rest.length && isLetter(rest[end])) end += 1;
    code = codeOf(rest.slice(0, end));
    numeric = rest.slice(end);
  } else {
    let lastDigit = rest.length - 1;
    while (lastDigit >= 0 && !/[0-9]/.test(rest[lastDigit])) lastDigit -= 1;
    if (lastDigit < 0) return null;
    code = codeOf(rest.slice(lastDigit + 1));
    numeric = rest.slice(0, lastDigit + 1);
  }
  if (code === null) return null;
  numeric = numeric.trim();
  for (const char of numeric) if (!numberChar.test(char)) return null;
  const amount = parseNumber(numeric, commaDecimal);
  if (amount === null || amount > 1e13) return null;
  return { amount: sign * amount, code };
}

export interface Rates {
  /** The date the ECB gave the rates, YYYY-MM-DD. */
  date: string;
  /** Units of each currency for one euro. */
  rates: Record<string, number>;
}

interface Cached extends Rates {
  fetchedAt: number;
}

/** The ECB's XML: `<Cube time='2026-11-04'><Cube currency='USD' rate='1.1267'/> …`. Null when it is not that. */
export function parseEcb(xml: string): Rates | null {
  if (typeof xml !== "string" || xml.length === 0 || xml.length > 200_000) return null;
  let date: string | null = null;
  const rates: Record<string, number> = { EUR: 1 };
  let at = 0;
  for (;;) {
    const start = xml.indexOf("<Cube", at);
    if (start < 0) break;
    const end = xml.indexOf(">", start);
    if (end < 0) break;
    at = end + 1;
    const attrs: Record<string, string> = {};
    const tag = xml.slice(start + 5, end);
    const pattern = /([A-Za-z]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(tag)) !== null) attrs[match[1]] = match[2] ?? match[3] ?? "";
    if (attrs.time !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(attrs.time)) date = date ?? attrs.time;
    if (attrs.currency !== undefined && attrs.rate !== undefined && /^[A-Z]{3}$/.test(attrs.currency)) {
      const rate = Number(attrs.rate);
      if (Number.isFinite(rate) && rate > 0) rates[attrs.currency] = rate;
    }
  }
  if (date === null || Object.keys(rates).length < 2) return null;
  return { date, rates };
}

function readCache(): Cached | null {
  try {
    const stored = yab.storage.get("ecb") as Partial<Cached> | undefined | null;
    if (!stored || typeof stored !== "object") return null;
    if (typeof stored.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(stored.date)) return null;
    if (typeof stored.fetchedAt !== "number" || typeof stored.rates !== "object" || stored.rates === null) return null;
    const rates: Record<string, number> = { EUR: 1 };
    for (const [code, rate] of Object.entries(stored.rates)) {
      if (/^[A-Z]{3}$/.test(code) && typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[code] = rate;
    }
    if (Object.keys(rates).length < 2) return null;
    return { date: stored.date, fetchedAt: stored.fetchedAt, rates };
  } catch {
    return null;
  }
}

/** Cached rates for a preview: no network, any age. */
export function cachedRates(): Rates | null {
  const cache = readCache();
  return cache ? { date: cache.date, rates: cache.rates } : null;
}

export interface Loaded extends Rates {
  /** True when the network failed and older cached rates stand in. */
  stale: boolean;
}

/** Today's rates: from the cache when fresh, else from the ECB; the older cache when the ECB cannot be reached. */
export async function loadRates(signal?: AbortSignal): Promise<Loaded | null> {
  const cache = readCache();
  const now = Date.now();
  if (cache && now >= cache.fetchedAt && now - cache.fetchedAt < limits.cacheMs) {
    return { date: cache.date, rates: cache.rates, stale: false };
  }
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener?.("abort", forward);
  const timer = setTimeout(() => controller.abort(), limits.fetchMs);
  try {
    const response = await yab.http.fetch(ecbUrl, { signal: controller.signal });
    const parsed = response.status === 200 && response.text !== undefined ? parseEcb(response.text) : null;
    if (parsed) {
      try {
        yab.storage.set("ecb", { date: parsed.date, fetchedAt: now, rates: parsed.rates });
      } catch {
        // A full store only costs the cache.
      }
      return { ...parsed, stale: false };
    }
  } catch {
    // Offline, blocked or too slow: fall through to the older rates.
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", forward);
  }
  return cache ? { date: cache.date, rates: cache.rates, stale: true } : null;
}

export function convertMoney(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  const a = rates[from];
  const b = rates[to];
  if (a === undefined || b === undefined) return null;
  return (amount / a) * b;
}

/** An amount as the language writes it, with the currency's own symbol or code. */
export function formatMoney(amount: number, code: string, language: string): string {
  const options = { style: "currency", currency: code } as const;
  try {
    return plainSpaces(new Intl.NumberFormat(language, options).format(amount));
  } catch {
    try {
      return plainSpaces(new Intl.NumberFormat("en", options).format(amount));
    } catch {
      return `${amount.toFixed(2)} ${code}`;
    }
  }
}

/** The ISO codes in a preference such as "jpy, CHF; sek", known ones only, in order, without repeats. */
export function extraCodes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const out: string[] = [];
  for (const part of value.slice(0, 400).split(/[\s,;]+/)) {
    const code = codeOf(part);
    if (code !== null && part.length >= 2 && !out.includes(code)) out.push(code);
    if (out.length >= 12) break;
  }
  return out;
}

export function targetsFor(source: string, extras: string[]): string[] {
  const list = [...defaultTargets];
  for (const code of extras) if (!list.includes(code)) list.push(code);
  return list.filter((code) => code !== source);
}
