import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { sources } from "../src/index.ts";
import {
  aegisExport,
  ascii,
  base32,
  bitwardenCsv,
  bitwardenExport,
  expectedCode,
  folder,
  hostWith,
  lastPassExport,
  migrationLink,
  migrationPayload,
  NOW,
  otpauth,
  otpParameters,
  seed,
  seedBytes,
  twoFasExport,
  twoFauthExport,
} from "./fixtures.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const EN = read("locales/en.json");
const TR = read("locales/tr.json");
const host = (accounts, options) => hostWith(sources, accounts, options);
const list = (accounts, options) => host(accounts, options).list("codes");
const code = (accounts, rowId, options) => host(accounts, options).runSource("codes", rowId, "code");

/** Three synthetic accounts, written out by each app's export below. */
const TABLE = [
  { issuer: "Örnek Bank", account: "deniz@ornek.dev", name: "e1", algorithm: "SHA1", digits: 6, period: 30 },
  { issuer: "Kod Deposu", account: "deniz", name: "e2", algorithm: "SHA256", digits: 8, period: 60 },
  { issuer: "Posta", account: "deniz.k", name: "e3", algorithm: "SHA512", digits: 6, period: 30 },
];
const linkOf = (entry) =>
  otpauth({ issuer: entry.issuer, account: entry.account, secret: seed(entry.name), algorithm: entry.algorithm, digits: entry.digits, period: entry.period });
const GOOGLE_ALGORITHM = { SHA1: 1, SHA256: 2, SHA512: 3 };
const googleParameters = (entry) =>
  otpParameters({ secret: seedBytes(entry.name), name: entry.account, issuer: entry.issuer, algorithm: GOOGLE_ALGORITHM[entry.algorithm], digits: entry.digits === 8 ? 2 : 1 });

/** Each supported export of TABLE, and the table as it can hold it (Google's codes are always 30 s). */
const EXPORTS = {
  "otpauth links": [TABLE.map(linkOf).join("\n"), TABLE],
  "Google Authenticator, two QR codes": [
    [migrationLink(migrationPayload(TABLE.slice(0, 2).map(googleParameters), { batchSize: 2 })), migrationLink(migrationPayload(TABLE.slice(2).map(googleParameters), { batchSize: 2, batchIndex: 1 }))].join("\n"),
    TABLE.map((entry) => ({ ...entry, period: 30 })),
  ],
  "LastPass Authenticator": [lastPassExport(TABLE.map((entry) => ({ ...entry, secret: seed(entry.name) }))), TABLE],
  Aegis: [aegisExport(TABLE.map((entry) => ({ ...entry, secret: seed(entry.name) }))), TABLE],
  "2FAS": [twoFasExport(TABLE.map((entry) => ({ ...entry, name: entry.issuer, secret: seed(entry.name) }))), TABLE],
  "Bitwarden JSON": [bitwardenExport(TABLE.map((entry) => ({ name: entry.issuer, username: entry.account, totp: linkOf(entry) }))), TABLE],
  "Bitwarden CSV": [bitwardenCsv(TABLE.map((entry) => ({ name: entry.issuer, username: entry.account, totp: linkOf(entry) }))), TABLE],
  "2FAuth": [twoFauthExport(TABLE.map((entry) => ({ service: entry.issuer, account: entry.account, secret: seed(entry.name), algorithm: entry.algorithm.toLowerCase(), digits: entry.digits, period: entry.period }))), TABLE],
};
const SORTED = [
  { title: "Kod Deposu", subtitle: "deniz" },
  { title: "Örnek Bank", subtitle: "deniz@ornek.dev" },
  { title: "Posta", subtitle: "deniz.k" },
];

