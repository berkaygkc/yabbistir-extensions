# Dev Servers

The local servers listening on your Mac, as a column in yabbistir's panel, found with `lsof`. Each row shows the program and its port (`node · 3000`) and, quieter, its process id and address (`pid 4100 · 127.0.0.1`). ↵ pastes `http://localhost:3000`, ⇧↵ pastes `localhost:3000`, and ⌘C copies the link.

## Example

You started a Vite server and forgot its port. Open the panel, move to the *Dev servers* column, type `vite` and press ↵: `http://localhost:5173` is pasted.

A program that listens on both IPv4 and IPv6 (`127.0.0.1` and `::1`) on the same port is one row, with both addresses in the subtitle. A listener on every interface shows *all interfaces*. Two processes on one port (a server and its workers) are two rows.

## Setup

None. `lsof` ships with macOS.

## Stopping a server

The extension does not stop processes. A source action cannot ask for confirmation first, and ending a process on a single keypress is too easy to do by mistake. So ⇧↵ pastes `localhost:<port>`, and you stop a server yourself in Terminal, with the pid from the row's subtitle:

```sh
kill 4100
```

`kill` sends SIGTERM, which lets the program shut down cleanly. Use `kill -9` only when it does not.

## Permissions and privacy

- **exec**, limited to `lsof`. The extension runs `lsof -nP +c 0 -iTCP -sTCP:LISTEN -F pcun`, always with these fixed options and no row content. It reads each listening process's name, process id, user id and local address and port. It asks for no network permission and runs no other tool.
- **Only your own processes.** lsof run without `sudo` lists only what you may see, which is your own programs. Processes of root (user id 0) are left out as well.
- **Nothing is kept.** The list is read each time the panel opens, lives in the app's memory, and never reaches the history, a file or a log. A row's id (`<pid>-<port>`) is checked before it becomes a paste.

## Limits

- Only TCP listeners; UDP and Unix sockets are not shown.
- Command names come from lsof as the system reports them; a program that renames itself shows its new name.
- A server may stop between the list and the paste: the link is pasted anyway.
- Programs of macOS itself that run as you (for example Control Center or rapportd) listen on ports too and appear as rows; only root-owned listeners are hidden.
- `lsof` ships with macOS, so the manifest's install note is a sentence rather than a `brew` command.
- Another user's processes that you can see (for example in a shared machine) are not told apart from yours.
