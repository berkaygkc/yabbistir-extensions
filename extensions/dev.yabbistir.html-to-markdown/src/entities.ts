// Character references (`&amp;`, `&#8217;`, `&#x1F600;`) the way the HTML Standard decodes them: the HTML 4 names,
// which are what clipboard HTML uses, plus a few common HTML5 ones. Names and code points come from the WHATWG HTML
// Standard's list of named character references (CC BY 4.0).

/** U+00A0 to U+00FF in order: `&nbsp;` is 160, `&yuml;` is 255. */
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro " +
  "para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil " +
  "Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave " +
  "Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml " +
  "igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute " +
  "thorn yuml";

/** Α to Ρ (U+0391…U+03A1), then Σ to Ω (U+03A3…U+03A9): U+03A2 is not a letter. */
const GREEK_UPPER = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho";
const GREEK_UPPER_2 = "Sigma Tau Upsilon Phi Chi Psi Omega";
/** α to ω (U+03B1…U+03C9), ς included. */
const GREEK_LOWER =
  "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon " +
  "phi chi psi omega";

const OTHERS: Record<string, number> = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, QUOT: 34, AMP: 38, LT: 60, GT: 62, COPY: 169, REG: 174,
  Tab: 9, NewLine: 10, excl: 33, num: 35, dollar: 36, percnt: 37, lpar: 40, rpar: 41, ast: 42, plus: 43, comma: 44,
  period: 46, sol: 47, colon: 58, semi: 59, equals: 61, quest: 63, commat: 64, lsqb: 91, lbrack: 91, bsol: 92,
  rsqb: 93, rbrack: 93, Hat: 94, lowbar: 95, grave: 96, lcub: 123, lbrace: 123, verbar: 124, vert: 124, rcub: 125,
  rbrace: 125,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  thetasym: 977, upsih: 978, piv: 982,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, hyphen: 8208, dash: 8208,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
  dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249,
  rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364, image: 8465, weierp: 8472, real: 8476, trade: 8482,
  alefsym: 8501, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, crarr: 8629, lArr: 8656, uArr: 8657,
  rArr: 8658, dArr: 8659, hArr: 8660, forall: 8704, part: 8706, exist: 8707, empty: 8709, nabla: 8711, isin: 8712,
  notin: 8713, ni: 8715, prod: 8719, sum: 8721, minus: 8722, lowast: 8727, radic: 8730, prop: 8733, infin: 8734,
  ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756, sim: 8764, cong: 8773,
  asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, nsub: 8836, sube: 8838, supe: 8839,
  oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901, lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971,
  loz: 9674, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830, starf: 9733, star: 9734, check: 10003,
  cross: 10007, lang: 10216, rang: 10217,
};

const NAMED = new Map<string, number>();
/** The names the Standard also decodes without a semicolon (`&copy 2026`): the Latin-1 ones and a few more. */
const LEGACY = new Set<string>(["amp", "lt", "gt", "quot", "AMP", "LT", "GT", "QUOT", "COPY", "REG"]);

LATIN1.split(" ").forEach((name, index) => {
  NAMED.set(name, 160 + index);
  LEGACY.add(name);
});
GREEK_UPPER.split(" ").forEach((name, index) => NAMED.set(name, 0x391 + index));
GREEK_UPPER_2.split(" ").forEach((name, index) => NAMED.set(name, 0x3a3 + index));
GREEK_LOWER.split(" ").forEach((name, index) => NAMED.set(name, 0x3b1 + index));
for (const [name, code] of Object.entries(OTHERS)) NAMED.set(name, code);

/** The Standard reads `&#128;`…`&#159;` as Windows-1252, which older documents rely on (`&#146;` is ’). */
const WINDOWS_1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

const LONGEST_LEGACY = 6;

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\uFFFD";
  return String.fromCodePoint(WINDOWS_1252[code] ?? code);
}

// One pass, no backtracking: every part is a plain run of one class.
const REFERENCE = /&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*))(;?)/g;

/**
 * Decodes the character references in `text`. In an attribute (`attribute: true`), a name without its semicolon
 * that runs into `=` or a letter stays as it is, so `?a=1&copy=2` in a link keeps its query.
 */
export function decodeEntities(text: string, attribute = false): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, (match: string, decimal?: string, hex?: string, name?: string, semicolon?: string,
    offset?: number, whole?: string) => {
    // A run of digits too long for a code point turns into Infinity, and so into U+FFFD.
    if (decimal !== undefined) return fromCodePoint(Number(decimal));
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
    const word = name ?? "";
    const after = (whole ?? "")[(offset ?? 0) + match.length] ?? "";
    if (semicolon === ";" && NAMED.has(word)) return String.fromCodePoint(NAMED.get(word) ?? 0xfffd);
    if (semicolon === "" && LEGACY.has(word)) {
      if (attribute && after === "=") return match;
      return String.fromCodePoint(NAMED.get(word) ?? 0xfffd);
    }
    // `&notit;` is `¬it;`: the longest legacy name the text starts with.
    for (let length = Math.min(word.length - 1, LONGEST_LEGACY); length >= 2; length--) {
      const prefix = word.slice(0, length);
      if (!LEGACY.has(prefix)) continue;
      if (attribute) return match; // a letter follows the name
      return String.fromCodePoint(NAMED.get(prefix) ?? 0xfffd) + word.slice(length) + semicolon;
    }
    return match;
  });
}
