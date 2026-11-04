import { hash, type Algorithm } from "./hash.ts";
import { base32Bytes, type Totp } from "./otp.ts";

// Reading an authenticator export: otpauth:// links, Google Authenticator's otpauth-migration:// links, and the JSON
// exports of LastPass Authenticator, Aegis, 2FAS, Bitwarden Authenticator and 2FAuth (Bitwarden's CSV too). One text
// may hold several of them, and its line breaks may have become spaces or gone. Nothing read here is logged or put
// in an error: every failure only counts the entry as skipped.

export interface Account extends Totp {
  /** The row's id: unique in the export and the same each time, made of nothing secret. */
  id: string;
  issuer: string;
  account: string;
}

export interface ExportContents {
  /** The time-based accounts, in the order the text gives them, each once. */
  accounts: Account[];
  /** Entries that are not time-based (HOTP, Steam, …) or could not be read. */
  skipped: number;
  /** The apps whose encrypted exports the text holds. */
  encrypted: string[];
}

interface Entry extends Totp {
  issuer: string;
  account: string;
  /** The export's own id for the entry, with the app's name before it. */
  exportId?: string;
}

interface Reader {
  entries: Entry[];
  skipped: number;
  encrypted: string[];
}

/** What one entry says, before it is checked. Missing parameters take the otpauth defaults: SHA-1, 6 digits, 30 s. */
interface Fields {
  issuer?: unknown;
  account?: unknown;
  secret: Uint8Array | undefined;
  algorithm?: unknown;
  digits?: unknown;
  period?: unknown;
  exportId?: string;
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const objectsIn = (value: unknown): JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);

const ALGORITHMS: Record<string, Algorithm> = { SHA1: "SHA1", SHA256: "SHA256", SHA512: "SHA512" };

function algorithmOf(value: unknown): Algorithm | undefined {
  if (value === undefined || value === null || value === "") return "SHA1";
  if (typeof value !== "string") return undefined;
  const name = value.toUpperCase().replace(/^HMAC/, "").replace(/[^A-Z0-9]/g, "");
  return Object.hasOwn(ALGORITHMS, name) ? ALGORITHMS[name] : undefined;
}

/** A whole number from min to max; a text's leading digits count, so "30" and "30,,login" are both 30. */
function integerOf(value: unknown, fallback: number, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  let number = NaN;
  if (typeof value === "number") number = value;
  else if (typeof value === "string" && /^\s*\d/.test(value)) number = parseInt(value, 10);
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

function add(reader: Reader, fields: Fields): void {
  const algorithm = algorithmOf(fields.algorithm);
  const digits = integerOf(fields.digits, 6, 6, 10);
  const period = integerOf(fields.period, 30, 1, 3600);
  if (fields.secret === undefined || algorithm === undefined || digits === undefined || period === undefined) {
    reader.skipped++;
    return;
  }
  reader.entries.push({
    issuer: textOf(fields.issuer),
    account: textOf(fields.account),
    secret: fields.secret,
    algorithm,
    digits,
    period,
    exportId: fields.exportId,
  });
}

/** The export's own id for an entry, when it is a plain short one: a UUID, a number. */
function exportIdOf(app: string, value: unknown): string | undefined {
  const id = typeof value === "number" ? String(value) : textOf(value);
  return /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? `${app}-${id}` : undefined;
}

/**
 * The secret in a link or a field, as Base32. A "," or ";" ends it: a CSV's next field, once its line breaks are gone.
 * Anything else that is not Base32 makes it unreadable, never a shorter secret.
 */
const secretIn = (text: unknown): Uint8Array | undefined =>
  typeof text === "string" ? base32Bytes(text.split(/[,;]/)[0]) : undefined;

function percentDecoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A query's parameters: names in lower case, values with "+" as a space and percent escapes decoded; the first wins. */
function queryOf(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    const equals = part.indexOf("=");
    if (equals <= 0) continue;
    const name = percentDecoded(part.slice(0, equals)).toLowerCase();
    if (!params.has(name)) params.set(name, percentDecoded(part.slice(equals + 1).replace(/\+/g, " ")));
  }
  return params;
}

