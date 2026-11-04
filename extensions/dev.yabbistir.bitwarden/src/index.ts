import type { Context, SourceListing, SourceRow, Sources, SourceValue } from "@yabbistir/api";

// Bitwarden logins as two columns, through bw: one pastes a password (↵) or a username (⇧↵), the other a TOTP code.
// A source has at most two actions, hence the second column. bw can read the whole vault, so this file holds itself
// to the sources rules: a value lives only in its `run` call (never logged, cached, stored or put in an error), the
// session key only reaches bw's --session option, the rows live only in a module variable for a few minutes, and
// bw's output never reaches a message.

/** How long a listing is reused. */
const LIFETIME = 5 * 60_000;
/** The app cuts a source's call off at 10 seconds; stopping bw a little earlier lets the person read why. */
const DEADLINE = 9_000;
/** Bitwarden's item type for logins; the others (notes, cards, identities, SSH keys) hold nothing to paste here. */
const LOGIN = 1;
/** Bitwarden's item ids. bw treats anything else given to `get` as a search, which could find another item. */
const GUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/**
 * What `bw unlock --raw` prints: a 64-byte key in Base64, 88 characters. Nothing else, a master password typed
 * there by mistake included, ever reaches bw's command line, and the key can never be read as an option.
 */
const SESSION_KEY = /^[A-Za-z0-9+/]{86}==$/;
/** The key inside the line `bw unlock` prints without --raw: export BW_SESSION="…". */
const EXPORT_LINE = /BW_SESSION\s*=\s*["']?([A-Za-z0-9+/=]+)/;
/** Options on every bw run: never prompt (an empty standard input would hang a prompt), and answer in JSON. */
const QUIET_JSON = ["--nointeraction", "--response"];
const UNLOCK = "bw unlock --raw";
const LOGIN_COMMAND = "bw login --raw";
/** What the app turns into a space in a row's title, and what it trims from its ends after that. */
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const EDGE_SPACE = /^[\p{Z}\t-\r\u0085]+|[\p{Z}\t-\r\u0085]+$/gu;
const BLANK = /^\p{White_Space}*$/u;
/** A host name, Unicode letters allowed. */
const HOST = /^[\p{L}\p{M}\p{N}-]+(\.[\p{L}\p{M}\p{N}-]+)*$/u;
/** A host typed without a scheme looks like one: a dotted name ending in letters, an IPv4 address or localhost. */
const BARE_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[\p{L}\p{M}\p{N}-]+(\.[\p{L}\p{M}\p{N}-]+)*\.\p{L}[\p{L}\p{M}\p{N}-]*)$/u;

/** A login as a row needs it. Nothing else of the item is kept: no password, no TOTP key, no notes, no URI. */
interface Entry {
  id: string;
  title: string;
  subtitle?: string;
  favorite: boolean;
  /** Whether the item has a TOTP key, never the key itself. */
  hasTotp: boolean;
  /** Whether Bitwarden asks for the master password before its password or code is used. */
  reprompt: boolean;
}

type Lock = "unauthenticated" | "locked";
type Status = "unlocked" | Lock;

// The helper's memory only, never yab.storage or a file: the last logins, and a fingerprint of the key that read
// them (never the key).
let cached: { at: number; print: string; entries: Entry[] } | undefined;

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const oneLine = (text: string): string => text.replace(LINE_BREAKS, " ").replace(EDGE_SPACE, "");

/** The session key from Settings: the key itself, or why there is none. */
function session(): { key: string } | { missing: "none" | "invalid" } {
  const text = yab.secrets.get("session") ?? "";
  if (text.trim() === "") return { missing: "none" };
  const key = (EXPORT_LINE.exec(text)?.[1] ?? text).trim();
  return SESSION_KEY.test(key) ? { key } : { missing: "invalid" };
}

/** 64-bit FNV-1a of the key: tells one key from another, and gives nothing of the key back. */
function fingerprint(key: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(key)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16);
}

/** Whether the cached logins came from this key, a short while ago. */
function fresh(print: string): boolean {
  if (cached === undefined || cached.print !== print) return false;
  const age = Date.now() - cached.at;
  return age >= 0 && age <= LIFETIME;
}

/**
 * A signal that aborts when the call's does, or once DEADLINE has passed; `late()` says whether the deadline did it.
 * `end()` must follow, so no timer outlives the call.
 */
function deadline(outer: AbortSignal) {
  const controller = new AbortController();
  let passed = false;
  const follow = () => controller.abort(outer.reason);
  if (outer.aborted) follow();
  else outer.addEventListener("abort", follow);
  const timer = setTimeout(() => {
    passed = true;
    controller.abort();
  }, DEADLINE);
  return {
    signal: controller.signal,
    late: () => passed && !outer.aborted,
    end() {
      clearTimeout(timer);
      outer.removeEventListener("abort", follow);
    },
  };
}

