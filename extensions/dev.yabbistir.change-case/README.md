# Change Case

Changes the case of copied text or code, and shows the result on the row before you paste it. One action, **Change case**, with eleven variants:

| Variant | `HTTPServerError` / `the lord of the rings` becomes |
|---|---|
| camelCase | `httpServerError` |
| PascalCase | `HttpServerError` |
| snake_case | `http_server_error` |
| CONSTANT_CASE | `HTTP_SERVER_ERROR` |
| kebab-case | `http-server-error` |
| dot.case | `http.server.error` |
| Title Case | `The Lord of the Rings` |
| Sentence case | `The lord of the rings` |
| UPPERCASE / lowercase | `THE LORD OF THE RINGS` / `the lord of the rings` |
| URL slug | `the-lord-of-the-rings` |

## Example

Copy `parseHTTPResponse2Json`, open the actions, type `snake`: the row shows `parse_http_response2_json`. ↵ pastes it.

## How words are found

- camelCase and PascalCase boundaries, and acronyms: `HTTPServerError` is *http, server, error*.
- Separators: spaces, `_`, `-`, `.` and any punctuation. An apostrophe inside a word is dropped (`don't` is `dont`).
- Digits stay with the letters beside them (`base64Encode` is *base64, encode*), and split only before a capital (`v2Beta` is *v2, beta*).
- Emoji and CJK text are treated as part of a word and passed through unchanged.

Title Case and Sentence case keep your punctuation and spacing. They split camelCase and `_ - .` only when the whole line is one token (`helloWorld` becomes `Hello World`); a single leading lower-case letter stays with its word (`iPhone` becomes `Iphone`, not `I Phone`); in a sentence, a word like `iPhone` is only lower-cased and capitalized as a whole.

## Casing rules (Turkish)

The *Casing rules* setting is **Automatic** (the app's language), **Turkish** or **English**. Turkish rules map `i` to `İ` and `ı` to `I` (`istanbul` becomes `İSTANBUL`, `IŞIK` becomes `ışık`); English rules do not (`ISTANBUL`). Title Case keeps these words small in the middle of a title: English *a, an, and, as, at, but, by, for, in, nor, of, on, or, the, to, via, vs*; Turkish *ve, ile, veya*. The rules apply to UPPERCASE, lowercase, Title Case, Sentence case and the slug. The code variants (camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case, dot.case) always use English rules so identifiers stay plain ASCII-safe (`getUserID` becomes `get_user_id`, never `get_user_ıd`).

## Slug

Lower-cases (with the chosen rules), transliterates Turkish letters and other accents (`ç ğ ı İ ö ş ü`, `é`, `ß`, `æ`, `ø`, `ł`…) and keeps only `a-z` and `0-9`, joined by single hyphens. Text with nothing URL-safe in it (only CJK or emoji) pastes nothing and says so.

## Lines

Multi-line text is converted line by line: line breaks, blank lines, and each line's leading and trailing whitespace stay as they are. In Sentence and Title case every line starts with a capital.

## Permissions and tools

None. The extension only reads the item it is given and returns text; it uses no network, runs no programs and keeps nothing.

## Limits

- Empty or whitespace-only text pastes nothing and says so.
- Sentence case treats a stop after a single letter as an abbreviation (`e.g. this`) and does not capitalize after it; other abbreviations (`Dr. smith`) do start a new sentence.
- English "I" is fixed in Sentence case (`i think` becomes `I think`) only under English rules.
- Long text is fine: work grows linearly and 60,000 characters take a few milliseconds, well within the hint's 500 ms.

## Develop

```sh
npm test -- dev.yabbistir.change-case
npm run build -- dev.yabbistir.change-case
```
