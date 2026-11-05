// What the model wraps around an answer, taken off before it is pasted: the markers the text was sent in, a code
// fence, a line such as "Here is the corrected text:", and quotes. Each is removed only when the person's own text
// did not have it, so a text that really starts with "Here's the plan:" keeps that line.

import { foldedWords, overlap } from "./words.ts";

/** The first line of a text, without its line end. */
function firstLine(text: string): string {
  const end = text.indexOf("\n");
  return (end === -1 ? text : text.slice(0, end)).trim();
}

/** Takes off the `<text>` and `</text>` markers the model may echo. */
function stripMarkers(output: string, tag: string): string {
  let text = output;
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  if (text.startsWith(open)) text = text.slice(open.length).trimStart();
  if (text.endsWith(close)) text = text.slice(0, -close.length).trimEnd();
  return text;
}

/** The inside of a code fence around the whole answer (```lang … ```), or the answer as it is. */
export function stripFence(output: string, input: string): string {
  if (!output.startsWith("```") || !output.endsWith("```") || input.startsWith("```")) return output;
  const firstBreak = output.indexOf("\n");
  if (firstBreak === -1 || output.length < firstBreak + 4) return output;
  const opener = output.slice(3, firstBreak).trim();
  if (opener.includes("`") || opener.includes(" ")) return output;
  const inside = output.slice(firstBreak + 1, output.length - 3);
  // A fence inside means the answer is several blocks, not one wrapped answer.
  if (inside.includes("\n```")) return output;
  return inside.trim();
}

