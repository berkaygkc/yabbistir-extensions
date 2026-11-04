import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { readExport } from "../src/exports.ts";
import {
  aegisExport,
  base32,
  bitwardenCsv,
  bitwardenExport,
  lastPassExport,
  migrationLink,
  migrationPayload,
  otpauth,
  otpParameters,
  seed,
  seedBytes,
  twoFasExport,
  twoFauthExport,
} from "./fixtures.mjs";

/** What a test compares: each account without its id, with its secret as Base32. */
const accountsOf = (text) =>
  readExport(text).accounts.map(({ issuer, account, secret, algorithm, digits, period }) => ({ issuer, account, secret: base32(secret), algorithm, digits, period }));
const account = (issuer, name, secretName, { algorithm = "SHA1", digits = 6, period = 30 } = {}) =>
  ({ issuer, account: name, secret: seed(secretName), algorithm, digits, period });
const nothing = (text) => {
  const contents = readExport(text);
  return { accounts: contents.accounts.length, skipped: contents.skipped, encrypted: contents.encrypted };
};

describe("otpauth links", () => {
  test("every parameter", () => {
    const link = otpauth({ issuer: "Örnek Bank", account: "deniz@ornek.dev", secret: seed("a"), algorithm: "SHA512", digits: 8, period: 60 });
    assert.deepEqual(accountsOf(link), [account("Örnek Bank", "deniz@ornek.dev", "a", { algorithm: "SHA512", digits: 8, period: 60 })]);
    assert.deepEqual(readExport(link).accounts[0].secret, seedBytes("a"));
  });

  test("defaults: SHA-1, 6 digits, 30 seconds", () => {
    assert.deepEqual(accountsOf(`otpauth://totp/deniz?secret=${seed("a")}`), [account("", "deniz", "a")]);
  });

  test("the issuer from the label, the parameter, or both", () => {
    const secret = seed("a");
    const cases = [
      [`otpauth://totp/Kod%20Deposu:deniz?secret=${secret}`, "Kod Deposu", "deniz"],
      [`otpauth://totp/Kod%20Deposu%3Adeniz?secret=${secret}`, "Kod Deposu", "deniz"],
      [`otpauth://totp/Kod%20Deposu:%20%20deniz?secret=${secret}`, "Kod Deposu", "deniz"],
      [`otpauth://totp/deniz?secret=${secret}&issuer=Kod%20Deposu`, "Kod Deposu", "deniz"],
      [`otpauth://totp/Kod%20Deposu:deniz?secret=${secret}&issuer=Kod+Deposu`, "Kod Deposu", "deniz"],
      [`otpauth://totp/kod%20deposu:deniz?secret=${secret}&issuer=Kod%20Deposu`, "Kod Deposu", "deniz"],
      [`otpauth://totp/İş:deniz?secret=${secret}&issuer=Kod%20Deposu`, "Kod Deposu", "İş:deniz"],
      [`otpauth://totp/?secret=${secret}&issuer=Kod%20Deposu`, "Kod Deposu", ""],
      [`otpauth://totp?secret=${secret}&issuer=Kod%20Deposu`, "Kod Deposu", ""],
      [`otpauth://totp/Air%20Canada:Benjamin?secret=${secret}&issuer=Air+Canada`, "Air Canada", "Benjamin"],
    ];
    for (const [link, issuer, name] of cases) {
      assert.deepEqual(accountsOf(link).map(({ issuer, account }) => [issuer, account]), [[issuer, name]], link);
    }
  });

  test("tolerant spellings: the scheme's and type's case, the algorithm's, a spaced lower-case padded secret", () => {
    const spaced = seed("a").toLowerCase().match(/.{1,4}/g).join("%20");
    const links = [
      `OTPAUTH://TOTP/deniz?SECRET=${seed("a")}&Algorithm=sha256`,
      `otpauth://totp/deniz?secret=${spaced}&algorithm=SHA-256`,
      `otpauth://totp/deniz?secret=${base32(seedBytes("a"), { padding: true }).replace(/=/g, "%3D")}&algorithm=HmacSHA256`,
    ];
    for (const link of links) assert.deepEqual(accountsOf(link), [account("", "deniz", "a", { algorithm: "SHA256" })], link);
  });

  test("unknown parameters are ignored, such as Ente Auth's codeDisplay", () => {
    const codeDisplay = encodeURIComponent(JSON.stringify({ pinned: false, trashed: false, tags: ["iş"] }));
    const link = `${otpauth({ issuer: "Posta", account: "deniz", secret: seed("a"), algorithm: "SHA1", digits: 6, period: 30 })}&codeDisplay=${codeDisplay}`;
    assert.deepEqual(accountsOf(link), [account("Posta", "deniz", "a")]);
  });

  test("links that make no time-based code are skipped and counted", () => {
    const secret = seed("a");
    const links = [
      otpauth({ type: "hotp", issuer: "Posta", account: "deniz", secret, counter: 4 }),
      otpauth({ type: "steam", issuer: "Steam", account: "deniz", secret }),
      otpauth({ type: "yaotp", issuer: "Yandex", account: "deniz", secret }),
      otpauth({ issuer: "Posta", account: "no secret" }),
      `otpauth://totp/Posta:deniz?secret=${secret}0`,
      `otpauth://totp/Posta:deniz?secret=${secret}&digits=5`,
      `otpauth://totp/Posta:deniz?secret=${secret}&digits=11`,
      `otpauth://totp/Posta:deniz?secret=${secret}&digits=six`,
      `otpauth://totp/Posta:deniz?secret=${secret}&period=0`,
      `otpauth://totp/Posta:deniz?secret=${secret}&period=3601`,
      `otpauth://totp/Posta:deniz?secret=${secret}&algorithm=MD5`,
      "otpauth://",
    ];
    for (const link of links) assert.deepEqual(nothing(link), { accounts: 0, skipped: 1, encrypted: [] }, link);
  });

  test("one per line, or separated by spaces, or with nothing between them", () => {
    const links = ["a", "b", "c"].map((name, index) => otpauth({ issuer: `Site ${index}`, account: `deniz${index}`, secret: seed(name) }));
    const expected = ["a", "b", "c"].map((name, index) => account(`Site ${index}`, `deniz${index}`, name));
    for (const separator of ["\n", "\r\n", " ", "\t", "", "\n\n  "]) {
      assert.deepEqual(accountsOf(links.join(separator)), expected, JSON.stringify(separator));
    }
  });

  test("links among other text, in quotes or angle brackets", () => {
    const link = otpauth({ issuer: "Posta", account: "deniz", secret: seed("a") });
    assert.deepEqual(accountsOf(`My codes:\n- "${link}"\n- <${link.replace("deniz", "deniz2")}>\nEnd.`), [account("Posta", "deniz", "a"), account("Posta", "deniz2", "a")]);
  });
});

