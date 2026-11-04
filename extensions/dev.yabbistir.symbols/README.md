# Symbols

Two columns in yabbistir's panel for the characters that are hard to type: **Symbols** and **Kaomoji**. Nothing to install, no permissions.

## Symbols

About 350 rows in groups: Mac keys (⌘ ⌥ ⇧ ⌃ ⏎ ⌫), arrows, typography (quotes, dashes, the ellipsis, bullets, primes and the spaces), math, currency (including ₺ and €), check marks and stars, Greek letters, superscripts and subscripts, fractions, box drawing and the legal marks (© ® ™ § ¶ °).

A row's title is the symbol and its subtitle is its name in the app's language and its code point, such as *Command · U+2318* or *Türk lirası · U+20BA*. The panel's search looks at both, so typing `lira`, `command` or `2318` finds it. Characters that show as nothing, such as the non-breaking space, the zero-width space or the soft hyphen, have their name in square brackets as the title.

- ↵ pastes the symbol, ⌘C copies it.
- ⇧↵ pastes its HTML form: the entity's name where the HTML standard has one (`&copy;`, `&mdash;`, `&alpha;`), the numeric form otherwise (`&#x2318;`).

## Kaomoji

About 160 rows in twelve groups: happy, love, sad, angry, surprised, shrug, table flip, bear, cat, music, sleepy and greeting. A row's title is the kaomoji and its subtitle is the group and a few search words in the app's language.

- ↵ pastes the kaomoji, ⌘C copies it.
- ⇧↵ pastes it for Markdown: a backslash, an underscore, an asterisk and a backtick get a backslash in front, so `¯\_(ツ)_/¯` survives as `¯\\\_(ツ)\_/¯`.

## Example

Open the panel, move to the *Symbols* column and type `euro`: ↵ pastes €, ⇧↵ pastes `&euro;`. In the *Kaomoji* column, type `shrug` and press ↵.

## Permissions and tools

None. The extension needs no permission and no command-line tool: both columns are tables inside the extension. It reads nothing from your Mac, uses no network, stores nothing and writes nothing to the log.

## Limits

- A space can't be pasted from a column: yabbistir treats a value of white space only as empty. ↵ on the non-breaking, en, em, thin and narrow spaces says so, and ⇧↵ pastes their HTML form (`&nbsp;`). The zero-width space and joiner and the soft hyphen paste as they are.
- Names and search words are in English and Turkish only; any other app language reads English.
- Row ids are the code points (`u-2318`) and, for kaomoji, the group and the place in it (`shrug-1`). New kaomoji are added at the end of a group so the ids stay.

## Where the data comes from

The symbols are Unicode facts: characters and their code points, named by hand in English and Turkish after the Unicode character names. Unicode data is free to use ([Unicode License v3](https://www.unicode.org/license.txt)). The HTML entity names are the ones in the [HTML Standard's list of named character references](https://html.spec.whatwg.org/multipage/named-characters.html) (CC0-licensed). The kaomoji are short public strings and the search words are written for this extension. The code is MIT-licensed.
