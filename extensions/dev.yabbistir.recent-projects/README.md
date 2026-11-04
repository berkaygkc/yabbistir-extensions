# Recent Projects

The folders and workspaces you opened lately in VS Code, Cursor, Windsurf, VSCodium or VS Code Insiders, as a column in yabbistir's panel. Each row shows the project's name, the editor and where it is. ↵ pastes the project's path, ⇧↵ pastes the editor's command that opens it, and ⌘C copies the path.

## Example

You are in a terminal and want to `cd` into a project you had open in VS Code this morning. Open the panel, move to the *Recent projects* column and type `shop`:

| Row | Second line |
|---|---|
| shop | VS Code · ~/dev/shop |
| Shop Admin | Cursor · ~/clients/Shop Admin |

Press ↵ on *shop* and `/Users/you/dev/shop` is pasted after your `cd `. Press ⇧↵ instead and the command that opens it in its editor is pasted, ready to run:

```sh
code /Users/you/dev/shop
cursor '/Users/you/clients/Shop Admin'
```

A path with spaces or other characters a shell treats specially is put in single quotes in the command. The path ↵ pastes is always as it is, for a chat, a file dialog or a quoted argument.

## What is listed

- **Folders and workspaces** (`.code-workspace` files), never single files. A workspace's row shows its name without `.code-workspace`.
- **Up to 50 projects**, newest first. When you use more than one editor, their lists are taken in turns, starting with the editor you started last: its newest, then the next editor's newest, then each one's second newest, and so on. The editors keep no date with a list's entries, only an order, but each writes down when it last started; this is the closest the column can come to one timeline. An editor that does not say when it started comes after the others.
- **Each project once.** A folder you opened in both VS Code and Cursor appears once, at the higher of its two places, under the editor you started more recently: that is the editor its second line names and ⇧↵ opens it in. On your Mac, paths that differ only in letter case or in how an accented letter is stored count as one, as they do on the Mac's disk.
- **Remote projects** too: a folder on an SSH host, in a dev container, through a tunnel or in a codespace. The second line says where it is (*VS Code · SSH: build-box · /home/you/api*). ↵ pastes its path on that machine, and ⇧↵ a command that opens it with the editor's `--folder-uri` (or `--file-uri` for a workspace), for example `code --folder-uri vscode-remote://ssh-remote%2Bbuild-box/home/you/api`.
- **Virtual projects**, such as a GitHub repository opened without cloning it. The second line shows its address (*VS Code · vscode-vfs://github/you/site*), without the branch or pull request GitHub writes into it after a `+`. ↵ pastes the whole address, since it has no path on a disk, and ⇧↵ the command that opens it.

Left out: the editors' untitled workspaces, network shares written the Windows way, and any path with a line break or another control character in it, so a pasted path never runs a command on its own in a terminal.

An editor that is not installed, or has not opened anything yet, adds nothing. With no projects at all, the column is empty.

## Setup

Nothing to set up for ↵: the column fills as soon as the extension is installed. `sqlite3` comes with macOS, so there is nothing to install either.

For ⇧↵, the editor's command must be in your PATH: `code` for VS Code, `code-insiders` for VS Code Insiders, `cursor` for Cursor, `windsurf` for Windsurf and `codium` for VSCodium. Each editor installs its own: open its Command Palette (⇧⌘P), type `shell command` and choose the command that installs it in PATH ([VS Code's guide](https://code.visualstudio.com/docs/setup/mac#_launch-vs-code-from-the-command-line)). Then open a new terminal window.

## Settings

- **Home folder**: where the editors' data is looked for. It is filled in for you (`~`, your home folder), and there is nothing to change unless you keep your editors' data under another user's folder. The extension needs it because a program it runs gets only an absolute path, and an extension learns the home folder's path from a folder setting like this one. When it is cleared, the column asks you to choose it again.

## Where the lists come from

VS Code and the editors built from it keep the recent list as JSON, under the key `history.recentlyOpenedPathsList`, in an SQLite database. The extension looks in two places for each editor, in this order:

1. `~/Library/Application Support/<editor>/User/globalStorage/state.vscdb`, where the list is kept up to VS Code 1.117, and where each editor keeps its other state. When this file is not there, the editor is not installed and nothing else is read for it.
2. `~/<shared folder>/sharedStorage/state.vscdb`, where VS Code 1.118 and later move the list: `~/.vscode-shared` for VS Code, `~/.vscode-insiders-shared` for VS Code Insiders and `~/.vscode-oss-shared` for VSCodium.

The `<editor>` folders are `Code`, `Code - Insiders`, `Cursor`, `Windsurf` and `VSCodium`. Cursor and Windsurf keep their list in the first place today; for when they move to VS Code 1.118 or later, the extension also looks in `~/.cursor-shared` and `~/.windsurf-shared`, following VS Code's naming.

From the first database the extension also reads `telemetry.currentSessionDate`: the date the editor last started, which it writes there each time it starts, whatever its telemetry setting. It decides which editor's list comes first.

The lists are read again each time the panel opens, so a folder you just opened is there the next time, and again when you press ↵ or ⇧↵ on a row. Nothing is ever written to these files. An editor that keeps its database in WAL mode leaves it unreadable to a read-only program while the editor is closed; the extension then reads the file as it is on disk.

Sources: VS Code's [recent list](https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts) and [its format](https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/common/workspaces.ts), the [database's table](https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/storage/node/storage.ts), the [start date](https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMain.ts), and the [shared storage](https://github.com/microsoft/vscode/pull/311317) of VS Code 1.118.

## Permissions and privacy

- **exec**, limited to `sqlite3`, which comes with macOS (`/usr/bin/sqlite3`). The extension runs it with fixed options and one fixed query: `-readonly` (it can neither change the database nor create one that is missing), `-safe` (no SQL or command that reads other files, writes files or runs a program), `-init /dev/null` (your `~/.sqliterc` is not read), and `--` before the database's path, so the path is never taken for an option. When a database cannot be opened that way, it is asked for once more as `file:…?immutable=1`, still read-only, which opens a WAL database whose editor is closed; a missing database stays missing. The path is built from the home folder setting and the fixed names above. yabbistir tells you before install that the extension "Can run these programs on your Mac: sqlite3. They can read and write your files and reach the internet"; this extension uses it only to read the two databases per editor named above.
- **Only the recent list and the start date are read.** The query takes the two keys above and nothing else from the editors' databases; of each entry it uses the folder's or workspace's address, never its label or any other field.
- **Nothing is stored or sent.** No network permission; nothing is written to the extension's storage or to a file, and the extension keeps nothing in memory between calls: ↵ and ⇧↵ read the row's editor's list again to find its project. yabbistir keeps the rows in memory until the Mac locks or sleeps or the app quits. They never reach yabbistir's history, its search index or the disk.
- **Nothing about your projects is logged.** The Development log says once, naming only the editor, when an editor's database is there but cannot be read, and when an editor's database holds no recent list and it has no shared one, which can mean that its list moved somewhere this version does not know.

## Limits

- The order across editors is by turns, the editor started last first, not by the time each project was opened (see *What is listed*). An editor left running for days counts from the day it started.
- Cursor's and Windsurf's shared folders are not published yet. If either moves its list somewhere else than `~/.cursor-shared` or `~/.windsurf-shared`, its projects stop showing until the extension learns the new place, and the Development log says that no recent list was found for it. The editor's `product.json` names the place (`sharedDataFolderName`, in `/Applications/Cursor.app/Contents/Resources/app/product.json` for Cursor).
- A source cannot open a link or an app in yabbistir, so ⇧↵ pastes the command rather than opening the project itself. Run it in a terminal.
- Editors older than VS Code 1.55 kept the list in another shape, and still older ones in another file; those lists are not read.
- The list is read only for the editors above, in their usual folders. An editor started with its own `--user-data-dir` keeps its list elsewhere.
