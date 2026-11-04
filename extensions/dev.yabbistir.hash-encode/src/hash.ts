/**
 * MD5, SHA-1, SHA-256 and SHA-512 in plain TypeScript. The host's `crypto` has only `getRandomValues` and
 * `randomUUID`, so these are written out. Input is bytes, output is lowercase hex. Each is checked against
 * the official test vectors in the tests.
 */

export type HashName = "md5" | "sha1" | "sha256" | "sha512";

const hex = "0123456789abcdef";

function toHex(words: ArrayLike<number>, littleEndian: boolean): string {
  let out = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i] >>> 0;
    for (let j = 0; j < 4; j++) {
      const shift = littleEndian ? j * 8 : 24 - j * 8;
      const byte = (word >>> shift) & 0xff;
      out += hex[byte >>> 4] + hex[byte & 15];
    }
  }
  return out;
}

/**
 * The message, a 0x80 byte, zeros, and the bit length: padded to a multiple of `block` bytes, with
 * `lengthBytes` bytes (8 or 16) holding the length in bits.
 */
function pad(bytes: Uint8Array, block: number, lengthBytes: number, littleEndian: boolean): Uint8Array {
  const total = Math.ceil((bytes.length + 1 + lengthBytes) / block) * block;
  const out = new Uint8Array(total);
  out.set(bytes);
  out[bytes.length] = 0x80;
  // The length in bits, as a number up to 2^53, spread over its low eight bytes.
  let bits = bytes.length * 8;
  for (let i = 0; i < 8; i++) {
    const byte = bits % 256;
    bits = Math.floor(bits / 256);
    out[littleEndian ? total - lengthBytes + i : total - 1 - i] = byte;
  }
  return out;
}

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

// ---------------------------------------------------------------------------------------------------------
// MD5 (RFC 1321)

const md5Shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
let md5Table: Uint32Array | undefined;

function md5Constants(): Uint32Array {
  if (!md5Table) {
    md5Table = new Uint32Array(64);
    for (let i = 0; i < 64; i++) md5Table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }
  return md5Table;
}

export function md5(bytes: Uint8Array): string {
  const k = md5Constants();
  const data = pad(bytes, 64, 8, true);
  const view = new DataView(data.buffer);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  const m = new Int32Array(16);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getInt32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const next = (b + rotl((a + f + k[i] + m[g]) | 0, md5Shifts[(i >> 4) * 4 + (i & 3)])) | 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  return toHex([a0, b0, c0, d0], true);
}

// ---------------------------------------------------------------------------------------------------------
// SHA-1 (FIPS 180-4)

export function sha1(bytes: Uint8Array): string {
  const data = pad(bytes, 64, 8, false);
  const view = new DataView(data.buffer);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89 | 0;
  let h2 = 0x98badcfe | 0;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0 | 0;
  const w = new Int32Array(80);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getInt32(offset + t * 4, false);
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc | 0;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6 | 0;
      }
      const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return toHex([h0, h1, h2, h3, h4], false);
}

// ---------------------------------------------------------------------------------------------------------
// The SHA-2 constants are the first bits of the fractional parts of the square and cube roots of the first
// primes (FIPS 180-4, 4.2 and 5.3). They are computed here, with integer roots on BigInt, rather than typed in.

