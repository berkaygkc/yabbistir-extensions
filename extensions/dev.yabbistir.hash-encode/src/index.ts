import type { Actions, Item } from "@yabbistir/api";

import { htmlDecode, htmlEncode, hexDecode, hexEncode, rot13, unicodeEscape, unicodeUnescape, urlDecode, urlEncode } from "./codecs.ts";
import { hashers, type HashName } from "./hash.ts";
import { domainToAscii, domainToUnicode, type DomainResult } from "./punycode.ts";
import { utf8Bytes } from "./utf8.ts";

/** The text of an item; a link's address when it has one. */
const textOf = (item: Item | null): string => item?.url ?? item?.text ?? "";

/** The answer, or, when there is nothing to work on, `{ none }` with the reason. */
function transform(item: Item | null, convert: (text: string) => string, unchanged?: string) {
  const text = textOf(item);
  if (text === "") return { none: true as const, message: yab.t("empty") };
  const result = convert(text);
  if (unchanged && result === text) return { none: true as const, message: yab.t(unchanged) };
  return { text: result };
}

function domain(item: Item | null, convert: (text: string) => DomainResult, nothing: string) {
  const text = textOf(item);
  if (text.trim() === "") return { none: true as const, message: yab.t("empty") };
  const result = convert(text);
  if (!result.ok) return { none: true as const, message: yab.t(`punycode.${result.reason}`) };
  if (!result.changed) return { none: true as const, message: yab.t(nothing) };
  return { text: result.text };
}

const hashNames: readonly HashName[] = ["md5", "sha1", "sha256", "sha512"];

export const actions: Actions = {
  hash: {
    run(item, ctx) {
      const text = item?.text ?? "";
      if (text === "") return { none: true, message: yab.t("empty") };
      const name = hashNames.find((candidate) => candidate === ctx.variant) ?? "sha256";
      return { text: hashers[name](utf8Bytes(text)) };
    },
  },
  "url-encode": { run: (item) => transform(item, urlEncode) },
  "url-decode": { run: (item) => transform(item, urlDecode, "url.nothing") },
  "html-encode": { run: (item) => transform(item, htmlEncode) },
  "html-decode": { run: (item) => transform(item, htmlDecode, "html.nothing") },
  "unicode-escape": { run: (item) => transform(item, unicodeEscape) },
  "unicode-unescape": { run: (item) => transform(item, unicodeUnescape, "unicode.nothing") },
  "hex-encode": { run: (item) => transform(item, hexEncode) },
  "hex-decode": {
    run(item) {
      const text = textOf(item);
      if (text === "") return { none: true, message: yab.t("empty") };
      const result = hexDecode(text);
      if (!result.ok) return { none: true, message: yab.t(`hex.${result.reason}`) };
      return { text: result.text };
    },
  },
  rot13: { run: (item) => transform(item, rot13, "rot13.nothing") },
  "punycode-encode": { run: (item) => domain(item, domainToAscii, "punycode.nothingToEncode") },
  "punycode-decode": { run: (item) => domain(item, domainToUnicode, "punycode.nothingToDecode") },
};
