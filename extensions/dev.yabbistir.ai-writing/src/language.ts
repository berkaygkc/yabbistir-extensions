// Which language to ask the model for. The frame around the person's text is English, and Apple's model answers in
// the language of its whole input: told only to keep "the same language as the text", it rewrote German, French,
// Spanish, Dutch, Japanese, Korean and Chinese texts in English when asked for a formal or a friendly tone (measured
// on the model itself). Told the language by name, it kept every one. So the text's language is named whenever it is
// clearly one of the languages Apple's model speaks. When two are about as likely, as Danish and Norwegian often are,
// both are named and the model keeps whichever it is. When none is clear, the instructions ask for the text's own
// language: naming a wrong one would have the model translate the text.

/** Common words of a language, by its English name. A word may belong to several languages. */
const lists: Record<string, string> = {
  // Common Turkish words that other languages rarely use as words of their own.
  Turkish: "ve bir bu şu için ile çok ama fakat gibi daha olarak değil nasıl neden çünkü veya şey kadar sonra önce şimdi "
    + "yarın bugün lütfen teşekkürler merhaba selam evet hayır biz siz benim senin bizim olan oldu yok",
  // Common English words that are not also common words of another language the model speaks: "was" and "will"
  // (German), "we", "is" and "of" (Dutch), "for" and "have" (Danish, Norwegian), "to" (Slavic languages) are left out.
  English: "the and are were that this these those it its you your with has had would could should please thanks thank "
    + "what when where which who our not but be been from they them their there about into than then because here "
    + "before after only some any every very",
  // The other lists leave out what English or code uses too ("was", "so", "im", "dir", "ci", "op", "es"…).
  German: "und der die das nicht ich ist mit auf für sie wir ein eine einen einem einer dass zu dem des den auch sich noch "
    + "nach bei aber oder wenn schon mir mich euch uns bitte danke sind haben habe hast wird werden wurde kann kannst "
    + "können nur wie über heute gibt geht mein meine dein unser unsere kein keine nichts jetzt immer sehr durch gegen "
    + "ohne vom zum zur ihr ihnen diese dieser dieses doch gerne weil damit dann denn sein seine vielleicht wieder "
    + "etwas nein wo vor bis du er hallo niemand morgen hier gestern bald gleich kurz",
  Dutch: "het een niet van dat ik je voor zijn maar ook wel nog naar bij wat hoe deze dit jullie bedankt alsjeblieft graag "
    + "hebben heb heeft wordt kunnen kan moet moeten geen niets alleen omdat ze zij hij wij mijn onze jouw hoi vandaag "
    + "tegen zonder uit aan waar nu dus weer nadat als er te om wie hallo niemand morgen hier gisteren wil zou gaan gaat kunt",
  French: "le les des est une pas que qui dans sur avec nous vous je ce cette mais ou du au aux merci sont avons avez ai fait "
    + "être avoir très aussi tout tous toute leur leurs notre votre nos vos ils il elle elles ne ça cela déjà demain "
    + "bonjour salut oui parce quand depuis sans chez vers peut faut donc personne à et qu j n c l peux veux suis êtes était "
    + "mon ma mes ton ta tes sa ses moi toi lui eux avant après comment pourquoi rien ici",
  Spanish: "el los las y del al pero más muy gracias está estoy están hola su sus yo tú usted ustedes nosotros este esta "
    + "esto ese eso hay ser estar tiene tengo hacer puede cuando donde porque también mañana hoy ya sí todo todos sin "
    + "hasta después nada algo mucho poco para por con una que lo le favor creo podemos nadie así sobre antes como entre "
    + "desde muchas bien qué cómo dónde nos les",
  Italian: "il gli di che è sono ma anche della delle dello degli dei nel nella nei grazie ciao questo questa quello quella "
    + "molto perché più già sempre oggi domani ho hai abbiamo avete hanno essere fatto può uno una non con lo le al del "
    + "nessuno tutti tutto dopo quindi prima ancora mai cosa favore dal dalla sul sulla alla allo ai mi l c",
  Portuguese: "não uma mas mais muito muita obrigado obrigada você vocês são isso isto olá oi ele ela eles elas nós seu sua "
    + "seus suas nosso nossa também já ainda amanhã hoje aqui então onde depois tudo bem sem até foi ter tem temos fazer "
    + "pode da das nos nas ao aos à é está estou estão essa esse este esta num numa pelo pela pelos pelas porque quando "
    + "para por que como antes nada todos sobre desde acho vai vou ninguém favor podemos",
  Swedish: "och att är inte jag för också mycket något någon några vad ni ska vara varit bara här där när hur varför gärna "
    + "tack ett allihop allihopa inget utan mellan sedan alltså hade många från kunde finns väl redan honom kanske nej "
    + "hej igen efter det som på med har av vi du mig dig sig oss blir om kan den dem före idag imorgon kommer måste skulle "
    + "vill får gör",
  Danish: "og det er som på med ikke jeg har til af vi du den dem om kan så også hvis hvor hvad hvordan hvorfor ingen noget "
    + "nogen nogle efter sig mig dig nu der være været skal vil kommer alle sammen før tak hej igen meget bliver blev "
    + "havde jer gerne måske lige sådan venligst lidt gør siger når nej jo godt mange selv kun mere et skulle må få får "
    + "hvornår",
  Norwegian: "og det er som på med ikke jeg har til av vi du den dem om kan så også hvis hvor hva hvordan hvorfor ingen noe "
    + "noen etter seg meg deg nå der være vært skal vil kommer alle sammen før takk hei igjen mye blir ble hadde dere "
    + "gjerne kanskje litt gjør sier når nei jo godt mange selv kun mer bare sånn fra skulle må få får",
  Vietnamese: "và của là không có được những các một cho này với người chúng tôi bạn đã sẽ đang trong khi nên cũng vào về ra "
    + "thì mà để đến từ như sau trước nhưng rất lại hay còn nếu cảm ơn xin chào vui lòng",
};

