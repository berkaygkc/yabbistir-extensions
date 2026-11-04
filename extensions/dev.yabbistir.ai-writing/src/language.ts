// Which language to ask the model for. By default it answers in the language of its whole input, and the frame
// around the person's text is English, so a Turkish text could come back in English. Naming the language when it
// is clear keeps the answer in it; otherwise the instructions ask for the text's own language.

/** Common Turkish words that other languages rarely use as words of their own. */
const turkishWords = new Set([
  "ve", "bir", "bu", "şu", "için", "ile", "çok", "ama", "fakat", "gibi", "daha", "olarak", "değil", "nasıl", "neden",
  "çünkü", "veya", "şey", "kadar", "sonra", "önce", "şimdi", "yarın", "bugün", "lütfen", "teşekkürler", "merhaba",
  "selam", "evet", "hayır", "biz", "siz", "benim", "senin", "bizim", "olan", "oldu", "yok",
]);

/** Common English words. */
const englishWords = new Set([
  "the", "and", "is", "are", "was", "were", "to", "of", "that", "this", "it", "for", "you", "with", "have", "has",
  "will", "would", "could", "should", "please", "thanks", "what", "when", "we", "our", "your", "not", "but", "be",
  "been", "from", "they", "there", "about",
]);

export type Language = "Turkish" | "English";

/** "Turkish" or "English" when the text clearly is, else null. Reads the first 4,000 characters. */
export function detectLanguage(text: string): Language | null {
  const sample = text.slice(0, 4000);
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  let turkish = 0;
  let english = 0;
  for (const word of words) {
    if (turkishWords.has(word) || /[ığş]/.test(word)) turkish++;
    else if (englishWords.has(word)) english++;
  }
  // "İ" lowercases to "i" and a combining dot, so it is counted on the original text.
  turkish += (sample.match(/İ/g) ?? []).length;
  if (turkish >= 2 && turkish > english * 2) return "Turkish";
  if (english >= 2 && english > turkish * 2) return "English";
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