describe("list", () => {
  test("without an export, one calm row says where to paste it", async () => {
    for (const accounts of [undefined, "", "  \n\t "]) {
      assert.deepEqual(await list(accounts), { locked: true, message: "Paste your authenticator’s export into Accounts, in Settings › Extensions › Authenticator." });
    }
  });

  test("every export: the issuer over the account name, in alphabetical order", async () => {
    for (const [format, [text]] of Object.entries(EXPORTS)) {
      const { rows } = await list(text);
      assert.deepEqual(rows.map(({ title, subtitle }) => ({ title, subtitle })), SORTED, format);
      assert.equal(new Set(rows.map((row) => row.id)).size, 3, format);
    }
  });

  test("alphabetical in the app's language", async () => {
    const text = ["Cz", "Çay", "alfa", "Oda", "Ödev"].map((issuer) => otpauth({ issuer, account: "deniz", secret: seed(issuer) })).join("\n");
    assert.deepEqual((await list(text)).rows.map((row) => row.title), ["alfa", "Çay", "Cz", "Oda", "Ödev"]);
    assert.deepEqual((await list(text, { language: "tr" })).rows.map((row) => row.title), ["alfa", "Cz", "Çay", "Oda", "Ödev"]);
  });

  test("without an issuer the account name is the title; without either, Unnamed account", async () => {
    const text = [
      `otpauth://totp/deniz%40ornek.dev?secret=${seed("n1")}`,
      `otpauth://totp/?secret=${seed("n2")}`,
      otpauth({ issuer: "Posta", account: "", secret: seed("n3") }),
    ].join("\n");
    const titles = async (language) => (await list(text, { language })).rows.map(({ title, subtitle }) => [title, subtitle]);
    assert.deepEqual(await titles("en"), [["deniz@ornek.dev", undefined], ["Posta", undefined], ["Unnamed account", undefined]]);
    assert.deepEqual(await titles("tr"), [["Adsız hesap", undefined], ["deniz@ornek.dev", undefined], ["Posta", undefined]]);
  });

  test("names on one line; one that is blank once the app cleans it counts as missing", async () => {
    const text = lastPassExport([
      { issuer: "Posta\nİş", account: "deniz\tk", secret: seed("c1") },
      { issuer: "\u2028 \u3000", account: "deniz", secret: seed("c2") },
    ]);
    assert.deepEqual((await list(text)).rows.map(({ title, subtitle }) => [title, subtitle]), [["deniz", undefined], ["Posta İş", "deniz k"]]);
  });

  test("an encrypted export: a row naming the app and saying to export without a password", async () => {
    const encrypted = {
      Aegis: JSON.stringify({ version: 1, header: { slots: [], params: { nonce: "00", tag: "00" } }, db: "Y2lwaGVy" }),
      "2FAS": JSON.stringify({ services: [], schemaVersion: 4, servicesEncrypted: "a:b:c" }),
      Bitwarden: JSON.stringify({ encrypted: true, passwordProtected: true, salt: "c2FsdA==", kdfType: 0, kdfIterations: 600000, encKeyValidation_DO_NOT_EDIT: "2.x", data: "2.x" }),
      "Ente Auth": JSON.stringify({ version: 1, kdfParams: { memLimit: 4096, opsLimit: 3, salt: "c2FsdA==" }, encryptedData: "ZGF0YQ==", encryptionNonce: "bm9uY2U=" }),
    };
    for (const [app, text] of Object.entries(encrypted)) {
      assert.deepEqual(await list(text), { locked: true, message: `This ${app} export is encrypted. Export again without a password, then paste it into Accounts in Settings.` });
    }
    assert.deepEqual(await list(encrypted.Aegis, { language: "tr" }), { locked: true, message: "Bu Aegis dışa aktarımı şifreli. Parola koymadan yeniden dışa aktar, sonra Ayarlar’daki Hesaplar alanına yapıştır." });
  });

  test("an encrypted export next to a readable one: the readable one's rows", async () => {
    const text = `${linkOf(TABLE[0])}\n${JSON.stringify({ services: [], schemaVersion: 4, servicesEncrypted: "a:b:c" })}`;
    assert.deepEqual((await list(text)).rows.map((row) => row.title), ["Örnek Bank"]);
  });

  test("only HOTP and Steam accounts: a row saying they aren't supported", async () => {
    const text = [otpauth({ type: "hotp", issuer: "Posta", account: "deniz", secret: seed("h"), counter: 1 }), otpauth({ type: "steam", issuer: "Steam", account: "deniz", secret: seed("s") })].join("\n");
    assert.deepEqual(await list(text), { locked: true, message: "No time-based accounts in this export. HOTP and Steam accounts aren’t supported." });
    assert.deepEqual(await list(text, { language: "tr" }), { locked: true, message: "Bu dışa aktarımda zamana dayalı hesap yok. HOTP ve Steam hesapları desteklenmiyor." });
  });

  test("anything else: a row saying what to paste", async () => {
    for (const text of ["hello", seed("bare"), "{\"some\": \"json\"}", "https://example.com"]) {
      assert.deepEqual(await list(text), { locked: true, message: "No accounts found. Paste otpauth links, or an export from LastPass, Google, Aegis, 2FAS or Bitwarden, into Accounts in Settings." }, text);
    }
    assert.deepEqual(await list("hello", { language: "tr" }), { locked: true, message: "Hesap bulunamadı. Ayarlar’daki Hesaplar alanına otpauth linklerini ya da LastPass, Google, Aegis, 2FAS veya Bitwarden dışa aktarımını yapıştır." });
  });

  test("the same rows and ids each time", async () => {
    const [text] = EXPORTS.Aegis;
    assert.deepEqual(await list(text), await list(text, { now: NOW + 3_600_000 }));
  });
});

