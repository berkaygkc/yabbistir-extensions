/** Pure builders for each destination: no yab calls, so they are easy to test. */

export type Destination = "obsidian" | "things" | "bear" | "drafts" | "omnifocus" | "reminders" | "notes";

export const URL_DESTINATIONS = ["obsidian", "things", "bear", "drafts", "omnifocus"] as const;

/** Our own conservative cap for an encoded URL; the apps' docs name no limit except Things' notes. */
export const MAX_URL = 30000;
/** Things: "notes" holds at most 10,000 characters unencoded (Cultured Code's URL scheme page). */
export const THINGS_NOTES_MAX = 10000;
/** Things: other strings at most 4,000 characters; titles stay far shorter. */
export const TITLE_MAX = 250;
/** Reminders and Notes take text as an argument, not a URL; this only keeps the argument sane. */
export const SCRIPT_TEXT_MAX = 100000;

export const APP_NAMES: Record<Destination, string> = {
  obsidian: "Obsidian",
  things: "Things",
  bear: "Bear",
  drafts: "Drafts",
  omnifocus: "OmniFocus",
  reminders: "Reminders",
  notes: "Notes",
};

/** Replaces NUL and lone surrogates, which encodeURIComponent would reject or the apps would choke on. */
export function clean(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { out += text[i] + text[i + 1]; i++; } else out += "�";
    } else if (c >= 0xdc00 && c <= 0xdfff) out += "�";
    else out += text[i];
  }
  return out.replace(/\r\n?/g, "\n");
}

/** Percent-encodes every byte that is not unreserved, including ! ' ( ) * and newlines. */
export function enc(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** The first `n` code points of `text`. */
export function head(text: string, n: number): string {
  let i = 0;
  let count = 0;
  while (i < text.length && count < n) {
    const c = text.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < text.length ? 2 : 1;
    count++;
  }
  return text.slice(0, i);
}

export function codePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) i++;
    count++;
  }
  return count;
}

/** The first non-empty line, and everything after it. */
export function split(text: string): { title: string; rest: string } {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length && lines[index]!.trim() === "") index++;
  if (index >= lines.length) return { title: "", rest: "" };
  const title = lines[index]!.trim();
  const rest = lines.slice(index + 1).join("\n").trim();
  return { title, rest };
}

function shortTitle(title: string): { title: string; cut: boolean } {
  if (codePoints(title) <= TITLE_MAX) return { title, cut: false };
  return { title: head(title, TITLE_MAX - 1) + "…", cut: true };
}

/** A file name Obsidian accepts: no \ / : * ? " < > | # ^ [ ], no leading dot, at most 100 characters. */
export function noteName(text: string, fallback: string): string {
  const { title } = split(text);
  let name = title.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  name = head(name, 100).trim().replace(/^\.+/, "").trim();
  return name === "" ? fallback : name;
}

/** A folder path from the preference: slashes trimmed, never leaving the vault. Returns null when it is not usable. */
export function cleanFolder(folder: string): string | null {
  const parts = folder.split(/[\\/]+/).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.some((p) => p === "." || p === ".." || /[:*?"<>|#^[\]\u0000-\u001f]/.test(p))) return null;
  return parts.join("/");
}

export interface Options {
  vault: string;
  folder: string;
  fallbackName: string;
}

/** The URL for one URL-scheme destination. `text` is already cleaned and trimmed. */
export function buildUrl(dest: (typeof URL_DESTINATIONS)[number], text: string, o: Options): string {
  switch (dest) {
    case "obsidian": {
      const name = noteName(text, o.fallbackName);
      const params: string[] = [];
      if (o.vault !== "") params.push("vault=" + enc(o.vault));
      params.push(o.folder !== "" ? "file=" + enc(o.folder + "/" + name) : "name=" + enc(name));
      params.push("content=" + enc(text));
      return "obsidian://new?" + params.join("&");
    }
    case "things": {
      const { title, rest } = split(text);
      const t = shortTitle(title);
      const notes = t.cut ? text : rest;
      return "things:///add?title=" + enc(t.title) + (notes !== "" ? "&notes=" + enc(notes) : "");
    }
    case "bear":
      return "bear://x-callback-url/create?text=" + enc(text) + "&open_note=no&show_window=no";
    case "drafts":
      return "drafts://create?text=" + enc(text);
    case "omnifocus": {
      const { title, rest } = split(text);
      const t = shortTitle(title);
      const note = t.cut ? text : rest;
      return "omnifocus:///add?name=" + enc(t.title) + (note !== "" ? "&note=" + enc(note) : "") + "&autosave=true";
    }
  }
}

export interface Fitted { url: string; cut: boolean }

/** Builds the URL, cutting the text (with an ellipsis) until the encoded URL fits MAX_URL. */
export function fit(dest: (typeof URL_DESTINATIONS)[number], text: string, o: Options): Fitted {
  let cut = false;
  let body = text;
  if (dest === "things") {
    const { title, rest } = split(text);
    if (codePoints(rest) > THINGS_NOTES_MAX) {
      body = title + "\n" + head(rest, THINGS_NOTES_MAX - 1) + "…";
      cut = true;
    }
  }
  const whole = buildUrl(dest, body, o);
  if (whole.length <= MAX_URL) return { url: whole, cut };
  // Binary search for the longest prefix that fits.
  let low = 0;
  let high = codePoints(body);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = buildUrl(dest, head(body, mid).trimEnd() + "…", o);
    if (candidate.length <= MAX_URL) low = mid; else high = mid - 1;
  }
  return { url: buildUrl(dest, head(body, low).trimEnd() + "…", o), cut: true };
}

/** The constant AppleScript sources. The text never becomes part of them: it arrives as arguments. */
const STRIP = `on plain(s)
	if (length of s) > 1 then return text 2 thru -1 of s
	return ""
end plain
`;

export const REMINDERS_SCRIPT = STRIP + `on run argv
	set n to count of argv
	set theBody to my plain(item n of argv)
	set theTitle to my plain(item (n - 1) of argv)
	tell application "Reminders" to make new reminder with properties {name:theTitle, body:theBody}
end run`;

export const NOTES_SCRIPT = STRIP + `on run argv
	set n to count of argv
	set theBody to my plain(item n of argv)
	tell application "Notes" to make new note with properties {body:theBody}
end run`;

/** Every script argument starts with "x" so an empty or option-like text is still one plain argument. */
export function reminderArgs(text: string): string[] {
  const { title, rest } = split(text);
  const t = shortTitle(title);
  const body = t.cut ? text : rest;
  return ["x" + t.title, "x" + head(body, SCRIPT_TEXT_MAX)];
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Notes bodies are HTML: the first line is a heading, the rest paragraphs, all escaped. */
export function noteHtml(text: string): string {
  const lines = text.split("\n");
  return lines
    .map((line, index) => {
      if (line.trim() === "") return "<div><br></div>";
      return index === 0 ? "<div><h1>" + escapeHtml(line) + "</h1></div>" : "<div>" + escapeHtml(line) + "</div>";
    })
    .join("");
}

export function noteArgs(text: string): string[] {
  return ["x" + noteHtml(head(text, SCRIPT_TEXT_MAX))];
}
