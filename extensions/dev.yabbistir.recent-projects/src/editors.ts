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
// looked at.

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

// The order breaks ties when two editors' lists are merged. VS Code's shared folder is the one its product.json
// names, VSCodium's the one it inherits from Code - OSS, and VS Code Insiders' the one its own builds use. Cursor and
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
 * Whether the list is there (one line, "1" or "0"), then each of its entries that is an object, as one line of JSON,
 * newest first. The value is cast to text because the column is declared BLOB, and JSON functions read a BLOB as
 * binary JSON. The editor keeps at most 500 folders and workspaces and then 500 files; 1000 lines take them all.
 */
export const QUERY =
  `SELECT count(*) FROM ItemTable WHERE key = '${KEY}'; ` +
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
  | { readonly kind: "list"; readonly entries: readonly string[] }
  | { readonly kind: "noList" }
  | { readonly kind: "noDatabase" }
  | { readonly kind: "failed" };

/** What sqlite3 says when the file is not there, as it says it for any database it cannot open. */
const CANNOT_OPEN = "unable to open database";

/**
 * The list in the database at `path`. Lines come through `onLine`: an exec result keeps only the last 64 KB of output,
 * less than a long list prints. sqlite3's own output never leaves this function.
 */
export async function readDatabase(path: string, signal: AbortSignal): Promise<Reading> {
  const lines: string[] = [];
  const result = await yab.exec("sqlite3", [...SQLITE_OPTIONS, "--", path, QUERY], {
    signal,
    onLine: (line, stream) => {
      if (stream === "stdout") lines.push(line);
    },
  });
  if (result.exitCode !== 0) return result.stderr.includes(CANNOT_OPEN) ? { kind: "noDatabase" } : { kind: "failed" };
  const [count, ...entries] = lines;
  if (count === "1") return { kind: "list", entries };
  if (count === "0" && entries.length === 0) return { kind: "noList" };
  return { kind: "failed" };
}

/**
 * The editor's list: from its old database, or from the shared one when the old one has none. `noDatabase` means the
 * editor is not installed (or was never started); `noList`, that it has opened nothing yet.
 */
export async function readEditor(editor: Editor, home: string, signal: AbortSignal): Promise<Reading> {
  const old = await readDatabase(oldDatabaseOf(editor, home), signal);
  if (old.kind === "list" || old.kind === "noDatabase") return old;
  const shared = await readDatabase(sharedDatabaseOf(editor, home), signal);
  if (shared.kind === "list") return shared;
  return old.kind === "failed" || shared.kind === "failed" ? { kind: "failed" } : { kind: "noList" };
}
