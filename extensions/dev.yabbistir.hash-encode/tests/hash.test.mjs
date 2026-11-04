import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { md5, sha1, sha256, sha512 } from "../src/hash.ts";
import { utf8Bytes } from "../src/utf8.ts";

const bytes = (text) => new TextEncoder().encode(text);
const msg448 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
const msg896 = "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";

describe("hash vectors", () => {
  test("md5MatchesRfc1321", () => {
    assert.equal(md5(bytes("")), "d41d8cd98f00b204e9800998ecf8427e");
    assert.equal(md5(bytes("a")), "0cc175b9c0f1b6a831c399e269772661");
    assert.equal(md5(bytes("abc")), "900150983cd24fb0d6963f7d28e17f72");
    assert.equal(md5(bytes("message digest")), "f96b697d7cb7938d525a2f31aaf161d0");
    assert.equal(md5(bytes("abcdefghijklmnopqrstuvwxyz")), "c3fcd3d76192e4007dfb496cca67e13b");
    assert.equal(md5(bytes("12345678901234567890123456789012345678901234567890123456789012345678901234567890")), "57edf4a22be3c955ac49da2e2107b67a");
  });

  test("sha1MatchesFips180", () => {
    assert.equal(sha1(bytes("")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    assert.equal(sha1(bytes("abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
    assert.equal(sha1(bytes(msg448)), "84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    assert.equal(sha1(bytes(msg896)), "a49b2446a02c645bf419f995b67091253a04a259");
  });

  test("sha256MatchesFips180", () => {
    assert.equal(sha256(bytes("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(sha256(bytes("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(sha256(bytes(msg448)), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    assert.equal(sha256(bytes(msg896)), "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  test("sha512MatchesFips180", () => {
    assert.equal(
      sha512(bytes("")),
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    );
    assert.equal(
      sha512(bytes("abc")),
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
    assert.equal(
      sha512(bytes(msg448)),
      "204a8fc6dda82f0a0ced7beb8e08a41657c16ef468b228a8279be331a703c33596fd15c13b1b07f9aa1d3bea57789ca031ad85c7a71dd70354ec631238ca3445",
    );
    assert.equal(
      sha512(bytes(msg896)),
      "8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909",
    );
  });

  test("aMillionAsMatchTheOfficialVectors", () => {
    const million = new Uint8Array(1_000_000).fill(97);
    assert.equal(sha1(million), "34aa973cd4c4daa4f61eeb2bdbad27316534016f");
    assert.equal(sha256(million), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    assert.equal(
      sha512(million),
      "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b",
    );
    assert.equal(md5(million), "7707d6ae4e027c70eea2a935c2296f21");
  });

  test("everyLengthAroundABlockBoundaryAgreesWithNode", () => {
    // Padding is where hash code usually breaks: lengths around 55/56/63/64 and 111/112/127/128 bytes.
    for (let length = 0; length <= 300; length++) {
      const data = Uint8Array.from({ length }, (_, i) => (i * 31 + length) & 255);
      assert.equal(md5(data), createHash("md5").update(data).digest("hex"), `md5 ${length}`);
      assert.equal(sha1(data), createHash("sha1").update(data).digest("hex"), `sha1 ${length}`);
      assert.equal(sha256(data), createHash("sha256").update(data).digest("hex"), `sha256 ${length}`);
      assert.equal(sha512(data), createHash("sha512").update(data).digest("hex"), `sha512 ${length}`);
    }
  });

  test("multibyteTextIsHashedAsUtf8", () => {
    const text = "Şişli’de çay ☕ 😀";
    const data = utf8Bytes(text);
    assert.equal(data.length, new TextEncoder().encode(text).length);
    for (const [name, fn] of Object.entries({ md5, sha1, sha256, sha512 })) {
      assert.equal(fn(data), createHash(name).update(text, "utf8").digest("hex"), name);
    }
  });

  test("largeInputStaysFast", () => {
    const data = new Uint8Array(5_000_000).fill(7);
    const started = Date.now();
    sha512(data);
    sha256(data);
    assert.ok(Date.now() - started < 8000);
  });
});
