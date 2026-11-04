// The editors whose recent folders and workspaces this extension reads, where each keeps that list, and how it is read.
//
// VS Code and the editors built from it keep the list as JSON under one key of an SQLite database, the one its
// "Open Recent" menu reads (src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts):
//   ~/Library/Application Support/<editor>/User/globalStorage/state.vscdb
// From VS Code 1.118 the key moves, the first time the editor starts, into a database shared with VS Code's Agents
// app, in a folder of the home folder that the editor's product.json names (`sharedDataFolderName`):
//   ~/<shared folder>/sharedStorage/state.vscdb
// The move deletes the key from the old database, so the old one is read first: an editor from before 1.118 still
// keeps its list there, and an editor that is not installed has no old database at all, so its shared folder is never
// looked at. The old database also says when the editor last started, which orders the editors' lists.

export interface Editor {
  /** Stable and short: it starts the ids of the editor's rows. */
  readonly id: string;
  /** The locale key of its name. */
  readonly name: string;
  /** Its folder in ~/Library/Application Support. */
  readonly support: string;
  /** Its shared data folder in the home folder, from VS Code 1.118 on. */
  readonly shared: string;
  /** The command that opens a folder in it, once installed in the PATH from the editor's Command Palette. */
  readonly command: string;
}

// The order breaks ties when two editors' lists are merged, and stands in for their start dates when those are not
// known. VS Code's shared folder is the one its product.json names, VSCodium's the one it inherits from Code - OSS, and VS Code Insiders' the one its own builds use. Cursor and
// Windsurf publish no shared folder yet; theirs follow VS Code's pattern, the data folder's name with "-shared", so
// that they work once those editors move to VS Code 1.118 or later. Until then they keep their list in the old place.
export const EDITORS: readonly Editor[] = [
  { id: "code", name: "editor.code", support: "Code", shared: ".vscode-shared", command: "code" },
  { id: "cursor", name: "editor.cursor", support: "Cursor", shared: ".cursor-shared", command: "cursor" },
  { id: "windsurf", name: "editor.windsurf", support: "Windsurf", shared: ".windsurf-shared", command: "windsurf" },
  { id: "codium", name: "editor.codium", support: "VSCodium", shared: ".vscode-oss-shared", command: "codium" },
  { id: "insiders", name: "editor.insiders", support: "Code - Insiders", shared: ".vscode-insiders-shared", command: "code-insiders" },
];

/** The editor's own folder, which holds its old database and, never in the recent list, its untitled workspaces. */
export const dataFolderOf = (editor: Editor, home: string): string => `${home}/Library/Application Support/${editor.support}`;

/** The database that keeps the list until VS Code 1.118. */
export const oldDatabaseOf = (editor: Editor, home: string): string => `${dataFolderOf(editor, home)}/User/globalStorage/state.vscdb`;

/** The database that keeps it from VS Code 1.118 on. */
export const sharedDatabaseOf = (editor: Editor, home: string): string => `${home}/${editor.shared}/sharedStorage/state.vscdb`;

const KEY = "history.recentlyOpenedPathsList";

/**
 * Written into the old database each time the editor starts, as `new Date().toUTCString()`, whether or not telemetry
 * is on (src/vs/platform/storage/electron-main/storageMain.ts, `updateTelemetryState`). The editors keep no date with
 * their recent lists; this one says which editor was used last.
 */
const STARTED_KEY = "telemetry.currentSessionDate";

/**
 * Three answers, one per line: whether the list is there ("1" or "0"); the date the editor last started, as JSON text
 * (`null` when the database has none: json_quote keeps it on one line); then each of the list's entries that is an
 * object, as one line of JSON, newest first. Values are cast to text because the column is declared BLOB, and JSON
 * functions read a BLOB as binary JSON. The editor keeps at most 500 folders and workspaces and then 500 files; 1000
 * lines take them all. Each statement looks up one key, by the table's index.
 */
export const QUERY =
  `SELECT count(*) FROM ItemTable WHERE key = '${KEY}'; ` +
  `SELECT json_quote((SELECT CAST(value AS TEXT) FROM ItemTable WHERE key = '${STARTED_KEY}')); ` +
  `SELECT json(e.value) FROM ItemTable AS t, json_each(CAST(t.value AS TEXT), '$.entries') AS e ` +
  `WHERE t.key = '${KEY}' AND e.type = 'object' ORDER BY e.key LIMIT 1000;`;

/**
 * sqlite3 opens the database read-only (it can neither change nor create it) and in safe mode (no SQL or dot command
 * that reads or writes other files or runs a program), skips the person's ~/.sqliterc, prints rows one per line
 * without a header, waits up to a second while the editor is writing, and stops at the first error. `--` ends the
 * options, so the database's path is never read as one.
 */
export const SQLITE_OPTIONS: readonly string[] = [
  "-readonly", "-safe", "-batch", "-bail", "-init", "/dev/null", "-noheader", "-list", "-cmd", ".timeout 1000",
];

/** What one database holds: the list's entries, no list, no database, or a database that could not be read. */
export type Reading =
  | { readonly kind: "list"; readonly entries: readonly string[]; readonly started: number | undefined }
  | { readonly kind: "noList"; readonly started: number | undefined }
  | { readonly kind: "noDatabase" }
  | { readonly kind: "failed" };

