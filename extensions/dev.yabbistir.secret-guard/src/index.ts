import type { CaptureResult, CaptureRules } from "@yabbistir/api";

/**
 * The longest copy the rule reads, in UTF-16 code units. The app sends a rule nothing over 256 KB; past this the copy
 * is kept rather than risk the rule's 200 ms.
 */
export const LIMIT = 512 * 1024;

/** A secret in a copy: `text.slice(start, end)`. Only tests read where it is; the rule needs only that there is one. */
export interface Finding {
  /** Which format it is, for tests; never shown. */
  kind: string;
  start: number;
  end: number;
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
 * Where a token may start: at the start of the text, after a character that is not part of a token, or after an escape
 * that ends in a letter or digit, such as `\n` in a JSON string or `%3D` in an address.
 */
const START = String.raw`(?:^|[^A-Za-z0-9_-]|\\[nrt]|%[0-9A-Fa-f]{2})`;

/**
 * A global pattern for a token whose body has no upper bound: `prefix` as group 1, checked to sit where a token may
 * start, then `body`. The check comes right after the prefix, so the search still jumps from prefix to prefix, and a
 * prefix repeated inside one long run is tried once instead of once per repetition: the search stays linear.
 */
function unbounded(prefix: string, body: string): RegExp {
  return new RegExp(`(${prefix})(?<=${START}${prefix})${body}`, "g");
}

/** Whether a token may start at `index`: the character before it is not in `word`, or ends an escape (`\n`, `%3D`). */
function startsHere(text: string, index: number, word: RegExp): boolean {
  if (index === 0 || !word.test(text[index - 1])) return true;
  return /\\[nrt]$|%[0-9A-Fa-f]{2}$/.test(text.slice(Math.max(0, index - 3), index));
}

/**
 * The matches of the global `pattern` that start where a token may (`startsHere`), or right after `after`. After one
 * that does not, the search goes on past the run of `word` characters it starts in: no token can start inside that run,
 * and going on one character at a time would read a long run once per character.
 */
function* matches(text: string, pattern: RegExp, word?: RegExp, after?: string): Iterable<RegExpExecArray> {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (!word || startsHere(text, match.index, word) || (after !== undefined && text.endsWith(after, match.index))) {
      yield match;
      continue;
    }
    let next = match.index + 1;
    while (next < text.length && word.test(text[next])) next++;
    pattern.lastIndex = next;
  }
}

/** Characters a token never starts right after, so `task-…` is never `sk-…`. */
const WORD = /[A-Za-z0-9_]/;
const WORD_DASH = /[A-Za-z0-9_-]/;
const WORD_DASH_DOT = /[A-Za-z0-9_.-]/;

/** Random-looking: capitals and small letters, or letters and digits. A placeholder such as `XXXX` is neither. */
const random = (text: string): boolean => mixed(text) || (/\d/.test(text) && /[A-Za-z]/.test(text));

// ---- Tokens with a prefix ----
// Group 1 of each pattern is the prefix; `check` looks at what follows it. A pattern's end keeps a token from ending
// inside a longer word, and `before` keeps it from starting inside one.

interface Token {
  kind: string;
  pattern: RegExp;
  before?: RegExp;
  /** Where else a token may start: right after this text (Telegram's `/bot`). */
  after?: string;
  /** Checks the part after the prefix. */
  check?: (body: string) => boolean;
}

