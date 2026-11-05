// Shared by the tests: a fake host whose model answers from a function, and what each call asked.
import { createFakeHost } from "@yabbistir/api/fake-host";

export const folder = new URL("..", import.meta.url);
export const text = (value) => ({ kind: "text", text: value });
export const code = (value) => ({ kind: "code", text: value });

/** The person's text inside a prompt: what stands between the opening and the closing marker. */
export function inside(prompt) {
  const open = /\n<(text(?:-[\w]+)?|diff(?:-[\w]+)?)>\n/.exec(prompt);
  if (!open) throw new Error("the prompt has no markers");
  const close = `\n</${open[1]}>`;
  return prompt.slice(open.index + open[0].length, prompt.lastIndexOf(close));
}

/**
 * A host whose model answers with `answer`: a string, or (input, prompt, options, call) => string, where `input`
 * is the text between the markers. `asked` collects every prompt and its options.
 */
export function writing(answer, options = {}) {
  const asked = [];
  const host = createFakeHost({
    folder,
    ...options,
    ai: (prompt, aiOptions) => {
      asked.push({ prompt, options: aiOptions });
      return typeof answer === "function" ? answer(inside(prompt), prompt, aiOptions, asked.length) : answer;
    },
  });
  return { host, asked };
}
