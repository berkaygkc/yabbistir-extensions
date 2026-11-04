import type { Sources } from "@yabbistir/api";

/** One host as the config describes it: the alias and the options this extension reads. */
export interface Host {
  alias: string;
  hostName?: string;
  user?: string;
  port?: string;
}

const MAX_FILE_BYTES = 4_000_000;
const MAX_FILES = 64;
const MAX_DEPTH = 8;
const MAX_ALIAS = 200;

/** Splits a line into its words: spaces separate them, double quotes group, an unquoted `#` starts a comment. Linear. */
export function words(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "#") break;
    let word = "";
    let quoted = false;
    while (i < n) {
      const d = line[i];
      if (d === "\"") { quoted = !quoted; i++; continue; }
      if (!quoted && (d === " " || d === "\t" || d === "\r")) break;
      if (d === "\\" && quoted && (line[i + 1] === "\"" || line[i + 1] === "\\")) { word += line[i + 1]; i += 2; continue; }
      word += d;
      i++;
    }
    out.push(word);
  }
  return out;
}

/** The keyword and the value words of a config line, or undefined for a blank line or a comment. `=` may separate them. */
export function splitLine(raw: string): { key: string; args: string[] } | undefined {
  let i = 0;
  const n = raw.length;
  while (i < n && (raw[i] === " " || raw[i] === "\t")) i++;
  if (i >= n || raw[i] === "#" || raw[i] === "\r") return undefined;
  let j = i;
  while (j < n && raw[j] !== " " && raw[j] !== "\t" && raw[j] !== "=" && raw[j] !== "\r") j++;
  const key = raw.slice(i, j).toLowerCase();
  if (key === "") return undefined;
  while (j < n && (raw[j] === " " || raw[j] === "\t")) j++;
  if (raw[j] === "=") j++;
  return { key, args: words(raw.slice(j)) };
}

const SAFE_WORD = /^[A-Za-z0-9_][A-Za-z0-9._@+:%-]*$/;
const SAFE_USER = /^[A-Za-z0-9_][A-Za-z0-9._@+-]*$/;

/** True when a Host pattern is a wildcard, a negation or something that is not one plain name. */
function isPattern(word: string): boolean {
  return word === "" || /[*?!]/.test(word);
}

/** The folder with no trailing slash. */
function trimSlash(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") end--;
  return path.slice(0, end);
}

/** `path` with `.` and `..` resolved; undefined when it climbs above the root. */
function normalize(path: string): string | undefined {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (out.pop() === undefined) return undefined; continue; }
    out.push(part);
  }
  return "/" + out.join("/");
}

/** Where an Include word points inside `folder`, or undefined for a glob, a place outside the folder or anything odd. */
export function includePath(folder: string, word: string): string | undefined {
  if (/[*?[\]{}]/.test(word) || word.includes("\0")) return undefined;
  let target = word;
  if (target.startsWith("~/")) {
    // `~` is the home folder, which this extension does not know; `~/.ssh/x` is the chosen folder's `x` when it is .ssh.
    const rest = target.slice(2);
    if (!folder.endsWith("/.ssh") || !rest.startsWith(".ssh/")) return undefined;
    target = folder + "/" + rest.slice(5);
  } else if (!target.startsWith("/")) {
    target = folder + "/" + target;
  }
  const normal = normalize(target);
  if (normal === undefined || !normal.startsWith(folder + "/")) return undefined;
  return normal;
}

interface Collected {
  hosts: Map<string, Host>;
  files: number;
  /** Names dropped because they are not plain words (spaces, a leading dash). Patterns do not count. */
  skipped: number;
}

function parseText(text: string, folder: string, seen: Set<string>, state: Collected, depth: number): void {
  let current: Host[] = [];
  const lines = text.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const line = k === 0 && lines[0]!.charCodeAt(0) === 0xfeff ? lines[0]!.slice(1) : lines[k]!;
    const parsed = splitLine(line);
    if (parsed === undefined) continue;
    const { key, args } = parsed;
    if (key === "host") {
      current = [];
      for (const name of args) {
        if (isPattern(name)) continue;
        if (name.length > MAX_ALIAS || !SAFE_WORD.test(name)) { state.skipped++; continue; }
        let host = state.hosts.get(name);
        if (host === undefined) { host = { alias: name }; state.hosts.set(name, host); }
        current.push(host);
      }
    } else if (key === "match") {
      current = [];
    } else if (key === "include") {
      if (depth >= MAX_DEPTH) continue;
      for (const word of args) {
        const path = includePath(folder, word);
        if (path === undefined || seen.has(path) || state.files >= MAX_FILES) continue;
        const included = readFile(path);
        if (included === undefined) continue;
        seen.add(path);
        state.files++;
        parseText(included, folder, seen, state, depth + 1);
      }
    } else if (current.length > 0 && args.length > 0) {
      const value = args[0]!;
      for (const host of current) {
        // The first value of an option wins, as it does in ssh.
        if (key === "hostname" && host.hostName === undefined) host.hostName = value;
        else if (key === "user" && host.user === undefined) host.user = value;
        else if (key === "port" && host.port === undefined) host.port = value;
      }
    }
  }
}

