/** Pure scans over text. Nothing here talks to the app; every scan is linear in the length of the text. */

export type HiddenHit = { index: number; cp: number; key: string };
export type LookalikeHit = { index: number; word: string; letters: { ch: string; cp: number; script: "Cyrillic" | "Greek" }[] };
export type ShellKind = "pipe" | "decode" | "sudo" | "rm" | "chmod" | "forkbomb" | "startup";
export type ShellHit = { kind: ShellKind; line: number };

/** Hits kept per scan: enough to explain, small enough to stay quick on a huge paste. */
export const MAX_HITS = 200;

// Control characters (but not tab, newline, return), invisible format characters, and two blank-looking letters.
const HIDDEN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb]|\u{E0001}|[\u{E0020}-\u{E007F}]/gu;
const RIGHT_TO_LEFT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

/** The locale key suffix that names a hidden character (`char.<key>`). */
export function hiddenKey(cp: number): string {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return "control";
  if (cp >= 0x206a && cp <= 0x206f) return "deprecated";
  if (cp >= 0xfff9 && cp <= 0xfffb) return "annotation";
  if (cp >= 0xe0000) return "tag";
  return cp.toString(16);
}

function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
  }
  return low;
}

/**
 * Calls `onHit` for each hidden character that has no business in a command or an address, in order; return `true`
 * from it to stop. Kept out: a joiner between two non-ASCII characters (emoji sequences, Persian and Indic text),
 * direction marks inside right-to-left text, and the tag characters of a flag emoji.
 */
export function scanHidden(text: string, onHit: (hit: HiddenHit) => boolean | void): void {
  HIDDEN.lastIndex = 0;
  let tagRunEnd = -1;
  let tagRunBenign = false;
  for (let match = HIDDEN.exec(text); match; match = HIDDEN.exec(text)) {
    const index = match.index;
    const cp = match[0].codePointAt(0)!;
    if (cp === 0x200c || cp === 0x200d) {
      const before = codePointBefore(text, index);
      const after = text.codePointAt(index + 1);
      if (before !== undefined && after !== undefined && before > 0x7f && after > 0x7f) continue;
    } else if (cp === 0x200e || cp === 0x200f || cp === 0x61c) {
      // A direction mark is excused only beside right-to-left text, not by a letter somewhere else in the paste.
      const before = codePointBefore(text, index);
      const after = text.codePointAt(index + 1);
      if ((before !== undefined && RIGHT_TO_LEFT.test(String.fromCodePoint(before))) || (after !== undefined && RIGHT_TO_LEFT.test(String.fromCodePoint(after)))) continue;
    } else if (cp >= 0xe0000) {
      if (tagRunEnd === index) {
        tagRunEnd = index + 2;
        if (tagRunBenign) continue;
      } else {
        tagRunBenign = codePointBefore(text, index) === 0x1f3f4;
        tagRunEnd = index + 2;
        if (tagRunBenign) continue;
      }
    }
    if (onHit({ index, cp, key: hiddenKey(cp) }) === true) return;
  }
}

export function hasHidden(text: string): boolean {
  let found = false;
  scanHidden(text, () => (found = true));
  return found;
}

/** The text without its hidden characters; everything else stays as it is. */
export function removeHidden(text: string): string {
  const cuts: { index: number; length: number; with: string }[] = [];
  scanHidden(text, (hit) => {
    // A vertical tab, form feed or next-line mark separates words; removing it would glue them together.
    cuts.push({ index: hit.index, length: hit.cp > 0xffff ? 2 : 1, with: hit.cp === 0x0b || hit.cp === 0x0c || hit.cp === 0x85 ? " " : "" });
  });
  if (cuts.length === 0) return text;
  let out = "";
  let from = 0;
  for (const cut of cuts) {
    out += text.slice(from, cut.index) + cut.with;
    from = cut.index + cut.length;
  }
  return out + text.slice(from);
}

/** Line (1-based) and column (1-based) of each index, for indexes given in increasing order. */
export function locator(text: string): (index: number) => { line: number; column: number } {
  let line = 1;
  let column = 1;
  let pos = 0;
  return (index) => {
    for (; pos < index; pos++) {
      const code = text.charCodeAt(pos);
      if (code === 10) {
        line++;
        column = 1;
      } else if (code < 0xdc00 || code > 0xdfff) {
        column++; // the second half of a surrogate pair is not a new character
      }
    }
    return { line, column };
  };
}

