// SHA-1, SHA-256 and SHA-512 (FIPS 180-4) and HMAC (RFC 2104), written out because the host's `crypto` has only
// getRandomValues and randomUUID. Plain rather than fast: a code takes one HMAC of eight bytes.

export type Algorithm = "SHA1" | "SHA256" | "SHA512";

interface Hash {
  blockSize: number;
  digest(message: Uint8Array): Uint8Array;
}

/**
 * The message padded to whole blocks, as FIPS 180-4 section 5.1 says: a 1 bit, zeros, and the message's length in
 * bits, big-endian, in the last 8 bytes (64-byte blocks) or 16 bytes (128-byte blocks).
 */
function padded(message: Uint8Array, blockSize: number): Uint8Array {
  const lengthBytes = blockSize === 128 ? 16 : 8;
  const total = Math.ceil((message.length + 1 + lengthBytes) / blockSize) * blockSize;
  const block = new Uint8Array(total);
  block.set(message);
  block[message.length] = 0x80;
  let bits = message.length * 8;
  for (let index = total - 1; bits > 0; index--) {
    block[index] = bits % 256;
    bits = Math.floor(bits / 256);
  }
  return block;
}

const word32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const rotl32 = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;
const rotr32 = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

function bytesOf32(words: number[]): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  words.forEach((word, index) => {
    out[index * 4] = word >>> 24;
    out[index * 4 + 1] = (word >>> 16) & 0xff;
    out[index * 4 + 2] = (word >>> 8) & 0xff;
    out[index * 4 + 3] = word & 0xff;
  });
  return out;
}

function sha1(message: Uint8Array): Uint8Array {
  const block = padded(message, 64);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let offset = 0; offset < block.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = word32(block, offset + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rotl32(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [a, b, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999];
      else if (t < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1];
      else if (t < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
      else [f, k] = [b ^ c ^ d, 0xca62c1d6];
      const next = (rotl32(a, 5) + f + e + k + w[t]) >>> 0;
      [e, d, c, b, a] = [d, c, rotl32(b, 30), a, next];
    }
    [a, b, c, d, e].forEach((value, index) => (h[index] = (h[index] + value) >>> 0));
  }
  return bytesOf32(h);
}

/** The first `count` prime numbers. */
function primes(count: number): number[] {
  const found: number[] = [];
  for (let candidate = 2; found.length < count; candidate++) {
    if (found.every((prime) => candidate % prime !== 0)) found.push(candidate);
  }
  return found;
}

/** ⌊x^(1/n)⌋, by Newton's method from a power of two above the root. */
function integerRoot(x: bigint, n: bigint): bigint {
  let root = 1n << (BigInt(x.toString(2).length) / n + 1n);
  for (;;) {
    const next = ((n - 1n) * root + x / root ** (n - 1n)) / n;
    if (next >= root) return root;
    root = next;
  }
}

/**
 * The first `bits` bits of the fractional part of the square (n = 2) or cube (n = 3) root of each prime: how FIPS 180-4
 * sections 4.2 and 5.3 define SHA-256's and SHA-512's constants and initial values.
 */
function rootFractions(count: number, n: bigint, bits: bigint): bigint[] {
  const mask = (1n << bits) - 1n;
  return primes(count).map((prime) => integerRoot(BigInt(prime) << (n * bits), n) & mask);
}

const SHA256_K = rootFractions(64, 3n, 32n).map(Number);
const SHA256_H = rootFractions(8, 2n, 32n).map(Number);

function sha256(message: Uint8Array): Uint8Array {
  const block = padded(message, 64);
  const h = [...SHA256_H];
  const w = new Array<number>(64);
  for (let offset = 0; offset < block.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = word32(block, offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + choose + SHA256_K[t] + w[t]) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((value, index) => (h[index] = (h[index] + value) >>> 0));
  }
  return bytesOf32(h);
}

// SHA-512 works on 64-bit words; BigInt keeps them whole.
const MASK64 = (1n << 64n) - 1n;
const SHA512_K = rootFractions(80, 3n, 64n);
const SHA512_H = rootFractions(8, 2n, 64n);
const rotr64 = (x: bigint, n: bigint): bigint => ((x >> n) | (x << (64n - n))) & MASK64;

function sha512(message: Uint8Array): Uint8Array {
  const block = padded(message, 128);
  const h = [...SHA512_H];
  const w = new Array<bigint>(80);
  for (let offset = 0; offset < block.length; offset += 128) {
    for (let t = 0; t < 16; t++) {
      w[t] = (BigInt(word32(block, offset + t * 8)) << 32n) | BigInt(word32(block, offset + t * 8 + 4));
    }
    for (let t = 16; t < 80; t++) {
      const s0 = rotr64(w[t - 15], 1n) ^ rotr64(w[t - 15], 8n) ^ (w[t - 15] >> 7n);
      const s1 = rotr64(w[t - 2], 19n) ^ rotr64(w[t - 2], 61n) ^ (w[t - 2] >> 6n);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 80; t++) {
      const s1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const choose = (e & f) ^ ((e ^ MASK64) & g);
      const t1 = (hh + s1 + choose + SHA512_K[t] + w[t]) & MASK64;
      const s0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) & MASK64;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) & MASK64, c, b, a, (t1 + t2) & MASK64];
    }
    [a, b, c, d, e, f, g, hh].forEach((value, index) => (h[index] = (h[index] + value) & MASK64));
  }
  const out = new Uint8Array(64);
  h.forEach((word, index) => {
    for (let byte = 0; byte < 8; byte++) out[index * 8 + byte] = Number((word >> BigInt(56 - byte * 8)) & 0xffn);
  });
  return out;
}

const HASHES: Record<Algorithm, Hash> = {
  SHA1: { blockSize: 64, digest: sha1 },
  SHA256: { blockSize: 64, digest: sha256 },
  SHA512: { blockSize: 128, digest: sha512 },
};

/** The digest of `message`. */
export function hash(algorithm: Algorithm, message: Uint8Array): Uint8Array {
  return HASHES[algorithm].digest(message);
}

/** HMAC (RFC 2104): H((K ⊕ opad) ‖ H((K ⊕ ipad) ‖ message)), a key longer than a block hashed first. */
export function hmac(algorithm: Algorithm, key: Uint8Array, message: Uint8Array): Uint8Array {
  const { blockSize, digest } = HASHES[algorithm];
  const block = new Uint8Array(blockSize);
  block.set(key.length > blockSize ? digest(key) : key);
  const inner = new Uint8Array(blockSize + message.length);
  for (let index = 0; index < blockSize; index++) inner[index] = block[index] ^ 0x36;
  inner.set(message, blockSize);
  const innerDigest = digest(inner);
  const outer = new Uint8Array(blockSize + innerDigest.length);
  for (let index = 0; index < blockSize; index++) outer[index] = block[index] ^ 0x5c;
  outer.set(innerDigest, blockSize);
  return digest(outer);
}