/**
 * Issuer and account from a label such as "GitHub:octocat" (Google's Key URI Format) and an issuer given apart. The
 * issuer given apart wins; the label's prefix is taken off the account only when it names the same issuer.
 */
function labelled(label: string, issuer: string): { issuer: string; account: string } {
  const colon = label.indexOf(":");
  if (colon === -1) return { issuer, account: label.trim() };
  const prefix = label.slice(0, colon).trim();
  const rest = label.slice(colon + 1).trim();
  if (issuer === "") return { issuer: prefix, account: rest };
  return { issuer, account: prefix.toLowerCase() === issuer.toLowerCase() ? rest : label.trim() };
}

/** Names that take the place of a link's own: an export's title and username for the entry. */
interface Names {
  issuer?: unknown;
  account?: unknown;
  exportId?: string;
}

/** One otpauth://totp/… link. Other types (hotp, steam, …) are skipped: HOTP needs a counter kept between uses. */
function readOtpauth(uri: string, reader: Reader, names: Names = {}): void {
  const match = /^otpauth:\/\/([^/?#]*)\/?([^?#]*)(?:\?([^#]*))?/i.exec(uri);
  if (match === null || match[1].toLowerCase() !== "totp") {
    reader.skipped++;
    return;
  }
  const params = queryOf(match[3] ?? "");
  const { issuer, account } = labelled(percentDecoded(match[2]), (params.get("issuer") ?? "").trim());
  add(reader, {
    issuer: textOf(names.issuer) || issuer,
    account: textOf(names.account) || account,
    secret: secretIn(params.get("secret")),
    algorithm: /^[A-Za-z0-9-]*/.exec(params.get("algorithm") ?? "")?.[0],
    digits: params.get("digits"),
    period: params.get("period"),
    exportId: names.exportId,
  });
}

/**
 * The bytes of Base64 or Base64url text, padding optional. A "+" that became a space on the way, as it does in a
 * form-decoded link, is turned back.
 */
function base64Bytes(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

interface ProtoField {
  number: number;
  value: number | Uint8Array;
}

/**
 * A protobuf message's fields, in order: varints as numbers (exact up to 2^53, enough for the small ones read here)
 * and length-delimited fields as bytes. Fixed-size fields are skipped. Throws on anything malformed.
 */
function protoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let at = 0;
  const varint = (): number => {
    let value = 0;
    for (let index = 0, scale = 1; index < 10; index++, scale *= 128) {
      if (at >= bytes.length) throw new Error("truncated");
      const byte = bytes[at++];
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
    }
    throw new Error("varint too long");
  };
  while (at < bytes.length) {
    const key = varint();
    const number = Math.floor(key / 8);
    const wireType = key % 8;
    if (number === 0) throw new Error("field 0");
    if (wireType === 0) fields.push({ number, value: varint() });
    else if (wireType === 2) {
      const length = varint();
      if (at + length > bytes.length) throw new Error("truncated");
      fields.push({ number, value: bytes.subarray(at, at + length) });
      at += length;
    } else if (wireType === 1) at += 8;
    else if (wireType === 5) at += 4;
    else throw new Error("wire type");
    if (at > bytes.length) throw new Error("truncated");
  }
  return fields;
}

const GOOGLE_ALGORITHMS: Record<number, Algorithm> = { 0: "SHA1", 1: "SHA1", 2: "SHA256", 3: "SHA512" };
const GOOGLE_DIGITS: Record<number, number> = { 0: 6, 1: 6, 2: 8 };

/**
 * One Google Authenticator otpauth-migration://offline?data=… link. `data` is a Base64 protobuf `MigrationPayload`
 * whose field 1 repeats `OtpParameters`: secret (1, bytes), name (2), issuer (3), algorithm (4), digits (5) and type
 * (6), as in Aegis's google_auth.proto. Google's codes always change every 30 seconds.
 */
function readMigration(uri: string, reader: Reader): void {
  const match = /^otpauth-migration:\/\/offline\/?\?(.*)$/is.exec(uri);
  // The raw value: decoding it as a form would turn an unescaped "+" of the Base64 into a space.
  const data = match === null ? undefined : /(?:^|&)data=([^&]*)/.exec(match[1])?.[1];
  const payload = data === undefined ? undefined : base64Bytes(percentDecoded(data));
  let parameters: ProtoField[][];
  try {
    if (payload === undefined) throw new Error("no data");
    parameters = protoFields(payload)
      .filter((field) => field.number === 1)
      .map((field) => {
        if (!(field.value instanceof Uint8Array)) throw new Error("not a message");
        return protoFields(field.value);
      });
  } catch {
    reader.skipped++;
    return;
  }
  const decoder = new TextDecoder();
  for (const fields of parameters) {
    const bytesOf = (number: number) => fields.find((field) => field.number === number)?.value;
    const numberOf = (number: number) => {
      const value = bytesOf(number) ?? 0;
      return typeof value === "number" ? value : -1;
    };
    const textAt = (number: number) => {
      const value = bytesOf(number);
      return value instanceof Uint8Array ? decoder.decode(value) : "";
    };
    const secret = bytesOf(1);
    const type = numberOf(6);
    // 0 is unspecified, read as TOTP as Aegis does; 1 is HOTP.
    if (type !== 0 && type !== 2) {
      reader.skipped++;
      continue;
    }
    const algorithm = GOOGLE_ALGORITHMS[numberOf(4)];
    const digits = GOOGLE_DIGITS[numberOf(5)];
    // MD5 (4) and anything newer have no code here.
    if (algorithm === undefined || digits === undefined) {
      reader.skipped++;
      continue;
    }
    const { issuer, account } = labelled(textAt(2), textAt(3).trim());
    add(reader, {
      issuer,
      account,
      secret: secret instanceof Uint8Array && secret.length > 0 ? secret : undefined,
      algorithm,
      digits,
      period: 30,
    });
  }
}

const SCHEME = /^otpauth(?:-migration)?:\/\//i;
/** Characters that never stand unescaped in a link: one ends there. */
const LINK_END = /[\s"<>{}[\]\\^|`]/;
const startsLink = (text: string, at: number): boolean =>
  (text[at] === "o" || text[at] === "O") && SCHEME.test(text.slice(at, at + 21));

/** Where the link that starts at `start` ends: at a character no link holds, or where the next link starts. */
function linkEnd(text: string, start: number): number {
  let at = start + 1;
  while (at < text.length && !LINK_END.test(text[at]) && !startsLink(text, at)) at++;
  return at;
}

function readLink(uri: string, reader: Reader, names?: Names): void {
  if (/^otpauth-migration:/i.test(uri)) readMigration(uri, reader);
  else readOtpauth(uri, reader, names);
}

/** The index of the bracket that closes the one at `start`, outside JSON strings, or -1. */
function closingBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let at = start; at < text.length; at++) {
    const char = text[at];
    if (inString) {
      if (char === "\\") at++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && --depth === 0) return at;
  }
  return -1;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // The engine's message may quote the text: it goes nowhere.
    return undefined;
  }
}