const tokens: Token[] = [
  { kind: "github", pattern: /(gh[pousr]_)[A-Za-z0-9]{36,251}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  { kind: "github", pattern: /(github_pat_)[A-Za-z0-9_]{36,244}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  { kind: "gitlab", pattern: unbounded(String.raw`gl(?:pat|dt|rtr?|ptt|oas|soat)-`, String.raw`[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)*(?![A-Za-z0-9_-])`),
    before: WORD_DASH, check: mixed },
  // Bot, user, app, refresh and workflow tokens: a number, then a few dash-separated parts, the last one long and random.
  { kind: "slack", pattern: unbounded(String.raw`(?:xoxe\.)?(?:xox[abposre]|xapp|xwfp)-`, String.raw`\d+-(?:[A-Za-z0-9]+-){0,6}[A-Za-z0-9]{10,}(?![A-Za-z0-9])`),
    before: WORD_DASH_DOT },
  // A webhook's last part is its secret; the documentation's `XXXXXXXXXXXXXXXXXXXXXXXX` is not.
  { kind: "slack", pattern: /((?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9_\/-]*[A-Za-z0-9]/g,
    check: (body) => { const last = body.slice(body.lastIndexOf("/") + 1); return last.length >= 16 && random(last) && !isPlaceholder(last); } },
  { kind: "stripe", pattern: /([rs]k_(?:live|test)_)[A-Za-z0-9]{20,247}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  { kind: "google", pattern: /(AIza)[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, before: WORD_DASH, check: mixed },
  { kind: "anthropic", pattern: unbounded(String.raw`sk-ant-(?:[a-z]+\d*-)?`, String.raw`[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])`), before: WORD_DASH, check: mixed },
  { kind: "openai", pattern: unbounded(String.raw`sk-(?:proj|svcacct|admin)-`, String.raw`[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])`), before: WORD_DASH, check: mixed },
  // The older keys: sk- and exactly 48 letters and digits.
  { kind: "openai", pattern: /(sk-)[A-Za-z0-9]{48}(?![A-Za-z0-9_-])/g, before: WORD_DASH, check: mixed },
  { kind: "npm", pattern: /(npm_)[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g, before: WORD, check: mixed },
  // A PyPI token is a macaroon, whose base64 always starts with AgE.
  { kind: "pypi", pattern: unbounded("pypi-", String.raw`AgE[A-Za-z0-9_-]{50,}(?![A-Za-z0-9_-])`), before: WORD_DASH },
  { kind: "sendgrid", pattern: /(SG\.)[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, before: WORD_DASH },
  { kind: "twilio", pattern: /(SK)[0-9a-fA-F]{32}(?![A-Za-z0-9_])/g, before: WORD },
  // AWS's own documentation ends its sample keys with EXAMPLE. A presigned S3 link carries a key id too, and is dropped:
  // it opens the object for anyone until it expires.
  { kind: "aws", pattern: /(AKIA|ASIA)[A-Z2-7]{16}(?![A-Za-z0-9_])/g, before: WORD, check: (body) => !body.endsWith("EXAMPLE") },
  // A Discord bot token starts with the bot's id, 17 to 20 digits, in base64.
  { kind: "discord", pattern: /()[MNO][A-Za-z0-9]{22,26}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{25,40}(?![A-Za-z0-9_-])/g, before: WORD_DASH_DOT,
    check: (body) => /^\d{17,20}$/.test(decode(body.slice(0, body.indexOf("."))) ?? "") },
  // A Telegram bot token: the bot's id, a colon, and 35 characters that start with A. In the Bot API's addresses it
  // follows `/bot`.
  { kind: "telegram", pattern: /(\d{5,16}:)A[A-Za-z0-9_-]{34}(?![A-Za-z0-9_-])/g, before: /[A-Za-z0-9_:]/, after: "/bot", check: mixed },
];

function* prefixed(text: string): Iterable<Finding> {
  for (const token of tokens) {
    for (const match of matches(text, token.pattern, token.before, token.after)) {
      if (token.check && !token.check(match[0].slice(match[1].length))) continue;
      yield { kind: token.kind, start: match.index, end: match.index + match[0].length };
    }
  }
}

// ---- Private keys ----

const pemBegin = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY( BLOCK)?-----/g;
/** The lines of a key whose END line was not copied: base64, armor headers (`Proc-Type: …`) and blank lines. */
const pemLines = /(?:\r?\n(?:[A-Za-z0-9+\/=]*|[A-Za-z][A-Za-z-]*: [^\r\n]*)(?=\r?\n|$))+/y;
const keyMaterial = /[A-Za-z0-9+\/]{16}/;

/**
 * The body of a private key, between its BEGIN line and the END line that matches it. The next `-----END ` is looked
 * for once, and once none is left it is not looked for again, so the text is read about once however many BEGIN lines
 * it has. A key whose END line was not copied ends with its last line of key material.
 */
function* privateKeys(text: string): Iterable<Finding> {
  /** The next `-----END ` at or after the current BEGIN line; -1 when there is none, -2 before the first look. */
  let end = -2;
  pemBegin.lastIndex = 0;
  for (let match = pemBegin.exec(text); match !== null; match = pemBegin.exec(text)) {
    const start = match.index + match[0].length;
    if (end !== -1 && end < start) end = text.indexOf("-----END ", start);
    const footer = `-----END ${match[1]}PRIVATE KEY${match[2] ?? ""}-----`;
    if (end >= 0 && text.startsWith(footer, end)) {
      if (keyMaterial.test(text.slice(start, end))) yield { kind: "privateKey", start, end };
      pemBegin.lastIndex = end + footer.length;
      continue;
    }
    pemLines.lastIndex = start;
    const lines = pemLines.exec(text)?.[0].trimEnd() ?? "";
    if (keyMaterial.test(lines)) yield { kind: "privateKey", start, end: start + lines.length };
    pemBegin.lastIndex = Math.max(pemBegin.lastIndex, start + lines.length);
  }
}

// ---- Values a label names ----

const placeholderWords = new Set([
  "changeme", "change_me", "change-me", "secret", "password", "passwd", "pass", "token", "apikey", "api_key", "api-key",
  "undefined", "example", "placeholder", "dummy", "redacted", "hidden", "default", "required",
  // Default passwords from documentation and tutorials: PostgreSQL's and MySQL's images, RabbitMQ, Redis's sample.
  "postgres", "root", "guest", "admin", "mysecretpassword", "foobared",
]);

/** A value that only stands in for a secret: empty, a reference, a template, an instruction or a sample. */
export function isPlaceholder(value: string): boolean {
  const text = value.trim();
  if (text === "" || text.startsWith("$") || /\$[{(]|^%\w+%$/.test(text)) return true; // $VAR, ${VAR}, $(command), %VAR%
  if (/^<[^<>]*>$/.test(text) || /^\{\{.*\}\}$/.test(text)) return true; // <password>, {{ secret }}
  if (/^(.)\1*$/.test(text) || /xxxx|\*\*\*|•|\.\.\.|…/i.test(text)) return true; // ******, sk-xxxx, sk_live_…, ••••
  if (/^(?:your|paste|insert|enter|replace|generate|put|add|change)[-_ ]|[-_ ]here$/i.test(text)) return true; // your-api-key, paste_it_here
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
      yield { kind: "aws", start, end: start + match[3].length };
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

/**
 * The password in `postgres://user:password@host`. A sample's password is not one: a placeholder, the user's own name
 * (`guest:guest`), or a password that says it is one (`johndoe:randompassword`).
 */
function* connectionPasswords(text: string): Iterable<Finding> {
  for (const match of matches(text, connection, /[A-Za-z0-9+.-]/)) {
    const authority = match[1];
    const at = authority.lastIndexOf("@");
    const colon = authority.indexOf(":");
    if (at < 0 || colon < 0 || colon > at) continue;
    const password = authority.slice(colon + 1, at);
    const plain = decoded(password);
    if (isPlaceholder(plain) || plain.toLowerCase() === decoded(authority.slice(0, colon)).toLowerCase()) continue;
    if (/password|passwd|secret/i.test(plain)) continue;
    const start = match.index + match[0].length - authority.length + colon + 1;
    yield { kind: "connection", start, end: start + password.length };
  }
}

/** Two-factor addresses. The seed is `secret=`, base32, or `data=` in a migration address, base64 of several. */
const otpauth = /otpauth(-migration)?:\/\/[^\s"'<>`\\]+/gi;
/** The seed in Google's description of otpauth addresses, in countless documents and tests. */
const SAMPLE_SEED = "JBSWY3DP" + "EHPK3PXP";
/** A base32 seed of 16 characters or more, other than the sample. */
const base32 = (value: string): boolean => {
  const seed = value.replace(/[\s=]/g, "");
  return /^[A-Za-z2-7]{16,}$/.test(seed) && seed.toUpperCase() !== SAMPLE_SEED;
};
const base64 = (value: string): boolean => /^[A-Za-z0-9+\/_-]{16,}={0,2}$/.test(value);

function* otpSeeds(text: string): Iterable<Finding> {
  for (const match of text.matchAll(otpauth)) {
    const migration = match[1] !== undefined;
    const parameter = (migration ? /[?&]data=([^&#]+)/i : /[?&]secret=([^&#]+)/i).exec(match[0]);
    if (!parameter || !(migration ? base64 : base32)(decoded(parameter[1]))) continue;
    const start = (match.index ?? 0) + parameter.index + parameter[0].length - parameter[1].length;
    yield { kind: "otp", start, end: start + parameter[1].length };
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
    yield { kind: "otp", start, end: start + value.length };
  }
}

/**
 * `.env` lines, `export` lines and compose `- KEY=value` lines; group 4 is a quoted value, or an unquoted value's first
 * word. A value may go unquoted only when `=` has no spaces around it, as in a .env file: `key = value` is code unless
 * the value is a quoted string. Either way the value must look like a key or a password (`tokenLike`), not like the
 * words a program shows.
 */
const envLine = /^([ \t]*(?:-[ \t]+)?(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*)([ \t]*=[ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s"'#]\S*)/gm;
/** Key names that say the value is a secret, by their last word or two; group 1 is that ending. */
const secretKey = /(?:^|_)(SECRET|TOKEN|PASSWORD|PASSWD|PASS|PASSPHRASE|API_?KEY|SECRET_?KEY|PRIVATE_?KEY|SECRET_ACCESS_KEY|SIGNING_KEY|ENCRYPTION_KEY|MASTER_KEY|SECRET_KEY_BASE)$/;
/** An unquoted value that is code: a call, an index, an argument, a property such as `settings.API_KEY`. */
const codeValue = /[()[\]{}]|[,;]$|^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/**
 * Shaped like a key or a password rather than like words: no spaces, and a digit, a symbol between letters, or a long
 * run that mixes capitals and small letters. `Forgot your password?`, `X-Api-Key` and `#mesondefine` are words.
 */
function tokenLike(value: string): boolean {
  if (/\s/.test(value)) return false;
  return /\d/.test(value) || /[A-Za-z][!@#$%^&*+=\/~|]+[A-Za-z0-9]/.test(value) || (value.length >= 16 && mixed(value) && !/[-.]/.test(value));
}

/**
 * The words of a key's ending that its secret would not spell out: `csrftoken`, `dbpassword`, `supersecret`. Only the
 * whole word counts for a password: `pass` stands alone only for a `…_PASS` key, so `SuperPass2024!` is still a password.
 */
function ownWords(ending: string): string[] {
  const whole = ending.replace(/_/g, "").toLowerCase();
  return [whole, ...["secret", "token"].filter((word) => whole.includes(word))];
}

/**
 * An unquoted value as a whole: the rest of its line, without a ` #` comment and trailing spaces. Read in code, not by
 * a regular expression, so the line is read once.
 */
function unquotedValue(text: string, start: number): string {
  const newline = text.indexOf("\n", start);
  const line = text.slice(start, newline < 0 ? text.length : newline);
  const comment = line.search(/\s#/);
  return (comment < 0 ? line : line.slice(0, comment)).trimEnd();
}

function* envValues(text: string): Iterable<Finding> {
  for (const match of text.matchAll(envLine)) {
    const [, lead, key, equals, raw] = match;
    const quoted = raw.startsWith('"') || raw.startsWith("'");
    if (!quoted && equals !== "=") continue;
    const ending = secretKey.exec(key.toUpperCase())?.[1];
    if (ending === undefined) continue;
    const start = (match.index ?? 0) + lead.length + key.length + equals.length + (quoted ? 1 : 0);
    // An unquoted value with spaces inside, such as `Welcome2026 to the app`, is text: `tokenLike` keeps it.
    const value = quoted ? raw.slice(1, -1) : unquotedValue(text, start);
    if (value.length < 6 || isPlaceholder(value) || !tokenLike(value) || (!quoted && codeValue.test(value))) continue;
    const plain = value.replace(/[-_.]/g, "").toLowerCase();
    if (ownWords(ending).some((word) => plain.includes(word))) continue;
    yield { kind: "env", start, end: start + value.length };
  }
}

/** A JSON Web Token: three base64url parts, the first a JSON header with an `alg`. */
const jwtPattern = unbounded("eyJ", String.raw`[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])`);

function* jsonWebTokens(text: string): Iterable<Finding> {
  for (const match of matches(text, jwtPattern, WORD_DASH)) {
    let header: unknown;
    try {
      header = JSON.parse(decode(match[0].slice(0, match[0].indexOf("."))) ?? "");
    } catch {
      continue;
    }
    if (typeof (header as { alg?: unknown } | null)?.alg !== "string") continue;
    yield { kind: "jwt", start: match.index, end: match.index + match[0].length };
  }
}

// ---- Finding ----

/** Most specific first: where two finds overlap, the earlier one wins, so a token in a .env line counts as the token. */
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

export const captureRules: CaptureRules = {
  // Pure and quick: no yab calls, nothing awaited, nothing logged, and what it finds goes nowhere. A copy with a secret
  // is not stored; the clipboard is left as it is, so the paste the person is making still works.
  guard: {
    run(item, ctx): CaptureResult {
      const text = item.kind === "link" ? (item.url ?? item.text) : item.text;
      if (!text || text.length > LIMIT) return { keep: true };
      const found = findSecrets(text, { jwt: ctx.preferences.jwt === true }, true);
      return found.length > 0 ? { ignore: true } : { keep: true };
    },
  },
};
