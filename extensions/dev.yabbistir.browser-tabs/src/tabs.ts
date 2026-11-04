// Reading the script's output and turning it into rows. Pure functions, apart from `yab.t` for the words.

import type { SourceRow } from "@yabbistir/api";

/** The browsers, in the order the column lists them after the frontmost one. */
export const BROWSERS = ["safari", "chrome", "arc", "brave", "edge", "vivaldi"] as const;
export type Browser = (typeof BROWSERS)[number];

export interface Tab {
  browser: Browser;
  /** The window's id as the browser gives it, or null. */
  window: string | null;
  /** The tab's id as the browser gives it (Chromium and Arc), or null (Safari). */
  tab: string | null;
  /** Its place in the window, from 0. */
  position: number;
  /** Whether it is the window's active tab. */
  active: boolean;
  title: string;
  url: string;
}

export interface Status {
  browser: Browser;
  state: "ok" | "denied" | "failed";
  frontmost: boolean;
  /** Private windows left out. */
  privateWindows: number;
}

export interface Reading {
  tabs: Tab[];
  statuses: Status[];
}

/** One tab as the column shows it, with what its two actions paste. */
export interface Entry {
  row: SourceRow;
  url: string;
  title: string;
}

/** Rows the app keeps from one listing; the rest would be dropped with a line in the log. */
export const MAX_ROWS = 10_000;
/** What the app turns into a space in a row's title, and what it trims from its ends after that. */
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const SPACE = /^[\p{Z}\t-\r\u0085]$/u;
/** Pages with nothing to link to: blank pages and the browsers' own new tab and start pages. */
const BLANK_PAGE = /^(?:about:(?:blank|newtab|home|startpage)|[a-z][a-z0-9+.-]*:\/\/(?:newtab|new-tab-page|startpage|start-page)\/?|favorites:\/\/\/?|topsites:\/\/\/?)$/i;
/** An id part kept as the browser gives it; any other is hashed. */
const PLAIN_ID = /^[A-Za-z0-9._-]{1,64}$/;

const isBrowser = (value: unknown): value is Browser => typeof value === "string" && (BROWSERS as readonly string[]).includes(value);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalText = (value: unknown): string | null | undefined => (value === null ? null : typeof value === "string" ? value : undefined);

/**
 * A title as the app shows it: on one line, without spaces at its ends. The ends are trimmed one character at a time
 * rather than with `/\s+$/`, which takes quadratic time on a long run of spaces that a page's title can hold. Every
 * character of \p{Z} is a single UTF-16 unit.
 */
export function oneLine(text: string): string {
  const flat = text.replace(LINE_BREAKS, " ");
  let start = 0;
  let end = flat.length;
  while (start < end && SPACE.test(flat[start] ?? "")) start++;
  while (end > start && SPACE.test(flat[end - 1] ?? "")) end--;
  return flat.slice(start, end);
}

/**
 * What the script printed, line by line, or undefined when it is not the script's answer (no `{"v":1}` line). Lines
 * that are not one of its two shapes are skipped; a browser's tabs count only when its status line says "ok", and only
 * its first status line counts.
 */
export function readOutput(lines: readonly string[]): Reading | undefined {
  let answered = false;
  const tabs: Tab[] = [];
  const statuses = new Map<Browser, Status>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isObject(value)) continue;
    if (value.v === 1 && value.b === undefined) {
      answered = true;
      continue;
    }
    if (!isBrowser(value.b)) continue;
    const browser = value.b;
    if (value.s !== undefined) {
      if (statuses.has(browser) || (value.s !== "ok" && value.s !== "denied" && value.s !== "failed")) continue;
      const hidden = typeof value.x === "number" && Number.isInteger(value.x) && value.x > 0 ? value.x : 0;
      statuses.set(browser, { browser, state: value.s, frontmost: value.f === 1, privateWindows: hidden });
      continue;
    }
    const url = value.u;
    const position = value.p;
    const window = optionalText(value.w);
    const tab = optionalText(value.t);
    const title = optionalText(value.n);
    if (typeof url !== "string" || typeof position !== "number" || !Number.isInteger(position) || position < 0) continue;
    if (window === undefined || tab === undefined || title === undefined) continue;
    tabs.push({ browser, window, tab, position, active: value.a === 1, title: title ?? "", url });
  }
  if (!answered) return undefined;
  const ok = (browser: Browser) => statuses.get(browser)?.state === "ok";
  return { tabs: tabs.filter((tab) => ok(tab.browser)), statuses: [...statuses.values()] };
}