/** A line that introduces what follows: "Sure! Here is the corrected text:", "Below are the action items:". */
const introductions = [
  /^(?:(?:sure|certainly|of course|okay|ok)[,!.]?\s)?(?:here(?:'|’)?s|here is|here are|below is|below are)\s([^\n]{0,120}):$/i,
  // "İşte düzeltilmiş metin:", "Tabii, işte daha kısa hali:" ("İ" is spelled out: it has no simple case folding)
  /^(?:tabii(?:\s?ki)?[,!.]?\s)?(?:[iİ]şte|[aA]şağıda)\s([^\n]{0,120}):$/iu,
];

/** A bare label: "Corrected text:", "Reply:", "Commit message:", "Düzeltilmiş metin:". */
const label = /^(?:(?:the\s)?(?:corrected|rewritten|revised|shorter|shortened|formal|friendly|friendlier)\s(?:text|version|message)|reply|response|draft|explanation|commit message|pull request description|pr description|bullet points|action items|(?:düzeltilmiş|yeniden yazılmış|kısaltılmış|resmi|samimi)\s(?:metin|hali|sürüm)|yanıt|cevap|açıklama)\s?:$/iu;

/** The starts of words that name an answer, folded ("açıklama" → "aciklama"), English and Turkish. */
const answerWords = [
  "text", "version", "repl", "respons", "rewrit", "revis", "correct", "edit", "list", "point", "bullet", "item",
  "checklist", "task", "todo", "explan", "messag", "draft", "summar", "descript", "commit", "result", "output",
  "metin", "metn", "hali", "surum", "yanit", "cevap", "liste", "madde", "aciklama", "mesaj", "taslak",
  "duzelt", "ozet", "gorev", "yapilacak", "sonuc",
];

/** Whether a line's words name the answer itself: "the corrected text", "a friendlier version", "daha kısa hali". */
function namesTheAnswer(words: string): boolean {
  return foldedWords(words).some((word) => answerWords.some((start) => word.startsWith(start)));
}

/**
 * Whether a line reads like the model introducing its answer. "Here are my thoughts:" introduces an answer only
 * when the person's own first line did not say "my thoughts" too: then it is their line, rewritten.
 */
function introducesAnswer(line: string, input: string): boolean {
  if (line.length > 160) return false;
  if (label.test(line)) return true;
  for (const pattern of introductions) {
    const found = pattern.exec(line);
    if (found) return namesTheAnswer(found[1]) || overlap(found[1], firstLine(input)) === 0;
  }
  return false;
}

/** Whether the person's own first line is an introduction, which their text then really starts with. */
function startsWithIntroduction(input: string): boolean {
  const line = firstLine(input);
  return line.length <= 160 && (label.test(line) || introductions.some((pattern) => pattern.test(line)));
}

/** Drops a first line that introduces the answer, when the person's text does not start with one too. */
export function stripPreamble(output: string, input: string): string {
  const line = firstLine(output);
  if (!introducesAnswer(line, input) || startsWithIntroduction(input)) return output;
  const rest = output.slice(output.indexOf("\n") + 1).trim();
  return output.includes("\n") && rest !== "" ? rest : output;
}

const quotePairs: [string, string][] = [["\"", "\""], ["“", "”"], ["„", "“"], ["«", "»"], ["'", "'"], ["‘", "’"], ["「", "」"]];

/** The answer without one pair of quotes around all of it, when the person's text had none and none are inside. */
export function stripQuotes(output: string, input: string): string {
  for (const [open, close] of quotePairs) {
    if (output.length < open.length + close.length + 1 || !output.startsWith(open) || !output.endsWith(close)) continue;
    if (input.startsWith(open) && input.endsWith(close)) return output;
    const inside = output.slice(open.length, output.length - close.length);
    if (inside.includes(open) || inside.includes(close)) return output;
    return inside.trim();
  }
  return output;
}

/**
 * The answer with square brackets the model escaped as Markdown made plain again: it writes a reply's placeholder
 * as "\[name]" now and then. Kept when the person's own text has a backslash, as code or a path might.
 */
export function stripEscapes(output: string, input: string): string {
  if (input.includes("\\") || !output.includes("\\")) return output;
  return output.split("\\[").join("[").split("\\]").join("]");
}

/** The last line of `text`, and where it starts; the whole text when it has one line. */
function lastLine(text: string): [string, number] {
  const start = text.lastIndexOf("\n") + 1;
  return [text.slice(start).trim(), start];
}

/**
 * A rewrite without the signature the model added at its end: a line that is only a placeholder ("[Your Name]",
 * "[İsminiz]"), and the short sign-off just above it ("Best regards,") when the person's text does not have that
 * line. Kept when the person's text has square brackets of its own.
 */
export function stripPlaceholderSignature(output: string, input: string): string {
  if (input.includes("[")) return output;
  const [placeholder, start] = lastLine(output);
  if (start === 0 || !/^\[[^[\]\n]{1,40}\]$/.test(placeholder)) return output;
  let text = output.slice(0, start).trimEnd();
  const [signOff, signOffStart] = lastLine(text);
  if (signOffStart > 0 && signOff.length <= 40 && signOff.endsWith(",") && !input.includes(signOff)) {
    text = text.slice(0, signOffStart).trimEnd();
  }
  return text;
}

/** The answer as it should be pasted: the wrapping taken off, line ends made plain, ends trimmed. */
export function cleanAnswer(output: string, input: string, tag: string): string {
  let text = stripEscapes(output.replace(/\r\n?/g, "\n").trim(), input);
  text = stripMarkers(text, tag);
  text = stripFence(text, input);
  text = stripPreamble(text, input);
  text = stripQuotes(text, input);
  return stripMarkers(text, tag).trim();
}

// What the model says when it declines. Apostrophes are optional, so "Im sorry but I cant help" counts too.
const refusals = [
  /^(?:i(?:'|’)?m sorry|i am sorry|sorry|i apologi[sz]e)[,.]?\s(?:but\s)?i\s(?:can(?:'|’)?t|cannot|can not|am unable to|(?:'|’)?m unable to|won(?:'|’)?t)\s(?:help|assist|fulfil|fulfill|comply|do that|provide|process|rewrite|complete)/i,
  /^i\s(?:can(?:'|’)?t|cannot|am unable to|(?:'|’)?m unable to)\s(?:help|assist|fulfil|fulfill|comply)\s(?:with|you)/i,
  /^as an ai\b/i,
  /^(?:üzgünüm|maalesef)[,.]?\s[^\n]{0,80}(?:yardımcı olamam|yerine getiremem)/iu,
];

/** Words of saying no, folded: when the person's own text has one, a rewrite of it may well start "Sorry, I can't". */
const declineWords = new Set([
  "sorry", "cant", "cannot", "unable", "wont", "apologize", "apologise", "unfortunately", "regret", "decline",
  "uzgunum", "maalesef", "malesef", "ozur", "ozurler",
]);

/** Turkish verbs said with "can't" or "won't": "olamam", "edemem", "yapamayacağım", "gelemeyiz". */
const turkishNo = ["amam", "emem", "amayiz", "emeyiz", "amayacagim", "emeyecegim", "amayacagiz", "emeyecegiz"];

/** Whether the person's text itself says no or says sorry. */
function saysNo(text: string): boolean {
  return foldedWords(text).some((word) => declineWords.has(word)
    || (word.length >= 6 && turkishNo.some((ending) => word.endsWith(ending))));
}

/**
 * Whether the answer is the model declining, rather than the text the person asked for. The app already reports
 * the model's own refusals as `unavailable`; this only catches one written out as an answer, and leans towards
 * pasting: an answer that starts like a refusal is one only when the person's text does not say no itself and
 * the answer has little to do with the text (under a quarter of its words).
 */
export function isRefusal(output: string, input: string): boolean {
  const line = firstLine(output);
  if (line.length > 300 || output.length > 600) return false;
  if (!refusals.some((pattern) => pattern.test(line))) return false;
  return !saysNo(input) && overlap(input, output) < 0.25;
}
