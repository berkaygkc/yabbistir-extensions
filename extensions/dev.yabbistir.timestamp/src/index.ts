import type { Actions, Context, Detectors, Item, PreviewSection } from "@yabbistir/api";

type Form = "seconds" | "milliseconds" | "microseconds" | "nanoseconds" | "iso" | "rfc2822";

export interface Moment {
  /** Milliseconds since 1970 (UTC), a whole number. */
  ms: number;
  /** Nanoseconds past that millisecond, 0 to 999 999. */
  subMs: number;
  form: Form;
  /** True when the text carried no time zone and was read in this Mac's time. */
  assumedLocal: boolean;
}

/** Texts longer than this are never timestamps; it also bounds every regular expression below. */
const maxLength = 64;
const minMs = Date.UTC(1990, 0, 1);
const maxMs = Date.UTC(2100, 0, 1);

const iso = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.,]([0-9]{1,9}))?)? ?(?:([Zz])|([+-])([0-9]{2})(?::?([0-9]{2}))?)?$/;
const rfc = /^(?:([A-Za-z]{3}), ?)?([0-9]{1,2}) ([A-Za-z]{3}) ([0-9]{4}) ([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?(?: ([+-][0-9]{4}|[A-Za-z]{1,3}))?$/;
const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** RFC 2822's named zones, in minutes from UTC. */
const zones: Record<string, number> = { ut: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420 };

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inRange(ms: number): boolean {
  return Number.isFinite(ms) && ms >= minMs && ms < maxMs;
}

interface Parts {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}

/** True for a real calendar date and clock time (no leap seconds, no 24:00). The supported range is applied later, on the instant. */
function validParts(p: Parts): boolean {
  return p.year >= 1000 && p.year <= 9999 && p.month >= 1 && p.month <= 12 && p.day >= 1 && p.day <= daysIn(p.year, p.month)
    && p.hour <= 23 && p.minute <= 59 && p.second <= 59;
}

function epoch(p: Parts, offsetMinutes: number | null): number {
  if (offsetMinutes === null) return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second).getTime();
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - offsetMinutes * 60_000;
}

function parseNumber(text: string): Moment | null {
  if (!/^[1-9][0-9]*$/.test(text)) return null;
  const big = BigInt(text);
  let ms: bigint;
  let subMs = 0n;
  let form: Form;
  switch (text.length) {
    case 10: ms = big * 1000n; form = "seconds"; break;
    case 13: ms = big; form = "milliseconds"; break;
    case 16: ms = big / 1000n; subMs = (big % 1000n) * 1000n; form = "microseconds"; break;
    case 19: ms = big / 1_000_000n; subMs = big % 1_000_000n; form = "nanoseconds"; break;
    default: return null;
  }
  const value = Number(ms);
  return inRange(value) ? { ms: value, subMs: Number(subMs), form, assumedLocal: false } : null;
}

function parseIso(text: string): Moment | null {
  const m = iso.exec(text);
  if (m === null) return null;
  const parts: Parts = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: m[6] === undefined ? 0 : +m[6] };
  if (!validParts(parts)) return null;
  let offset: number | null = null;
  if (m[8] !== undefined) offset = 0;
  else if (m[9] !== undefined) {
    const hours = +m[10];
    const minutes = m[11] === undefined ? 0 : +m[11];
    if (hours > 23 || minutes > 59) return null;
    offset = (m[9] === "-" ? -1 : 1) * (hours * 60 + minutes);
  }
  const fraction = (m[7] ?? "").padEnd(9, "0");
  const ms = epoch(parts, offset) + Number(fraction.slice(0, 3));
  if (!inRange(ms)) return null;
  return { ms, subMs: Number(fraction.slice(3)), form: "iso", assumedLocal: offset === null };
}

function parseRfc(text: string): Moment | null {
  const m = rfc.exec(text);
  if (m === null) return null;
  const month = months.indexOf(m[3].toLowerCase()) + 1;
  if (month === 0) return null;
  const parts: Parts = { year: +m[4], month, day: +m[2], hour: +m[5], minute: +m[6], second: m[7] === undefined ? 0 : +m[7] };
  if (!validParts(parts)) return null;
  if (m[1] !== undefined) {
    const weekday = days.indexOf(m[1].toLowerCase());
    if (weekday < 0 || weekday !== new Date(Date.UTC(parts.year, month - 1, parts.day)).getUTCDay()) return null;
  }
  let offset: number | null = null;
  const zone = m[8];
  if (zone !== undefined) {
    if (zone[0] === "+" || zone[0] === "-") {
      const hours = +zone.slice(1, 3);
      const minutes = +zone.slice(3, 5);
      if (hours > 23 || minutes > 59) return null;
      offset = (zone[0] === "-" ? -1 : 1) * (hours * 60 + minutes);
    } else {
      const known = zones[zone.toLowerCase()];
      if (known === undefined) return null;
      offset = known;
    }
  }
  const ms = epoch(parts, offset);
  return inRange(ms) ? { ms, subMs: 0, form: "rfc2822", assumedLocal: offset === null } : null;
}

