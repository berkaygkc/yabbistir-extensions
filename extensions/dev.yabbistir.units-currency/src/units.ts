// Unit tables, parsing and conversion. Pure functions: no host calls, so detectors and previews can use them.

export type Dimension = "length" | "mass" | "temperature" | "volume" | "speed" | "area" | "data" | "time";

export interface Unit {
  id: string;
  dim: Dimension;
  /** Which family the unit belongs to; "other system" conversions cross families. */
  sys: string;
  label: string;
  /** Size of one of this unit in the dimension's base unit (not used for temperature). */
  factor: number;
  aliases: string[];
}

export interface Quantity {
  value: number;
  unit: Unit;
  /** How the input was written, when it is not a number and a unit (a compound duration such as 1h 30m). */
  display?: string;
}

const u = (id: string, dim: Dimension, sys: string, label: string, factor: number, aliases: string[]): Unit => ({
  id, dim, sys, label, factor, aliases,
});

export const units: Unit[] = [
  // Length, base metre.
  u("mm", "length", "metric", "mm", 0.001, ["mm", "millimeter", "millimeters", "millimetre", "millimetres", "milimetre"]),
  u("cm", "length", "metric", "cm", 0.01, ["cm", "centimeter", "centimeters", "centimetre", "centimetres", "santimetre", "santim"]),
  u("m", "length", "metric", "m", 1, ["m", "meter", "meters", "metre", "metres"]),
  u("km", "length", "metric", "km", 1000, ["km", "kilometer", "kilometers", "kilometre", "kilometres"]),
  u("in", "length", "imperial", "in", 0.0254, ["in", "inch", "inches", "inç"]),
  u("ft", "length", "imperial", "ft", 0.3048, ["ft", "foot", "feet"]),
  u("yd", "length", "imperial", "yd", 0.9144, ["yd", "yds", "yard", "yards"]),
  u("mi", "length", "imperial", "mi", 1609.344, ["mi", "mile", "miles", "mil"]),
  // Mass, base kilogram.
  u("mg", "mass", "metric", "mg", 1e-6, ["mg", "milligram", "milligrams", "miligram"]),
  u("g", "mass", "metric", "g", 0.001, ["g", "gr", "gram", "grams"]),
  u("kg", "mass", "metric", "kg", 1, ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"]),
  u("t", "mass", "metric", "t", 1000, ["t", "tonne", "tonnes", "ton", "tons", "metricton", "metrictons"]),
  u("oz", "mass", "imperial", "oz", 0.028349523125, ["oz", "ounce", "ounces"]),
  u("lb", "mass", "imperial", "lb", 0.45359237, ["lb", "lbs", "pound", "pounds"]),
  u("st", "mass", "imperial", "st", 6.35029318, ["st", "stone", "stones"]),
  // Temperature, base kelvin (conversion by function).
  u("c", "temperature", "metric", "°C", 1, ["°c", "ºc", "℃", "c", "celsius", "degc", "degreescelsius", "°celsius"]),
  u("f", "temperature", "imperial", "°F", 1, ["°f", "ºf", "℉", "f", "fahrenheit", "degf", "degreesfahrenheit", "°fahrenheit"]),
  u("k", "temperature", "metric", "K", 1, ["k", "kelvin", "°k"]),
  // Volume, base litre (US customary for the cooking and liquid units).
  u("ml", "volume", "metric", "ml", 0.001, ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "mililitre"]),
  u("cl", "volume", "metric", "cl", 0.01, ["cl", "centiliter", "centiliters", "centilitre", "centilitres", "santilitre"]),
  u("l", "volume", "metric", "l", 1, ["l", "lt", "liter", "liters", "litre", "litres"]),
  u("tsp", "volume", "imperial", "tsp", 0.00492892159375, ["tsp", "teaspoon", "teaspoons"]),
  u("tbsp", "volume", "imperial", "tbsp", 0.01478676478125, ["tbsp", "tablespoon", "tablespoons"]),
  u("floz", "volume", "imperial", "fl oz", 0.0295735295625, ["floz", "fluidounce", "fluidounces"]),
  u("cup", "volume", "imperial", "cup", 0.2365882365, ["cup", "cups"]),
  u("pt", "volume", "imperial", "pt", 0.473176473, ["pt", "pint", "pints"]),
  u("qt", "volume", "imperial", "qt", 0.946352946, ["qt", "quart", "quarts"]),
  u("gal", "volume", "imperial", "gal", 3.785411784, ["gal", "gallon", "gallons"]),
  // Speed, base metre per second.
  u("kmh", "speed", "metric", "km/h", 1 / 3.6, ["km/h", "kmh", "kph", "kmph"]),
  u("ms", "speed", "metric", "m/s", 1, ["m/s", "mps"]),
  u("mph", "speed", "imperial", "mph", 0.44704, ["mph", "mi/h"]),
  u("kn", "speed", "imperial", "kn", 1852 / 3600, ["kn", "kt", "kts", "knot", "knots"]),
  // Area, base square metre.
  u("cm2", "area", "metric", "cm²", 1e-4, ["cm2", "cm^2", "sqcm"]),
  u("m2", "area", "metric", "m²", 1, ["m2", "m^2", "sqm"]),
  u("ha", "area", "metric", "ha", 1e4, ["ha", "hectare", "hectares", "hektar"]),
  u("km2", "area", "metric", "km²", 1e6, ["km2", "km^2", "sqkm"]),
  u("in2", "area", "imperial", "in²", 6.4516e-4, ["in2", "in^2", "sqin"]),
  u("ft2", "area", "imperial", "ft²", 0.09290304, ["ft2", "ft^2", "sqft", "sqfeet", "squarefeet", "squarefoot"]),
  u("yd2", "area", "imperial", "yd²", 0.83612736, ["yd2", "yd^2", "sqyd"]),
  u("acre", "area", "imperial", "acre", 4046.8564224, ["acre", "acres"]),
  u("mi2", "area", "imperial", "mi²", 2589988.110336, ["mi2", "mi^2", "sqmi"]),
  // Data, base byte. KB is 1000 bytes (as macOS counts), KiB is 1024.
  u("B", "data", "decimal", "B", 1, ["b", "byte", "bytes"]),
  u("KB", "data", "decimal", "KB", 1e3, ["kb", "kilobyte", "kilobytes"]),
  u("MB", "data", "decimal", "MB", 1e6, ["mb", "megabyte", "megabytes"]),
  u("GB", "data", "decimal", "GB", 1e9, ["gb", "gigabyte", "gigabytes"]),
  u("TB", "data", "decimal", "TB", 1e12, ["tb", "terabyte", "terabytes"]),
  u("KiB", "data", "binary", "KiB", 1024, ["kib", "kibibyte", "kibibytes"]),
  u("MiB", "data", "binary", "MiB", 1024 ** 2, ["mib", "mebibyte", "mebibytes"]),
  u("GiB", "data", "binary", "GiB", 1024 ** 3, ["gib", "gibibyte", "gibibytes"]),
  u("TiB", "data", "binary", "TiB", 1024 ** 4, ["tib", "tebibyte", "tebibytes"]),
  // Time, base second.
  u("msec", "time", "time", "ms", 0.001, ["msec", "millisecond", "milliseconds", "milisaniye"]),
  u("s", "time", "time", "s", 1, ["s", "sec", "secs", "second", "seconds", "saniye", "sn"]),
  u("min", "time", "time", "min", 60, ["min", "mins", "minute", "minutes", "dakika", "dk"]),
  u("h", "time", "time", "h", 3600, ["h", "hr", "hrs", "hour", "hours", "saat", "sa"]),
  u("d", "time", "time", "d", 86400, ["d", "day", "days", "gün", "gun"]),
  u("wk", "time", "time", "wk", 604800, ["wk", "wks", "w", "week", "weeks", "hafta"]),
];

