// The ten writing tasks: what each asks Apple's on-device model, how its input is prepared and how its answer is
// shaped. The instructions are fixed English text written here (the model follows English instructions best, and a
// person's text never goes into them: Apple's model obeys instructions over the prompt, so the text goes only into
// the prompt, between markers). What language the answer is in is decided per call, in prompt.ts.

import { condenseDiff, looksLikeDiff } from "./diff.ts";
import { toBulletList, toChecklist, toCommitMessage, toPullRequestDescription } from "./format.ts";
import { latestMessage } from "./reply.ts";
import { shortenMiddle } from "./text.ts";

/** How a task's input is read. */
export type Input =
  /** Rewritten part by part, each part on its own, then put back together in order. */
  | { kind: "parts"; size: number; join: "keep" | "lines" }
  /** Read whole, once `prepare` has shortened it to what the model can read. */
  | { kind: "whole"; prepare: (text: string) => string }
  /** A diff, condensed to `budget` characters. */
  | { kind: "diff"; budget: number };

/** Which language the answer is in: the text's own, the app's for code that "Explain this" explains, or English. */
export type AnswerLanguage = "text" | "explain" | "english";

export interface Task {
  /** The id of the action that runs at once; the job for longer text is `${id}-long`. */
  id: string;
  input: Input;
  /** What the task does, as the instructions put it. */
  rule: string;
  /** The line before the person's text in the prompt. */
  ask: string;
  language: AnswerLanguage;
  temperature: number;
  /** The longest answer for a prompt text of this many characters. */
  maxTokens: (characters: number) => number;
  /** The answer's final shape, after the wrapping is taken off. */
  shape?: (answer: string) => string;
  /** The locale key for the notice when the answer is the text unchanged. */
  unchanged?: string;
  /** The locale key for the notice when the answer is empty once shaped. */
  nothing?: string;
  /** A reply that starts "Sorry, I can't…" is a real reply, not the model declining. */
  replyLike?: boolean;
}

/** About as many tokens as the text, with room to spare: an answer cut short would lose the end of the text. */
const asLong = (characters: number) => Math.min(2048, Math.ceil(characters / 2) + 128);
const fixed = (tokens: number) => () => tokens;

export const tasks: Task[] = [
  {
    id: "fix",
    input: { kind: "parts", size: 2400, join: "keep" },
    rule: "Correct the spelling, grammar and punctuation of the text. Change nothing else: keep its words, tone, line breaks, lists, emoji, names, links, @mentions and code as they are. If it has no mistakes, write it back unchanged.",
    ask: "Correct the mistakes in this text:",
    language: "text",
    temperature: 0,
    maxTokens: asLong,
    unchanged: "fix.unchanged",
  },
  {
    id: "shorter",
    input: { kind: "parts", size: 3200, join: "keep" },
    rule: "Rewrite the text to be about half as long. Keep its meaning, key facts, names, numbers, dates, links and tone. Cut repetition and filler.",
    ask: "Make this text shorter:",
    language: "text",
    temperature: 0.3,
    maxTokens: (characters) => Math.min(2048, Math.ceil(characters / 3) + 128),
    unchanged: "unchanged",
  },
  {
    id: "formal",
    input: { kind: "parts", size: 2400, join: "keep" },
    rule: "Rewrite the text in a more formal, polite and professional tone. Keep its meaning, facts, names, numbers, dates and links, about the same length, and its line breaks and lists.",
    ask: "Rewrite this text in a more formal tone:",
    language: "text",
    temperature: 0.4,
    maxTokens: asLong,
    unchanged: "unchanged",
  },
  {
    id: "friendly",
    input: { kind: "parts", size: 2400, join: "keep" },
    rule: "Rewrite the text in a warmer, friendlier and more casual tone that stays clear and respectful. Keep its meaning, facts, names, numbers, dates and links, about the same length, and its line breaks and lists. Add no emoji the text does not already have.",
    ask: "Rewrite this text in a friendlier tone:",
    language: "text",
    temperature: 0.5,
    maxTokens: asLong,
    unchanged: "unchanged",
  },
  {
    id: "bullets",
    input: { kind: "parts", size: 2400, join: "lines" },
    rule: "Turn the text into a short bullet list: one idea per line, each line starting with \"- \". Keep its facts, names, numbers and dates. No heading and no introduction.",
    ask: "Turn this text into bullet points:",
    language: "text",
    temperature: 0.2,
    maxTokens: asLong,
    shape: toBulletList,
  },
  {
    id: "action-items",
    input: { kind: "parts", size: 4000, join: "lines" },
    rule: "List the action items in the text: the tasks, follow-ups and decisions someone has to act on. Write one per line as \"- [ ] \" and the task, with who does it and by when if the text says so. If there are none, write exactly NONE.",
    ask: "List the action items in this text:",
    language: "text",
    temperature: 0.1,
    maxTokens: fixed(600),
    shape: toChecklist,
    nothing: "action-items.none",
  },
  {
    id: "reply",
    input: { kind: "whole", prepare: (text) => shortenMiddle(latestMessage(text), 5000) },
    rule: "Write a reply to the message, as the person who received it. Answer what it asks and match its tone and formality. Keep it short. Do not make up facts, dates or promises: where a detail is needed, write a short placeholder in square brackets, such as [time]. No subject line and no signature.",
    ask: "Write a reply to this message:",
    language: "text",
    temperature: 0.6,
    maxTokens: fixed(400),
    replyLike: true,
  },
  {
    id: "explain",
    input: {
      kind: "whole",
      prepare: (text) => (looksLikeDiff(text) ? condenseDiff(text, 5000) : shortenMiddle(text, 5000)),
    },
    rule: "Explain in plain words what the text means, for someone who is not an expert. If it is code, explain what it does and why, without repeating the code. Write a few short paragraphs, at most about 150 words, with no headings.",
    ask: "Explain this:",
    language: "explain",
    temperature: 0.3,
    maxTokens: fixed(500),
  },
  {
    id: "commit",
    input: { kind: "diff", budget: 6000 },
    rule: "Write a git commit message for the changes in the diff, in the Conventional Commits style. The first line is type(scope): summary, at most 72 characters, in the imperative mood, with no full stop at the end. The type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore or revert; leave out (scope) when there is no clear one. Then an empty line and a short body of one to three lines on what changed and why.",
    ask: "Write a commit message for this diff:",
    language: "english",
    temperature: 0.2,
    maxTokens: fixed(220),
    shape: toCommitMessage,
  },
  {
    id: "pr-description",
    input: { kind: "diff", budget: 6000 },
    rule: "Write a pull request description for the changes in the diff, in Markdown, laid out exactly like this:\n## Summary\nOne to three sentences on what the change does and why.\n\n## Changes\n- One line for each notable change.",
    ask: "Write a pull request description for this diff:",
    language: "english",
    temperature: 0.3,
    maxTokens: fixed(600),
    shape: toPullRequestDescription,
  },
];