/** Short words several languages share, each counted as a share of a word for every one of them. */
const shared: Record<string, string[]> = {
  la: ["French", "Spanish", "Italian"],
  de: ["French", "Spanish", "Portuguese", "Dutch", "Swedish", "Danish", "Norwegian"],
  en: ["French", "Spanish", "Dutch", "Swedish", "Danish", "Norwegian"],
  un: ["French", "Spanish", "Italian"],
  o: ["Spanish", "Portuguese"],
  se: ["French", "Spanish", "Italian", "Portuguese"],
  si: ["French", "Spanish", "Italian"],
  te: ["French", "Spanish", "Italian", "Dutch"],
  tu: ["French", "Spanish", "Italian", "Portuguese"],
  mi: ["Spanish", "Italian"],
};

/** Each word, with the languages it is common in. */
const owners = new Map<string, string[]>(Object.entries(shared));
for (const [name, list] of Object.entries(lists)) {
  for (const word of new Set(list.split(" "))) owners.set(word, [...(owners.get(word) ?? []), name]);
}

/** Letters only some of the languages write, for a word no list has: "mødet" is Danish or Norwegian. */
const letterOwners = new Map<string, string[]>([
  ["ß", ["German"]], ["ä", ["German", "Swedish"]], ["ö", ["German", "Swedish", "Turkish"]], ["ü", ["German", "Turkish"]],
  ["å", ["Swedish", "Danish", "Norwegian"]], ["æ", ["Danish", "Norwegian"]], ["ø", ["Danish", "Norwegian"]],
  ["ñ", ["Spanish"]], ["ã", ["Portuguese"]], ["õ", ["Portuguese"]], ["ç", ["French", "Portuguese", "Turkish"]],
  ["à", ["French", "Italian", "Portuguese"]], ["è", ["French", "Italian"]], ["ù", ["French", "Italian"]],
  ["ì", ["Italian"]], ["ò", ["Italian"]], ["â", ["French", "Portuguese"]], ["ê", ["French", "Portuguese"]],
  ["ô", ["French", "Portuguese"]], ["î", ["French"]], ["û", ["French"]], ["ë", ["French", "Dutch"]],
  ["ï", ["French", "Dutch"]], ["é", ["French", "Spanish", "Portuguese", "Italian"]], ["á", ["Spanish", "Portuguese"]],
  ["í", ["Spanish", "Portuguese"]], ["ó", ["Spanish", "Portuguese"]], ["ú", ["Spanish", "Portuguese"]],
]);

/** The languages every special letter of `word` belongs to, or none. */
function byLetters(word: string): string[] {
  let languages: string[] | null = null;
  for (const letter of word) {
    const owners = letterOwners.get(letter);
    if (owners === undefined) continue;
    languages = languages === null ? owners : languages.filter((name) => owners.includes(name));
  }
  return languages ?? [];
}

/** Every language with a list, for the tests. */
export const listedLanguages = Object.keys(lists);

