// About how many tokens a text is to Apple's on-device model. Its context holds 4,096 tokens in all, shared by the
// instructions, the prompt and the answer (Apple, TN3193). A token is about three to four characters of English
// text, fewer of most other languages, and about one character of Chinese, Japanese or Korean. These estimates lean
// high on purpose: a part that is too long, or an answer limit that is too tight, cuts the end of the text off.

/** What one call may use of the model's 4,096 tokens, with some room left for the model's own framing. */
export const usableTokens = 3800;

/** Tokens per character of Latin text: about three characters a token in English and code, two in other languages. */
export function latinWeight(language: string | null, isCode: boolean): number {
  return isCode || language === "English" ? 1 / 3 : 1 / 2;
}

/**
 * Whether a code point is written at about one token each: Chinese, Japanese and Korean, the Thai, Lao, Khmer and
 * Myanmar scripts, the scripts of India, and the emoji and other symbols beyond the first plane.
 */
function isDense(point: number): boolean {
  return (point >= 0x0900 && point <= 0x0dff) // Devanagari … Sinhala
    || (point >= 0x0e00 && point <= 0x0eff) // Thai, Lao
    || (point >= 0x1000 && point <= 0x109f) // Myanmar
    || (point >= 0x1100 && point <= 0x11ff) // Hangul Jamo
    || (point >= 0x1780 && point <= 0x17ff) // Khmer
    || (point >= 0x2e80 && point <= 0x9fff) // CJK radicals and symbols, Kana, Hangul compatibility, CJK ideographs
    || (point >= 0xa960 && point <= 0xa97f) // Hangul Jamo extended
    || (point >= 0xac00 && point <= 0xd7ff) // Hangul syllables
    || (point >= 0xf900 && point <= 0xfaff) // CJK compatibility ideographs
    || (point >= 0xff00 && point <= 0xffef) // half-width and full-width forms
    || point > 0xffff; // emoji, rarer ideographs and symbols
}

/** How many tokens one code point is about: 1 for dense scripts, half for other non-Latin scripts, else `latin`. */
export function pointWeight(point: number, latin: number): number {
  if (point < 0x0370) return latin;
  return isDense(point) ? 1 : 1 / 2;
}

/** About how many tokens `text` is, with `latin` tokens per Latin character. Linear in its length. */
export function estimateTokens(text: string, latin: number): number {
  let tokens = 0;
  for (let index = 0; index < text.length; index++) {
    const point = text.codePointAt(index) ?? 0;
    if (point > 0xffff) index++;
    tokens += pointWeight(point, latin);
  }
  return Math.ceil(tokens);
}

/**
 * About how many characters of `text` make `tokens` tokens, judged by the text as a whole; at least 1. A text
 * that mixes scripts unevenly can be a little over, so callers measure what they cut again.
 */
export function charactersFor(text: string, tokens: number, latin: number): number {
  const total = estimateTokens(text, latin);
  if (total <= tokens) return Math.max(1, text.length);
  return Math.max(1, Math.floor((tokens * text.length) / total));
}
