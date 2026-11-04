import { hmac, type Algorithm } from "./hash.ts";

// One-time codes: HOTP (RFC 4226) and TOTP (RFC 6238), and the Base32 (RFC 4648) their seeds are written in.

export interface Totp {
  secret: Uint8Array;
  algorithm: Algorithm;
  /** 6 to 10. */
  digits: number;
  /** The time step, in seconds. */
  period: number;
}

/** With fewer milliseconds than this left in a period, the next period's code is pasted instead. */
export const MARGIN = 3_000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * The bytes a Base32 text stands for, or undefined when it holds anything but Base32 letters (either case), spaces,
 * hyphens and trailing "=" padding, or nothing at all. Bits left over after the last whole byte are dropped, as
 * authenticator apps do.
 */
export function base32Bytes(text: string): Uint8Array | undefined {
  const letters = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (letters === "") return undefined;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const letter of letters) {
    const value = BASE32.indexOf(letter);
    if (value === -1) return undefined;
    buffer = ((buffer << 5) | value) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out.length === 0 ? undefined : new Uint8Array(out);
}

/** The counter as 8 bytes, big-endian. Counters stay well below 2^53. */
function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let rest = counter;
  for (let index = 7; index >= 0; index--) {
    bytes[index] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return bytes;
}

/** RFC 4226 section 5.3: the HMAC's dynamic truncation, as `digits` decimal digits with leading zeros. */
export function hotp(secret: Uint8Array, counter: number, algorithm: Algorithm, digits: number): string {
  const mac = hmac(algorithm, secret, counterBytes(counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) * 2 ** 24) + (mac[offset + 1] << 16) + (mac[offset + 2] << 8) + mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** RFC 6238 section 4.2: the number of whole periods since the Unix epoch. */
export function counterAt(nowMs: number, period: number): number {
  return Math.floor(nowMs / (period * 1000));
}

/**
 * The code to paste at `nowMs`: the current period's, or the next period's when fewer than three seconds of the current
 * one are left, so the code does not expire on its way to the server.
 */
export function codeToPaste(account: Totp, nowMs: number): string {
  const periodMs = account.period * 1000;
  const left = periodMs - (((nowMs % periodMs) + periodMs) % periodMs);
  const counter = counterAt(nowMs, account.period) + (left < MARGIN ? 1 : 0);
  return hotp(account.secret, counter, account.algorithm, account.digits);
}
