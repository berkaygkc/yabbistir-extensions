// Synthetic exports for the tests, in the shapes the apps write them. Every seed is made at run time from a made-up
// phrase (or is an RFC test vector), so no file holds anything shaped like a real secret.

import { createHmac } from "node:crypto";
import { createFakeHost } from "@yabbistir/api/fake-host";

export const folder = new URL("..", import.meta.url);

export const ascii = (text) => new TextEncoder().encode(text);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 Base32, with "=" padding when asked. */
export function base32(bytes, { padding = false } = {}) {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return padding ? out.padEnd(Math.ceil(out.length / 8) * 8, "=") : out;
}

/** A made-up seed's bytes and its Base32. */
export const seedBytes = (name) => ascii(`yabbistir synthetic seed: ${name}`);
export const seed = (name) => base32(seedBytes(name));

/**
 * What an independent implementation, Node's HMAC, says the extension should paste at `nowMs`: the current period's
 * code, or the next period's when fewer than three seconds are left.
 */
export function expectedCode(secret, nowMs, { algorithm = "SHA1", digits = 6, period = 30 } = {}) {
  const periodMs = period * 1000;
  const counter = Math.floor(nowMs / periodMs) + (periodMs - (nowMs % periodMs) < 3000 ? 1 : 0);
  return referenceHotp(secret, counter, algorithm, digits);
}

export function referenceHotp(secret, counter, algorithm, digits) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm.toLowerCase(), Buffer.from(secret)).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** An otpauth:// link as Google's Key URI Format writes it; `label` overrides the "Issuer:account" label. */
export function otpauth({ type = "totp", issuer, account = "", secret, label, ...rest }) {
  const path = label ?? (issuer ? `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` : encodeURIComponent(account));
  const params = new URLSearchParams();
  if (secret !== undefined) params.set("secret", secret);
  if (issuer !== undefined) params.set("issuer", issuer);
  for (const [name, value] of Object.entries(rest)) params.set(name, String(value));
  return `otpauth://${type}/${path}?${params}`;
}

// Protobuf, for Google Authenticator's MigrationPayload: written here by hand, apart from the extension's reader.
function varint(value) {
  let rest = BigInt.asUintN(64, BigInt(value));
  const out = [];
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest > 0n) byte |= 0x80;
    out.push(byte);
  } while (rest > 0n);
  return out;
}
const key = (number, wireType) => varint(number * 8 + wireType);
const numberField = (number, value) => [...key(number, 0), ...varint(value)];
const bytesField = (number, bytes) => [...key(number, 2), ...varint(bytes.length), ...bytes];

/** One OtpParameters message. algorithm 1 SHA1 · 2 SHA256 · 3 SHA512 · 4 MD5; digits 1 six · 2 eight; type 1 HOTP · 2 TOTP. */
export function otpParameters({ secret, name = "", issuer = "", algorithm = 1, digits = 1, type = 2, counter }) {
  return [
    ...bytesField(1, secret),
    ...bytesField(2, ascii(name)),
    ...(issuer === "" ? [] : bytesField(3, ascii(issuer))),
    ...numberField(4, algorithm),
    ...numberField(5, digits),
    ...numberField(6, type),
    ...(counter === undefined ? [] : numberField(7, counter)),
  ];
}

/** A MigrationPayload: the parameters, then version, batch size, index and a negative batch id (ten-byte varint). */
export function migrationPayload(parameters, { batchSize = 1, batchIndex = 0, extra = [] } = {}) {
  return Uint8Array.from([
    ...parameters.flatMap((message) => bytesField(1, message)),
    ...numberField(2, 1),
    ...numberField(3, batchSize),
    ...numberField(4, batchIndex),
    ...numberField(5, -1_234_567_890),
    ...extra,
  ]);
}

/** The otpauth-migration:// link of a QR code: the payload in Base64, percent-escaped unless `escape` is false. */
export function migrationLink(payload, { escape = true } = {}) {
  const data = Buffer.from(payload).toString("base64");
  return `otpauth-migration://offline?data=${escape ? encodeURIComponent(data) : data}`;
}

