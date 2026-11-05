// Words of a text, for telling whether two texts are about the same thing: an answer and the text it was asked
// about, or a line the model wrote and the person's own first line. Linear in the text's length.

/** How much of a text is read for its words. */
const sampleLength = 4000;

/**
 * The text's words, lower-cased and folded: accents and dots off ("İşte" → "iste", "ı" → "i"), apostrophes
 * dropped ("can't" → "cant"). Reads the first 4,000 characters.
 */
export function foldedWords(text: string): string[] {
  const folded = text.slice(0, sampleLength).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
  // Each round of the group starts with an apostrophe, so the letters can be split only one way.
  return (folded.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? []).map((word) => word.replace(/['’]/g, ""));
}

/** Words that say little about what a text is about, in English and Turkish, folded. */
const stopwords = new Set([
  "the", "and", "but", "for", "nor", "yet", "with", "that", "this", "these", "those", "you", "your", "yours", "our",
  "ours", "are", "was", "were", "has", "have", "had", "not", "can", "could", "will", "would", "should", "shall",
  "may", "might", "must", "from", "they", "them", "their", "there", "here", "what", "when", "where", "which", "who",
  "how", "why", "its", "into", "onto", "about", "just", "all", "any", "some", "also", "than", "then", "been",
  "being", "did", "does", "done", "doing", "sure", "okay", "yes", "his", "her", "hers", "she", "him", "out", "too",
  "very", "below", "above", "now",
  "bir", "icin", "ile", "ama", "fakat", "gibi", "daha", "cok", "olarak", "degil", "ben", "sen", "biz", "siz",
  "onlar", "veya", "kadar", "sonra", "once", "simdi", "her", "hic", "ise", "diye", "iste", "asagida", "tabii",
]);

/**
 * What a text is about: the first five letters of each word of three letters or more that is not a stopword.
 * Five letters, so "booking" and "bookings", or "taşınmana" and "taşınmanda", count as the same word.
 */
export function contentKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const word of foldedWords(text)) {
    if (word.length >= 3 && !stopwords.has(word)) keys.add(word.slice(0, 5));
  }
  return keys;
}

/** The share of `text`'s content words that `other` has too: 0 when `text` has none. */
export function overlap(text: string, other: string): number {
  const keys = contentKeys(text);
  if (keys.size === 0) return 0;
  const theirs = contentKeys(other);
  let shared = 0;
  for (const key of keys) if (theirs.has(key)) shared++;
  return shared / keys.size;
}
