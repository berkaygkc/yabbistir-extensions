import type { Context, ExecResult, SourceListing, SourceRow, Sources, SourceValue } from "@yabbistir/api";

// 1Password logins as two columns, through op, 1Password's command-line tool, signed in by the 1Password app
// ("Integrate with 1Password CLI"). op can read every vault the app has, so this file holds itself to the sources rules:
// a value lives only in its `run` call (never logged, cached, stored or put in an error), the rows live only in a module
// variable for a few minutes, and op's output never reaches a message: its errors are read only to pick one of ours.

/** `--reveal`, which a field read asks for, came in op 2.30.0. */
const MINIMUM_VERSION = [2, 30, 0];
/** How long a listing is reused, while op still answers for the app without asking. */
const LIFETIME = 5 * 60_000;
/** op is stopped this far into a call: the app cuts `list` and `run` off at 10 seconds. */
export const DEADLINE = 8_500;
/** 1Password's ids are 26 letters and digits. Any letters and digits get through: op never reads them as an option. */
const ITEM_ID = /^[A-Za-z0-9]{1,64}$/;
/** A sign-in address (my.1password.com, with or without https://), or an account or user ID. */
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,254}$/;
/** What a vault's name in Settings may not hold: it reaches op as one argument, on one line. */
const OFF_THE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** What the app turns into a space in a row's title, and what it trims from its ends after that. */
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const EDGE_SPACE = /^[\p{Z}\t-\r\u0085]+|[\p{Z}\t-\r\u0085]+$/gu;
/** A host name as a person reads it: letters, digits, dots and dashes. */
const HOST = /^[\p{L}\p{N}](?:[\p{L}\p{N}.-]*[\p{L}\p{N}])?$/u;

