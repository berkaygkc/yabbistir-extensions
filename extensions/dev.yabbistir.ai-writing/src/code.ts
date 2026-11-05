// Whether a text item is really code: code copied from a web page or a chat often arrives as text. "Explain this"
// explains code in the app's language, since code has no language of its own (its keywords are English words).
// Line by line, with plain string checks and short anchored patterns, so a long text costs no more than its length.

/** Line ends that prose almost never has. */
const codeEnds = [";", "{", "}", "[", "(", "=>"];

/** Operators that prose almost never has. */
const operators = ["=>", "===", "!==", "==", "!=", "&&", "||", "::", "+=", "-=", ":=", "</", "/>"];

/** A comment or a closing bracket at the start of a line. */
const codeMark = /^(?:#include|#define|#!|\/\/|\/\*|\*\/|[}\])])/;

/** A line that starts with a keyword: "const total = …", "def load(path):", "import React from 'react'". */
const keywordStart = /^(?:(?:export |async |public |private |protected |static )*(?:function|const|let|var|def|class|fn|func|struct|enum|interface|import|package|namespace|using|return|SELECT|INSERT|UPDATE|DELETE|CREATE) )/;

/** The characters that make a keyword line code rather than a sentence that starts with "return" or "import". */
const codeCharacter = /[(){}[\];=<>:'"*]/;

/** Python's and the shell's block lines: "if x:", "for item in items:", "else:". */
const blockLine = /^(?:if|elif|else|for|while|try|except|finally|with|def|class)\b[^\n]{0,280}:$/;

/** A call on its own line: "print(total)", "items.sort(by: name)". */
const callStart = /^[\w.$]{1,80}\(/;

/** An assignment: "total = 0", "self.items += [item]". */
const assignment = /^[\w.$[\]]{1,80} [-+*/]?= /;

function isCodeLine(raw: string): boolean {
  const line = raw.trim();
  if (codeMark.test(line) || blockLine.test(line)) return true;
  if (keywordStart.test(line) && codeCharacter.test(line)) return true;
  if (codeEnds.some((end) => line.endsWith(end)) && /[(){}[\];=]/.test(line.slice(0, -1))) return true;
  if (callStart.test(line) && (line.endsWith(")") || line.endsWith(");"))) return true;
  if (assignment.test(line)) return true;
  return operators.some((operator) => line.includes(operator));
}

/** Whether most of the text's lines read as code. Reads the first 4,000 characters. */
export function looksLikeCode(text: string): boolean {
  let lines = 0;
  let code = 0;
  for (const line of text.slice(0, 4000).split("\n")) {
    if (line.trim() === "") continue;
    lines++;
    if (line.length <= 300 && isCodeLine(line)) code++;
  }
  return lines > 0 && code * 2 >= lines;
}