function firstPrimes(count: number): number[] {
  const primes: number[] = [];
  for (let n = 2; primes.length < count; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
  return primes;
}

/** floor(value ** (1 / degree)) for a non-negative BigInt, by bisection. */
function integerRoot(value: bigint, degree: bigint): bigint {
  let low = 0n;
  let high = 1n;
  while (high ** degree <= value) high <<= 1n;
  while (low < high - 1n) {
    const mid = (low + high) >> 1n;
    if (mid ** degree <= value) low = mid;
    else high = mid;
  }
  return low;
}

/** The first `bits` bits of the fractional part of the `degree`-th root of `prime`. */
function rootFraction(prime: number, degree: bigint, bits: bigint): bigint {
  const scaled = integerRoot(BigInt(prime) << (bits * degree), degree);
  return scaled & ((1n << bits) - 1n);
}

let sha256Tables: { k: Uint32Array; h: number[] } | undefined;
let sha512Tables: { k: Uint32Array; h: number[] } | undefined;

function sha256Constants() {
  if (!sha256Tables) {
    const k = new Uint32Array(64);
    firstPrimes(64).forEach((p, i) => (k[i] = Number(rootFraction(p, 3n, 32n))));
    const h = firstPrimes(8).map((p) => Number(rootFraction(p, 2n, 32n)) | 0);
    sha256Tables = { k, h };
  }
  return sha256Tables;
}

/** SHA-512 constants as (high, low) 32-bit pairs. */
function sha512Constants() {
  if (!sha512Tables) {
    const split = (value: bigint): number[] => [Number(value >> 32n), Number(value & 0xffffffffn)];
    const k = new Uint32Array(160);
    firstPrimes(80).forEach((p, i) => k.set(split(rootFraction(p, 3n, 64n)), i * 2));
    const h = firstPrimes(8).flatMap((p) => split(rootFraction(p, 2n, 64n)).map((x) => x | 0));
    sha512Tables = { k, h };
  }
  return sha512Tables;
}

export function sha256(bytes: Uint8Array): string {
  const { k, h: initial } = sha256Constants();
  const data = pad(bytes, 64, 8, false);
  const view = new DataView(data.buffer);
  const h = Int32Array.from(initial);
  const w = new Int32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getInt32(offset + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let t = 0; t < 64; t++) {
      const big1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (hh + big1 + choose + k[t] + w[t]) | 0;
      const big0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (big0 + majority) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  return toHex(h, false);
}

// SHA-512 works on 64-bit words, kept as pairs of 32-bit halves: word i is (hi[i], lo[i]).
// The rotate and shift helpers leave their answer in these two variables to avoid allocating.
let outHi = 0;
let outLo = 0;

function rotr64(hi: number, lo: number, n: number): void {
  if (n === 32) {
    outHi = lo;
    outLo = hi;
  } else if (n < 32) {
    outHi = (hi >>> n) | (lo << (32 - n));
    outLo = (lo >>> n) | (hi << (32 - n));
  } else {
    const m = n - 32;
    outHi = (lo >>> m) | (hi << (32 - m));
    outLo = (hi >>> m) | (lo << (32 - m));
  }
}

export function sha512(bytes: Uint8Array): string {
  const { k, h: initial } = sha512Constants();
  const data = pad(bytes, 128, 16, false);
  const view = new DataView(data.buffer);
  // State a..h, each as (hi, lo).
  const h = Int32Array.from(initial);
  const w = new Int32Array(160);
  const v = new Int32Array(16);
  for (let offset = 0; offset < data.length; offset += 128) {
    for (let t = 0; t < 32; t++) w[t] = view.getInt32(offset + t * 4, false);
    for (let t = 16; t < 80; t++) {
      const x = (t - 15) * 2;
      const y = (t - 2) * 2;
      // s0 = rotr1 ^ rotr8 ^ shr7 of w[t-15]
      rotr64(w[x], w[x + 1], 1);
      let s0h = outHi;
      let s0l = outLo;
      rotr64(w[x], w[x + 1], 8);
      s0h ^= outHi;
      s0l ^= outLo;
      s0h ^= w[x] >>> 7;
      s0l ^= (w[x + 1] >>> 7) | (w[x] << 25);
      // s1 = rotr19 ^ rotr61 ^ shr6 of w[t-2]
      rotr64(w[y], w[y + 1], 19);
      let s1h = outHi;
      let s1l = outLo;
      rotr64(w[y], w[y + 1], 61);
      s1h ^= outHi;
      s1l ^= outLo;
      s1h ^= w[y] >>> 6;
      s1l ^= (w[y + 1] >>> 6) | (w[y] << 26);
      const lo = (w[(t - 16) * 2 + 1] >>> 0) + (s0l >>> 0) + (w[(t - 7) * 2 + 1] >>> 0) + (s1l >>> 0);
      const hi = (w[(t - 16) * 2] >>> 0) + (s0h >>> 0) + (w[(t - 7) * 2] >>> 0) + (s1h >>> 0) + Math.floor(lo / 4294967296);
      w[t * 2] = hi | 0;
      w[t * 2 + 1] = lo | 0;
    }
    v.set(h);
    for (let t = 0; t < 80; t++) {
      const ah = v[0], al = v[1], bh = v[2], bl = v[3], ch = v[4], cl = v[5], dh = v[6], dl = v[7];
      const eh = v[8], el = v[9], fh = v[10], fl = v[11], gh = v[12], gl = v[13], hh = v[14], hl = v[15];
      // big1 = rotr14 ^ rotr18 ^ rotr41 of e
      rotr64(eh, el, 14);
      let b1h = outHi;
      let b1l = outLo;
      rotr64(eh, el, 18);
      b1h ^= outHi;
      b1l ^= outLo;
      rotr64(eh, el, 41);
      b1h ^= outHi;
      b1l ^= outLo;
      const chooseH = (eh & fh) ^ (~eh & gh);
      const chooseL = (el & fl) ^ (~el & gl);
      const t1lo = (hl >>> 0) + (b1l >>> 0) + (chooseL >>> 0) + k[t * 2 + 1] + (w[t * 2 + 1] >>> 0);
      const t1hi = (hh >>> 0) + (b1h >>> 0) + (chooseH >>> 0) + k[t * 2] + (w[t * 2] >>> 0) + Math.floor(t1lo / 4294967296);
      // big0 = rotr28 ^ rotr34 ^ rotr39 of a
      rotr64(ah, al, 28);
      let b0h = outHi;
      let b0l = outLo;
      rotr64(ah, al, 34);
      b0h ^= outHi;
      b0l ^= outLo;
      rotr64(ah, al, 39);
      b0h ^= outHi;
      b0l ^= outLo;
      const majH = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majL = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2lo = (b0l >>> 0) + (majL >>> 0);
      const t2hi = (b0h >>> 0) + (majH >>> 0) + Math.floor(t2lo / 4294967296);
      // Shift the registers down, then fill in the new a and e.
      v[14] = gh; v[15] = gl;
      v[12] = fh; v[13] = fl;
      v[10] = eh; v[11] = el;
      const elo = (dl >>> 0) + (t1lo % 4294967296);
      const ehi = (dh >>> 0) + (t1hi % 4294967296) + Math.floor(elo / 4294967296);
      v[8] = ehi | 0; v[9] = elo | 0;
      v[6] = ch; v[7] = cl;
      v[4] = bh; v[5] = bl;
      v[2] = ah; v[3] = al;
      const alo = (t1lo % 4294967296) + (t2lo % 4294967296);
      const ahi = (t1hi % 4294967296) + (t2hi % 4294967296) + Math.floor(alo / 4294967296);
      v[0] = ahi | 0; v[1] = alo | 0;
    }
    for (let i = 0; i < 16; i += 2) {
      const lo = (h[i + 1] >>> 0) + (v[i + 1] >>> 0);
      const hi = (h[i] >>> 0) + (v[i] >>> 0) + Math.floor(lo / 4294967296);
      h[i] = hi | 0;
      h[i + 1] = lo | 0;
    }
  }
  return toHex(h, false);
}

export const hashers: Record<HashName, (bytes: Uint8Array) => string> = { md5, sha1, sha256, sha512 };
