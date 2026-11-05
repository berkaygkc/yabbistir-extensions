import type { SourceRow, Sources } from "@yabbistir/api";

// The TCP ports your Mac is listening on, through lsof. Only the process name, pid, user id and the address and port
// are read (`-F pcun`); nothing is kept: the rows live in the app's memory and the list is read again each time.

/** All listening TCP sockets, in lsof's field format. `+c 0` keeps whole command names (the default cuts them at 9). */
const LSOF_ARGS = ["-nP", "+c", "0", "-iTCP", "-sTCP:LISTEN", "-F", "pcun"];

export interface Listener {
  pid: number;
  command: string;
  port: number;
  /** Distinct addresses of this pid on this port, in the order lsof printed them. */
  addresses: string[];
}

/** lsof writes unusual bytes in a name as `\xHH` (a space is `\x20`); decode them as UTF-8. */
function decodeName(text: string): string {
  if (!text.includes("\\x")) return text;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < text.length; ) {
    const hex = text[index] === "\\" && text[index + 1] === "x" ? text.slice(index + 2, index + 4) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      index += 4;
    } else {
      const point = text.codePointAt(index) ?? 0;
      const char = String.fromCodePoint(point);
      bytes.push(...encoder.encode(char));
      index += char.length;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `127.0.0.1:3000`, `*:3000`, `[::1]:3000` -> its address and port; undefined for anything else. */
function endpoint(name: string): { address: string; port: number } | undefined {
  const match = /^(\*|\[[0-9A-Fa-f:.%A-Za-z0-9]+\]|[0-9.]+):(\d{1,5})$/.exec(name);
  if (match === null) return undefined;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return undefined;
  const raw = match[1] ?? "";
  const address = raw.startsWith("[") ? raw.slice(1, -1) : raw;
  return { address, port };
}

/**
 * The listeners in `lsof -F pcun` output: a `p` line starts a process (its `c` command and `u` user id follow), every
 * `n` line is one socket's local address and port. A pid's IPv4 and IPv6 sockets on one port become one listener.
 * Processes of root (uid 0) and lines that are not understood are skipped.
 */
export function parseListeners(output: string): Listener[] {
  const found = new Map<string, Listener>();
  let pid = 0;
  let command = "";
  let skip = true;
  for (const line of output.split("\n")) {
    const tag = line[0];
    const value = line.slice(1).replace(/\r$/, "");
    if (tag === "p") {
      pid = /^\d+$/.test(value) ? Number(value) : 0;
      command = "";
      skip = pid <= 0;
    } else if (tag === "c") {
      command = decodeName(value);
    } else if (tag === "u") {
      if (value === "0") skip = true;
    } else if (tag === "n" && !skip) {
      // "127.0.0.1:3000" for a listener; a connection would read "a:1->b:2", which `endpoint` refuses.
      const where = endpoint(value);
      if (where === undefined) continue;
      const key = `${pid}-${where.port}`;
      const existing = found.get(key);
      if (existing === undefined) found.set(key, { pid, command, port: where.port, addresses: [where.address] });
      else if (!existing.addresses.includes(where.address)) existing.addresses.push(where.address);
    }
  }
  return [...found.values()]
    .map((entry) => ({ ...entry, command: entry.command.replace(/[\u0000-\u001f\u007f]/g, " ").trim() }))
    .sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/** The addresses as a person reads them: `*` is every interface, and two wildcards (IPv4 and IPv6) are one. */
function addressText(addresses: string[]): string {
  const names = addresses.map((address) => (address === "*" ? yab.t("allInterfaces") : address));
  return [...new Set(names)].join(", ");
}

export function rowsOf(listeners: Listener[]): SourceRow[] {
  return listeners.map((listener) => ({
    id: `${listener.pid}-${listener.port}`,
    title: `${listener.command === "" ? "?" : listener.command} · ${listener.port}`,
    subtitle: `pid ${listener.pid} · ${addressText(listener.addresses)}`,
  }));
}

export const sources: Sources = {
  servers: {
    async list(ctx) {
      let output = "";
      const result = await yab.exec("lsof", LSOF_ARGS, {
        signal: ctx.signal,
        onLine: (line, stream) => {
          if (stream === "stdout") output += `${line}\n`;
        },
      });
      // lsof exits 1 when nothing listens (it prints nothing) or when it only warned (rows are still printed); more is a failure.
      if (result.exitCode > 1) throw new Error(yab.t("listFailed"));
      return { rows: rowsOf(parseListeners(output)) };
    },

    run(rowId, actionId) {
      // Ids are "<pid>-<port>" made here; anything else is not ours.
      const match = /^(\d+)-(\d{1,5})$/.exec(rowId);
      const port = match === null ? 0 : Number(match[2]);
      if (port < 1 || port > 65535) throw new Error(yab.t("gone"));
      // Stopping a process would need a confirmation, which a source action cannot ask for: ⇧↵ pastes the address.
      if (actionId === "address") return { text: `localhost:${port}` };
      if (actionId === "url") return { text: `http://localhost:${port}` };
      throw new Error(yab.t("gone"));
    },
  },
};
