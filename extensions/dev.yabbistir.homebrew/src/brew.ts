/**
 * What the Homebrew extension asks brew for, and how it reads what brew prints. Pure functions, no `yab` calls.
 *
 * Every regular expression here is linear: no nested or overlapping quantifiers, and the ones over brew's output are
 * anchored at the start of a line.
 */

/** The most names one install runs. */
export const MAX_NAMES = 50;
/** The longest name taken, tap included. */
export const MAX_NAME_LENGTH = 128;

/**
 * A formula's or cask's own name: lowercase letters, digits, `+`, `_` and `-`, and a version after `@` whose dots are
 * each followed by a digit (`python@3.12`, `firefox@developer-edition`). No other dot, so no name is ever a file
 * (`x.rb`, `x.json`, a bottle's `.tar.gz`), a path or a link.
 */
const OWN_NAME = /^[a-z0-9][a-z0-9+_-]*(?:@[a-z0-9][a-z0-9+_-]*(?:\.[0-9][a-z0-9+_-]*)*)?$/;
/** A tap's user or repository: a GitHub name, never `.` or `..`. */
const TAP_PART = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Whether `value` is a package name brew installs from its own taps: `wget`, or `user/tap/name` for a third-party tap. */
export function isPackageName(value: string): boolean {
  if (value.length === 0 || value.length > MAX_NAME_LENGTH) return false;
  const parts = value.split("/");
  if (parts.length === 1) return OWN_NAME.test(value);
  return parts.length === 3 && TAP_PART.test(parts[0]) && TAP_PART.test(parts[1]) && OWN_NAME.test(parts[2]);
}

