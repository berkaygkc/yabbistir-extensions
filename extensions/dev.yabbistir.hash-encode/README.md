# Hash & Encode

Hashes and encodings for text and code, everything computed on this Mac. Pick an item, press ⇧, and the transform is there; decoders show up only when the text can be decoded, and every decoder shows its result on the row before you paste. Hash rows show no preview.

| Action | What it does |
|---|---|
| **Hash** (MD5, SHA-1, SHA-256, SHA-512) | The digest of the text's UTF-8 bytes, as lowercase hex |
| **Encode for a URL** / **Decode from a URL** | Percent-encoding of a component (`encodeURIComponent`) and back; decoding is offered when the text has `%XX` |
| **Encode HTML entities** / **Decode HTML entities** | `& < > " '` and every non-ASCII character as `&#N;`, and back (named and numeric references) |
| **Escape as Unicode** / **Unescape Unicode** | Non-ASCII characters as `\uXXXX` (an emoji as its surrogate pair), and `\uXXXX`, `\u{XXXXX}`, `\xXX` back |
| **Text to hex** / **Hex to text** | UTF-8 bytes as hex, and back; decoding is offered for pairs of hex digits |
| **ROT13** | Rotates the letters A to Z by 13; offered when there is a letter |
| **Domain to Punycode** / **Punycode to domain** | `bücher.example` to `xn--bcher-kva.example` (RFC 3492), on a domain or a link |

## Example

Copy `Şişli`, press ⇧, choose **Escape as Unicode**: `Şişli`. Copy `caf%C3%A9`, choose **Decode from a URL**: `café`. Copy `https://bücher.example/yol`, choose **Domain to Punycode**: `https://xn--bcher-kva.example/yol`.

## Details and limits

- **Hash** covers the text exactly as copied: a trailing newline changes the digest. Text is hashed as UTF-8. MD5 and SHA-1 are here for checksums and compatibility, not for security. Hashes are written in plain TypeScript (the extension host has no hashing of its own) and checked against the official test vectors and against Node's `crypto`.
- **URL**: decoding handles each run of `%XX` that is valid UTF-8; a stray `%` or a byte that is not text stays as written. `+` is not turned into a space (that is form decoding). Encoding leaves `A-Z a-z 0-9 - _ . ! ~ * ' ( )` as they are, like `encodeURIComponent`. A link is decoded from its address.
- **HTML**: decoding knows the common named set (Latin-1, Greek, arrows, math symbols, typographic punctuation, `&apos;`), decimal and hexadecimal references, and treats numbers 128 to 159 as Windows-1252, as HTML does. Names it does not know, and references without the closing `;`, are left as written. It decodes once: `&amp;lt;` becomes `&lt;`.
- **Unicode escapes**: only characters past ASCII are escaped. Decoding leaves malformed escapes, lone surrogates and code points past U+10FFFF as written, and does not decode an escaped backslash (`\\u0041`).
- **Hex**: decoding accepts spaces, line breaks, colons and a leading `0x` between and before pairs, and refuses bytes that are not valid UTF-8 with a message.
- **Punycode**: only the host of a link is converted; a path, query or fragment with non-ASCII characters is left alone. Labels are lowercased and normalized (NFC) before encoding; this is not the full UTS #46 mapping. A label longer than 63 characters is refused.
- Hex decoding also refuses results that contain control characters (other than tab and line breaks), so a digit string like `0102` is not read as text.
- Previews on very large text (several hundred KB) may be skipped when they would take too long; the action itself still works.
- Punycode is offered only on domain-like text: no spaces, at least one dot and a non-ASCII character.
- All of it is linear in the text's size; a megabyte is far inside the 10-second limit.

## Permissions and tools

None. No network, no programs, no history: everything is computed from the item you picked.

## Sources

- Hash algorithms: RFC 1321 (MD5) and FIPS 180-4 (SHA-1, SHA-2); the SHA-2 constants are derived at load time from the square and cube roots of the first primes, as that standard defines them.
- Punycode: RFC 3492, with its section 7.1 sample strings as tests.
- HTML entity names: the mapping of names to characters from the [HTML Living Standard](https://html.spec.whatwg.org/multipage/named-characters.html) (WHATWG; names and code points are facts, no text is copied). The extension carries its common subset only.