interface Flight {
  promise: Promise<unknown>;
  controller: AbortController;
  waiters: number;
  late: boolean;
}
/** The bw runs both columns are waiting for, by what they ask. */
const flights = new Map<string, Flight>();

/**
 * `work` under `name`, or the run of it already going: when the panel opens, both columns list at once and share one
 * bw. The run has its own deadline and stops only when every call waiting for it has gone, so one column's cancel
 * never stops the other's answer.
 */
function shared<T>(name: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let flight = flights.get(name);
  if (flight === undefined) {
    const controller = new AbortController();
    const started: Flight = { promise: Promise.resolve(), controller, waiters: 0, late: false };
    const timer = setTimeout(() => {
      started.late = true;
      controller.abort();
    }, DEADLINE);
    started.promise = work(controller.signal).finally(() => {
      clearTimeout(timer);
      if (flights.get(name) === started) flights.delete(name);
    });
    // Its failure reaches every waiter; with none left, it goes nowhere.
    started.promise.catch(() => undefined);
    flights.set(name, started);
    flight = started;
  }
  const joined = flight;
  joined.waiters++;
  return new Promise<T>((resolve, reject) => {
    let left = false;
    const leave = () => {
      if (left) return false;
      left = true;
      signal.removeEventListener("abort", cancel);
      joined.waiters--;
      return true;
    };
    function cancel() {
      if (!leave()) return;
      if (joined.waiters === 0) joined.controller.abort();
      reject(signal.reason);
    }
    if (signal.aborted) return cancel();
    signal.addEventListener("abort", cancel);
    joined.promise.then(
      (value) => {
        if (leave()) resolve(value as T);
      },
      (error: unknown) => {
        if (leave()) reject(joined.late ? new Error(yab.t("slow")) : error);
      },
    );
  });
}

/**
 * `shared`, once more when the run this call joined was another call's, and ended with that call: the app stops a
 * call's programs when it ends, so a cancelled column takes its bw with it.
 */
async function together<T>(name: string, ctx: Context, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await shared(name, ctx.signal, work);
  } catch (error) {
    const code = isObject(error) ? error.code : undefined;
    if (ctx.signal.aborted || (code !== "cancelled" && code !== "timeout")) throw error;
    return await shared(name, ctx.signal, work);
  }
}

/** What bw answered with --response: its data, or its own message (only ever matched, never shown or logged). */
type Answer = { ok: true; data: unknown } | { ok: false; message: string };

/**
 * Runs bw with fixed options and reads its JSON answer, or undefined when there is none to trust. bw prints it on one
 * line, heard through onLine: an exec result keeps only the last 64 KB, less than a large vault prints.
 */
async function bw(command: string[], key: string | undefined, signal: AbortSignal): Promise<Answer | undefined> {
  const lines: string[] = [];
  const args = [...command, ...(key === undefined ? [] : ["--session", key]), ...QUIET_JSON];
  const result = await yab.exec("bw", args, {
    signal,
    onLine: (line, stream) => {
      if (stream === "stdout") lines.push(line);
    },
  });
  let answer: unknown;
  try {
    answer = JSON.parse(lines.join("\n"));
  } catch {
    return undefined;
  }
  if (!isObject(answer) || typeof answer.success !== "boolean") return undefined;
  // A success counts only when bw also exited cleanly; a failure's message is read either way.
  if (answer.success) return result.exitCode === 0 ? { ok: true, data: answer.data } : undefined;
  return { ok: false, message: typeof answer.message === "string" ? answer.message : "" };
}

/** `bw status`: whether bw is logged in and the key unlocks it; undefined when unreadable. */
async function statusOf(key: string | undefined, signal: AbortSignal): Promise<Status | undefined> {
  const answer = await bw(["status"], key, signal);
  if (answer === undefined || !answer.ok || !isObject(answer.data)) return undefined;
  const template = isObject(answer.data.template) ? answer.data.template : answer.data;
  const status = template.status;
  return status === "unlocked" || status === "locked" || status === "unauthenticated" ? status : undefined;
}

/** Which lock one of bw's messages names ("You are not logged in.", "Vault is locked."), if any. */
function lockIn(message: string): Lock | undefined {
  if (/not logged in/i.test(message)) return "unauthenticated";
  if (/vault is locked/i.test(message)) return "locked";
  return undefined;
}