// What op's error says, with the account, vault and id taken out of it first, so that a name never decides.
/** 1Password is locked, or its prompt was dismissed or never answered. */
const LOCKED = /authori[sz]|dismissed|\bunlock|\blocked\b|biometric|touch id/i;
/** op cannot reach the app: the CLI integration is off, the app is not running, or no account is signed in through it. */
const SETUP = /no accounts? configured|not (currently )?signed in|op signin|desktop app|1password app|connect|integrat/i;
const NO_VAULT = /isn[’']t a vault|\bvault\b.*\bnot found|no vault/i;
const NO_ACCOUNT = /\baccount\b.*\b(not found|isn[’']t|unknown|no such)|no account (found|matching|with)/i;
const NO_CODE = /one-time password|\botp\b|totp/i;

/** The fields `run` reads with `op item get --fields`: a Login's own username and password. */
const FIELDS: Record<string, { label: string; purpose: string; empty: string }> = {
  password: { label: "password", purpose: "PASSWORD", empty: "noPassword" },
  username: { label: "username", purpose: "USERNAME", empty: "noUsername" },
};

/** The account and vault chosen in Settings; "" for the account op used last, and for every vault. */
interface Choice {
  account: string;
  vault: string;
}

/** Stops op when its call is cancelled or runs too long, and tells which it was. */
interface Watch {
  readonly signal: AbortSignal;
  late(): boolean;
  stop(reason: unknown): void;
  end(): void;
}

/** One `op item list` for every column that asks while it runs; op stops once none waits for it any more. */
interface Listing {
  readonly key: string;
  readonly watch: Watch;
  readonly done: Promise<SourceListing>;
  waiting: number;
}

// The helper's memory only, never yab.storage or a file: whether op was recent enough once, the last rows, and the
// listing on its way.
let versionChecked = false;
let cached: { key: string; at: number; rows: SourceRow[] } | undefined;
let pending: Listing | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCancelled = (error: unknown): boolean => isRecord(error) && error.code === "cancelled";
/** Text as the app shows it in a row: on one line, its ends trimmed. */
const oneLine = (text: string): string => text.replace(LINE_BREAKS, " ").replace(EDGE_SPACE, "");
const accountFlag = (choice: Choice): string[] => (choice.account === "" ? [] : [`--account=${choice.account}`]);
const vaultFlag = (choice: Choice): string[] => (choice.vault === "" ? [] : [`--vault=${choice.vault}`]);

/** What Settings hold, or the message that says what is wrong with it. One argument each, `--account=…`, so never an option. */
function chosen(preferences: Record<string, unknown>): Choice | string {
  const account = typeof preferences.account === "string" ? preferences.account.trim() : "";
  const vault = typeof preferences.vault === "string" ? preferences.vault.trim() : "";
  if (account !== "" && !ACCOUNT.test(account)) return yab.t("badAccount");
  if (vault.length > 255 || OFF_THE_LINE.test(vault)) return yab.t("badVault");
  return { account, vault };
}

function watch(): Watch {
  const controller = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    controller.abort();
  }, DEADLINE);
  return {
    signal: controller.signal,
    late: () => late,
    stop: (reason) => controller.abort(reason),
    end: () => clearTimeout(timer),
  };
}

/** op's answer, or undefined when the watch stopped it for running too long. Cancelling, and a missing op, go through. */
async function op(args: string[], watch: Watch, onLine?: (line: string, stream: "stdout" | "stderr") => void): Promise<ExecResult | undefined> {
  try {
    return await yab.exec("op", args, onLine === undefined ? { signal: watch.signal } : { signal: watch.signal, onLine });
  } catch (error) {
    if (watch.late()) return undefined;
    throw error;
  }
}

/** Whether `op --version` ("2.32.0") names 2.30.0 or later; false when it names no version. */
function recentEnough(output: string): boolean {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (match === null) return false;
  for (let index = 0; index < MINIMUM_VERSION.length; index++) {
    const part = Number(match[index + 1]);
    if (part !== MINIMUM_VERSION[index]) return part > MINIMUM_VERSION[index];
  }
  return true;
}

/**
 * True once op is recent enough, false while it is not, undefined when it did not say in time. Asked once per helper,
 * and every time until it is, so the column works again after `brew upgrade` without a restart.
 */
async function opIsRecent(watch: Watch): Promise<boolean | undefined> {
  if (versionChecked) return true;
  const version = await op(["--version"], watch);
  if (version === undefined) return undefined;
  if (version.exitCode !== 0 || !recentEnough(version.stdout)) return false;
  versionChecked = true;
  return true;
}

/** op's error without the words that came from Settings or the row, so a vault named "Locked" decides nothing. */
function said(stderr: string, ...names: string[]): string {
  return names.filter((name) => name !== "").reduce((text, name) => text.split(name).join(" "), stderr);
}

/** A locked answer, which the rows go with. */
function locked(message: string, command?: string): SourceListing {
  cached = undefined;
  return command === undefined ? { locked: true, message } : { locked: true, message, command };
}

/** The message for a failed `op item list` that the person can do something about, or undefined. */
function listRefusal(stderr: string, choice: Choice): string | undefined {
  const words = said(stderr, choice.account, choice.vault);
  if (choice.vault !== "" && NO_VAULT.test(words)) return yab.t("unknownVault", { vault: choice.vault });
  if (LOCKED.test(words)) return yab.t("locked");
  if (SETUP.test(words)) return yab.t("setup");
  if (choice.account !== "" && NO_ACCOUNT.test(words)) return yab.t("unknownAccount", { account: choice.account });
  return undefined;
}

/** The message for a failed `op item get`. A lock, or a lost connection to the app, lets the rows go too. */
function runRefusal(stderr: string, choice: Choice, rowId: string, code: boolean): string {
  const words = said(stderr, choice.account, rowId);
  if (code && NO_CODE.test(words)) return yab.t("noCode");
  if (LOCKED.test(words) || SETUP.test(words)) {
    cached = undefined;
    return yab.t(LOCKED.test(words) ? "lockedRun" : "setup");
  }
  if (choice.account !== "" && NO_ACCOUNT.test(words)) return yab.t("unknownAccount", { account: choice.account });
  return yab.t("readFailed");
}

/**
 * A login's website as a person reads it ("ornek.dev"): its primary URL's host, without the scheme, "www.", port or
 * path, and without a user name or password written into the link. Only web links; "" when there is none.
 */
function hostOf(urls: unknown): string {
  if (!Array.isArray(urls)) return "";
  const links = urls.filter((url): url is { href: string; primary?: unknown } => isRecord(url) && typeof url.href === "string");
  const link = links.find((url) => url.primary === true) ?? links[0];
  if (link === undefined) return "";
  let rest = link.href.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (scheme !== null) {
    if (!/^https?$/i.test(scheme[1] ?? "")) return "";
    rest = rest.slice(scheme[0].length);
  }
  const authority = rest.split(/[/?#\\]/, 1)[0] ?? "";
  const host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "").replace(/\.$/, "").toLowerCase().replace(/^www\./, "");
  return HOST.test(host) ? host : "";
}

function collator(): Intl.Collator {
  try {
    return new Intl.Collator(yab.language, { sensitivity: "base", numeric: true });
  } catch {
    return new Intl.Collator("en", { sensitivity: "base", numeric: true });
  }
}

/**
 * The rows of `op item list --format json`: Login items with an id op would take back, titled by their name (or, with
 * none, their website), with the username and the website's host below. Favorites first, then by name. An id listed
 * twice keeps its first row. Throws, in our words only, when the output is not a list.
 */
function rowsOf(json: string): SourceRow[] {
  if (json.trim() === "") return [];
  let items: unknown;
  try {
    items = JSON.parse(json);
  } catch {
    // Never the parser's own message: it quotes the output.
    throw new Error(yab.t("listFailed"));
  }
  if (!Array.isArray(items)) throw new Error(yab.t("listFailed"));
  const seen = new Set<string>();
  const entries: Array<{ row: SourceRow; favorite: boolean }> = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== "string" || !ITEM_ID.test(item.id) || seen.has(item.id)) continue;
    if (typeof item.category !== "string" || item.category.toUpperCase() !== "LOGIN") continue;
    const host = hostOf(item.urls);
    const name = typeof item.title === "string" ? oneLine(item.title) : "";
    const title = name !== "" ? name : host;
    // A row the app would clean down to no title would fail the whole listing.
    if (title === "") continue;
    seen.add(item.id);
    const username = typeof item.additional_information === "string" ? oneLine(item.additional_information) : "";
    const parts = [username, host.toLowerCase() === title.toLowerCase() ? "" : host].filter((part) => part !== "");
    const row: SourceRow = parts.length === 0 ? { id: item.id, title } : { id: item.id, title, subtitle: parts.join(" · ") };
    entries.push({ row, favorite: item.favorite === true });
  }
  const order = collator();
  entries.sort((a, b) => Number(b.favorite) - Number(a.favorite) || order.compare(a.row.title, b.row.title)
    || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
  return entries.map((entry) => entry.row);
}

async function readListing(choice: Choice, key: string, watch: Watch): Promise<SourceListing> {
  const recent = await opIsRecent(watch);
  if (recent === undefined) return locked(yab.t("noAnswer"));
  // A calm row with the command, as for a lock.
  if (!recent) return locked(yab.t("updateNeeded"), "brew upgrade 1password-cli");

  // Rows a few minutes old come back while op still answers for the app: `op whoami` never asks for Touch ID, and
  // fails once 1Password locks or its approval runs out. Then the rows go, and the listing below asks again.
  const age = cached !== undefined && cached.key === key ? Date.now() - cached.at : Infinity;
  if (cached !== undefined && age >= 0 && age <= LIFETIME) {
    const rows = cached.rows;
    const signedIn = await op(["whoami", ...accountFlag(choice)], watch);
    if (signedIn === undefined) return locked(yab.t("noAnswer"));
    if (signedIn.exitCode === 0) return { rows };
  }
  cached = undefined;

  // Every line through onLine: an exec result keeps only the last 64 KB, less than a large vault's JSON. Archived
  // items are left out by op itself.
  const lines: string[] = [];
  const listed = await op(["item", "list", "--categories", "Login", "--format", "json", ...vaultFlag(choice), ...accountFlag(choice)], watch, (line, stream) => {
    if (stream === "stdout") lines.push(line);
  });
  if (listed === undefined) return locked(yab.t("noAnswer"));
  if (listed.exitCode !== 0) {
    const refusal = listRefusal(listed.stderr, choice);
    if (refusal !== undefined) return locked(refusal);
    throw new Error(yab.t("listFailed"));
  }
  const rows = rowsOf(lines.join("\n"));
  cached = { key, at: Date.now(), rows };
  return { rows };
}

/** The listing on its way for these settings, or a new one. Both columns open at once share it, and one prompt. */
function listingFor(choice: Choice, key: string): Listing {
  if (pending !== undefined && pending.key === key) return pending;
  const timer = watch();
  const done = readListing(choice, key, timer).finally(() => {
    timer.end();
    if (pending?.done === done) pending = undefined;
  });
  pending = { key, watch: timer, done, waiting: 0 };
  return pending;
}

/** Waits for a listing on behalf of one call: its cancel lets it go, and op stops when it was the last one waiting. */
function join(listing: Listing, signal: AbortSignal): Promise<SourceListing> {
  return new Promise((resolve, reject) => {
    let waiting = true;
    const leave = (): boolean => {
      if (!waiting) return false;
      waiting = false;
      listing.waiting--;
      signal.removeEventListener("abort", abandon);
      return true;
    };
    const abandon = () => {
      if (!leave()) return;
      if (listing.waiting === 0) listing.watch.stop(signal.reason);
      reject(signal.reason);
    };
    listing.waiting++;
    signal.addEventListener("abort", abandon);
    listing.done.then(
      (answer) => {
        if (leave()) resolve(answer);
      },
      (error: unknown) => {
        if (leave()) reject(error);
      },
    );
  });
}

async function list(ctx: Context): Promise<SourceListing> {
  ctx.signal.throwIfAborted();
  const choice = chosen(ctx.preferences);
  if (typeof choice === "string") return locked(choice);
  const key = JSON.stringify([choice.account, choice.vault]);
  try {
    return await join(listingFor(choice, key), ctx.signal);
  } catch (error) {
    // The op this column waited on was stopped with the other column's call, not with this one: once more.
    if (ctx.signal.aborted || !isCancelled(error)) throw error;
    return await join(listingFor(choice, key), ctx.signal);
  }
}

/** A `--fields … --format json` answer's value: undefined when it is not op's JSON, null when the field is not there. */
function valueOf(stdout: string, field: { label: string; purpose: string }): string | null | undefined {
  if (stdout.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) && !Array.isArray(parsed)) return undefined;
  // Several fields can share the label; the Login's own carries the purpose.
  const fields = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord);
  const chosenField = fields.find((candidate) => candidate.purpose === field.purpose)
    ?? fields.find((candidate) => candidate.id === field.label) ?? fields[0];
  return chosenField !== undefined && typeof chosenField.value === "string" ? chosenField.value : null;
}

