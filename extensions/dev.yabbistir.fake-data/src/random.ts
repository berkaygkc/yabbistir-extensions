/** Where random numbers come from. Tests replace it; the app always uses `crypto.getRandomValues`. */
export type RandomSource = (array: Uint32Array) => Uint32Array;

const fromCrypto: RandomSource = (array) => crypto.getRandomValues(array);

let source: RandomSource = fromCrypto;

/** Swaps the random source (tests only). `null` goes back to `crypto.getRandomValues`. */
export function useRandomSource(next: RandomSource | null): void {
  source = next ?? fromCrypto;
}

const range = 0x100000000;

/** A uniform whole number from 0 up to, not including, `max` (rejection sampling, so there is no modulo bias). */
export function int(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > range) throw new RangeError("max must be a whole number from 1 to 2^32");
  const limit = range - (range % max);
  const slot = new Uint32Array(1);
  for (let tries = 0; tries < 64; tries += 1) {
    const value = source(slot)[0] >>> 0;
    if (value < limit) return value % max;
  }
  // A broken source that never answers below the limit must not hang a hint.
  return (slot[0] >>> 0) % max;
}

/** A whole number from `low` to `high`, both included. */
export function between(low: number, high: number): number {
  return low + int(high - low + 1);
}

export function pick<T>(list: readonly T[]): T {
  return list[int(list.length)];
}

/** `count` random decimal digits. */
export function digits(count: number): number[] {
  return Array.from({ length: count }, () => int(10));
}

/** A version 4 UUID built from the same source. */
export function uuid(): string {
  const bytes = Array.from({ length: 16 }, () => int(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
