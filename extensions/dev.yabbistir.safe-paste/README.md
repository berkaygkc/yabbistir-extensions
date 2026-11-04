# Safe Paste

Paste without surprises. Safe Paste spots what a copy hides, tells you in plain words, and pastes a cleaned version where it matters most: in a terminal.

## Why

A web page can put a different command on your clipboard than the one you saw. Text can carry characters you cannot see (zero-width spaces, direction overrides) that change what a command or an address really is. A final newline makes a terminal run a command the moment it lands. yabbistir knows which app a paste is headed for, so Safe Paste can offer the safe version first when that app is a terminal.

## What it does

**Three tags**, shown as chips on a copy, each with a short explanation in its preview:

- **Hidden characters**: zero-width characters, direction controls (the "Trojan Source" trick), soft hyphens, control characters such as escape and backspace, and blank-looking letters. The preview counts each kind, says on which lines (or at which positions) they are, and shows the text with each one made visible. A joiner inside an emoji sequence, a half-space in Persian, a direction mark inside Hebrew or Arabic and the tag characters of a flag emoji are normal and are not reported.
- **Look-alike letters**: a word that mixes Latin letters with Cyrillic or Greek ones that look the same (`p` + Cyrillic `а` + `ypal`), and, in an address, a part made only of such letters next to a plain Latin part. Text written entirely in Cyrillic or Greek is never reported.
- **Risky command**: a download piped into a shell (`curl … | sh`, `bash <(curl …)`), decoded text run as a script (`base64 -d | sh`), `sudo`, `rm -r` aimed at a whole disk of files (`/`, `/*`, `~`, `~/*`, `$HOME`, `*`, `.`, `..`; an ordinary path such as `/tmp/build` or `~/proj/node_modules` is not tagged), a fork bomb, `chmod -R 777`, and appending to a shell startup file (`>> ~/.zshrc`). The preview names the kind of risk and the line, never the command itself, and adds when the paste ends with a newline, holds several commands or contains curly quotes or a look-alike dash before an option (which shells do not read as quotes or options). The Look-alike and Hidden previews say the same. A plain command is not tagged.

**Two actions:**

- **Paste safely** (leads in terminals): removes the hidden characters, turns non-breaking and other odd spaces into plain spaces, line endings into `\n`, and strips newlines, spaces and tabs at the very end of the text (a space escaped by a backslash stays). Quotes, trailing spaces inside the text and everything else are left alone. The row shows exactly what is pasted; when nothing needs changing, the text pastes as it is. It never fixes a dangerous command, it only removes what is hidden, so you can read it and decide.
- **Remove hidden characters** (offered on copies tagged "Hidden characters"): the same hidden-character cleanup and nothing else, for editors and browsers where quotes, spaces and newlines matter.

## Example

You copy a one-line install command from a page. It looks like `curl -fsSL https://example.com/install.sh | sh`, but a zero-width space sits after `curl` and a newline ends it. The copy gets the "Hidden characters" and "Risky command" chips. In a terminal, "Paste safely" is first in the list and shows `curl -fsSL https://example.com/install.sh | sh` without the hidden character and without the newline, so you read it and press return yourself.

## Permissions

None. The extension only reads the copy it is asked about. It uses no network, runs no program and writes nothing; nothing is logged.

## Setup

Install it. There is nothing to set up.

## Limits

- Detection reads words, not the whole shell language: it will miss a danger hidden behind variables, functions or aliases, and a quoted `|` can look like a pipe. It is a second pair of eyes, not a guarantee.
- Look-alike detection knows the Cyrillic and Greek letters that are drawn like Latin ones. A word made only of such letters (all Cyrillic `аррӏе`) is reported only inside a dotted address next to a plain Latin part. Other scripts are not checked.
- A final newline or several lines alone do not tag a copy, because copying a line from an editor often ends in a newline; the preview of a tagged copy mentions them, and "Paste safely" always removes the final newline.
- "Paste safely" turns every carriage return into a newline, and keeps dashes and curly quotes as they are. The preview of a tagged copy points out curly quotes and a look-alike dash (en dash, em dash, minus sign) right before an option, which a shell would not read as quotes or as an option.
- Paste safely hints are skipped for text over 256 KB; the row shows its subtitle and the action still works.
- Items over 256 KB are not looked at by detectors.
