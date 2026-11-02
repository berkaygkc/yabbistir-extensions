import type { SourceRow, Sources } from "@yabbistir/api";

// LastPass entries as a column, through lpass. lpass can read the whole vault, so this file holds itself to the
// sources rules: a password lives only in its `run` call (never logged, cached, stored or put in an error), the rows
// live only in a module variable for a few minutes, and lpass's output never reaches a message.

/** lpass before 1.6.2 can no longer connect to LastPass. */
const MINIMUM_VERSION = [1, 6, 2];
/** How long a listing is reused. */
const LIFETIME = 5 * 60_000;
/** One line per entry: its id, name, user name and URL, separated by tabs. */
const LIST_FORMAT = "--format=%ai\t%an\t%au\t%al";
/** lpass reads its local copy of the vault without syncing, and prints plain text. */
const LOCAL_PLAIN = ["--sync=no", "--color=never"];
/** The URLs lpass gives folders and secure notes, which hold no login to paste. */
const NOT_LOGINS = new Set(["http://group", "http://sn"]);
/** What the app turns into a space in a row's title, and what it trims from its ends after that. */
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const EDGE_SPACE = /^[\p{Z}\t-\r\u0085]+|[\p{Z}\t-\r\u0085]+$/gu;

// The helper's memory only, never yab.storage or a file: whether lpass was recent enough once, and the last rows.
let versionChecked = false;
let cached: { at: number; rows: SourceRow[] } | undefined;

/** Whether `lpass --version` names 1.6.2 or later ("LastPass CLI v1.6.2"); false when it names no version. */
function recentEnough(output: string): boolean {
  const match = /\bv(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (match === null) return false;
  for (let index = 0; index < MINIMUM_VERSION.length; index++) {
    const part = Number(match[index + 1]);
    if (part !== MINIMUM_VERSION[index]) return part > MINIMUM_VERSION[index];
  }
  return true;
}

/**
 * The logins among `lpass ls` lines: numbered entries with a name, without folders or secure notes. A line is the id,
 * the name, the username and the URL; a tab in the name only adds fields in the middle, so the id is the first field,
 * the URL the last and the username the one before it. A line break in a name splits its entry over two lines, the
 * second of which may claim any id: every row of an id listed more than once is left out, so a name never carries
 * another entry's id.
 */
function rowsOf(lines: string[]): SourceRow[] {
  const entries: Array<{ id: string; name: string; username: string; url: string }> = [];
  const listed = new Map<string, number>();
  for (const line of lines) {
    const fields = line.split("\t");
    const id = fields[0] ?? "";
    if (/^\d+$/.test(id)) listed.set(id, (listed.get(id) ?? 0) + 1);
    if (fields.length < 4) continue;
    entries.push({ id, name: fields.slice(1, -2).join(" "), username: fields.at(-2) ?? "", url: fields.at(-1) ?? "" });
  }
  const rows: SourceRow[] = [];
  for (const { id, name, username, url } of entries) {
    if (!/^\d+$/.test(id) || id === "0" || listed.get(id) !== 1 || NOT_LOGINS.has(url)) continue;
    // A name the app would clean down to nothing would fail the whole listing.
    if (name.replace(LINE_BREAKS, " ").replace(EDGE_SPACE, "") === "") continue;
    rows.push({ id, title: name, subtitle: username || undefined });
  }
  return rows;
}

/** The value lpass printed: its one trailing newline taken off, every other character kept. */
const printed = (stdout: string): string => (stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout);

export const sources: Sources = {
  vault: {
    async list(ctx) {
      const signal = ctx.signal;
      if (!versionChecked) {
        const version = await yab.exec("lpass", ["--version"], { signal });
        // A calm row with the command, as for a lock. Not remembered, so the column works again after `brew upgrade`
        // without a restart.
        if (version.exitCode !== 0 || !recentEnough(version.stdout)) {
          return { locked: true, message: yab.t("updateNeeded"), command: "brew upgrade lastpass-cli" };
        }
        versionChecked = true;
      }

      // `status -q` never prompts; logging in, with any second factor, happens in Terminal.
      const status = await yab.exec("lpass", ["status", "-q"], { signal });
      if (status.exitCode !== 0) {
        cached = undefined;
        return { locked: true, message: yab.t("locked"), command: `lpass login --trust ${yab.t("emailPlaceholder")}` };
      }

      const age = cached === undefined ? Infinity : Date.now() - cached.at;
      if (cached !== undefined && age >= 0 && age <= LIFETIME) return { rows: cached.rows };

      // Every line, through onLine: an exec result keeps only the last 64 KB, less than a large vault prints.
      const lines: string[] = [];
      const listing = await yab.exec("lpass", ["ls", ...LOCAL_PLAIN, LIST_FORMAT], {
        signal,
        onLine: (line, stream) => {
          if (stream === "stdout") lines.push(line);
        },
      });
      if (listing.exitCode !== 0) throw new Error(yab.t("listFailed"));
      cached = { at: Date.now(), rows: rowsOf(lines) };
      return { rows: cached.rows };
    },

    async run(rowId, actionId, ctx) {
      const field = actionId === "password" ? "--password" : actionId === "username" ? "--username" : undefined;
      // Ids are lpass's own numbers: anything else never reaches the tool.
      if (field === undefined || !/^\d+$/.test(rowId)) throw new Error(yab.t("showFailed"));
      // Never --clip: the app pastes the value itself, concealed, and gives the clipboard back.
      const result = await yab.exec("lpass", ["show", field, ...LOCAL_PLAIN, rowId], { signal: ctx.signal });
      if (result.exitCode !== 0) {
        // LastPass may have locked since the list: then say so, and let the rows go with the lock.
        const status = await yab.exec("lpass", ["status", "-q"], { signal: ctx.signal });
        if (status.exitCode !== 0) {
          cached = undefined;
          throw new Error(yab.t("locked"));
        }
        throw new Error(yab.t("showFailed"));
      }
      const value = printed(result.stdout);
      // lpass prints an empty field when it cannot decrypt one: never paste that.
      if (field === "--password") {
        if (value.trim() === "") throw new Error(yab.t("emptyPassword"));
        return { secret: value };
      }
      if (value.trim() === "") throw new Error(yab.t("emptyUsername"));
      return { text: value };
    },
  },
};