/** Aegis: `header` and `db`; `db` is Base64 ciphertext when the export is encrypted. Entries of `db.entries`. */
function readAegis(object: JsonObject, reader: Reader): boolean {
  const db = object.db;
  if (typeof db === "string" && isObject(object.header)) {
    reader.encrypted.push("Aegis");
    return true;
  }
  const entries = isObject(db) ? db.entries : object.entries;
  if (!Array.isArray(entries) || !objectsIn(entries).some((entry) => isObject(entry.info))) return false;
  for (const entry of objectsIn(entries)) {
    const info = isObject(entry.info) ? entry.info : {};
    if (entry.type !== "totp") {
      reader.skipped++;
      continue;
    }
    add(reader, {
      issuer: entry.issuer,
      account: entry.name,
      secret: secretIn(info.secret),
      algorithm: info.algo,
      digits: info.digits,
      period: info.period,
      exportId: exportIdOf("aegis", entry.uuid),
    });
  }
  return true;
}

/** 2FAS: `services`, or `servicesEncrypted` when the export has a password. A service's `name` is what 2FAS shows. */
function readTwoFas(object: JsonObject, reader: Reader): boolean {
  const services = objectsIn(object.services);
  const encrypted = textOf(object.servicesEncrypted) !== "";
  if (!encrypted && !services.some((service) => "secret" in service && isObject(service.otp))) return false;
  if (encrypted) reader.encrypted.push("2FAS");
  for (const service of services) {
    const otp = isObject(service.otp) ? service.otp : {};
    const tokenType = textOf(otp.tokenType).toUpperCase();
    if (tokenType !== "" && tokenType !== "TOTP") {
      reader.skipped++;
      continue;
    }
    const label = labelled(textOf(otp.label), textOf(otp.issuer));
    add(reader, {
      issuer: textOf(service.name) || textOf(otp.issuer) || label.issuer,
      account: textOf(otp.account) || label.account,
      secret: secretIn(service.secret),
      algorithm: otp.algorithm,
      digits: otp.digits,
      period: otp.period,
    });
  }
  return true;
}

