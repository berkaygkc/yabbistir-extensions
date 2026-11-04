# Recent Projects

The folders and workspaces you opened lately in VS Code, Cursor, Windsurf, VSCodium or VS Code Insiders, as a column in yabbistir's panel. Each row shows the project's name, the editor and where it is. ↵ pastes the project's path, ⇧↵ pastes the editor's command that opens it, and ⌘C copies the path.

## Example

You are in a terminal and want to `cd` into a project you had open in VS Code this morning. Open the panel, move to the *Recent projects* column and type `shop`:

| Row | Second line |
|---|---|
| shop | VS Code · ~/dev/shop |
| shop-admin | Cursor · ~/clients/Shop Admin |

Press ↵ on *shop* and `/Users/you/dev/shop` is pasted after your `cd `. Press ⇧↵ instead and the command that opens it in its editor is pasted, ready to run:

```sh
code /Users/you/dev/shop
cursor '/Users/you/clients/Shop Admin'
```

A path with spaces or other characters a shell treats specially is put in single quotes in the command. The path ↵ pastes is always as it is, for a chat, a file dialog or a quoted argument.

## What is listed

- **Folders and workspaces** (`.code-workspace` files), never single files. A workspace's row shows its name without `.code-workspace`.
- **Up to 50 projects**, newest first. When you use more than one editor, their lists are taken in turns: each editor's newest, then each one's second newest, and so on. The editors keep no dates with their lists, only an order, so this is the closest the column can come to one timeline.
- **Each project once.** A folder you opened in both VS Code and Cursor appears where it is more recent. On your Mac, paths that differ only in letter case or in how an accented letter is stored count as one, as they do on the Mac's disk.
- **Remote projects** too: a folder on an SSH host, in a dev container, through a tunnel or in a codespace. The second line says where it is (*VS Code · SSH: build-box · /home/you/api*). ↵ pastes its path on that machine, and ⇧↵ a command that opens it with the editor's `--folder-uri` (or `--file-uri` for a workspace), for example `code --folder-uri vscode-remote://ssh-remote%2Bbuild-box/home/you/api`.
- **Virtual projects**, such as a GitHub repository opened without cloning it: ↵ pastes its address (`vscode-vfs://github/…`), since it has no path on a disk, and ⇧↵ the command that opens it.

Left out: the editors' untitled workspaces, network shares written the Windows way, and any path with a line break or another control character in it, so a pasted path never runs a command on its own in a terminal.

An editor that is not installed, or has not opened anything yet, adds nothing. With no projects at all, the column is empty.

## Setup

Nothing to set up for ↵: the column fills as soon as the extension is installed.

For ⇧↵, the editor's command must be in your PATH: `code` for VS Code, `code-insiders` for VS Code Insiders, `cursor` for Cursor, `windsurf` for Windsurf and `codium` for VSCodium. Each editor installs its own: open its Command Palette (⇧⌘P), type `shell command` and choose the command that installs it in PATH ([VS Code's guide](https://code.visualstudio.com/docs/setup/mac#_launch-vs-code-from-the-command-line)). Then open a new terminal window.

## Settings

- **Home folder**: where the editors' data is looked for. It is filled in for you (`~`, your home folder), and there is nothing to change unless you keep your editors' data under another user's folder. The extension needs it because a program it runs gets only an absolute path, and an extension learns the home folder's path from a folder setting like this one. When it is cleared, the column asks you to choose it again.

## Where the lists come from

VS Code and the editors built from it keep the recent list as JSON, under the key `history.recentlyOpenedPathsList`, in an SQLite database. The extension looks in two places for each editor, in this order:

1. `~/Library/Application Support/<editor>/User/globalStorage/state.vscdb`, where the list is kept up to VS Code 1.117, and where each editor keeps its other state. When this file is not there, the editor is not installed and nothing else is read for it.
2. `~/<shared folder>/sharedStorage/state.vscdb`, where VS Code 1.118 and later move the list: `~/.vscode-shared` for VS Code, `~/.vscode-insiders-shared` for VS Code Insiders and `~/.vscode-oss-shared` for VSCodium.

The `<editor>` folders are `Code`, `Code - Insiders`, `Cursor`, `Windsurf` and `VSCodium`. Cursor and Windsurf keep their list in the first place today; for when they move to VS Code 1.118 or later, the extension also looks in `~/.cursor-shared` and `~/.windsurf-shared`, following VS Code's naming.

The list is read again each time the panel opens, so a folder you just opened is there the next time. Nothing is ever written to these files.

Sources: VS Code's [recent list](https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts) and [its format](https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/common/workspaces.ts), the [database's table](https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/storage/node/storage.ts), and the [shared storage](https://github.com/microsoft/vscode/pull/311317) of VS Code 1.118.

## Permissions and privacy

- **exec**, limited to `sqlite3`, which comes with macOS (`/usr/bin/sqlite3`). The extension runs it with fixed options and one fixed query: `-readonly` (it can neither change the database nor create one that is missing), `-safe` (no SQL or command that reads other files, writes files or runs a program), `-init /dev/null` (your `~/.sqliterc` is not read), and `--` before the database's path, so the path is never taken for an option. The path is built from the home folder setting and the fixed names above. yabbistir tells you before install that the extension "Can run these programs on your Mac: sqlite3. They can read and write your files and reach the internet"; this extension uses it only to read the two databases per editor named above.
- **Only the recent list is read.** The query takes the one key above and nothing else from the editors' databases; of each entry it uses the folder's or workspace's address, never its label or any other field.
- **Nothing is stored or sent.** No network permission; nothing is written to the extension's storage or to a file. The last list stays in memory for up to five minutes, so ↵ and ⇧↵ can find a row's project, and yabbistir keeps the rows in memory until the Mac locks or sleeps or the app quits. They never reach yabbistir's history, its search index or the disk.
- **Nothing about your projects is logged.** When an editor's database is there but cannot be read, the Development log says so once, naming only the editor.

## Limits

- The order across editors is by turns, not by time (see *What is listed*).
- Cursor's and Windsurf's shared folders are not published yet. If either moves its list somewhere else than `~/.cursor-shared` or `~/.windsurf-shared`, its projects stop showing until the extension learns the new place.
- A source cannot open a link or an app in yabbistir, so ⇧↵ pastes the command rather than opening the project itself. Run it in a terminal.
- Editors older than VS Code 1.55 kept the list in another shape, and still older ones in another file; those lists are not read.
- The list is read only for the editors above, in their usual folders. An editor started with its own `--user-data-dir` keeps its list elsewhere.