/** Whether a tab has an address worth pasting. */
export function linkable(url: string): boolean {
  const trimmed = url.trim();
  return trimmed !== "" && !BLANK_PAGE.test(trimmed);
}

/** The host a subtitle shows ("github.com"), "" when the URL has none; never the path, the query or a user name. */
export function hostOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "";
  }
  if (parsed.protocol === "file:") return yab.t("file");
  return parsed.host.replace(/^www\./i, "");
}

/** FNV-1a over UTF-16 code units, 32 bits, from `seed`. */
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 16 hex digits standing for `text`: two 32-bit FNV-1a hashes from different seeds. */
export function digest(text: string): string {
  const part = (seed: number) => fnv1a(text, seed).toString(16).padStart(8, "0");
  return part(0x811c9dc5) + part(0x9747b28c);
}

const idPart = (value: string | null): string | null => {
  if (value === null || value === "") return null;
  return PLAIN_ID.test(value) ? value : `h${digest(value)}`;
};

/**
 * A row id that stays with its tab: the browser, the window's id and the tab's id when the browser gives one
 * ("chrome:1203:1388"); in Safari, which gives tabs none, a digest of the tab's URL and its place in the window
 * ("safari:4711:3f…"), so the id changes only when the tab goes to another page or moves.
 */
export function tabID(tab: Tab): string {
  const window = idPart(tab.window) ?? "-";
  const own = idPart(tab.tab) ?? `u${digest(`${tab.position}\n${tab.url}`)}`;
  return `${tab.browser}:${window}:${own}`;
}

/**
 * The tabs as rows: the frontmost browser first, then Safari, Chrome, Arc, Brave, Edge and Vivaldi; the active tab of
 * every window before the others; windows front to back, as the browser lists them, and tabs in their order. Blank
 * pages are left out, and an id that repeats gets "~2", "~3"… so the listing never fails.
 */
export function entriesOf(reading: Reading, limit = MAX_ROWS): Entry[] {
  const rank = (browser: Browser) => {
    const front = reading.statuses.find((status) => status.browser === browser)?.frontmost === true;
    return (front ? 0 : 1) * BROWSERS.length + BROWSERS.indexOf(browser);
  };
  const tabs = reading.tabs
    .map((tab, order) => ({ tab, order }))
    .filter(({ tab }) => linkable(tab.url))
    .sort((a, b) => Number(b.tab.active) - Number(a.tab.active) || rank(a.tab.browser) - rank(b.tab.browser) || a.order - b.order);

  const seen = new Map<string, number>();
  const entries: Entry[] = [];
  for (const { tab } of tabs) {
    if (entries.length >= limit) break;
    const base = tabID(tab);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}~${count}`;
    const url = tab.url.trim();
    const host = hostOf(url);
    const title = oneLine(tab.title) || host || oneLine(url);
    const browser = yab.t(`browser.${tab.browser}`);
    entries.push({ row: { id, title, subtitle: host === "" ? browser : `${browser} · ${host}` }, url, title });
  }
  return entries;
}

/** A Markdown link to a tab: `[Title](url)`, the title's Markdown characters escaped and the URL's breaking ones encoded. */
export function markdownLink(title: string, url: string): string {
  const escape = (text: string) => oneLine(text).replace(/[\\[\]<>*_`]/g, "\\$&");
  const destination = url.trim().replace(/[\s()<>]/g, (character) =>
    character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character));
  return `[${escape(title) || escape(url)}](${destination})`;
}

/** "Safari", "Safari and Google Chrome", "Safari, Arc and Vivaldi", in the app's language. */
export function namesOf(browsers: readonly Browser[], language: string): string {
  const names = browsers.map((browser) => yab.t(`app.${browser}`));
  try {
    return new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}
