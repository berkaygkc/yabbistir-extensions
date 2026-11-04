import type { SourceListing, Sources } from "@yabbistir/api";

import { ARGS } from "./script.ts";
import { BROWSERS, MAX_ROWS, entriesOf, markdownLink, namesOf, readOutput } from "./tabs.ts";
import type { Browser, Entry, Reading } from "./tabs.ts";

export { ARGS, SCRIPT } from "./script.ts";
export { digest, entriesOf, hostOf, linkable, markdownLink, readOutput, tabID } from "./tabs.ts";

// The open tabs of Safari, Chrome, Arc, Brave, Edge and Vivaldi as a column, through one fixed osascript script. Only
// browsers that are already running are asked. Tabs are private enough to be kept to themselves: no row, title, URL or
// osascript output is ever logged, kept or put in an error message, and nothing is cached. `run` reads the row's own
// browser again, and only that one, and pastes the URL the tab has now.

/** A row that says a browser's Automation switch is off: `denied:safari`. */
const DENIED_ROW = /^denied:([a-z]+)$/;
/** A tab's row id: a browser, a window and a tab (see `tabID`), and "~n" when an id repeats. */
const TAB_ROW = /^(?:safari|chrome|arc|brave|edge|vivaldi):[A-Za-z0-9._-]{1,65}:[A-Za-z0-9._-]{1,65}(?:~\d{1,5})?$/;
/** osascript's own words when the whole script was refused Apple events: "… (-1743)". */
const REFUSED = /\((?:-1743|-1744)\)/;

type Outcome = { reading: Reading } | { refused: true };

/**
 * Runs the script once: for every browser, or for `only`, one of the fixed keys in BROWSERS and never text from a row.
 * The output goes through onLine: an exec result keeps only the last 64 KB, less than a few hundred tabs print. Throws
 * a plain message when osascript fails; its output never reaches it.
 */
async function readTabs(signal: AbortSignal, only?: Browser): Promise<Outcome> {
  const lines: string[] = [];
  const result = await yab.exec("osascript", only === undefined ? [...ARGS] : [...ARGS, only], {
    signal,
    onLine: (line, stream) => {
      if (stream === "stdout") lines.push(line);
    },
  });
  if (result.exitCode !== 0) {
    if (REFUSED.test(result.stderr)) return { refused: true };
    throw new Error(yab.t("readFailed"));
  }
  const reading = readOutput(lines);
  if (reading === undefined) throw new Error(yab.t("readFailed"));
  return { reading };
}

const deniedIn = (reading: Reading): Browser[] =>
  BROWSERS.filter((browser) => reading.statuses.some((status) => status.browser === browser && status.state === "denied"));

function deniedMessage(browsers: readonly Browser[], language: string): string {
  return yab.t(browsers.length === 1 ? "denied.one" : "denied.many", { browsers: namesOf(browsers, language) });
}

/** The locked row for a column with no tab to show, saying why; undefined when there are tabs. */
function emptyListing(reading: Reading, entries: readonly Entry[], language: string): SourceListing | undefined {
  if (entries.length > 0) return undefined;
  if (reading.statuses.length === 0) return { locked: true, message: yab.t("noBrowser") };
  const denied = deniedIn(reading);
  if (denied.length > 0) return { locked: true, message: deniedMessage(denied, language) };
  if (reading.statuses.some((status) => status.state === "failed" || status.unreadWindows > 0)) throw new Error(yab.t("readFailed"));
  if (reading.statuses.some((status) => status.privateWindows > 0)) return { locked: true, message: yab.t("onlyPrivate") };
  return { locked: true, message: yab.t("noTabs") };
}

export const sources: Sources = {
  tabs: {
    async list(ctx) {
      const outcome = await readTabs(ctx.signal);
      if ("refused" in outcome) return { locked: true, message: yab.t("deniedAll") };
      const { reading } = outcome;
      const denied = deniedIn(reading);
      // Room for one row per browser whose tabs are kept from yabbistir, after the tabs.
      const entries = entriesOf(reading, MAX_ROWS - denied.length);
      const empty = emptyListing(reading, entries, ctx.language);
      if (empty !== undefined) return empty;
      const rows = entries.map((entry) => entry.row);
      for (const browser of denied) {
        rows.push({
          id: `denied:${browser}`,
          title: yab.t("deniedRow.title", { browser: yab.t(`app.${browser}`) }),
          subtitle: yab.t("deniedRow.subtitle"),
        });
      }
      return { rows };
    },

    async run(rowId, actionId, ctx) {
      if (actionId !== "link" && actionId !== "markdown") throw new Error(yab.t("tabGone"));
      const deniedRow = DENIED_ROW.exec(rowId);
      if (deniedRow !== null) {
        const browser = BROWSERS.find((name) => name === deniedRow[1]);
        if (browser === undefined) throw new Error(yab.t("tabGone"));
        throw new Error(deniedMessage([browser], ctx.language));
      }
      // Ids are the listing's own: anything else is no tab, and an id never reaches osascript in any case.
      const browser = TAB_ROW.test(rowId) ? BROWSERS.find((name) => rowId.startsWith(`${name}:`)) : undefined;
      if (browser === undefined) throw new Error(yab.t("tabGone"));

      // The tab's browser again, rather than a URL kept from the listing: a value lives for its run only, and the link
      // pasted is the one the tab has now. Only that browser is asked, by its key from BROWSERS, so another browser
      // that is slow, hung or showing its Automation prompt never holds the paste up.
      const outcome = await readTabs(ctx.signal, browser);
      if ("refused" in outcome) throw new Error(deniedMessage([browser], ctx.language));
      const { reading } = outcome;
      const entry = entriesOf(reading).find((candidate) => candidate.row.id === rowId);
      if (entry === undefined) {
        if (deniedIn(reading).includes(browser)) throw new Error(deniedMessage([browser], ctx.language));
        throw new Error(yab.t("tabGone"));
      }
      return { text: actionId === "link" ? entry.url : markdownLink(entry.title, entry.url) };
    },
  },
};
