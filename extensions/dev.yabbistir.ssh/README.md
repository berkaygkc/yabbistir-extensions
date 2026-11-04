# SSH Hosts

The hosts in your SSH config as a column in yabbistir's panel. Each row shows a host's alias and, quieter, `user@hostname:port` (parts the config does not set are left out). ↵ pastes `ssh <alias>`, ⇧↵ pastes the full command, and ⌘C copies `ssh <alias>`.

## Example

With this in `~/.ssh/config`:

```text
Host prod-db
    HostName db.example.test
    User deploy
    Port 2222
```

open the panel in Terminal, move to the *SSH Hosts* column and type `prod`. The row reads *prod-db* with `deploy@db.example.test:2222` under it. ↵ pastes `ssh prod-db`; ⇧↵ pastes `ssh deploy@db.example.test -p 2222`. Neither presses Return for you.

## Setup

1. Open Settings → Extensions → SSH Hosts and choose the **SSH folder**. The folder is `.ssh` in your home folder, which macOS hides. In the picker press ⌘⇧. (Command-Shift-Period) to show hidden folders, then choose `.ssh`.
2. Open the panel and move to the SSH Hosts column. Until a folder is chosen, or when it has no `config` file or no hosts, the column says what to do.

## What it reads

- The `config` file in the folder you chose, and nothing else: no keys, no `known_hosts`.
- `Host` blocks, with `HostName`, `User` and `Port`. A `Host` line with several names gives one row each. Patterns (names with `*`, `?` or `!`, such as `Host *`) are skipped, and so are their options. Option names are not case sensitive, `Option=value` works, and values may be in double quotes.
- Like ssh, the first value of an option wins when a host appears twice.
- `Match` blocks are ignored.
- `Include` lines that name a file inside the same folder, relative (`Include work`) or absolute (`Include /Users/you/.ssh/work`), and `~/.ssh/work` when the folder you chose is `.ssh`. Includes inside included files are followed up to eight levels deep.
- **Limit:** a config that is a symlink pointing out of the folder, or cannot be read, counts as missing. Host names with spaces or a leading dash get no row; when that leaves nothing, the column says so.
- **Limit:** the extension cannot list a folder, so a glob such as `Include config.d/*` is not followed; name the files one by one. Files outside the chosen folder are never read.
- Options from `Host *` blocks are not merged into the rows; ssh still applies them when you run the command.

## What is pasted

- ↵ pastes `ssh <alias>`, which uses everything in your config.
- ⇧↵ pastes `ssh user@hostname -p port` using the host's own options (parts that are not set are left out). yabbistir cannot open a link in your terminal (`yab.open` opens only web links, and not from a column), so this is the way to get the details in front of ssh.
- Only plain names reach the pasted line. An alias, host name, user or port with spaces, quotes, `;`, `$` or a leading `-` is not pasted: such an alias gets no row, and for the other values ⇧↵ falls back to `ssh <alias>`. `%h` in a `HostName` is read as the alias; other `%` tokens are not supported.

## Permissions and privacy

None. Reading the folder you chose needs no permission; the app only lets the extension read inside the folder you picked in Settings. The extension cannot write there, runs no program, and uses no network.

Rows stay in memory only; the extension stores nothing and logs nothing. The config is read again each time the panel opens and each time you paste or copy a row.