/** LastPass Authenticator's "Export accounts to file". */
export function lastPassExport(accounts) {
  return JSON.stringify({
    deviceId: "synthetic-device",
    deviceSecret: "",
    localDeviceId: "00000000-0000-4000-8000-000000000001",
    deviceName: "iPhone15,4",
    version: 3,
    accounts: accounts.map((account, index) => ({
      accountID: "",
      issuerName: account.issuer,
      originalIssuerName: account.originalIssuer ?? account.issuer,
      userName: account.account,
      originalUserName: account.originalAccount ?? account.account,
      pushNotification: false,
      secret: account.secret,
      timeStep: account.period ?? 30,
      digits: account.digits ?? 6,
      creationTimestamp: 1_715_971_083 + index,
      isFavorite: false,
      algorithm: account.algorithm ?? "SHA1",
      folderData: { folderId: 0, position: index },
      lmiUserId: "",
      ...account.extra,
    })),
    folders: [
      { id: 1, name: "Favorites", isOpened: true },
      { id: 0, name: "Other Accounts", isOpened: true },
    ],
  }, null, 2);
}

/** An unencrypted Aegis export (db version 3). */
export function aegisExport(entries) {
  return JSON.stringify({
    version: 1,
    header: { slots: null, params: null },
    db: {
      version: 3,
      entries: entries.map((entry, index) => ({
        type: entry.type ?? "totp",
        uuid: entry.uuid ?? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: entry.account,
        issuer: entry.issuer,
        note: "",
        favorite: false,
        icon: null,
        icon_mime: null,
        icon_hash: null,
        info: { secret: entry.secret, algo: entry.algorithm ?? "SHA1", digits: entry.digits ?? 6, ...(entry.type === "hotp" ? { counter: 3 } : { period: entry.period ?? 30 }) },
        groups: [],
      })),
      groups: [],
    },
  }, null, 4);
}

/** A 2FAS backup (.2fas), schema 4, without a password. */
export function twoFasExport(services) {
  return JSON.stringify({
    services: services.map((service, index) => ({
      name: service.name,
      secret: service.secret,
      updatedAt: 1_702_934_567_518 + index,
      otp: {
        label: service.account,
        account: service.account,
        issuer: service.issuer ?? service.name,
        digits: service.digits ?? 6,
        period: service.period ?? 30,
        algorithm: service.algorithm ?? "SHA1",
        tokenType: service.tokenType ?? "TOTP",
        source: "Link",
      },
      order: { position: index },
      icon: { selected: "Label", label: { text: "XX", backgroundColor: "Default" } },
    })),
    groups: [],
    updatedAt: 1_702_934_732_299,
    schemaVersion: 4,
    appVersionCode: 5_000_009,
    appVersionName: "5.1.0",
    appOrigin: "ios",
  });
}

/** Bitwarden Authenticator's JSON export. */
export function bitwardenExport(items) {
  return JSON.stringify({
    encrypted: false,
    items: items.map((item, index) => ({
      favorite: false,
      id: item.id ?? `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
      login: { totp: item.totp, username: item.username ?? null },
      name: item.name,
      type: 1,
    })),
  }, null, 2);
}

const csvField = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Bitwarden's CSV export. */
export function bitwardenCsv(items) {
  const header = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp";
  const rows = items.map((item) => ["", "", "login", item.name, "", "", "0", "", item.username ?? "", "", item.totp].map(csvField).join(","));
  return [header, ...rows].join("\n") + "\n";
}

/** A 2FAuth migration file. */
export function twoFauthExport(data) {
  return JSON.stringify({
    app: "2fauth_v5.1.1",
    schema: 1,
    datetime: "2026-01-01T09:00:00.000000Z",
    data: data.map((entry) => ({
      otp_type: entry.type ?? "totp",
      account: entry.account,
      service: entry.service,
      icon: null,
      icon_mime: null,
      icon_file: null,
      secret: entry.secret,
      digits: entry.digits ?? 6,
      algorithm: entry.algorithm ?? "sha1",
      period: entry.period ?? 30,
      counter: null,
      legacy_uri: otpauth({ issuer: entry.service, account: entry.account, secret: entry.secret }),
    })),
  });
}

/** A host with the export in the Accounts preference (none when `accounts` is undefined). */
export function hostWith(sources, accounts, { now = Date.parse("2026-01-01T09:00:10Z"), language } = {}) {
  return createFakeHost({
    folder,
    sources,
    secrets: accounts === undefined ? {} : { accounts },
    now,
    ...(language === undefined ? {} : { context: { language } }),
  });
}

/** A moment with plenty of the current period left: ten seconds into a 30 s and a 60 s period. */
export const NOW = Date.parse("2026-01-01T09:00:10Z");