describe("run", () => {
  test("↵ pastes the current code of every row, for every export", async () => {
    for (const [format, [text, table]] of Object.entries(EXPORTS)) {
      const { rows } = await list(text);
      for (const row of rows) {
        const entry = table.find((candidate) => candidate.issuer === row.title);
        assert.deepEqual(await code(text, row.id), { secret: expectedCode(seedBytes(entry.name), NOW, entry) }, `${format}: ${row.title}`);
      }
    }
  });

  test("RFC 6238's codes, from an otpauth link", async () => {
    const secret = base32(ascii("12345678901234567890"));
    const text = `otpauth://totp/RFC:6238?secret=${secret}&digits=8`;
    const [{ id }] = (await list(text)).rows;
    assert.deepEqual(await code(text, id, { now: 1111111111_000 }), { secret: "14050471" });
    assert.deepEqual(await code(text, id, { now: 1234567890_000 }), { secret: "89005924" });
    assert.deepEqual(await code(text, id, { now: 2000000000_000 }), { secret: "69279037" });
    assert.deepEqual(await code(text, id, { now: 1111111109_000 }), { secret: "14050471" }, "a second left: the next code");
  });

  test("near the end of a period, the next period's code", async () => {
    const text = linkOf(TABLE[0]);
    const [{ id }] = (await list(text)).rows;
    const end = Date.parse("2026-01-01T09:00:30Z");
    const counter = (now) => expectedCode(seedBytes("e1"), now, { period: 30 });
    assert.deepEqual(await code(text, id, { now: end - 3000 }), { secret: counter(end - 3000) });
    assert.deepEqual(await code(text, id, { now: end - 2999 }), { secret: counter(end) }, "the code of the next period");
    assert.notEqual(counter(end - 3000), counter(end));
  });

  test("an account that has left the export says so", async () => {
    const [text] = EXPORTS["otpauth links"];
    const { rows } = await list(text);
    const fewer = TABLE.slice(1).map(linkOf).join("\n");
    const gone = rows.find((row) => row.title === "Örnek Bank").id;
    await assert.rejects(code(fewer, gone), { message: "This account is no longer in Accounts in Settings." });
    await assert.rejects(code(fewer, gone, { language: "tr" }), { message: "Bu hesap artık Ayarlar’daki Hesaplar alanında yok." });
    await assert.rejects(code(text, "otp-0000000000000000"), { message: "This account is no longer in Accounts in Settings." });
  });

  test("once the export is removed from Settings, pasting says where to put it", async () => {
    await assert.rejects(code(undefined, "otp-0000000000000000"), { message: EN.setUp });
    await assert.rejects(code("", "otp-0000000000000000", { language: "tr" }), { message: TR.setUp });
  });

  test("an action the manifest doesn't have is refused", async () => {
    const fake = host(EXPORTS["otpauth links"][0]);
    const restore = fake.install();
    try {
      assert.throws(() => sources.codes.run("otp-0000000000000000", "username", { language: "en", preferences: {}, trigger: "source", variant: null, target: null }), { message: EN.noCode });
    } finally {
      restore();
    }
  });
});

