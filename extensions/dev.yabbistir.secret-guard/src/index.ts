import type { CaptureResult, CaptureRules } from "@yabbistir/api";

/** What stands in for the hidden part of a secret. */
export const DOTS = "••••••••";

/**
 * The longest copy the rule reads, in UTF-16 code units. The app sends a rule nothing over 256 KB; past this the copy
 * is kept rather than risk the rule's 200 ms.
 */
export const LIMIT = 512 * 1024;

/** A secret in a copy: `text.slice(start, end)`, of which the first `keep` characters stay readable when masked. */
export interface Finding {
  /** Which format it is, for tests; never shown. */
  kind: string;
  start: number;
  end: number;
  keep: number;
  /** Keep the last four characters too: tokens, which dashboards list by their last four. Never passwords or seeds. */
  tail: boolean;
  /** What replaces the hidden part instead of the dots (a private key's body, between its BEGIN and END lines). */
  fill?: string;
}

export interface Options {
  /** Treat JSON Web Tokens as secrets too. */
  jwt: boolean;
}

type Detector = (text: string) => Iterable<Finding>;

/** Has both a capital and a small letter: random keys do; words and placeholders such as `xxxx` mostly do not. */
const mixed = (text: string): boolean => /[a-z]/.test(text) && /[A-Z]/.test(text);

/** Base64 or base64url without padding, decoded; null when it is not base64. */
function decode(segment: string): string | null {
  try {
    const plain = segment.replace(/-/g, "+").replace(/_/g, "/");
    return atob(plain + "=".repeat((4 - (plain.length % 4)) % 4));
  } catch {
    return null;
  }
}

/**
 * The matches of the global `pattern` that do not start right after a `word` character: what a lookbehind would say,
 * which JavaScriptCore runs slowly enough (a few ms per regular expression over 256 KB) to matter here.
 */
function* matches(text: string, pattern: RegExp, word?: RegExp): Iterable<RegExpExecArray> {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (word && match.index > 0 && word.test(text[match.index - 1])) pattern.lastIndex = match.index + 1;
    else yield match;
  }
}

/** Characters a token never starts right after, so `task-…` is never `sk-…`. */
const WORD = /[A-Za-z0-9_]/;
const WORD_DASH = /[A-Za-z0-9_-]/;
const WORD_DASH_DOT = /[A-Za-z0-9_.-]/;

// ---- Tokens with a prefix ----
// Group 1 of each pattern is the prefix that stays readable. A pattern's end keeps a token from ending inside a longer
// word, and `before` keeps it from starting inside one.

interface Token {
  kind: string;
  pattern: RegExp;
  before?: RegExp;
  /** Checks the part after the prefix. */
  check?: (body: string) => boolean;
  /** What a match may end with that belongs to the text after it. */
  trim?: RegExp;
}