/** What sqlite3 says when the file is not there, as it says it for any database it cannot open. */
const CANNOT_OPEN = "unable to open database";

/**
 * The database's path as an SQLite URI that opens it as a file nobody changes: no lock, no journal, no -shm file.
 * `%`, `?` and `#` are escaped, so the path is read as a path to its end and no part of it is taken for a parameter.
 */
export const immutableUriOf = (path: string): string =>
  `file://${path.replace(/[%?#]/g, (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`)}?immutable=1`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Date.prototype.toUTCString's form, which the editor writes: "Tue, 03 Nov 2026 09:00:00 GMT". */
const UTC_DATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

/** The time the text names, in milliseconds, or undefined when it is not a date in that form. */
export function utcDateOf(text: string): number | undefined {
  const match = UTC_DATE.exec(text);
  if (match === null) return undefined;
  const [, day = "", monthName = "", year = "", hours = "", minutes = "", seconds = ""] = match;
  const month = MONTHS.indexOf(monthName);
  const [d, h, m, s] = [Number(day), Number(hours), Number(minutes), Number(seconds)];
  if (month === -1 || h > 23 || m > 59 || s > 59) return undefined;
  const time = Date.UTC(Number(year), month, d, h, m, s);
  // Date.UTC rolls an impossible day over into the next month: "31 Feb" is no date.
  return new Date(time).getUTCDate() === d ? time : undefined;
}

/**
 * The date line: `null`, or a JSON string whose date is used when it is one. Undefined when the line is neither,
 * which sqlite3 never prints for this query.
 */
function dateLineOf(line: string | undefined): { started: number | undefined } | undefined {
  if (line === "null") return { started: undefined };
  if (line === undefined || line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) return undefined;
  // A date is 31 characters with its quotes: a longer value is not one, and is not parsed.
  if (line.length > 64) return { started: undefined };
  try {
    const text: unknown = JSON.parse(line);
    return typeof text === "string" ? { started: utcDateOf(text) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * sqlite3 run with the query on one database, named by its path or by a URI. Lines come through `onLine`: an exec
 * result keeps only the last 64 KB of output, less than a long list prints.
 */
async function query(database: string, signal: AbortSignal): Promise<{ failed: boolean; cannotOpen: boolean; lines: string[] }> {
  const lines: string[] = [];
  const result = await yab.exec("sqlite3", [...SQLITE_OPTIONS, "--", database, QUERY], {
    signal,
    onLine: (line, stream) => {
      if (stream === "stdout") lines.push(line);
    },
  });
  return { failed: result.exitCode !== 0, cannotOpen: result.exitCode !== 0 && result.stderr.includes(CANNOT_OPEN), lines };
}

/** The list in the database at `path`, and the date the editor last started. sqlite3's own output never leaves here. */
export async function readDatabase(path: string, signal: AbortSignal): Promise<Reading> {
  let result = await query(path, signal);
  // A database in WAL mode cannot be opened read-only without its -shm file, which is gone whenever no program has
  // the database open, and sqlite3 then says what it says for a missing file. So it is asked once more, for the file
  // as it is on disk: with no -shm file nobody is writing to it, and a missing file is still "unable to open".
  if (result.cannotOpen) result = await query(immutableUriOf(path), signal);
  if (result.failed) return result.cannotOpen ? { kind: "noDatabase" } : { kind: "failed" };
  const [count, dateLine, ...entries] = result.lines;
  const date = dateLineOf(dateLine);
  if (date === undefined) return { kind: "failed" };
  if (count === "1") return { kind: "list", entries, started: date.started };
  if (count === "0" && entries.length === 0) return { kind: "noList", started: date.started };
  return { kind: "failed" };
}

/**
 * What an editor holds: its list and when it last started, no list (it has opened nothing yet), no list where this
 * extension looks (`notFound`: the old database has none and there is no shared one, so the list may have moved), no
 * database (the editor is not installed, or was never started), or a database that could not be read.
 */
export type EditorReading =
  | { readonly kind: "list"; readonly entries: readonly string[]; readonly started: number | undefined }
  | { readonly kind: "noList" }
  | { readonly kind: "notFound" }
  | { readonly kind: "noDatabase" }
  | { readonly kind: "failed" };

/** The editor's list: from its old database, or from the shared one when the old one has none. */
export async function readEditor(editor: Editor, home: string, signal: AbortSignal): Promise<EditorReading> {
  const old = await readDatabase(oldDatabaseOf(editor, home), signal);
  if (old.kind === "list" || old.kind === "noDatabase") return old;
  const shared = await readDatabase(sharedDatabaseOf(editor, home), signal);
  // The start date stays in the old database, wherever the list is.
  if (shared.kind === "list") return { kind: "list", entries: shared.entries, started: old.kind === "noList" ? old.started : undefined };
  if (old.kind === "failed" || shared.kind === "failed") return { kind: "failed" };
  return shared.kind === "noDatabase" ? { kind: "notFound" } : { kind: "noList" };
}