/** The name without its tap: `terraform` for `hashicorp/tap/terraform`. */
export function shortName(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

/**
 * Whether `value` is a bare package name worth offering an install for: a package name whose own part has a letter
 * after any leading digits and signs, so a copied number such as `2026` is not one.
 */
export function isBareName(value: string): boolean {
  return isPackageName(value) && /^[0-9+_-]*[a-z]/.test(shortName(value));
}

export type InstallCommand =
  | { cask: boolean; names: string[] }
  | { problem: "unsupported" | "noNames" | "tooMany" };

/**
 * A copied `brew install …` command, read the way the action's pattern reads it: an optional `$ ` or `% ` prompt,
 * `brew install`, then package names and `--cask`, anywhere and as often as they come. A backslash at a line's end
 * joins the next line. Anything else (another option, a path, a link, a quote, `;`, `&&`, a second command) makes it
 * unsupported: nothing of it ever reaches brew.
 */
export function parseInstallCommand(text: string): InstallCommand {
  const joined = text.trim().replace(/\\\r?\n/g, " ").replace(/^[$%][ \t]+/, "");
  if (/[\r\n]/.test(joined)) return { problem: "unsupported" };
  const words = joined.split(/[ \t]+/);
  if (words[0] !== "brew" || words[1] !== "install") return { problem: "unsupported" };
  let cask = false;
  const names = new Set<string>();
  for (const word of words.slice(2)) {
    if (word === "--cask") cask = true;
    else if (isPackageName(word)) names.add(word);
    else return { problem: "unsupported" };
  }
  if (names.size === 0) return { problem: "noNames" };
  if (names.size > MAX_NAMES) return { problem: "tooMany" };
  return { cask, names: [...names] };
}

/** brew's arguments for an install: the names after `--`, so none can ever be read as an option. */
export function installArguments(command: { cask: boolean; names: string[] }): string[] {
  return ["install", ...(command.cask ? ["--cask"] : []), "--", ...command.names];
}

/** What a line of brew's output says it is doing, for the job card; null for a line that changes nothing. */
export type Phase =
  | { step: "updating" }
  | { step: "downloading" }
  | { step: "installing"; name?: string }
  | { step: "upgrading"; name: string }
  | { step: "cleaning" };

const INSTALLING = /^==> Installing (?:Cask )?(\S+)$/;
const INSTALLING_DEPENDENCY = /^==> Installing \S+ dependency: (\S+)$/;
const UPGRADING = /^==> Upgrading (\S+)$/;

/** A name from brew's output, shown on the card only when it looks like a package name. */
const shown = (name: string | undefined): string | undefined => (name !== undefined && isPackageName(name) ? name : undefined);

/**
 * The phase a line of brew's output announces. brew prints its steps as "==> …" lines whether or not it writes to a
 * terminal; the auto-update's lines go to standard error, the rest to standard output.
 */
export function phaseOf(line: string): Phase | null {
  if (!line.startsWith("==> ")) return null;
  if (line.startsWith("==> Auto-updating Homebrew")) return { step: "updating" };
  if (line.startsWith("==> Fetching") || line.startsWith("==> Downloading")) return { step: "downloading" };
  if (line.startsWith("==> Running `brew cleanup")) return { step: "cleaning" };
  const installing = INSTALLING.exec(line) ?? INSTALLING_DEPENDENCY.exec(line);
  if (installing !== null) return { step: "installing", name: shown(installing[1]) };
  // "==> Installing dependencies for wget: libidn2, openssl@3"
  if (line.startsWith("==> Installing ")) return { step: "installing" };
  const upgrading = UPGRADING.exec(line);
  if (upgrading !== null) {
    const name = shown(upgrading[1]);
    return name === undefined ? null : { step: "upgrading", name };
  }
  return null;
}

/** Whether a line of brew's output opens its notes after an install ("caveats"), which are never shown here. */
export function isCaveats(line: string): boolean {
  return line.trimEnd() === "==> Caveats";
}

/** The names of a command that brew left as they were, from its "Warning: …" and "Error: …" lines. */
export interface LeftAlone {
  /** Installed already, at the latest version or just not linked: brew installed nothing. */
  already: Set<string>;
  /** Installed already at an older version that brew kept, because the package is pinned or brew.env says so. */
  held: Set<string>;
}

/**
 * The names among `names` that brew said were already installed (Library/Homebrew/install/check.rb,
 * cask/upgrade.rb):
 *
 * - "Warning: wget 1.25.0 is already installed and up-to-date.", "Warning: wget 1.25.0 is already installed, it's just
 *   not linked." or "Warning: Not upgrading firefox, the latest version is already installed": already there;
 * - "Error: wget 1.24.5 is already installed" followed by "To upgrade to 1.25.0, run: …": an older version brew keeps
 *   (pinned, or HOMEBREW_NO_INSTALL_UPGRADE). brew says it with `onoe`, which does not fail the run.
 *
 * A package brew upgrades instead ("is already installed but outdated (so it will be upgraded)") counts as installed.
 */
export function leftAlone(lines: string[], names: string[]): LeftAlone {
  const already = new Set<string>();
  const held = new Set<string>();
  for (const line of lines) {
    const lower = line.toLowerCase();
    const error = lower.startsWith("error:");
    if ((!error && !lower.startsWith("warning:")) || !lower.includes("already installed")) continue;
    if (lower.includes("outdated") || lower.includes("will be upgraded")) continue;
    const words = new Set(line.split(/[\s,;:'"`()]+/));
    for (const name of names) {
      if (!words.has(name) && !words.has(shortName(name))) continue;
      if (error) held.add(name);
      else already.add(name);
    }
  }
  for (const name of held) already.delete(name);
  return { already, held };
}

/** Why a brew run failed, read from what it wrote to standard error; never shown as it is. */
export type Failure = "busy" | "needsPassword" | "notFound" | "offline" | "other";

export function failureOf(stderr: string): Failure {
  const text = stderr.toLowerCase();
  // "A `brew install x` process has already locked …", "Another active Homebrew update process is already in progress."
  if (text.includes("has already locked") || text.includes("another active homebrew")) return "busy";
  // A cask's installer that runs sudo: without a terminal, sudo cannot ask for the password.
  if (text.includes("sudo: ")) return "needsPassword";
  if (["no available formula", "no available cask", "no formulae or casks found", "no formulae found", "no casks found",
    "no cask with this name"].some((phrase) => text.includes(phrase))) return "notFound";
  if (["could not resolve host", "failed to connect", "couldn't connect", "connection timed out", "network is unreachable",
    "download failed", "curl: ("].some((phrase) => text.includes(phrase))) return "offline";
  return "other";
}

/** One outdated package, as `brew outdated --json=v2` describes it. */
export interface Outdated {
  kind: "formula" | "cask";
  /** A formula's full name (`user/tap/name` for a third-party tap), or a cask's token. */
  name: string;
  installed: string[];
  current: string;
  pinned: boolean;
}

/** The JSON object in `text`: all of it, or from the first line that opens an object, in case brew wrote a line before it. */
function jsonObject(text: string): Record<string, unknown> | undefined {
  const attempts = [text];
  const start = text.startsWith("{") ? -1 : text.indexOf("\n{");
  if (start >= 0) attempts.push(text.slice(start + 1));
  for (const attempt of attempts) {
    try {
      const value: unknown = JSON.parse(attempt);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Try the next reading.
    }
  }
  return undefined;
}

/** A version as brew wrote it, on one short line; "" for anything that is not a string or a number. */
function version(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, 64);
}

/**
 * The packages in `brew outdated --json=v2`: `{ "formulae": [{ name, installed_versions, current_version, pinned,
 * pinned_version }], "casks": [the same, with the cask's token as name] }`. Undefined when the text is not that object.
 * An entry without a usable name is left out: its row could not be upgraded safely.
 */
export function parseOutdated(text: string): Outdated[] | undefined {
  const json = jsonObject(text);
  if (json === undefined || (!Array.isArray(json.formulae) && !Array.isArray(json.casks))) return undefined;
  const packages: Outdated[] = [];
  for (const [kind, list] of [["formula", json.formulae], ["cask", json.casks]] as const) {
    if (!Array.isArray(list)) continue;
    for (const entry of list as unknown[]) {
      if (entry === null || typeof entry !== "object") continue;
      const { name, installed_versions: installed, current_version: current, pinned } = entry as Record<string, unknown>;
      if (typeof name !== "string" || !isPackageName(name)) continue;
      const versions = (Array.isArray(installed) ? installed : [installed]).map(version).filter((value) => value !== "");
      packages.push({ kind, name, installed: versions, current: version(current), pinned: pinned === true });
    }
  }
  return packages;
}

/** The package a row is about: enough for `run` to build its command without asking brew again. */
export interface RowPackage {
  kind: "formula" | "cask";
  name: string;
  pinned: boolean;
}

/**
 * A row's id: the package's kind and name, so `run` can tell a formula from a cask of the same name, with `pinned-`
 * before the kind for a pinned package (`pinned-formula:python@3.12`), whose upgrade needs an unpin first.
 */
export function rowID(pkg: RowPackage): string {
  return `${pkg.pinned ? "pinned-" : ""}${pkg.kind}:${pkg.name}`;
}

/** The package a row's id names; undefined for any id this extension did not list. */
export function packageOfRow(id: string): RowPackage | undefined {
  const colon = id.indexOf(":");
  if (colon < 0) return undefined;
  const prefix = id.slice(0, colon);
  const pinned = prefix.startsWith("pinned-");
  const kind = pinned ? prefix.slice("pinned-".length) : prefix;
  const name = id.slice(colon + 1);
  if ((kind !== "formula" && kind !== "cask") || !isPackageName(name)) return undefined;
  return { kind, name, pinned };
}

/**
 * What ↵ pastes: the command that upgrades just this package, with `--cask` for a cask so a formula of the same name is
 * never meant. A pinned package is unpinned first, the command brew itself suggests: `brew upgrade` refuses a pinned
 * one. It is only pasted, never run, so the person sees the unpin before pressing return.
 */
export function upgradeCommand(pkg: RowPackage): string {
  const cask = pkg.kind === "cask" ? "--cask " : "";
  const upgrade = `brew upgrade ${cask}${pkg.name}`;
  return pkg.pinned ? `brew unpin ${cask}${pkg.name} && ${upgrade}` : upgrade;
}

/** brew's arguments for one package's details, which hold its homepage. */
export function infoArguments(pkg: { kind: "formula" | "cask"; name: string }): string[] {
  return ["info", "--json=v2", pkg.kind === "cask" ? "--cask" : "--formula", "--", pkg.name];
}

/**
 * The homepage in `brew info --json=v2`: `{ "formulae": [{ name, full_name, homepage, … }], "casks": [{ token,
 * full_token, homepage, … }] }`. `undefined` when the text is not that object or holds no such package; `null` when the
 * package has no web address for a homepage.
 */
export function homepageOf(text: string, pkg: { kind: "formula" | "cask"; name: string }): string | null | undefined {
  const json = jsonObject(text);
  const list = json?.[pkg.kind === "cask" ? "casks" : "formulae"];
  if (!Array.isArray(list)) return undefined;
  const entries = (list as unknown[]).filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object");
  const names = (entry: Record<string, unknown>) => [entry.name, entry.full_name, entry.token, entry.full_token];
  const entry = entries.find((candidate) => names(candidate).includes(pkg.name)) ?? (entries.length === 1 ? entries[0] : undefined);
  if (entry === undefined) return undefined;
  const homepage = typeof entry.homepage === "string" ? entry.homepage.trim() : "";
  if (homepage === "" || /\s/.test(homepage)) return null;
  try {
    const url = new URL(homepage);
    return url.protocol === "https:" || url.protocol === "http:" ? homepage : null;
  } catch {
    return null;
  }
}