/**
 * LastPass Authenticator (Settings › Transfer accounts › Export accounts to file): `accounts`, each with `secret`,
 * `issuerName`, `userName` (the names as shown, which the person may have changed; `originalIssuerName` and
 * `originalUserName` hold the names it came with), `algorithm`, `digits` and `timeStep`. It makes only TOTP codes.
 */
function readLastPass(object: JsonObject, reader: Reader): boolean {
  const accounts = objectsIn(object.accounts);
  const looksLike = (account: JsonObject) =>
    "secret" in account && ("issuerName" in account || "originalIssuerName" in account || "timeStep" in account);
  if (!accounts.some(looksLike)) return false;
  for (const account of accounts) {
    add(reader, {
      issuer: textOf(account.issuerName) || textOf(account.originalIssuerName),
      account: textOf(account.userName) || textOf(account.originalUserName),
      secret: secretIn(account.secret),
      algorithm: account.algorithm,
      digits: account.digits,
      period: account.timeStep,
      exportId: exportIdOf("lastpass", account.accountID),
    });
  }
  return true;
}

/**
 * A Bitwarden login's `totp`: an otpauth link, a `steam://` one (skipped), or a bare Base32 secret with the default
 * parameters. The login's own name and username are what Bitwarden shows, so they win over the link's.
 */
function readBitwardenTotp(totp: string, reader: Reader, names: Names): void {
  if (/^otpauth:\/\//i.test(totp)) readOtpauth(totp, reader, names);
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(totp)) reader.skipped++;
  else add(reader, { ...names, secret: secretIn(totp) });
}

/** Bitwarden (Authenticator or Password Manager) JSON: `items`, each `login.totp`; `encrypted: true` when encrypted. */
function readBitwarden(object: JsonObject, reader: Reader): boolean {
  if (object.encrypted === true && ("encKeyValidation_DO_NOT_EDIT" in object || "passwordProtected" in object)) {
    reader.encrypted.push("Bitwarden");
    return true;
  }
  if (!Array.isArray(object.items)) return false;
  for (const item of objectsIn(object.items)) {
    const login = isObject(item.login) ? item.login : {};
    const totp = textOf(login.totp);
    if (totp === "") continue;
    readBitwardenTotp(totp, reader, { issuer: item.name, account: login.username, exportId: exportIdOf("bitwarden", item.id) });
  }
  return true;
}

/** 2FAuth: `app` "2fauth_v…" and `data`, each with `otp_type`, `service`, `account`, `secret`, `algorithm`, … */
function readTwoFauth(object: JsonObject, reader: Reader): boolean {
  if (!/^2fauth/i.test(textOf(object.app)) || !Array.isArray(object.data)) return false;
  for (const entry of objectsIn(object.data)) {
    if (textOf(entry.otp_type).toLowerCase() !== "totp") {
      reader.skipped++;
      continue;
    }
    add(reader, {
      issuer: entry.service,
      account: entry.account,
      secret: secretIn(entry.secret),
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
    });
  }
  return true;
}