const lockedListing = (key: string, command: string): SourceListing => ({ locked: true, message: yab.t(key), command });
/** The calm row for a lock; the rows go with it. */
function lockFor(lock: Lock): SourceListing {
  cached = undefined;
  return lock === "unauthenticated" ? lockedListing("notLoggedIn", LOGIN_COMMAND) : lockedListing("expired", UNLOCK);
}

/**
 * The host of the first web URI: "posta.ornek.dev" for "https://deniz:…@www.posta.ornek.dev:8443/giris?x=1". Only
 * the host: a URI's user, password, path and query never reach a row. Apps' URIs (androidapp://…) have none, and
 * neither has text without a scheme that does not look like a host (a PIN, a note).
 */
function hostOf(uris: unknown): string | undefined {
  if (!Array.isArray(uris)) return undefined;
  for (const entry of uris) {
    let rest = isObject(entry) && typeof entry.uri === "string" ? entry.uri.trim() : "";
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(rest);
    if (scheme !== null) {
      if (!/^https?$/i.test(scheme[1] ?? "")) continue;
      rest = rest.slice(scheme[0].length);
    }
    const authority = rest.split(/[/?#\\]/, 1)[0] ?? "";
    const host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "").replace(/\.$/, "").toLowerCase();
    if ((scheme === null ? BARE_HOST : HOST).test(host)) return host.replace(/^www\.(?=.+\.)/, "");
  }
  return undefined;
}

/** The logins in `bw list items`, each reduced to what its row needs; undefined when the answer is not a list. */
function entriesOf(data: unknown): Entry[] | undefined {
  const items = isObject(data) && Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : undefined;
  if (items === undefined) return undefined;
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isObject(item) || item.type !== LOGIN || item.deletedDate != null) continue;
    const id = typeof item.id === "string" ? item.id : "";
    // Only ids bw reads as ids, once each.
    if (!GUID.test(id) || seen.has(id.toLowerCase())) continue;
    // A name the app would clean down to nothing would fail the whole listing.
    const title = typeof item.name === "string" ? item.name : "";
    if (oneLine(title) === "") continue;
    seen.add(id.toLowerCase());
    const login = isObject(item.login) ? item.login : {};
    const username = typeof login.username === "string" ? oneLine(login.username) : "";
    const host = hostOf(login.uris) ?? "";
    // A login named after its site ("ornek.dev") needs the site only once.
    const site = host === oneLine(title).toLowerCase() ? "" : host;
    const subtitle = [username, site].filter((part) => part !== "").join(" · ");
    entries.push({
      id,
      title,
      ...(subtitle === "" ? {} : { subtitle }),
      favorite: item.favorite === true,
      hasTotp: typeof login.totp === "string" && !BLANK.test(login.totp),
      // Anything but "no re-prompt" counts as one.
      reprompt: item.reprompt !== 0,
    });
  }
  return entries;
}

/** Favorites first, then by name in the app's language; the codes column without the logins it cannot paste. */
function rowsOf(entries: Entry[], codes: boolean, language: string): SourceRow[] {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(language, { sensitivity: "base", numeric: true });
  } catch {
    collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  }
  return entries
    .filter((entry) => !codes || (entry.hasTotp && !entry.reprompt))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, title, subtitle }) => (subtitle === undefined ? { id, title } : { id, title, subtitle }));
}

/** `bw list items`, kept for both columns; or the lock bw answered with instead. */
async function readVault(key: string, print: string, signal: AbortSignal): Promise<Entry[] | Lock> {
  const answer = await bw(["list", "items"], key, signal);
  if (answer !== undefined && !answer.ok) {
    const lock = lockIn(answer.message);
    if (lock !== undefined) {
      cached = undefined;
      return lock;
    }
  }
  const entries = answer?.ok ? entriesOf(answer.data) : undefined;
  if (entries === undefined) throw new Error(yab.t("listFailed"));
  cached = { at: Date.now(), print, entries };
  return entries;
}

/** Both columns' list: every login, or (`codes`) those with a TOTP code to paste. */
async function listing(ctx: Context, codes: boolean): Promise<SourceListing> {
  const given = session();
  if ("missing" in given) {
    cached = undefined;
    if (given.missing === "invalid") return lockedListing("badKey", UNLOCK);
    // No key yet: say whether to log in first or only to unlock.
    const status = await together("status", ctx, (signal) => statusOf(undefined, signal));
    return status === "unauthenticated" ? lockedListing("notLoggedIn", LOGIN_COMMAND) : lockedListing("needsKey", UNLOCK);
  }
  const print = fingerprint(given.key);
  if (fresh(print)) {
    // Rows in hand: only check the lock, which `bw lock`, `bw logout` or a newer `bw unlock` may have set since.
    const status = await together(`status ${print}`, ctx, (signal) => statusOf(given.key, signal));
    if (status === undefined) throw new Error(yab.t("listFailed"));
    if (status !== "unlocked") return lockFor(status);
    if (cached !== undefined && fresh(print)) return { rows: rowsOf(cached.entries, codes, ctx.language) };
  }
  // One bw run: the listing answers for the lock itself.
  const vault = await together(`list ${print}`, ctx, (signal) => readVault(given.key, print, signal));
  return typeof vault === "string" ? lockFor(vault) : { rows: rowsOf(vault, codes, ctx.language) };
}

