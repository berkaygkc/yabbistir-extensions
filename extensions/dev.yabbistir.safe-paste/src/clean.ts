import { removeHidden } from "./scan.ts";

export { removeHidden };

/** Spaces of other widths, which look like a space and which a shell reads as part of a word. */
const ODD_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
/** A hyphen-like character that starts an option (`\u2011\u2011force`, `\u2212v`): the same mark as `-`, drawn differently. */
const OPTION_DASHES = /(^|[\s(])([\u2010\u2011\u2012\u2212]+)(?=[A-Za-z0-9])/gm;

/**
 * Text ready for a terminal: hidden characters gone, odd spaces made plain, and no trailing whitespace or newline at
 * the very end, so nothing runs before the person presses return. Everything else, quotes included, stays as it is.
 */
export function cleanForTerminal(text: string): string {
  return trimEnd(
    removeHidden(text)
      .replace(/\r\n?/g, "\n")
      .replace(ODD_SPACES, " ")
      .replace(OPTION_DASHES, (_all, lead: string, dashes: string) => lead + "-".repeat(dashes.length)),
  );
}

/** Drops trailing newlines, spaces and tabs from the end of the text, but keeps a space that a backslash escapes. */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code === 10) {
      end--;
    } else if (code === 32 || code === 9) {
      let slashes = 0;
      while (end - 2 - slashes >= 0 && text.charCodeAt(end - 2 - slashes) === 92) slashes++;
      if (slashes % 2 === 1) break;
      end--;
    } else {
      break;
    }
  }
  return end === text.length ? text : text.slice(0, end);
}
