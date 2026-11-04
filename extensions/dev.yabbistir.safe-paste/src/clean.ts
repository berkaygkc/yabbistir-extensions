import { removeHidden } from "./scan.ts";

export { removeHidden };

/** Spaces of other widths, which a shell reads as part of a word. */
const ODD_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const SINGLE_QUOTES = /[‘’‚‛]/g;
const DOUBLE_QUOTES = /[“”„‟]/g;
/** A hyphen-like character that starts an option (`\u2011\u2011force`, `\u2212v`): the same mark as `-`, drawn differently. */
const OPTION_DASHES = /(^|[\s(])([\u2010\u2011\u2012\u2212]+)(?=[A-Za-z0-9])/gm;

/**
 * Text ready for a terminal: hidden characters gone, odd spaces and curly quotes made plain, and no trailing
 * whitespace or newline, so nothing runs before the person presses return. A command is never changed beyond that.
 */
export function cleanForTerminal(text: string): string {
  return removeHidden(text)
    .replace(/\r\n?/g, "\n")
    .replace(ODD_SPACES, " ")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(OPTION_DASHES, (_all, lead: string, dashes: string) => lead + "-".repeat(dashes.length))
    .split("\n")
    .map(trimLineEnd)
    .join("\n")
    .trimEnd();
}

/** Drops spaces and tabs at the end of a line, with a scan from the end so a long run costs nothing extra. */
function trimLineEnd(line: string): string {
  let end = line.length;
  while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
  return end === line.length ? line : line.slice(0, end);
}