describe("nothing secret leaks", () => {
  const SEED_TEXTS = TABLE.flatMap((entry) => [seed(entry.name), seed(entry.name).toLowerCase(), Buffer.from(seedBytes(entry.name)).toString("hex"), Buffer.from(seedBytes(entry.name)).toString()]);
  /** Every code the accounts have around NOW, in each of their lengths. */
  const CODES = TABLE.flatMap((entry) => [-1, 0, 1].map((step) => expectedCode(seedBytes(entry.name), NOW + step * entry.period * 1000, entry)));
  const BROKEN_JSON = `{"accounts": [{"secret": "${seed("e1")}", "issuerName": "Posta",`;

  /** Every path through list and run, each on a host of its own, with what came out of it. */
  async function everyPath() {
    const hosts = [];
    const out = [];
    const on = async (accounts, work, options) => {
      const fake = host(accounts, options);
      hosts.push(fake);
      try {
        out.push(await work(fake));
      } catch (error) {
        out.push(error.message, error.stack);
      }
    };
    for (const [text] of Object.values(EXPORTS)) {
      await on(text, (fake) => fake.list("codes"));
      await on(text, async (fake) => {
        for (const row of (await fake.list("codes")).rows) await fake.runSource("codes", row.id, "code");
        return "ran";
      });
    }
    await on(undefined, (fake) => fake.list("codes"));
    await on(undefined, (fake) => fake.runSource("codes", "x", "code"));
    await on(EXPORTS.Aegis[0], (fake) => fake.runSource("codes", "otp-0000000000000000", "code"));
    await on(BROKEN_JSON, (fake) => fake.list("codes"));
    await on(BROKEN_JSON, (fake) => fake.runSource("codes", "x", "code"));
    await on(`${seed("e1")}\n${seed("e2")}`, (fake) => fake.list("codes"));
    await on(JSON.stringify({ services: [], schemaVersion: 4, servicesEncrypted: seed("e1") }), (fake) => fake.list("codes"));
    await on(otpauth({ type: "hotp", issuer: "Posta", account: "deniz", secret: seed("e1"), counter: 1 }), (fake) => fake.list("codes"));
    await on(`otpauth://totp/Posta:deniz?secret=${seed("e1")}&digits=5`, (fake) => fake.list("codes"));
    await on(EXPORTS.Aegis[0], (fake) => fake.list("codes"), { now: Date.parse("2026-01-01T09:00:29.500Z") });
    return { hosts, out };
  }

  test("nothing is logged, stored, notified or opened, and the only call reads the preference", async () => {
    for (const fake of (await everyPath()).hosts) {
      assert.deepEqual(fake.logs, []);
      assert.deepEqual(fake.storage, {});
      assert.deepEqual(fake.notifications, []);
      assert.deepEqual(fake.opened, []);
      assert.deepEqual(fake.results, []);
      assert.ok(fake.calls.every((call) => call.api === "secrets.get" && call.args[0] === "accounts"), JSON.stringify(fake.calls));
    }
  });

  test("no seed or code is in a row, a locked row or an error", async () => {
    const { out } = await everyPath();
    const shown = JSON.stringify(out);
    for (const secret of SEED_TEXTS) assert.ok(!shown.includes(secret), "a seed was shown");
    for (const value of CODES) assert.ok(!shown.includes(value), "a code was shown");
  });

  test("a row id is made of nothing secret", async () => {
    for (const [text] of Object.values(EXPORTS)) {
      for (const { id } of (await list(text)).rows) {
        assert.ok(id.length <= 256);
        for (const secret of SEED_TEXTS) assert.ok(!id.includes(secret));
        for (const value of CODES) assert.ok(!id.includes(value));
      }
    }
  });

  test("an error while reading never carries what was read", async () => {
    const fake = host("unused");
    const secret = seed("e1");
    fake.yab.secrets.get = () => ({ trim() { throw new Error(`broken near ${secret}`); } });
    for (const work of [() => fake.list("codes"), () => fake.runSource("codes", "x", "code")]) {
      await assert.rejects(work(), (error) => {
        assert.equal(error.message, EN.readFailed);
        assert.ok(!error.stack.includes(secret));
        return true;
      });
    }
  });

  test("broken JSON with a seed in it says only that nothing was found", async () => {
    assert.deepEqual(await list(BROKEN_JSON), { locked: true, message: EN.unrecognized });
  });
});

describe("manifest", () => {
  const manifest = read("manifest.json");

  test("asks for no permission and marks its one source sensitive", () => {
    assert.equal(manifest.permissions, undefined);
    assert.equal(manifest.network, undefined);
    assert.equal(manifest.requires, undefined);
    assert.equal(manifest.minAppVersion, "0.3.0");
    const [source] = manifest.contributes.sources;
    assert.equal(source.sensitive, true);
    assert.deepEqual(source.actions, [{ id: "code", kind: "secret", title: "code.title", label: "code.label" }]);
  });

  test("keeps the export in a secret preference, which has no default", () => {
    assert.deepEqual(manifest.preferences, [{ id: "accounts", type: "secret", title: "accounts.title" }]);
    assert.equal(createFakeHost({ folder }).yab.preferences.accounts, undefined, "a secret never reaches preferences");
  });

  test("Turkish has every English string", () => {
    assert.deepEqual(Object.keys(TR).sort(), Object.keys(EN).sort());
  });
});
