import type { SourceRow, Sources } from "@yabbistir/api";

// Docker containers as a column, through the `docker` CLI (Docker Desktop, OrbStack and Colima all provide it).
// A container's name is its row id: names are unique and stay the same across restarts, unlike a container's
// position in the list. Nothing is cached and nothing is stored; docker's output never reaches a message.

/** One JSON object per line, one line per container. */
const PS_ARGS = ["ps", "--format", "{{json .}}"];
/** What docker allows in a container name; it is also what keeps a pasted `docker exec` line free of shell syntax. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Ports shown in a subtitle before "+N". */
const MAX_PORTS = 3;
/** Port lists are short; this keeps a hostile one from costing time. */
const MAX_PORTS_TEXT = 4000;
/** The messages docker prints when it cannot reach its daemon, for Docker Desktop, OrbStack, Colima and plain Linux. */
const DAEMON_DOWN = [
  "cannot connect to the docker daemon",
  "is the docker daemon running",
  "error during connect",
  "error response from daemon: dial unix",
  "docker.sock",
  "docker daemon is not running",
];
/** The user is not allowed to use the socket (not in the docker group): the daemon may well be running. */
const DENIED = "permission denied while trying to connect";

/** A container's real name: `Names` may add link aliases such as "webapp/db", which are not names of it. */
function nameOf(names: unknown): string | undefined {
  if (typeof names !== "string") return undefined;
  const all = names.split(",").map((name) => name.trim()).filter((name) => name !== "");
  const own = all.find((name) => !name.includes("/")) ?? all[0];
  return own !== undefined && NAME.test(own) ? own : undefined;
}

/**
 * `Ports` as a calm line: "0.0.0.0:8080->80/tcp, :::8080->80/tcp, 5432/tcp" becomes "8080→80/tcp, 5432/tcp". The
 * host address is dropped, the IPv4 and IPv6 twins merge, and a long list ends in "+N".
 */
export function portsOf(ports: unknown): string {
  if (typeof ports !== "string") return "";
  const seen = new Set<string>();
  for (const part of ports.slice(0, MAX_PORTS_TEXT).split(",")) {
    const port = part.trim();
    if (port === "") continue;
    const arrow = port.indexOf("->");
    if (arrow < 0) {
      seen.add(port);
      continue;
    }
    const left = port.slice(0, arrow);
    seen.add(`${left.slice(left.lastIndexOf(":") + 1)}→${port.slice(arrow + 2)}`);
  }
  const list = [...seen];
  const shown = list.slice(0, MAX_PORTS).join(", ");
  return list.length > MAX_PORTS ? `${shown} ${yab.t("morePorts", { count: list.length - MAX_PORTS })}` : shown;
}

/** The rows among `docker ps` lines. A line that is not a container is skipped; a repeated name is listed once. */
export function rowsOf(lines: string[]): SourceRow[] {
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    let container: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      container = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const name = nameOf(container.Names);
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
    const subtitle = [text(container.Image), text(container.Status), portsOf(container.Ports)].filter((part) => part !== "").join(" · ");
    rows.push({ id: name, title: name, subtitle: subtitle || undefined });
  }
  return rows;
}

export const sources: Sources = {
  containers: {
    async list(ctx) {
      const all = ctx.preferences.all === true;
      const lines: string[] = [];
      let stderr = "";
      // Through onLine: an exec result keeps only its last 64 KB, which a busy host's listing can pass.
      const result = await yab.exec("docker", all ? [...PS_ARGS, "--all"] : PS_ARGS, {
        signal: ctx.signal,
        onLine: (line, stream) => {
          if (stream === "stdout") lines.push(line);
          else if (stderr.length < 2000) stderr += `${line}\n`;
        },
      });
      if (result.exitCode !== 0) {
        const said = `${stderr}\n${result.stderr}`.toLowerCase();
        if (said.includes(DENIED)) return { locked: true, message: yab.t("denied") };
        if (DAEMON_DOWN.some((text) => said.includes(text))) return { locked: true, message: yab.t("locked") };
        throw new Error(yab.t("listFailed"));
      }
      return { rows: rowsOf(lines) };
    },

    async run(rowId, actionId) {
      // Ids are container names: anything else never becomes a line the person pastes into a terminal.
      if (!NAME.test(rowId)) throw new Error(yab.t("badRow"));
      if (actionId === "name") return { text: rowId };
      if (actionId === "exec") return { text: `docker exec -it ${rowId} sh` };
      throw new Error(yab.t("badRow"));
    },
  },
};