/** A file's text, or undefined when it is missing, unreadable or too large. */
function readFile(path: string): string | undefined {
  try {
    if (!yab.files.exists(path)) return undefined;
    const bytes = yab.files.read(path);
    if (bytes.length > MAX_FILE_BYTES) return undefined;
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return undefined;
  }
}

/** Every host in the config text and the files it includes inside `folder`, in the order they first appear. */
export function parseConfig(text: string, folder: string): Host[] {
  return parseAll(text, folder).hosts;
}

function parseAll(text: string, folder: string): { hosts: Host[]; skipped: number } {
  const root = trimSlash(folder);
  const state: Collected = { hosts: new Map(), files: 1, skipped: 0 };
  parseText(text, root, new Set([root + "/config"]), state, 0);
  return { hosts: [...state.hosts.values()], skipped: state.skipped };
}

/** The host name with `%h` read as the alias; undefined when it is not a plain name. */
function hostNameOf(host: Host): string | undefined {
  if (host.hostName === undefined) return undefined;
  const name = host.hostName.replace(/%[h%]/g, (token) => (token === "%h" ? host.alias : "%"));
  return name.length <= 253 && !name.includes("%") && SAFE_WORD.test(name) ? name : undefined;
}

function portOf(host: Host): string | undefined {
  if (host.port === undefined || !/^\d{1,5}$/.test(host.port)) return undefined;
  const port = Number(host.port);
  return port >= 1 && port <= 65535 ? String(port) : undefined;
}

function userOf(host: Host): string | undefined {
  return host.user !== undefined && host.user.length <= 64 && SAFE_USER.test(host.user) ? host.user : undefined;
}

/** `user@hostname:port` with the missing parts left out; undefined when there is nothing beyond the alias. */
export function subtitleOf(host: Host): string | undefined {
  const name = hostNameOf(host);
  const user = userOf(host);
  const port = portOf(host);
  if (user === undefined && port === undefined && (name === undefined || name === host.alias)) return undefined;
  // An IPv6 address has colons of its own, so it is bracketed before the port is added.
  const shown = name ?? host.alias;
  return `${user === undefined ? "" : `${user}@`}${shown.includes(":") ? `[${shown}]` : shown}${port === undefined ? "" : `:${port}`}`;
}

/** `ssh alias`. */
export function aliasCommand(host: Host): string {
  return `ssh ${host.alias}`;
}

/** `ssh user@host -p port`; with nothing else to say it is `ssh alias`. Only checked words reach the line. */
export function fullCommand(host: Host): string {
  const name = hostNameOf(host);
  const user = userOf(host);
  const port = portOf(host);
  if (name === undefined && user === undefined && port === undefined) return aliasCommand(host);
  return `ssh ${user === undefined ? "" : `${user}@`}${name ?? host.alias}${port === undefined ? "" : ` -p ${port}`}`;
}

type Loaded = { hosts: Host[]; skipped: number } | { locked: string };

function load(): Loaded {
  const chosen = yab.preferences.folder;
  if (typeof chosen !== "string" || chosen.trim() === "" || !chosen.startsWith("/")) return { locked: yab.t("noFolder") };
  const folder = trimSlash(chosen);
  const config = folder + "/config";
  let exists = false;
  try { exists = yab.files.exists(config); } catch { exists = false; }
  if (!exists) return { locked: yab.t("noConfig") };
  let bytes: Uint8Array;
  try { bytes = yab.files.read(config); } catch { throw new Error(yab.t("listFailed")); }
  if (bytes.length > MAX_FILE_BYTES) throw new Error(yab.t("listFailed"));
  return parseAll(new TextDecoder("utf-8").decode(bytes), folder);
}

export const sources: Sources = {
  hosts: {
    list() {
      const loaded = load();
      if ("locked" in loaded) return { locked: true, message: loaded.locked };
      if (loaded.hosts.length === 0) return { locked: true, message: yab.t(loaded.skipped > 0 ? "noHostsSkipped" : "noHosts") };
      return { rows: loaded.hosts.map((host) => ({ id: host.alias, title: host.alias, subtitle: subtitleOf(host) })) };
    },
    run(rowId, actionId) {
      const loaded = load();
      // The id is looked up among the hosts the config has; only those reach a pasted line.
      const host = "hosts" in loaded ? loaded.hosts.find((entry) => entry.alias === rowId) : undefined;
      if (host === undefined) throw new Error(yab.t("gone"));
      return { text: actionId === "full" ? fullCommand(host) : aliasCommand(host) };
    },
  },
};