/** The error for a bw run that gave no value: in the person's words, never bw's. */
function failure(answer: Answer | undefined, fallback: string): Error {
  if (answer === undefined || answer.ok) return new Error(yab.t(fallback));
  const lock = lockIn(answer.message);
  if (lock !== undefined) {
    cached = undefined;
    return new Error(yab.t(lock === "unauthenticated" ? "notLoggedIn" : "expired"));
  }
  const known: Array<[string, string]> = [
    ["Not found.", "gone"],
    ["No username available", "noUsername"],
    ["No password available", "noPassword"],
    ["No TOTP available", "noTotp"],
    ["Premium status is required", "premium"],
  ];
  const match = known.find(([text]) => answer.message.startsWith(text));
  return new Error(yab.t(match?.[1] ?? fallback));
}

/** The string bw answered with (`get username`, `get totp`), exactly as it is. */
function valueOf(answer: Answer | undefined, empty: string, fallback: string): string {
  if (answer === undefined || !answer.ok) throw failure(answer, fallback);
  const value = isObject(answer.data) ? answer.data.data : undefined;
  if (typeof value !== "string") throw new Error(yab.t(fallback));
  if (BLANK.test(value)) throw new Error(yab.t(empty));
  return value;
}

/** `bw get item`: the one login, with what decides whether its password and TOTP code may be pasted. */
async function loginOf(id: string, key: string, signal: AbortSignal): Promise<Fields> {
  const answer = await bw(["get", "item", id], key, signal);
  if (answer === undefined || !answer.ok) throw failure(answer, "showFailed");
  const item = answer.data;
  if (!isObject(item) || item.type !== LOGIN || typeof item.id !== "string" || item.id.toLowerCase() !== id.toLowerCase()) {
    throw new Error(yab.t("showFailed"));
  }
  if (item.deletedDate != null) throw new Error(yab.t("gone"));
  // Master password re-prompt: Bitwarden asks for the master password before this item's password or code is used.
  // The app cannot ask for it, so it never pastes them; and when unsure (no field, another value), it refuses too.
  if (item.reprompt !== 0) throw new Error(yab.t("reprompt"));
  return isObject(item.login) ? item.login : {};
}

/** One action's value for one row. */
async function value(rowId: string, actionId: string, ctx: Context, actions: string[]): Promise<SourceValue> {
  // Ids are Bitwarden's own: anything else never reaches bw.
  if (!actions.includes(actionId) || !GUID.test(rowId)) throw new Error(yab.t("showFailed"));
  const given = session();
  if ("missing" in given) {
    cached = undefined;
    throw new Error(yab.t(given.missing === "invalid" ? "badKey" : "needsKey"));
  }
  const time = deadline(ctx.signal);
  try {
    // Never --clip or `bw get … | pbcopy`: the app pastes the value itself, concealed, and gives the clipboard back.
    if (actionId === "username") {
      return { text: valueOf(await bw(["get", "username", rowId], given.key, time.signal), "noUsername", "showFailed") };
    }
    const login = await loginOf(rowId, given.key, time.signal);
    if (actionId === "password") {
      // No password, or one the person may not see (an organization's "hide passwords"): bw gives null.
      if (typeof login.password !== "string" || BLANK.test(login.password)) throw new Error(yab.t("noPassword"));
      return { secret: login.password };
    }
    if (typeof login.totp !== "string" || BLANK.test(login.totp)) throw new Error(yab.t("noTotp"));
    // Only once the item may give one: never a code for a re-prompt item. Two bw runs one after the other, since
    // bw runs at the same time wait for each other's lock on its data file.
    return { secret: valueOf(await bw(["get", "totp", rowId], given.key, time.signal), "totpFailed", "totpFailed") };
  } catch (error) {
    throw time.late() ? new Error(yab.t("slow")) : error;
  } finally {
    time.end();
  }
}

export const sources: Sources = {
  vault: {
    list: (ctx) => listing(ctx, false),
    run: (rowId, actionId, ctx) => value(rowId, actionId, ctx, ["password", "username"]),
  },
  codes: {
    list: (ctx) => listing(ctx, true),
    run: (rowId, actionId, ctx) => value(rowId, actionId, ctx, ["code"]),
  },
};