/** The moment a whole text names, or null. Never throws. */
export function parse(input: string | undefined | null): Moment | null {
  const text = (input ?? "").trim();
  if (text === "" || text.length > maxLength) return null;
  try {
    if (/^[0-9]+$/.test(text)) return parseNumber(text);
    return parseIso(text) ?? parseRfc(text);
  } catch {
    return null;
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** 2026-01-01T00:00:00Z, with a fraction only when there is one (3, 6 or 9 digits). */
export function toIso(moment: Moment): string {
  const d = new Date(moment.ms);
  const nanos = d.getUTCMilliseconds() * 1_000_000 + moment.subMs;
  let fraction = "";
  if (nanos !== 0) {
    const digits = pad(nanos, 9);
    fraction = "." + (nanos % 1_000_000 === 0 ? digits.slice(0, 3) : nanos % 1000 === 0 ? digits.slice(0, 6) : digits);
  }
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${fraction}Z`;
}

export const toSeconds = (moment: Moment): string => String(Math.floor(moment.ms / 1000));
export const toMilliseconds = (moment: Moment): string => String(moment.ms);

function format(ms: number, language: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "long", timeStyle: "long", timeZone }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function weekday(ms: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { weekday: "long" }).format(new Date(ms));
  } catch {
    return "";
  }
}

/** "3 days ago" / "3 gün önce", in the app's language. */
export function relative(ms: number, nowMs: number, language: string): string {
  const seconds = (ms - nowMs) / 1000;
  const abs = Math.abs(seconds);
  let unit: Intl.RelativeTimeFormatUnit;
  let value: number;
  if (abs < 60) { unit = "second"; value = seconds; }
  else if (abs < 3600) { unit = "minute"; value = seconds / 60; }
  else if (abs < 86_400) { unit = "hour"; value = seconds / 3600; }
  else if (abs < 30 * 86_400) { unit = "day"; value = seconds / 86_400; }
  else if (abs < 365 * 86_400) { unit = "month"; value = seconds / (30.4375 * 86_400); }
  else { unit = "year"; value = seconds / (365.25 * 86_400); }
  try {
    return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(Math.round(value), unit);
  } catch {
    return "";
  }
}

/** The extra zone from the preferences, or null when it is empty or not an IANA zone. */
export function extraZone(preferences: Record<string, unknown>): string | null {
  const value = preferences.zone;
  if (typeof value !== "string") return null;
  const zone = value.trim();
  if (zone === "" || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function formLabel(moment: Moment): string {
  if (moment.form === "iso" || moment.form === "rfc2822") return yab.t(`form.${moment.form}${moment.assumedLocal ? "Local" : ""}`);
  return yab.t(`form.${moment.form}`);
}

const momentOf = (item: Item | null) => (item === null ? null : parse(item.text));

export const detectors: Detectors = {
  timestamp: {
    validate: (item) => parse(item.text) !== null,
    preview(item, ctx: Context): PreviewSection[] {
      const moment = parse(item.text);
      if (moment === null) return [];
      const { ms } = moment;
      const time: [string, string][] = [
        [yab.t("local"), format(ms, ctx.language)],
        ["UTC", format(ms, ctx.language, "UTC")],
      ];
      const zone = extraZone(ctx.preferences ?? {});
      if (zone !== null) time.push([zone, format(ms, ctx.language, zone)]);
      time.push(["ISO 8601", toIso(moment)]);
      const details: [string, string][] = [];
      const ago = relative(ms, Date.now(), ctx.language);
      if (ago !== "") details.push([yab.t("relative"), ago]);
      const day = weekday(ms, ctx.language);
      if (day !== "") details.push([yab.t("weekday"), day]);
      details.push([yab.t("unixSeconds"), toSeconds(moment)], [yab.t("readAs"), formLabel(moment)]);
      return [
        { type: "keyValue", title: yab.t("preview.time"), rows: time },
        { type: "keyValue", title: yab.t("preview.details"), rows: details },
      ];
    },
  },
};

function convert(make: (moment: Moment, ctx: Context) => string) {
  return {
    run(item: Item | null, ctx: Context) {
      const moment = momentOf(item);
      if (moment === null) return { none: true as const, message: yab.t("notATimestamp") };
      return { text: make(moment, ctx) };
    },
  };
}

export const actions: Actions = {
  toIso: convert((m) => toIso(m)),
  toSeconds: convert((m) => toSeconds(m)),
  toMilliseconds: convert((m) => toMilliseconds(m)),
  toLocal: convert((m, ctx) => format(m.ms, ctx.language)),
  nowSeconds: { run: () => ({ text: String(Math.floor(Date.now() / 1000)) }) },
  nowIso: {
    run: () => {
      const now = Date.now();
      return { text: toIso({ ms: now, subMs: 0, form: "milliseconds", assumedLocal: false }) };
    },
  },
};