const tokens: Token[] = [
  { kind: "github", pattern: /(gh[pousr]_)[A-Za-z0-9]{36,251}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  { kind: "github", pattern: /(github_pat_)[A-Za-z0-9_]{36,244}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  { kind: "gitlab", pattern: /(gl(?:pat|dt|rtr?|ptt|oas|soat)-)[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)*(?![A-Za-z0-9_-])/g, before: WORD_DASH, check: mixed },
  // Bot, user, app, refresh and workflow tokens: the part after the prefix starts with a number.
  { kind: "slack", pattern: /((?:xoxe\.)?(?:xox[abposre]|xapp|xwfp)-)\d+-[A-Za-z0-9-]+/g, before: WORD_DASH_DOT, check: (body) => body.length >= 16, trim: /-+$/ },
  { kind: "slack", pattern: /((?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9_\/-]{20,}/g, trim: /[\/-]+$/ },
  { kind: "stripe", pattern: /([rs]k_(?:live|test)_)[A-Za-z0-9]{20,247}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  { kind: "google", pattern: /(AIza)[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, before: WORD_DASH, check: mixed },
  { kind: "anthropic", pattern: /(sk-ant-(?:[a-z]+\d*-)?)[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, before: WORD_DASH, check: mixed },
  { kind: "openai", pattern: /(sk-(?:proj|svcacct|admin)-)[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, before: WORD_DASH, check: mixed },
  // The older keys: sk- and exactly 48 letters and digits.
  { kind: "openai", pattern: /(sk-)[A-Za-z0-9]{48}(?![A-Za-z0-9_-])/g, before: WORD_DASH, check: mixed },
  { kind: "npm", pattern: /(npm_)[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  // A PyPI token is a macaroon, whose base64 always starts with AgE.
  { kind: "pypi", pattern: /(pypi-)AgE[A-Za-z0-9_-]{50,}(?![A-Za-z0-9_-])/g, before: WORD_DASH },
  { kind: "sendgrid", pattern: /(SG\.)[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, before: WORD_DASH },
  { kind: "twilio", pattern: /(SK)[0-9a-fA-F]{32}(?![A-Za-z0-9_])/g, before: WORD },
  // AWS's own documentation ends its sample keys with EXAMPLE.
  { kind: "aws", pattern: /(AKIA|ASIA)[A-Z2-7]{16}(?![A-Za-z0-9_])/g, before: WORD, check: (body) => !body.endsWith("EXAMPLE") },
  // A Discord bot token starts with the bot's id, 17 to 20 digits, in base64.
  { kind: "discord", pattern: /()[MNO][A-Za-z0-9]{22,26}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{25,40}(?![A-Za-z0-9_-])/g, before: WORD_DASH_DOT,
    check: (body) => /^\d{17,20}$/.test(decode(body.slice(0, body.indexOf("."))) ?? "") },
  // A Telegram bot token: the bot's id, a colon, and 35 characters that start with A.
  { kind: "telegram", pattern: /(\d{5,16}:)A[A-Za-z0-9_-]{34}(?![A-Za-z0-9_-])/g, before: /[A-Za-z0-9_:]/, check: mixed },
];

function* prefixed(text: string): Iterable<Finding> {
  for (const token of tokens) {
    for (const match of matches(text, token.pattern, token.before)) {
      const prefix = match[1] ?? "";
      const value = token.trim ? match[0].replace(token.trim, "") : match[0];
      if (token.check && !token.check(value.slice(prefix.length))) continue;
      yield { kind: token.kind, start: match.index, end: match.index + value.length, keep: prefix.length, tail: true };
    }
  }
}

// ---- Private keys ----

const pemBegin = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY( BLOCK)?-----/g;
/** The lines of a key whose END line was not copied: base64, armor headers (`Proc-Type: …`) and blank lines. */
const pemLines = /(?:\r?\n(?:[A-Za-z0-9+\/=]*|[A-Za-z][A-Za-z-]*: [^\r\n]*)(?=\r?\n|$))+/y;
const keyMaterial = /[A-Za-z0-9+\/]{16}/;

/** The first line break in a key's body as it is written there: a real one, or `\n` inside a JSON string. */
function lineBreak(body: string): string {
  return /\r\n|\n|\\n/.exec(body)?.[0] ?? " ";
}

/**
 * The body of a private key. Its BEGIN and END lines stay, so the kind of key can still be read. The search goes on
 * after each key, and an END line that is not there is looked for once, so the text is read about once however many
 * BEGIN lines it has.
 */
function* privateKeys(text: string): Iterable<Finding> {
  const missing = new Set<string>();
  pemBegin.lastIndex = 0;
  for (let match = pemBegin.exec(text); match !== null; match = pemBegin.exec(text)) {
    const start = match.index + match[0].length;
    const footer = `-----END ${match[1]}PRIVATE KEY${match[2] ?? ""}-----`;
    const end = missing.has(footer) ? -1 : text.indexOf(footer, start);
    if (end >= 0) {
      const body = text.slice(start, end);
      if (keyMaterial.test(body)) {
        const nl = lineBreak(body);
        yield { kind: "privateKey", start, end, keep: 0, tail: false, fill: nl + DOTS + nl };
      }
      pemBegin.lastIndex = end + footer.length;
      continue;
    }
    missing.add(footer);
    pemLines.lastIndex = start;
    const lines = pemLines.exec(text)?.[0].trimEnd() ?? "";
    if (keyMaterial.test(lines)) {
      yield { kind: "privateKey", start, end: start + lines.length, keep: 0, tail: false, fill: lineBreak(lines) + DOTS };
    }
    pemBegin.lastIndex = Math.max(pemBegin.lastIndex, start + lines.length);
  }
}

// ---- Values a label names ----

const placeholderWords = new Set([
  "changeme", "change_me", "change-me", "secret", "password", "passwd", "token", "apikey", "api_key", "api-key",
  "undefined", "example", "placeholder", "dummy", "redacted", "hidden", "default", "required",
]);

/** A value that only stands in for a secret: empty, a reference, a template or a sample. */
export function isPlaceholder(value: string): boolean {
  const text = value.trim();
  if (text === "" || text.startsWith("$") || /\$[{(]|^%\w+%$/.test(text)) return true; // $VAR, ${VAR}, $(command), %VAR%
  if (/^<[^<>]*>$/.test(text) || /^\{\{.*\}\}$/.test(text)) return true; // <password>, {{ secret }}
  if (/^(.)\1*$/.test(text) || /xxxx|\*\*\*|•|\.\.\.|…/i.test(text)) return true; // ******, sk-xxxx, sk_live_…, masked
  if (/^your[-_ ]|[-_ ]here$/i.test(text)) return true; // your-api-key, put_it_here
  return placeholderWords.has(text.toLowerCase());
}

/** AWS's secret key and session token, only where a label names them: `aws_secret_access_key = …`, `"SecretAccessKey": "…"`. */
const awsLabeled: [RegExp, (value: string) => boolean][] = [
  [/((?:aws_?)?secret_?access_?key)(["']?\s*[:=]\s*["']?)([A-Za-z0-9\/+]{40})(?![A-Za-z0-9\/+=])/gi,
    (value) => mixed(value) && !value.endsWith("EXAMPLEKEY")],
  [/((?:aws_?)?session_?token)(["']?\s*[:=]\s*["']?)([A-Za-z0-9\/+=]{100,})/gi, mixed],
];

function* awsSecrets(text: string): Iterable<Finding> {
  for (const [pattern, check] of awsLabeled) {
    for (const match of text.matchAll(pattern)) {
      if (!check(match[3])) continue;
      const start = (match.index ?? 0) + match[1].length + match[2].length;
      yield { kind: "aws", start, end: start + match[3].length, keep: 0, tail: true };
    }
  }
}

/** A database or queue address; group 1 is its authority, where `user:password@` sits. */
const connection = /(?:postgres(?:ql)?|mysql|mariadb|mongodb|rediss?|amqps?)(?:\+[A-Za-z0-9]+)?:\/\/([^\s\/?#"'<>`\\]+)/gi;

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The password in `postgres://user:password@host`; the user and the host stay. */
function* connectionPasswords(text: string): Iterable<Finding> {
  for (const match of matches(text, connection, /[A-Za-z0-9+.-]/)) {
    const authority = match[1];
    const at = authority.lastIndexOf("@");
    const colon = authority.indexOf(":");
    if (at < 0 || colon < 0 || colon > at) continue;
    const password = authority.slice(colon + 1, at);
    if (isPlaceholder(decoded(password))) continue;
    const start = match.index + match[0].length - authority.length + colon + 1;
    yield { kind: "connection", start, end: start + password.length, keep: 0, tail: false };
  }
}

/** Two-factor addresses. The seed is `secret=`, base32, or `data=` in a migration address, base64 of several. */
const otpauth = /otpauth(-migration)?:\/\/[^\s"'<>`\\]+/gi;
const base32 = (value: string): boolean => /^[A-Za-z2-7]{16,}$/.test(value.replace(/[\s=]/g, ""));
const base64 = (value: string): boolean => /^[A-Za-z0-9+\/_-]{16,}={0,2}$/.test(value);

function* otpSeeds(text: string): Iterable<Finding> {
  for (const match of text.matchAll(otpauth)) {
    const migration = match[1] !== undefined;
    const parameter = (migration ? /[?&]data=([^&#]+)/i : /[?&]secret=([^&#]+)/i).exec(match[0]);
    if (!parameter || !(migration ? base64 : base32)(decoded(parameter[1]))) continue;
    const start = (match.index ?? 0) + parameter.index + parameter[0].length - parameter[1].length;
    yield { kind: "otp", start, end: start + parameter[1].length, keep: 0, tail: false };
  }
}

/** `"secret": "…"` or `"totp": "…"` in JSON; group 2 is the value. */
const jsonSeed = /"(secret|totp)"\s*:\s*"([^"\\]*)"/gi;
/** Keys an authenticator export keeps next to each seed. */
const otpKeys = /"(?:issuer|issuerName|digits|period|algorithm|algo|timeStep|tokenType)"\s*:/i;
/** How far from a `"secret"` those keys may be: 2FAS keeps them in an `otp` object after it. */
const NEAR = 500;

/**
 * The seeds in an authenticator export (Aegis, 2FAS, LastPass Authenticator, andOTP, Bitwarden): a base32 `secret` with
 * an issuer, digits, period or algorithm near it, or a base32 `totp` (Bitwarden). An otpauth address is `otpSeeds`'s.
 */
function* exportSeeds(text: string): Iterable<Finding> {
  for (const match of text.matchAll(jsonSeed)) {
    const [whole, key, value] = match;
    const index = match.index ?? 0;
    const seed = key.toLowerCase() === "totp"
      ? base32(value) || /^steam:\/\/[A-Za-z2-7]{16,}$/i.test(value)
      : base32(value) && otpKeys.test(text.slice(Math.max(0, index - NEAR), index + whole.length + NEAR));
    if (!seed) continue;
    const start = index + whole.length - 1 - value.length;
    yield { kind: "otp", start, end: start + value.length, keep: 0, tail: false };
  }
}

/**
 * `.env` lines, `export` lines and compose `- KEY=value` lines; group 4 is the value. A value may go unquoted only when
 * `=` has no spaces around it, as in a .env file: `key = value` is code unless the value is a quoted string.
 */
const envLine = /^([ \t]*(?:-[ \t]+)?(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*)([ \t]*=[ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"'#]\S*)/gm;
/** Key names that say the value is a secret, by their last word or two. */
const secretKey = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PASS|PASSPHRASE|API_?KEY|SECRET_?KEY|PRIVATE_?KEY|SECRET_ACCESS_KEY|SIGNING_KEY|ENCRYPTION_KEY|MASTER_KEY|SECRET_KEY_BASE)$/;
/** An unquoted value that is code: a call, an index, an argument, a property such as `settings.API_KEY`. */
const codeValue = /[()[\]{}]|[,;]$|^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function* envValues(text: string): Iterable<Finding> {
  for (const match of text.matchAll(envLine)) {
    const [, lead, key, equals, raw] = match;
    const quoted = raw.startsWith('"') || raw.startsWith("'");
    if (!quoted && equals !== "=") continue;
    const name = key.toUpperCase();
    if (!secretKey.test(name)) continue;
    const value = quoted ? raw.slice(1, -1) : raw;
    if (value.length < 6 || isPlaceholder(value) || value.toUpperCase() === name || (!quoted && codeValue.test(value))) continue;
    const start = (match.index ?? 0) + lead.length + key.length + equals.length + (quoted ? 1 : 0);
    yield { kind: "env", start, end: start + value.length, keep: 0, tail: !/PASS/.test(name) };
  }
}

/** A JSON Web Token: three base64url parts, the first a JSON header with an `alg`. */
const jwtPattern = /(eyJ)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g;

function* jsonWebTokens(text: string): Iterable<Finding> {
  for (const match of matches(text, jwtPattern, WORD_DASH)) {
    let header: unknown;
    try {
      header = JSON.parse(decode(match[0].slice(0, match[0].indexOf("."))) ?? "");
    } catch {
      continue;
    }
    if (typeof (header as { alg?: unknown } | null)?.alg !== "string") continue;
    yield { kind: "jwt", start: match.index, end: match.index + match[0].length, keep: 3, tail: true };
  }
}

// ---- Finding and masking ----

/** Most specific first: where two finds overlap, the earlier one wins, so a token in a .env line keeps its prefix. */
function detectors(options: Options): Detector[] {
  const list: Detector[] = [privateKeys, awsSecrets, prefixed, connectionPasswords, otpSeeds, exportSeeds, envValues];
  if (options.jwt) list.push(jsonWebTokens);
  return list;
}

/** Where a finding that starts at `start` goes in `sorted`, which is in order and has no overlaps. */
function insertionPoint(sorted: Finding[], start: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle].start < start) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Every secret in `text`, in order and without overlaps. With `first`, it stops at the first one. */
export function findSecrets(text: string, options: Options, first = false): Finding[] {
  const found: Finding[] = [];
  for (const detect of detectors(options)) {
    for (const finding of detect(text)) {
      if (finding.end <= finding.start) continue;
      const at = insertionPoint(found, finding.start);
      if ((at > 0 && found[at - 1].end > finding.start) || (at < found.length && found[at].start < finding.end)) continue;
      found.splice(at, 0, finding);
      if (first) return found;
    }
  }
  return found;
}

/** `text` with each secret masked, such as `ghp_••••••••a1b2`: its prefix, and a long token's last four. */
export function maskSecrets(text: string, findings: Finding[]): string {
  let out = "";
  let at = 0;
  for (const finding of findings) {
    const secret = text.slice(finding.start, finding.end);
    const hidden = secret.slice(finding.keep);
    const tail = finding.tail && hidden.length >= 16 ? hidden.slice(-4) : "";
    out += text.slice(at, finding.start) + secret.slice(0, finding.keep) + (finding.fill ?? DOTS + tail);
    at = finding.end;
  }
  return out + text.slice(at);
}

export const captureRules: CaptureRules = {
  // Pure and quick: no yab calls, nothing awaited, nothing logged. What it finds goes nowhere but the masked copy.
  guard: {
    run(item, ctx): CaptureResult {
      const text = item.kind === "link" ? (item.url ?? item.text) : item.text;
      if (!text || text.length > LIMIT) return { keep: true };
      const mask = ctx.preferences.mode === "mask";
      const found = findSecrets(text, { jwt: ctx.preferences.jwt === true }, !mask);
      if (found.length === 0) return { keep: true };
      // Anything but "mask" drops the copy: an unknown value must never keep a secret.
      if (!mask) return { ignore: true };
      return { replace: { text: maskSecrets(text, found) } };
    },
  },
};