/** Ente Auth's encrypted export: `kdfParams`, `encryptedData` and `encryptionNonce`. Its plain one is otpauth links. */
function readEnte(object: JsonObject, reader: Reader): boolean {
  if (typeof object.encryptedData !== "string" || !isObject(object.kdfParams)) return false;
  reader.encrypted.push("Ente Auth");
  return true;
}

/** The strings anywhere in a JSON value that hold an otpauth link. */
function linkTexts(value: unknown, found: string[], depth = 0): void {
  if (depth > 32 || found.length >= 10_000) return;
  if (typeof value === "string") {
    if (/otpauth/i.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const element of value) linkTexts(element, found, depth + 1);
  } else if (isObject(value)) {
    for (const element of Object.values(value)) linkTexts(element, found, depth + 1);
  }
}

const JSON_FORMATS = [readAegis, readTwoFas, readLastPass, readBitwarden, readTwoFauth, readEnte];

/** One JSON value: a known export, or else any otpauth links in its strings. */
function readJson(value: unknown, reader: Reader): void {
  if (isObject(value) && JSON_FORMATS.some((read) => read(value, reader))) return;
  const texts: string[] = [];
  linkTexts(value, texts);
  for (const text of texts) readText(text, reader);
}

/** The rows of CSV text (RFC 4180): fields split at commas, quoted fields with "" for a quote, rows at line ends. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"';
        at++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[at + 1] === "\n") at++;
      row.push(field);
      rows.push(row);
      [row, field] = [[], ""];
    } else field += char;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/**
 * Bitwarden's CSV export, when the text is one with its line breaks: a header "folder,favorite,type,name,…" with a
 * `login_totp` column. False when it is not, so the text is read for links instead.
 */
function readBitwardenCsv(text: string, reader: Reader): boolean {
  if (!/^folder,favorite,type,name,/.test(text) || !/[\r\n]/.test(text)) return false;
  const [header, ...rows] = csvRows(text);
  const column = (name: string) => header.indexOf(name);
  if (column("login_totp") === -1) return false;
  for (const row of rows) {
    const totp = (row[column("login_totp")] ?? "").trim();
    if (totp !== "") readBitwardenTotp(totp, reader, { issuer: row[column("name")], account: row[column("login_username")] });
  }
  return true;
}

/** Any text: the links and the JSON values in it, in order. */
function readText(text: string, reader: Reader): void {
  let at = 0;
  while (at < text.length) {
    if (startsLink(text, at)) {
      const end = linkEnd(text, at);
      readLink(text.slice(at, end), reader);
      at = end;
      continue;
    }
    if (text[at] === "{" || text[at] === "[") {
      const end = closingBracket(text, at);
      const value = end === -1 ? undefined : parsedJson(text.slice(at, end + 1));
      if (value !== undefined) {
        readJson(value, reader);
        at = end + 1;
        continue;
      }
    }
    at++;
  }
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Every time-based account in an export's text. An entry given twice, the same in every part, is kept once. Its id is
 * the export's own id for it, or else a hash of its issuer and account name; a second entry with the same id gets
 * "~2" after it, and so on, in the order of the text.
 */
export function readExport(text: string): ExportContents {
  const reader: Reader = { entries: [], skipped: 0, encrypted: [] };
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!readBitwardenCsv(trimmed, reader)) readText(trimmed, reader);

  const seen = new Set<string>();
  const used = new Set<string>();
  const accounts: Account[] = [];
  for (const entry of reader.entries) {
    const same = [entry.issuer, entry.account, entry.algorithm, entry.digits, entry.period, hex(entry.secret)].join("\n");
    if (seen.has(same)) continue;
    seen.add(same);
    const named = new TextEncoder().encode(`${entry.issuer}\n${entry.account}`);
    const base = entry.exportId ?? `otp-${hex(hash("SHA256", named)).slice(0, 16)}`;
    let id = base;
    for (let count = 2; used.has(id); count++) id = `${base}~${count}`;
    used.add(id);
    const { issuer, account, secret, algorithm, digits, period } = entry;
    accounts.push({ id, issuer, account, secret, algorithm, digits, period });
  }
  return { accounts, skipped: reader.skipped, encrypted: [...new Set(reader.encrypted)] };
}