/** One row's value for one of `actions`, read by op as the person picks it. */
async function read(rowId: string, actionId: string, ctx: Context, actions: readonly string[]): Promise<SourceValue> {
  // Ids are 1Password's letters and digits, and actions the manifest's: anything else never reaches op.
  if (!actions.includes(actionId) || !ITEM_ID.test(rowId)) throw new Error(yab.t("readFailed"));
  const choice = chosen(ctx.preferences);
  if (typeof choice === "string") throw new Error(choice);
  ctx.signal.throwIfAborted();
  const timer = watch();
  const stop = () => timer.stop(ctx.signal.reason);
  ctx.signal.addEventListener("abort", stop);
  try {
    const recent = await opIsRecent(timer);
    if (recent === undefined) throw new Error(yab.t("noAnswerRun"));
    if (!recent) throw new Error(yab.t("updateNeededRun"));

    const code = actionId === "code";
    const field = FIELDS[actionId];
    // One field, or the current code that `--otp` works out; never the item's other fields. op prints nothing to the
    // clipboard: the app pastes the value itself, concealed, and gives the clipboard back.
    const args = code || field === undefined
      ? ["item", "get", rowId, "--otp", ...accountFlag(choice)]
      : ["item", "get", rowId, "--fields", `label=${field.label}`, "--format", "json", "--reveal", ...accountFlag(choice)];
    const result = await op(args, timer);
    if (result === undefined) throw new Error(yab.t("noAnswerRun"));
    if (result.exitCode !== 0) throw new Error(runRefusal(result.stderr, choice, rowId, code));

    if (code || field === undefined) {
      const value = result.stdout.trim();
      if (value === "") throw new Error(yab.t("noCode"));
      return { secret: value };
    }
    // The value exactly as 1Password keeps it: JSON carries every character, spaces and line ends included.
    const value = valueOf(result.stdout, field);
    if (value === undefined) throw new Error(yab.t("readFailed"));
    if (value === null || value.trim() === "") throw new Error(yab.t(field.empty));
    return actionId === "password" ? { secret: value } : { text: value };
  } finally {
    timer.end();
    ctx.signal.removeEventListener("abort", stop);
  }
}

export const sources: Sources = {
  logins: { list, run: (rowId, actionId, ctx) => read(rowId, actionId, ctx, ["password", "username"]) },
  // Every login again, for its one-time code: a column can only offer the same actions on every row, and op's list
  // does not say which items have a code, so one without says so when it is picked.
  codes: { list, run: (rowId, actionId, ctx) => read(rowId, actionId, ctx, ["code"]) },
};
