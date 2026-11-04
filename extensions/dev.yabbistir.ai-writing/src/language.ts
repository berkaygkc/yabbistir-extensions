// Which language to ask the model for. By default it answers in the language of its whole input, and the frame
// around the person's text is English, so a Turkish text could come back in English. Naming the language when it
// is clear keeps the answer in it. When it is not clear, the instructions ask for the text's own language: naming a
// wrong one would have the model translate the text, which is worse than naming none.

/** Common Turkish words that other languages rarely use as words of their own. */
const turkishWords = new Set([
  "ve", "bir", "bu", "şu", "için", "ile", "çok", "ama", "fakat", "gibi", "daha", "olarak", "değil", "nasıl", "neden",
  "çünkü", "veya", "şey", "kadar", "sonra", "önce", "şimdi", "yarın", "bugün", "lütfen", "teşekkürler", "merhaba",
  "selam", "evet", "hayır", "biz", "siz", "benim", "senin", "bizim", "olan", "oldu", "yok",
]);

/**
 * Common English words that are not also common words of another language the model speaks: "was" and "will"
 * (German), "we", "is" and "of" (Dutch), "for" and "have" (Danish, Norwegian), "to" (Slavic languages) are left
 * out, so a German or Dutch text is not taken for English.
 */
const englishWords = new Set([
  "the", "and", "are", "were", "that", "this", "these", "those", "it", "its", "you", "your", "with", "has", "had",
  "would", "could", "should", "please", "thanks", "thank", "what", "when", "where", "which", "who", "our", "not",
  "but", "be", "been", "from", "they", "them", "their", "there", "about", "into", "than", "then", "because", "here",
  "before", "after", "only", "some", "any", "every", "very",
]);

/** Letters Turkish does not use, which Azerbaijani, Turkmen, Romanian, Kurdish and others do, beside ı, ğ or ş. */
const notTurkish = /[əäßñșțţăåøæãõłőűêňžý]/;

/** The least share of a text's words that must be a language's own for the text to be named as that language. */
const share = 0.2;

export type Language = "Turkish" | "English";

/** "Turkish" or "English" when the text clearly is, else null. Reads the first 4,000 characters. */
export function detectLanguage(text: string): Language | null {
  const sample = text.slice(0, 4000);
  const lower = sample.toLowerCase();
  const words = lower.match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return null;
  let turkish = 0;
  let english = 0;
  for (const word of words) {
    if (turkishWords.has(word) || /[ığş]/.test(word)) turkish++;
    else if (englishWords.has(word)) english++;
  }
  // "İ" lowercases to "i" and a combining dot, so it is counted on the original text.
  turkish += (sample.match(/İ/g) ?? []).length;
  const clearly = (hits: number, least: number, other: number) => hits >= least && hits >= words.length * share && hits > other * 2;
  if (clearly(turkish, 2, english) && !notTurkish.test(lower)) return "Turkish";
  if (clearly(english, 3, turkish)) return "English";
  return null;
}

/** The English name of an app language code ("tr" → "Turkish"), for the model. */
export function languageName(code: string): string {
  const base = code.split(/[-_]/)[0].toLowerCase();
  if (base === "tr") return "Turkish";
  if (base === "en" || base === "") return "English";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(base) ?? "English";
  } catch {
    return "English";
  }
}

/**
 * Apple's model reads this exact phrase, from its training, to set the locale; it comes first in the instructions,
 * and U.S. English needs none. Only Turkish is named: the extension speaks English and Turkish.
 */
export function localePhrase(language: string | null): string {
  return language === "Turkish" ? "The person's locale is tr_TR." : "";
}

/** The rule that keeps the answer in the text's language. */
export function sameLanguageRule(language: Language | null): string {
  if (language === "Turkish") {
    return "You MUST write in Turkish, the language of the text, with correct Turkish letters (ç, ğ, ı, İ, ö, ş, ü). NEVER translate it.";
  }
  if (language === "English") return "You MUST write in English, the language of the text. NEVER translate it.";
  return "You MUST write in the same language as the text. NEVER translate it.";
}

/** The rule for an answer in a language chosen by the extension, not by the text. */
export function fixedLanguageRule(name: string): string {
  return `You MUST write in ${name}.`;
}
