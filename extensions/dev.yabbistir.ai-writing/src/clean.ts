// What the model wraps around an answer, taken off before it is pasted: the markers the text was sent in, a code
// fence, a line such as "Here is the corrected text:", and quotes. Each is removed only when the person's own text
// did not have it, so a text that really starts with "Here's the plan:" keeps that line.

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

const preambles = [
  // "Sure! Here is the corrected text:", "Here's a friendlier version:", "Below is the reply:"
  /^(?:(?:sure|certainly|of course|okay|ok)[,!.]?\s)?(?:here(?:'|’)?s|here is|here are|below is|below are)\s[^\n]{0,120}:$/i,
  // "İşte düzeltilmiş metin:", "Tabii, işte daha kısa hali:" ("İ" is spelled out: it has no simple case folding)
  /^(?:tabii(?:\s?ki)?[,!.]?\s)?(?:[iİ]şte|[aA]şağıda)\s[^\n]{0,120}:$/iu,
  // A bare label: "Corrected text:", "Reply:", "Commit message:", "Düzeltilmiş metin:"
  /^(?:(?:the\s)?(?:corrected|rewritten|revised|shorter|shortened|formal|friendly|friendlier)\s(?:text|version|message)|reply|response|draft|explanation|commit message|pull request description|pr description|bullet points|action items|(?:düzeltilmiş|yeniden yazılmış|kısaltılmış|resmi|samimi)\s(?:metin|hali|sürüm)|yanıt|cevap|açıklama)\s?:$/iu,
];

/** Whether a line reads like the model introducing its answer. */
function isPreamble(line: string): boolean {
  return line.length <= 160 && preambles.some((pattern) => pattern.test(line));
}

/** Drops a first line that introduces the answer, when the person's text does not start with one too. */
export function stripPreamble(output: string, input: string): string {
  const line = firstLine(output);
  if (!isPreamble(line) || isPreamble(firstLine(input))) return output;
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

/** The answer as it should be pasted: the wrapping taken off, line ends made plain, ends trimmed. */
export function cleanAnswer(output: string, input: string, tag: string): string {
  let text = output.replace(/\r\n?/g, "\n").trim();
  text = stripMarkers(text, tag);
  text = stripFence(text, input);
  text = stripPreamble(text, input);
  text = stripQuotes(text, input);
  return stripMarkers(text, tag).trim();
}

// Apostrophes are optional, so the person's own "Im sorry but I cant help" is recognized as theirs.
const refusals = [
  /^(?:i(?:'|’)?m sorry|i am sorry|sorry|i apologi[sz]e)[,.]?\s(?:but\s)?i\s(?:can(?:'|’)?t|cannot|can not|am unable to|(?:'|’)?m unable to|won(?:'|’)?t)\s(?:help|assist|fulfil|fulfill|comply|do that|provide|process|rewrite|complete)/i,
  /^i\s(?:can(?:'|’)?t|cannot|am unable to|(?:'|’)?m unable to)\s(?:help|assist|fulfil|fulfill|comply)\s(?:with|you)/i,
  /^as an ai\b/i,
  /^(?:üzgünüm|maalesef)[,.]?\s[^\n]{0,80}(?:yardımcı olamam|yapamam|yerine getiremem)/iu,
];

/** Whether the answer is the model declining, rather than the text the person asked for. */
export function isRefusal(output: string, input: string): boolean {
  const line = firstLine(output);
  if (line.length > 300 || output.length > 600) return false;
  const declines = (text: string) => refusals.some((pattern) => pattern.test(text));
  return declines(line) && !declines(firstLine(input));
}