/** Each language's own words, for the tests. */
export function wordsOf(name: string): string[] {
  return [...new Set((lists[name] ?? "").split(" "))];
}

/** Letters Turkish does not use, which Azerbaijani, Turkmen, Romanian, Kurdish and others do, beside ı, ğ or ş. */
const notTurkish = /[əäßñșțţăåøæãõłőűêňžý]/;

/** Letters only Vietnamese writes: ơ, ư and the letters with a tone mark of their own (U+1EA0 to U+1EF9). */
const vietnamese = /[Ạ-ỹơư]/;

/** The least share of a text's words that must be a language's for the text to be named as that language. */
const share = 0.2;

/** The text's language by its English name ("German"), or two that are about as likely ("Danish or Norwegian"). */
export type Language = string;

/** Chinese, Japanese or Korean when the text is mostly written in that script, else null. */
function byScript(sample: string): Language | null {
  const letters = (sample.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return null;
  const count = (pattern: RegExp) => (sample.match(pattern) ?? []).length;
  const hangul = count(/[ᄀ-ᇿ㄰-㆏가-힯]/gu);
  if (hangul >= letters * 0.3) return "Korean";
  const kana = count(/[぀-ヿㇰ-ㇿｦ-ﾟ]/gu);
  const han = count(/\p{Script=Han}/gu);
  if (kana >= letters * 0.05 && kana + han >= letters * 0.3) return "Japanese";
  if (han >= letters * 0.3) return "Chinese";
  return null;
}

/**
 * The text's language when it is clear, else null. Reads the first 4,000 characters. Chinese, Japanese and Korean
 * are told by their script, Vietnamese by its letters, and the others by their common words. A word common in
 * several languages counts as a share of a word for each, so German is not taken for Swedish over "du" and "den".
 */
export function detectLanguage(text: string): Language | null {
  const sample = text.slice(0, 4000).normalize("NFC");
  const script = byScript(sample);
  if (script !== null) return script;
  const lower = sample.toLowerCase();
  const words = lower.match(/[\p{L}\p{M}]+/gu) ?? [];
  if (words.length === 0) return null;
  const turkishAllowed = !notTurkish.test(lower);
  const scores = new Map<string, number>();
  const hits = new Map<string, number>();
  const add = (name: string, weight: number) => {
    if (name === "Turkish" && !turkishAllowed) return;
    scores.set(name, (scores.get(name) ?? 0) + weight);
    hits.set(name, (hits.get(name) ?? 0) + 1);
  };
  for (const word of words) {
    const listed = owners.get(word);
    const languages = listed ?? (vietnamese.test(word) ? ["Vietnamese"] : /[ığş]/.test(word) ? ["Turkish"] : byLetters(word));
    for (const name of languages) add(name, 1 / languages.length);
  }
  // "İ" lowercases to "i" and a combining dot, so it is counted on the original text.
  for (let count = (sample.match(/İ/g) ?? []).length; count > 0; count--) add("Turkish", 1);
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [name, top] = ranked[0];
  if (top < (name === "English" ? 3 : 2) || (hits.get(name) ?? 0) < words.length * share) return null;
  // A language with more than twice the score of another rules it out.
  const close = ranked.filter(([, score]) => score * 2 >= top);
  if (close.length === 1) return name;
  if (close.length === 2) return `${name} or ${close[1][0]}`;
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
 * and U.S. English needs none. Only Turkish is given one: a name alone kept every other language, and a locale would
 * pick a region (Spain or Mexico, Brazil or Portugal) the text may not be from.
 */
export function localePhrase(language: string | null): string {
  return language === "Turkish" ? "The person's locale is tr_TR." : "";
}

/** The rule that keeps the answer in the text's language. */
export function sameLanguageRule(language: Language | null): string {
  if (language === null) return "You MUST write in the same language as the text. NEVER translate it.";
  if (language === "Turkish") {
    return "You MUST write in Turkish, the language of the text, with correct Turkish letters (ç, ğ, ı, İ, ö, ş, ü). NEVER translate it.";
  }
  if (language === "Chinese") {
    return "You MUST write in Chinese, the language of the text, in the same characters as the text, simplified or traditional. NEVER translate it.";
  }
  if (language.includes(" or ")) return `You MUST write in the language of the text, ${language}, whichever it is. NEVER translate it.`;
  return `You MUST write in ${language}, the language of the text. NEVER translate it.`;
}

/** The rule for an answer in a language chosen by the extension, not by the text. */
export function fixedLanguageRule(name: string): string {
  return `You MUST write in ${name}.`;
}