/** "ms" is both a millisecond and (as m/s) a speed: the plain text "ms" means milliseconds. */
const byAlias = new Map<string, Unit>();
for (const unit of units) {
  for (const alias of unit.aliases) {
    if (!byAlias.has(alias)) byAlias.set(alias, unit);
  }
}
// "ms" as typed is milliseconds.
byAlias.set("ms", units.find((unit) => unit.id === "msec")!);

export const unitsOf = (dim: Dimension): Unit[] => units.filter((unit) => unit.dim === dim);

/** Lowercase, no spaces or dots, ² as 2. */
export function normalizeUnit(text: string): string {
  return text.toLowerCase().replace(/[\s. ]/g, "").replace(/²/g, "2").replace(/\^2/g, "2");
}

export function findUnit(text: string): Unit | null {
  const raw = text.trim();
  if (raw === "" || raw.length > 24) return null;
  // Megabit, gigabit and so on are not bytes.
  if (/^[KMGT]b$/.test(raw)) return null;
  // A bare F or C is a temperature only in capitals; "°C" and the word forms are in the table.
  if (raw === "c" || raw === "f") return null;
  return byAlias.get(normalizeUnit(raw)) ?? null;
}

const groupSeparators = /[    '’]/;
export const numberChar = /[0-9.,'’\s   ]/;

/** Decimal comma in this language? Falls back to the dot. */
export function usesDecimalComma(language: string | undefined): boolean {
  try {
    const part = new Intl.NumberFormat(language || "en").formatToParts(1.1).find((p) => p.type === "decimal");
    return part?.value === ",";
  } catch {
    return false;
  }
}

const digits = /^[0-9]+$/;
const first = /^[0-9]{1,3}$/;
const group = /^[0-9]{3}$/;

function groupedInteger(parts: string[]): string | null {
  if (parts.length === 0 || !first.test(parts[0])) return null;
  for (let i = 1; i < parts.length; i += 1) if (!group.test(parts[i])) return null;
  return parts.join("");
}

/**
 * A number as people write it: 1234, 1,234.5, 1.234,5, 1 234,5, 1'234.5, 3,5. When a single separator is followed by
 * exactly three digits ("1,234") it is a thousands separator unless it is the language's decimal separator.
 */
export function parseNumber(raw: string, commaDecimal: boolean): number | null {
  const text = raw.trim();
  if (text === "" || text.length > 40 || !/^[0-9]/.test(text)) return null;
  let integer: string | null;
  let fraction = "";
  if (groupSeparators.test(text)) {
    // Spaces (or apostrophes) group the thousands; a . or , may only start the fraction of the last group.
    const parts = text.split(/[    '’]/);
    const last = parts[parts.length - 1];
    const match = /^([0-9]{1,3})(?:[.,]([0-9]+))?$/.exec(last);
    if (!match) return null;
    if (!group.test(match[1])) return null;
    parts[parts.length - 1] = match[1];
    integer = groupedInteger(parts);
    fraction = match[2] ?? "";
  } else {
    const dots = text.split(".").length - 1;
    const commas = text.split(",").length - 1;
    if (dots > 0 && commas > 0) {
      const decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
      const thousands = decimal === "." ? "," : ".";
      if (text.split(decimal).length !== 2) return null;
      const [head, tail] = text.split(decimal);
      if (head.includes(decimal) || !digits.test(tail)) return null;
      integer = groupedInteger(head.split(thousands));
      fraction = tail;
    } else if (dots + commas === 0) {
      integer = digits.test(text) ? text : null;
    } else {
      const sep = dots > 0 ? "." : ",";
      const parts = text.split(sep);
      if (parts.length > 2) {
        integer = groupedInteger(parts);
      } else {
        const [head, tail] = parts;
        if (!digits.test(head) || !digits.test(tail)) return null;
        const ambiguous = tail.length === 3 && head.length <= 3 && head !== "0" && !head.startsWith("0");
        const thousands = ambiguous && sep !== (commaDecimal ? "," : ".");
        if (thousands) {
          integer = head + tail;
        } else {
          integer = head;
          fraction = tail;
        }
      }
    }
  }
  if (integer === null) return null;
  const value = Number(fraction === "" ? integer : `${integer}.${fraction}`);
  return Number.isFinite(value) ? value : null;
}

/** Splits a leading sign off: returns the sign (1 or -1) and the rest. */
export function splitSign(text: string): { sign: 1 | -1; rest: string } {
  const match = /^([-+−])\s*/.exec(text);
  if (!match) return { sign: 1, rest: text };
  return { sign: match[1] === "+" ? 1 : -1, rest: text.slice(match[0].length) };
}

const maxText = 64;

function parseCompound(text: string): Quantity | null {
  // 1h 30m, 2 d 4 h: strictly descending time units, each once.
  let i = 0;
  let total = 0;
  let count = 0;
  let lastFactor = Infinity;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i += 1;
    let start = i;
    while (i < n && /[0-9.,]/.test(text[i])) i += 1;
    const num = parseNumber(text.slice(start, i), false);
    if (num === null) return null;
    while (i < n && /\s/.test(text[i])) i += 1;
    start = i;
    while (i < n && /[A-Za-zçğıöşüÇĞİÖŞÜ]/.test(text[i])) i += 1;
    const word = text.slice(start, i);
    // In "1h 30m" the m is minutes.
    const unit = word === "m" ? byAlias.get("min") ?? null : findUnit(word);
    if (!unit || unit.dim !== "time" || unit.factor >= lastFactor) return null;
    lastFactor = unit.factor;
    total += num * unit.factor;
    count += 1;
  }
  if (count < 2) return null;
  return { value: total, unit: units.find((x) => x.id === "s")!, display: text };
}

/** A whole text that is a number and a unit, or null. Quick and linear; `commaDecimal` settles "1,234". */
export function parseQuantity(input: string, commaDecimal = false): Quantity | null {
  const text = input.trim();
  if (text === "" || text.length > maxText) return null;
  const { sign, rest } = splitSign(text);
  let end = 0;
  while (end < rest.length && numberChar.test(rest[end])) end += 1;
  let lastDigit = end - 1;
  while (lastDigit >= 0 && !/[0-9]/.test(rest[lastDigit])) lastDigit -= 1;
  if (lastDigit < 0) return null;
  const numeric = rest.slice(0, lastDigit + 1);
  const unitText = rest.slice(lastDigit + 1).trim();
  const value = parseNumber(numeric, commaDecimal);
  if (value === null || unitText === "") return null;
  const unit = findUnit(unitText);
  if (!unit) {
    if (/[0-9]/.test(rest.slice(lastDigit + 1))) {
      const compound = parseCompound(rest);
      if (compound) return { ...compound, value: compound.value * sign };
    }
    return null;
  }
  const signed = sign * value;
  if (Math.abs(signed) > 1e15) return null;
  // Nothing is colder than absolute zero.
  if (unit.dim === "temperature" && toKelvin(signed, unit) < -1e-9) return null;
  return { value: signed, unit };
}

function toKelvin(value: number, unit: Unit): number {
  if (unit.id === "c") return value + 273.15;
  if (unit.id === "f") return ((value - 32) * 5) / 9 + 273.15;
  return value;
}

function fromKelvin(kelvin: number, unit: Unit): number {
  if (unit.id === "c") return kelvin - 273.15;
  if (unit.id === "f") return ((kelvin - 273.15) * 9) / 5 + 32;
  return kelvin;
}

export function convert(value: number, from: Unit, to: Unit): number {
  if (from.dim === "temperature") return fromKelvin(toKelvin(value, from), to);
  return (value * from.factor) / to.factor;
}

/** How far a number is from being pleasant to read: small whole-ish numbers win, and below 1 costs a little. */
const score = (value: number): number => {
  if (value === 0 || !Number.isFinite(value)) return 0;
  const magnitude = Math.log10(Math.abs(value));
  return magnitude < 0 ? -magnitude + 1 : magnitude;
};

const caps: Record<Dimension, { other: number; same: number; mainSame: boolean }> = {
  length: { other: 2, same: 2, mainSame: false },
  mass: { other: 2, same: 2, mainSame: false },
  temperature: { other: 3, same: 0, mainSame: false },
  volume: { other: 2, same: 2, mainSame: false },
  speed: { other: 2, same: 1, mainSame: false },
  area: { other: 2, same: 2, mainSame: false },
  data: { other: 2, same: 3, mainSame: true },
  time: { other: 0, same: 4, mainSame: true },
};

/** Speeds read best in the other country's everyday unit, not the one closest to 1. */
const mainOverride: Record<string, string> = { kmh: "mph", ms: "mph", mph: "kmh", kn: "kmh" };

export interface Conversion {
  unit: Unit;
  value: number;
}

/** The sensible conversions of a quantity, best first: the main one, then the common neighbors. */
export function conversionsOf(quantity: Quantity): Conversion[] {
  const { unit, value } = quantity;
  const rule = caps[unit.dim];
  const all = unitsOf(unit.dim)
    .filter((candidate) => candidate.id !== unit.id)
    .map((candidate, order) => ({
      unit: candidate,
      value: convert(value, unit, candidate),
      order,
      // A zero reads the same everywhere: prefer the unit of about the same size.
      near: Math.abs(Math.log10(candidate.factor / unit.factor)),
    }));
  const rank = (a: { value: number; order: number; near: number }, b: { value: number; order: number; near: number }) =>
    score(a.value) - score(b.value) || a.near - b.near || a.order - b.order;
  if (unit.dim === "temperature") {
    const main = unit.id === "f" ? "c" : unit.id === "c" ? "f" : "c";
    const ordered = [...all.filter((x) => x.unit.id === main), ...all.filter((x) => x.unit.id !== main)];
    return ordered.map(({ unit: target, value: converted }) => ({ unit: target, value: converted }));
  }
  const same = all.filter((x) => x.unit.sys === unit.sys).sort(rank);
  const other = all.filter((x) => x.unit.sys !== unit.sys).sort(rank);
  const preferred = other.find((x) => x.unit.id === mainOverride[unit.id]);
  const primary = preferred ? [preferred] : rule.mainSame ? same : other;
  const picked: typeof all = [];
  const take = (list: typeof all, count: number) => {
    for (const entry of list.slice(0, count)) if (!picked.includes(entry)) picked.push(entry);
  };
  take(primary, 1);
  take(other, rule.other);
  take(same, rule.same);
  // Present in a steady order after the main one: the main first, then by closeness.
  const [main, ...others] = picked;
  return [main, ...others.sort(rank)].filter(Boolean).map(({ unit: target, value: converted }) => ({ unit: target, value: converted }));
}

/** Some languages group digits with a no-break space; text that is pasted should hold ordinary spaces. */
export const plainSpaces = (text: string): string => text.replace(/[\u00a0\u202f\u2009]/g, " ");

/** A number for people: sensible digits, in the language's own separators. */
export function formatNumber(value: number, language: string): string {
  if (!Number.isFinite(value)) return "";
  const magnitude = Math.abs(value);
  let options: Intl.NumberFormatOptions;
  if (magnitude !== 0 && (magnitude >= 1e15 || magnitude < 1e-9)) return value.toExponential(3);
  if (magnitude >= 1) options = { maximumFractionDigits: 2 };
  else if (magnitude === 0) options = { maximumFractionDigits: 0 };
  else options = { maximumSignificantDigits: 3 };
  try {
    return plainSpaces(new Intl.NumberFormat(language, options).format(value === 0 ? 0 : value));
  } catch {
    return new Intl.NumberFormat("en", options).format(value);
  }
}

export const formatQuantity = (value: number, unit: Unit, language: string): string =>
  `${formatNumber(value, language)} ${unit.label}`;