describe("Google Authenticator", () => {
  const parameters = [
    otpParameters({ secret: seedBytes("g1"), name: "deniz@ornek.dev", issuer: "Örnek Bank" }),
    otpParameters({ secret: seedBytes("g2"), name: "Kod Deposu:deniz", algorithm: 2, digits: 2 }),
    otpParameters({ secret: seedBytes("g3"), name: "Posta:deniz", issuer: "Posta", algorithm: 3 }),
    otpParameters({ secret: seedBytes("g4"), name: "deniz", type: 0 }),
  ];
  const expected = [
    account("Örnek Bank", "deniz@ornek.dev", "g1"),
    account("Kod Deposu", "deniz", "g2", { algorithm: "SHA256", digits: 8 }),
    account("Posta", "deniz", "g3", { algorithm: "SHA512" }),
    account("", "deniz", "g4"),
  ];

  test("a migration link's accounts, with Google's algorithms and digit counts", () => {
    assert.deepEqual(accountsOf(migrationLink(migrationPayload(parameters))), expected);
  });

  test("HOTP, MD5 and unknown digit counts or types are skipped", () => {
    const skipped = [
      otpParameters({ secret: seedBytes("h1"), name: "hotp", type: 1, counter: 7 }),
      otpParameters({ secret: seedBytes("h2"), name: "md5", algorithm: 4 }),
      otpParameters({ secret: seedBytes("h3"), name: "digits", digits: 3 }),
      otpParameters({ secret: seedBytes("h4"), name: "type", type: 3 }),
      otpParameters({ secret: new Uint8Array(0), name: "no secret" }),
    ];
    const contents = readExport(migrationLink(migrationPayload([...skipped, parameters[0]])));
    assert.equal(contents.accounts.length, 1);
    assert.equal(contents.skipped, 5);
  });

  test("several QR codes of one export, together in any spacing", () => {
    const first = migrationLink(migrationPayload(parameters.slice(0, 2), { batchSize: 2, batchIndex: 0 }));
    const second = migrationLink(migrationPayload(parameters.slice(2), { batchSize: 2, batchIndex: 1 }));
    for (const separator of ["\n", " ", ""]) assert.deepEqual(accountsOf(first + separator + second), expected, JSON.stringify(separator));
  });

  test("Base64 escaped or not, with its '+' turned into spaces, or as Base64url", () => {
    // A payload whose Base64 holds "+", "/" and "=".
    const payload = migrationPayload([otpParameters({ secret: Uint8Array.from([0xfb, 0xff, 0xbf, 0xfe, 0x01, 0x02, 0x03]), name: "deniz", issuer: "Posta" })]);
    const raw = Buffer.from(payload).toString("base64");
    assert.match(raw, /\+/);
    assert.match(raw, /\//);
    const links = [
      migrationLink(payload),
      migrationLink(payload, { escape: false }),
      `otpauth-migration://offline?data=${raw.replace(/\+/g, "%20")}`,
      `otpauth-migration://offline?data=${Buffer.from(payload).toString("base64url")}`,
      `OTPAUTH-MIGRATION://offline/?data=${encodeURIComponent(raw)}`,
    ];
    for (const link of links) {
      assert.deepEqual(readExport(link).accounts.map((found) => [...found.secret]), [[0xfb, 0xff, 0xbf, 0xfe, 0x01, 0x02, 0x03]], link);
    }
  });

  test("unknown fields of every wire type are skipped", () => {
    const fixed64 = [0x31, 1, 2, 3, 4, 5, 6, 7, 8]; // field 6, wire type 1
    const fixed32 = [0x3d, 1, 2, 3, 4]; // field 7, wire type 5
    const text = [0x42, 2, 0x68, 0x69]; // field 8, wire type 2
    const inner = [...parameters[0], ...fixed64, ...fixed32, ...text];
    assert.deepEqual(accountsOf(migrationLink(migrationPayload([inner], { extra: [...fixed64, ...fixed32, ...text] }))), expected.slice(0, 1));
  });

  test("a broken link is skipped and counted, never thrown", () => {
    const payload = migrationPayload(parameters);
    const broken = [
      migrationLink(payload.subarray(0, payload.length - 30)),
      migrationLink(Uint8Array.from([0x0a, 0x7f, 0x01])),
      migrationLink(Uint8Array.from([0x0b, 0x01])),
      migrationLink(Uint8Array.from([0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])),
      migrationLink(Uint8Array.from([0x08, 0x01])),
      "otpauth-migration://offline?data=%%%",
      "otpauth-migration://offline?data=a",
      "otpauth-migration://offline?other=1",
      "otpauth-migration://online?data=CgA",
    ];
    for (const link of broken) assert.equal(readExport(link).accounts.length, 0, link);
    for (const link of broken) assert.ok(readExport(link).skipped >= 1, link);
  });
});

describe("LastPass Authenticator", () => {
  const accounts = [
    { issuer: "Örnek Bank", account: "deniz@ornek.dev", secret: seed("l1") },
    { issuer: "Kod Deposu", account: "deniz", secret: seed("l2"), algorithm: "SHA256", digits: 8, period: 60 },
    { issuer: "Posta", account: "deniz.k", secret: seed("l3").toLowerCase().match(/.{1,4}/g).join(" "), algorithm: "SHA512" },
  ];
  const expected = [
    account("Örnek Bank", "deniz@ornek.dev", "l1"),
    account("Kod Deposu", "deniz", "l2", { algorithm: "SHA256", digits: 8, period: 60 }),
    account("Posta", "deniz.k", "l3", { algorithm: "SHA512" }),
  ];

  test("its accounts, as written by Export accounts to file", () => {
    assert.deepEqual(accountsOf(lastPassExport(accounts)), expected);
  });

  test("on one line, or with its line breaks gone", () => {
    const pretty = lastPassExport(accounts);
    for (const text of [JSON.stringify(JSON.parse(pretty)), pretty.replace(/\n/g, " "), pretty.replace(/\n/g, "")]) {
      assert.deepEqual(accountsOf(text), expected);
    }
  });

  test("the names as LastPass shows them, which the person may have changed", () => {
    const text = lastPassExport([
      { issuer: "İş postası", originalIssuer: "Posta", account: "Deniz", originalAccount: "deniz.k", secret: seed("l1") },
      { issuer: "", originalIssuer: "Kod Deposu", account: "", originalAccount: "deniz", secret: seed("l2") },
      { issuer: "", originalIssuer: "", account: "deniz", secret: seed("l3") },
    ]);
    assert.deepEqual(accountsOf(text).map(({ issuer, account }) => [issuer, account]), [["İş postası", "Deniz"], ["Kod Deposu", "deniz"], ["", "deniz"]]);
  });

  test("an account's own id is its row id; without one, the id comes from its names", () => {
    const text = lastPassExport([
      { issuer: "Posta", account: "deniz", secret: seed("l1"), extra: { accountID: "4711" } },
      { issuer: "Posta", account: "deniz.k", secret: seed("l2") },
    ]);
    const [first, second] = readExport(text).accounts;
    assert.equal(first.id, "lastpass-4711");
    assert.match(second.id, /^otp-[0-9a-f]{16}$/);
  });
});

describe("Aegis", () => {
  const entries = [
    { issuer: "Örnek Bank", account: "deniz@ornek.dev", secret: seed("a1"), uuid: "3ae6f1ad-2e65-4ed2-a953-1ec0dff2386d" },
    { issuer: "Kod Deposu", account: "deniz", secret: seed("a2"), algorithm: "SHA256", digits: 7, period: 20 },
    { issuer: "", account: "deniz", secret: seed("a3"), algorithm: "SHA512", digits: 8, period: 50 },
    { type: "hotp", issuer: "Posta", account: "deniz", secret: seed("a4") },
    { type: "steam", issuer: "Steam", account: "deniz", secret: seed("a5"), digits: 5 },
    { type: "motp", issuer: "MOTP", account: "deniz", secret: seed("a6") },
    { type: "yandex", issuer: "Yandex", account: "deniz", secret: seed("a7"), digits: 8 },
  ];

  test("its TOTP entries; HOTP, Steam, mOTP and Yandex skipped", () => {
    const contents = readExport(aegisExport(entries));
    assert.deepEqual(accountsOf(aegisExport(entries)), [
      account("Örnek Bank", "deniz@ornek.dev", "a1"),
      account("Kod Deposu", "deniz", "a2", { algorithm: "SHA256", digits: 7, period: 20 }),
      account("", "deniz", "a3", { algorithm: "SHA512", digits: 8, period: 50 }),
    ]);
    assert.equal(contents.skipped, 4);
    assert.equal(contents.accounts[0].id, "aegis-3ae6f1ad-2e65-4ed2-a953-1ec0dff2386d", "the entry's UUID");
  });

  test("an encrypted export is recognized", () => {
    const encrypted = JSON.stringify({
      version: 1,
      header: { slots: [{ type: 1, uuid: "00000000-0000-4000-8000-000000000000", key: "00", key_params: { nonce: "00", tag: "00" }, n: 32768, r: 8, p: 1, salt: "00" }], params: { nonce: "00", tag: "00" } },
      db: Buffer.from("synthetic ciphertext").toString("base64"),
    });
    assert.deepEqual(nothing(encrypted), { accounts: 0, skipped: 0, encrypted: ["Aegis"] });
  });

  test("its text export is a list of otpauth links", () => {
    const text = entries.slice(0, 3).map((entry) => otpauth({ issuer: entry.issuer || undefined, account: entry.account, secret: entry.secret, algorithm: entry.algorithm ?? "SHA1", digits: entry.digits ?? 6, period: entry.period ?? 30 })).join("\n");
    assert.equal(readExport(text).accounts.length, 3);
  });
});

describe("2FAS", () => {
  test("schema 4: TOTP services, with the name 2FAS shows; HOTP and Steam skipped", () => {
    const text = twoFasExport([
      { name: "Örnek Bank", issuer: "ornek", account: "deniz@ornek.dev", secret: seed("t1") },
      { name: "Kod Deposu", account: "deniz", secret: seed("t2"), algorithm: "SHA512", digits: 8, period: 60 },
      { name: "Posta", account: "deniz", secret: seed("t3"), tokenType: "HOTP" },
      { name: "Steam", account: "deniz", secret: seed("t4"), tokenType: "STEAM", digits: 5 },
    ]);
    assert.deepEqual(accountsOf(text), [account("Örnek Bank", "deniz@ornek.dev", "t1"), account("Kod Deposu", "deniz", "t2", { algorithm: "SHA512", digits: 8, period: 60 })]);
    assert.equal(readExport(text).skipped, 2);
  });

  test("schema 1 and 2: no tokenType, digits or period; the issuer from the label when the name is missing", () => {
    const text = JSON.stringify({
      appOrigin: "android",
      schemaVersion: 1,
      services: [
        { name: "Posta", order: { position: 0 }, otp: { account: "deniz", issuer: "Posta", label: "Posta:deniz" }, secret: seed("t1"), type: "Unknown" },
        { order: { position: 1 }, otp: { label: "Kod Deposu:deniz" }, secret: seed("t2"), type: "Unknown" },
      ],
    });
    assert.deepEqual(accountsOf(text), [account("Posta", "deniz", "t1"), account("Kod Deposu", "deniz", "t2")]);
  });

  test("a backup with a password is recognized", () => {
    const encrypted = JSON.stringify({ services: [], groups: [], updatedAt: 1, schemaVersion: 4, appVersionCode: 5000009, appOrigin: "ios", servicesEncrypted: `${Buffer.from("data").toString("base64")}:${Buffer.from("salt").toString("base64")}:${Buffer.from("iv").toString("base64")}`, reference: "x" });
    assert.deepEqual(nothing(encrypted), { accounts: 0, skipped: 0, encrypted: ["2FAS"] });
  });
});

describe("Bitwarden", () => {
  const items = [
    { name: "Örnek Bank", username: "deniz@ornek.dev", totp: otpauth({ issuer: "ornek", account: "x", secret: seed("b1"), algorithm: "SHA1", digits: 6, period: 30 }) },
    { name: "Kod Deposu", totp: otpauth({ issuer: "Kod Deposu", account: "deniz", secret: seed("b2"), algorithm: "SHA256", digits: 8, period: 60 }) },
    { name: "Posta", username: "deniz", totp: seed("b3").toLowerCase() },
    { name: "Steam", username: "deniz", totp: `steam://${seed("b4")}` },
    { name: "No code", username: "deniz" },
  ];
  const expected = [
    account("Örnek Bank", "deniz@ornek.dev", "b1"),
    account("Kod Deposu", "deniz", "b2", { algorithm: "SHA256", digits: 8, period: 60 }),
    account("Posta", "deniz", "b3"),
  ];

  test("JSON: otpauth links and bare secrets; the item's name and username win; Steam skipped, items without a code left out", () => {
    const contents = readExport(bitwardenExport(items));
    assert.deepEqual(accountsOf(bitwardenExport(items)), expected);
    assert.equal(contents.skipped, 1);
    assert.equal(contents.accounts[0].id, "bitwarden-00000000-0000-4000-9000-000000000000");
  });

  test("CSV, with quoted fields and either line end", () => {
    const csv = bitwardenCsv(items);
    assert.deepEqual(accountsOf(csv), expected);
    assert.deepEqual(accountsOf(csv.replace(/\n/g, "\r\n")), expected);
    const quoted = bitwardenCsv([{ name: 'Posta, "iş"', username: "deniz", totp: seed("b3") }]);
    assert.deepEqual(accountsOf(quoted), [account('Posta, "iş"', "deniz", "b3")]);
  });

  test("CSV whose line breaks are gone: the links in it still count", () => {
    const csv = bitwardenCsv(items.slice(0, 2));
    assert.deepEqual(accountsOf(csv.replace(/\n/g, " ")), [account("ornek", "x", "b1"), expected[1]]);
    assert.deepEqual(accountsOf(csv.replace(/\n/g, "")), [account("ornek", "x", "b1"), expected[1]]);
  });

  test("encrypted exports are recognized, account-restricted or with a password", () => {
    const restricted = JSON.stringify({ encrypted: true, encKeyValidation_DO_NOT_EDIT: "2.x|y|z", folders: [], items: [{ id: "1", login: { totp: "2.x|y|z" } }] });
    const password = JSON.stringify({ encrypted: true, passwordProtected: true, salt: "c2FsdA==", kdfIterations: 600000, kdfType: 0, encKeyValidation_DO_NOT_EDIT: "2.x|y|z", data: "2.x|y|z" });
    for (const text of [restricted, password]) assert.deepEqual(nothing(text), { accounts: 0, skipped: 0, encrypted: ["Bitwarden"] });
  });
});

describe("other exports", () => {
  test("2FAuth: TOTP entries, HOTP skipped", () => {
    const text = twoFauthExport([
      { service: "Posta", account: "deniz", secret: seed("f1"), algorithm: "sha256", digits: 8, period: 60 },
      { service: "Kod Deposu", account: "deniz", secret: seed("f2"), type: "hotp" },
    ]);
    assert.deepEqual(accountsOf(text), [account("Posta", "deniz", "f1", { algorithm: "SHA256", digits: 8, period: 60 })]);
    assert.equal(readExport(text).skipped, 1);
  });

  test("Ente Auth's encrypted export is recognized", () => {
    const text = JSON.stringify({ version: 1, kdfParams: { memLimit: 4096, opsLimit: 3, salt: "c2FsdA==" }, encryptedData: "ZGF0YQ==", encryptionNonce: "bm9uY2U=" });
    assert.deepEqual(nothing(text), { accounts: 0, skipped: 0, encrypted: ["Ente Auth"] });
  });

  test("any other JSON: the otpauth links in its strings", () => {
    const link = otpauth({ issuer: "Posta", account: "deniz", secret: seed("o1") });
    const text = JSON.stringify({ version: 1, entries: [{ id: "x", content: { uri: link, entry_type: "Totp", name: "Posta" } }] });
    assert.deepEqual(accountsOf(text), [account("Posta", "deniz", "o1")]);
    assert.deepEqual(accountsOf(JSON.stringify([link])), [account("Posta", "deniz", "o1")]);
  });
});

describe("mixed and broken input", () => {
  const link = otpauth({ issuer: "Posta", account: "deniz", secret: seed("m1") });
  const google = migrationLink(migrationPayload([otpParameters({ secret: seedBytes("m2"), name: "deniz", issuer: "Kod Deposu" })]));
  const lastPass = lastPassExport([{ issuer: "Örnek Bank", account: "deniz@ornek.dev", secret: seed("m3") }]);
  const aegis = aegisExport([{ issuer: "Ağ", account: "deniz", secret: seed("m4") }]);
  const expected = [account("Posta", "deniz", "m1"), account("Kod Deposu", "deniz", "m2"), account("Örnek Bank", "deniz@ornek.dev", "m3"), account("Ağ", "deniz", "m4")];

  test("several formats in one text, in its order", () => {
    const text = [link, google, lastPass, aegis].join("\n");
    assert.deepEqual(accountsOf(text), expected);
  });

  test("the same with its line breaks turned into spaces, or gone", () => {
    const text = [link, google, lastPass, aegis].join("\n");
    assert.deepEqual(accountsOf(text.replace(/\n/g, " ")), expected);
    assert.deepEqual(accountsOf(text.replace(/\n/g, "")), expected);
  });

  test("an encrypted export next to readable ones", () => {
    const encrypted = JSON.stringify({ services: [], schemaVersion: 4, servicesEncrypted: "a:b:c" });
    const contents = readExport(`${link}\n${encrypted}`);
    assert.equal(contents.accounts.length, 1);
    assert.deepEqual(contents.encrypted, ["2FAS"]);
  });

  test("garbage, half an export and an empty text hold no accounts and throw nothing", () => {
    const halves = [lastPass.slice(0, lastPass.length / 2), aegis.slice(0, -3), `{"accounts": [${"[".repeat(500)}`];
    const garbage = ["", "   ", "hello", "{not json}", "[", "{", "]}", "otpauth", "otpauth:/totp/x", "https://example.com/?secret=ABC", seed("g"), "\u0000\uffff", ...halves];
    for (const text of garbage) assert.equal(readExport(text).accounts.length, 0, JSON.stringify(text.slice(0, 40)));
    assert.equal(readExport("[1, 2, 3] {\"a\": \"b\"}").accounts.length, 0);
  });

  test("an entry given twice is kept once, across formats", () => {
    const sameInLastPass = lastPassExport([{ issuer: "Posta", account: "deniz", secret: seed("m1") }]);
    assert.deepEqual(accountsOf(`${link}\n${link}\n${sameInLastPass}`), [account("Posta", "deniz", "m1")]);
  });

  test("two accounts with the same names keep apart, with ids in the text's order", () => {
    const other = otpauth({ issuer: "Posta", account: "deniz", secret: seed("m9") });
    const third = otpauth({ issuer: "Posta", account: "deniz", secret: seed("m8") });
    const ids = readExport([link, other, third].join("\n")).accounts.map((found) => found.id);
    assert.match(ids[0], /^otp-[0-9a-f]{16}$/);
    assert.deepEqual(ids, [ids[0], `${ids[0]}~2`, `${ids[0]}~3`]);
  });
});

describe("row ids", () => {
  test("the same each time, whatever the format, made of the names only", () => {
    const fromLink = readExport(otpauth({ issuer: "Posta", account: "deniz", secret: seed("i1") })).accounts[0].id;
    const fromGoogle = readExport(migrationLink(migrationPayload([otpParameters({ secret: seedBytes("i2"), name: "deniz", issuer: "Posta" })]))).accounts[0].id;
    const from2fas = readExport(twoFasExport([{ name: "Posta", account: "deniz", secret: seed("i3"), algorithm: "SHA512" }])).accounts[0].id;
    assert.equal(fromGoogle, fromLink, "a different secret, the same names");
    assert.equal(from2fas, fromLink);
    assert.equal(readExport(otpauth({ issuer: "Posta", account: "deniz", secret: seed("i1") })).accounts[0].id, fromLink);
    assert.notEqual(readExport(otpauth({ issuer: "Posta", account: "deniz2", secret: seed("i1") })).accounts[0].id, fromLink);
  });

  test("an export's own id is used only when it is short and plain", () => {
    const ids = ["x".repeat(129), "a b", "a/b", "", 42].map((uuid, index) => readExport(aegisExport([{ issuer: "Posta", account: `deniz${index}`, secret: seed("i1"), uuid }])).accounts[0].id);
    assert.deepEqual(ids.slice(0, 4).map((id) => /^otp-[0-9a-f]{16}$/.test(id)), [true, true, true, true]);
    assert.equal(ids[4], "aegis-42");
  });
});

describe("a very long export", () => {
  test("hundreds of accounts with icons read quickly", () => {
    const icon = Buffer.alloc(20_000, 7).toString("base64");
    const entries = Array.from({ length: 200 }, (_, index) => ({ issuer: `Site ${index}`, account: "deniz", secret: seed(`big ${index}`) }));
    const text = aegisExport(entries).replace(/"icon": null/g, `"icon": "${icon}"`);
    assert.ok(text.length > 5_000_000);
    const started = performance.now();
    assert.equal(readExport(text).accounts.length, 200);
    assert.ok(performance.now() - started < 3000, "well inside the 10 s a listing has");
  });
});
