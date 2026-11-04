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
/** What `bw unlock --raw` prints: Base64, so never something bw could read as an option. */
const SESSION_KEY = /^[A-Za-z0-9+/]{16,1024}={0,2}$/;
/** The key inside the line `bw unlock` prints without --raw: export BW_SESSION="…". */
const EXPORT_LINE = /BW_SESSION\s*=\s*["']?([A-Za-z0-9+/=]+)/;
/** Options on every bw run: never prompt (an empty standard input would hang a prompt), and answer in JSON. */
const QUIET_JSON = ["--nointeraction", "--response", "--pretty"];
const UNLOCK = "bw unlock --raw";
const LOGIN_COMMAND = "bw login --raw";
/** What the app turns into a space in a row's title, and what it trims from its ends after that. */
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const EDGE_SPACE = /^[\p{Z}\t-\r\u0085]+|[\p{Z}\t-\r\u0085]+$/gu;
const BLANK = /^\p{White_Space}*$/u;

/** A login as a row needs it. Nothing else of the item is kept: no password, no TOTP key, no notes, no URI. */
interface Entry {
  id: string;
  title: string;
  subtitle?: string;
  favorite: boolean;
  hasTotp: boolean;
}

// The helper's memory only, never yab.storage or a file: the last logins, and the account they came from.
let cached: { at: number; user: string; entries: Entry[] } | undefined;

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

/** What bw answered with --response: its data, or its own message (only ever matched, never shown or logged). */
type Answer = { ok: true; data: unknown } | { ok: false; message: string };

/**
 * Runs bw with fixed options and reads its JSON answer, or undefined when there is none to read. Through onLine: an
 * exec result keeps only the last 64 KB, less than a large vault prints. --pretty keeps each line short.
 */
async function bw(command: string[], key: string | undefined, signal: AbortSignal): Promise<Answer | undefined> {
  const lines: string[] = [];
  const args = [...command, ...(key === undefined ? [] : ["--session", key]), ...QUIET_JSON];
  await yab.exec("bw", args, {
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
  // The exit code says no more than `success` does; bw sets both.
  if (!isObject(answer) || typeof answer.success !== "boolean") return undefined;
  if (answer.success) return { ok: true, data: answer.data };
  return { ok: false, message: typeof answer.message === "string" ? answer.message : "" };
}

type Status = "unlocked" | "locked" | "unauthenticated";

/** `bw status`: whether bw is logged in and the key unlocks it, and whose vault it is; undefined when unreadable. */
async function statusOf(key: string | undefined, signal: AbortSignal): Promise<{ status: Status; user: string } | undefined> {
  const answer = await bw(["status"], key, signal);
  if (answer === undefined || !answer.ok || !isObject(answer.data)) return undefined;
  const template = isObject(answer.data.template) ? answer.data.template : answer.data;
  const status = template.status;
  if (status !== "unlocked" && status !== "locked" && status !== "unauthenticated") return undefined;
  return { status, user: typeof template.userId === "string" ? template.userId : "" };
}

/** Which lock one of bw's messages names ("You are not logged in.", "Vault is locked."), if any. */
function lockIn(message: string): "unauthenticated" | "locked" | undefined {
  if (/not logged in/i.test(message)) return "unauthenticated";
  if (/vault is locked/i.test(message)) return "locked";
  return undefined;
}

const lockedListing = (key: string, command: string): SourceListing => ({ locked: true, message: yab.t(key), command });
/** The calm row for a lock; the rows go with it. */
function lockFor(lock: "unauthenticated" | "locked"): SourceListing {
  cached = undefined;
  return lock === "unauthenticated" ? lockedListing("notLoggedIn", LOGIN_COMMAND) : lockedListing("expired", UNLOCK);
}

/**
 * The host of the first web URI: "posta.ornek.dev" for "https://deniz:…@www.posta.ornek.dev:8443/giris?x=1". Only
 * the host: a URI's user, password, path and query never reach a row. Apps' URIs (androidapp://…) have none.
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
    if (/^[\p{L}\p{M}\p{N}-]+(\.[\p{L}\p{M}\p{N}-]+)*$/u.test(host)) return host.replace(/^www\.(?=.+\.)/, "");
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
      // Whether the item has a TOTP key, never the key itself.
      hasTotp: typeof login.totp === "string" && !BLANK.test(login.totp),
    });
  }
  return entries;
}

/** Favorites first, then by name in the app's language. */
function rowsOf(entries: Entry[], language: string): SourceRow[] {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(language, { sensitivity: "base", numeric: true });
  } catch {
    collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  }
  return [...entries]
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, title, subtitle }) => (subtitle === undefined ? { id, title } : { id, title, subtitle }));
}

/** Both columns' list: every login, or (`codes`) only those with a TOTP key. */
async function listing(ctx: Context, codes: boolean): Promise<SourceListing> {
  const given = session();
  if ("missing" in given) cached = undefined;
  if ("missing" in given && given.missing === "invalid") return lockedListing("badKey", UNLOCK);
  const time = deadline(ctx.signal);
  try {
    if ("missing" in given) {
      // No key yet: say whether to log in first or only to unlock.
      const state = await statusOf(undefined, time.signal);
      return state?.status === "unauthenticated" ? lockedListing("notLoggedIn", LOGIN_COMMAND) : lockedListing("needsKey", UNLOCK);
    }
    const state = await statusOf(given.key, time.signal);
    if (state === undefined) throw new Error(yab.t("listFailed"));
    // "locked" with a key: `bw lock`, `bw logout` or a newer `bw unlock` ended it.
    if (state.status !== "unlocked") return lockFor(state.status);

    const age = cached === undefined ? Infinity : Date.now() - cached.at;
    if (cached === undefined || cached.user !== state.user || age < 0 || age > LIFETIME) {
      const answer = await bw(["list", "items"], given.key, time.signal);
      if (answer !== undefined && !answer.ok) {
        const lock = lockIn(answer.message);
        if (lock !== undefined) return lockFor(lock);
      }
      const entries = answer?.ok ? entriesOf(answer.data) : undefined;
      if (entries === undefined) throw new Error(yab.t("listFailed"));
      cached = { at: Date.now(), user: state.user, entries };
    }
    return { rows: rowsOf(codes ? cached.entries.filter((entry) => entry.hasTotp) : cached.entries, ctx.language) };
  } catch (error) {
    throw time.late() ? new Error(yab.t("slow")) : error;
  } finally {
    time.end();
  }
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
  // The app cannot ask for it, so it never pastes them.
  if (item.reprompt !== undefined && item.reprompt !== null && item.reprompt !== 0) throw new Error(yab.t("reprompt"));
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