// Letters of the Cyrillic and Greek alphabets that are drawn like a Latin letter.
const CONFUSABLE = new Map<number, "Cyrillic" | "Greek">();
for (const cp of [
  0x430, 0x441, 0x435, 0x43e, 0x440, 0x445, 0x443, 0x456, 0x458, 0x455, 0x501, 0x51b, 0x51d, 0x4bb, 0x4cf, 0x475,
  0x410, 0x412, 0x421, 0x415, 0x41d, 0x406, 0x408, 0x41a, 0x41c, 0x41e, 0x420, 0x405, 0x422, 0x425, 0x4ae, 0x474, 0x4c0,
]) CONFUSABLE.set(cp, "Cyrillic");
for (const cp of [
  0x3bf, 0x3b1, 0x3b9, 0x3bd, 0x3c1, 0x3c5, 0x3ba, 0x3c7,
  0x391, 0x392, 0x395, 0x396, 0x397, 0x399, 0x39a, 0x39c, 0x39d, 0x39f, 0x3a1, 0x3a4, 0x3a5, 0x3a7,
]) CONFUSABLE.set(cp, "Greek");

const NEEDS_LOOKALIKE_CHECK = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
// Starts only where a run of letters starts, so a long token is read once instead of from every position.
const HOST = /(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const LATIN = /\p{Script=Latin}/u;

/**
 * Words that mix Latin letters with look-alike Cyrillic or Greek ones, and, in a dotted name such as an address, a
 * part made only of look-alikes next to a plain Latin part. Pure Cyrillic or Greek text is never reported.
 */
export function scanLookalike(text: string, limit = MAX_HITS): LookalikeHit[] {
  const hits: LookalikeHit[] = [];
  if (!NEEDS_LOOKALIKE_CHECK.test(text)) return hits;
  WORD.lastIndex = 0;
  for (let match = WORD.exec(text); match && hits.length < limit; match = WORD.exec(text)) {
    const word = match[0];
    const letters: LookalikeHit["letters"] = [];
    let latin = false;
    for (const ch of word) {
      const cp = ch.codePointAt(0)!;
      const script = CONFUSABLE.get(cp);
      if (script) {
        if (letters.length < 3 && !letters.some((l) => l.cp === cp)) letters.push({ ch, cp, script });
      } else if (!latin && LATIN.test(ch)) {
        latin = true;
      }
    }
    if (latin && letters.length > 0) hits.push({ index: match.index, word, letters });
  }
  HOST.lastIndex = 0;
  for (let match = HOST.exec(text); match && hits.length < limit; match = HOST.exec(text)) {
    const labels = match[0].split(".");
    const plain = labels.some((label) => /^[A-Za-z0-9-]+$/.test(label) && /[A-Za-z]/.test(label));
    if (!plain) continue;
    let offset = match.index;
    for (const label of labels) {
      const chars = [...label];
      if (chars.length >= 2 && chars.every((ch) => CONFUSABLE.has(ch.codePointAt(0)!))) {
        const letters: LookalikeHit["letters"] = [];
        for (const ch of chars) {
          const cp = ch.codePointAt(0)!;
          if (letters.length < 3 && !letters.some((l) => l.cp === cp)) letters.push({ ch, cp, script: CONFUSABLE.get(cp)! });
        }
        hits.push({ index: offset, word: label, letters });
      }
      offset += label.length + 1;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "csh", "tcsh", "fish"]);
const DOWNLOADERS = new Set(["curl", "wget", "fetch"]);
const WRAPPERS = new Set(["env", "command", "exec", "nohup", "time", "nice", "builtin"]);
const SEGMENT_SPLIT = /\|\||&&|;|&/;
const SUBSTITUTION_DOWNLOAD = /(?:\$\(|<\(|`)\s{0,8}(?:curl|wget)\b/;
const SUBSTITUTION_DECODE = /(?:\$\(|<\(|`)[^)`]{0,200}\b(?:base64|xxd|openssl)\b/;
const STARTUP_FILE =
  /(?:>>?|\btee\b(?:\s+-\w+)*)\s{0,8}["']?(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/\s"']+|\/home\/[^/\s"']+|\/root)?\/?(?:\.(?:zshrc|zprofile|zshenv|zlogin|bashrc|bash_profile|bash_login|profile)\b|etc\/(?:zshrc|zprofile|zshenv|zlogin|profile|bashrc)\b|\.config\/fish\/config\.fish\b)/;

type Stage = { cmd: string; args: string[]; sudo: boolean; raw: string };

const base = (word: string) => {
  const name = word.replace(/^\\/, ""); // `\sh` runs sh without any alias
  return name.slice(name.lastIndexOf("/") + 1).toLowerCase();
};

function parseStage(raw: string): Stage {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  let sudo = false;
  let i = 0;
  if (words[0] === "$") i++;
  for (; i < words.length; i++) {
    const word = words[i].replace(/^[({!]+/, "");
    if (word === "") continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    const name = base(word);
    if (name === "sudo" || name === "doas") {
      sudo = true;
      while (words[i + 1]?.startsWith("-")) {
        i++;
        if (/^-[uUgGhpCDRT]$/.test(words[i])) i++;
      }
      continue;
    }
    if (WRAPPERS.has(name)) {
      while (words[i + 1]?.startsWith("-")) i++;
      continue;
    }
    return { cmd: name, args: words.slice(i + 1), sudo, raw };
  }
  return { cmd: "", args: [], sudo, raw };
}

/** The root, the home folder, everything here or one level up. A path inside them is an ordinary cleanup. */
const DANGEROUS_RM_TARGET = /^(?:\/\*?|~\/?\*?|\$HOME\/?\*?|\$\{HOME\}\/?\*?|\*|\.|\.\.)$/;
const unquote = (word: string) => word.replace(/^["']+|["']+$/g, "");
const isRecursiveFlag = (arg: string) => /^-[A-Za-z]*[rR][A-Za-z]*$/.test(arg) || arg === "--recursive";
const isDecoder = (stage: Stage) =>
  (stage.cmd === "base64" && stage.args.some((a) => /^(-d|-D|--decode)$/i.test(a))) ||
  (stage.cmd === "xxd" && stage.args.some((a) => /^-[a-z]*r[a-z]*$/.test(a))) ||
  (stage.cmd === "openssl" && stage.args.some((a) => a === "base64" || a === "enc") && stage.args.some((a) => /^-(d|a|base64)$/.test(a))) ||
  stage.cmd === "uudecode";

/** Fork bombs look like `name(){ name|name& }`; found by their `(){`, so a long line costs nothing extra. */
function hasForkBomb(line: string): boolean {
  const open = /\(\s*\)\s*\{/g;
  for (let m = open.exec(line); m; m = open.exec(line)) {
    const before = /([\w:]{1,16})\s*$/.exec(line.slice(Math.max(0, m.index - 40), m.index));
    if (!before) continue;
    const name = before[1];
    const after = line.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const bomb = new RegExp(`^\\s*${name.replace(/[^\w:]/g, "")}\\s*\\|\\s*${name.replace(/[^\w:]/g, "")}\\s*&`);
    if (bomb.test(after)) return true;
  }
  return false;
}

/** The risky shell patterns in `text` and the line (1-based) of each. Reads words, not the shell's whole grammar. */
export function scanShell(text: string): ShellHit[] {
  const hits: ShellHit[] = [];
  const seen = new Set<string>();
  const add = (kind: ShellKind, line: number) => {
    const key = `${kind}:${line}`;
    if (!seen.has(key) && hits.length < MAX_HITS) {
      seen.add(key);
      hits.push({ kind, line });
    }
  };
  const lines = text.split("\n");
  for (let n = 0; n < lines.length && hits.length < MAX_HITS; n++) {
    const line = lines[n];
    if (line.trim() === "") continue;
    const lineNumber = n + 1;
    if (hasForkBomb(line)) add("forkbomb", lineNumber);
    for (const segment of line.replace(/\|&/g, "|").split(SEGMENT_SPLIT)) {
      if (segment.trim() === "") continue;
      if (STARTUP_FILE.test(segment)) add("startup", lineNumber);
      const stages = segment.split("|").map(parseStage);
      stages.forEach((stage, i) => {
        if (stage.sudo) add("sudo", lineNumber);
        if (i > 0 && SHELLS.has(stage.cmd)) {
          if (stages.slice(0, i).some((s) => DOWNLOADERS.has(s.cmd))) add("pipe", lineNumber);
          if (stages.slice(0, i).some(isDecoder)) add("decode", lineNumber);
        }
        if (i === 0 && (SHELLS.has(stage.cmd) || stage.cmd === "eval" || stage.cmd === "source" || stage.cmd === ".")) {
          if (SUBSTITUTION_DOWNLOAD.test(segment)) add("pipe", lineNumber);
          if (SUBSTITUTION_DECODE.test(segment)) add("decode", lineNumber);
        }
        if (stage.cmd === "rm" && stage.args.some(isRecursiveFlag)) {
          const targets = stage.args.map(unquote).filter((a) => !a.startsWith("-") || a === "--");
          if (targets.some((a) => DANGEROUS_RM_TARGET.test(a))) add("rm", lineNumber);
        }
        if (stage.cmd === "chmod" && stage.args.some(isRecursiveFlag) && stage.args.some((a) => /^0?777$/.test(a))) add("chmod", lineNumber);
      });
    }
  }
  return hits;
}

/** What a terminal would do with the paste: a final newline runs it at once, more lines run one after another. */
export function shape(text: string): { trailingNewline: boolean; commandLines: number } {
  let commandLines = 0;
  for (const line of text.split("\n")) if (line.trim() !== "") commandLines++;
  const rest = text.slice(text.trimEnd().length);
  return { trailingNewline: rest.includes("\n"), commandLines };
}
