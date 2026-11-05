import type { Action, Actions, Context, Item, Result, YabError } from "@yabbistir/api";

import { cleanAnswer, isRefusal, stripPlaceholderSignature } from "./clean.ts";
import { looksLikeCode } from "./code.ts";
import { condenseDiff, looksLikeDiff } from "./diff.ts";
import { buildRequest, settingFor, type Setting } from "./prompt.ts";
import { tasks, type Task } from "./tasks.ts";
import { sameText, splitIntoParts, stopsMidSentence, type Part } from "./text.ts";
import { charactersFor, estimateTokens, pointWeight } from "./tokens.ts";

// A task whose answer is about as long as the text (a rewrite, a list, a reply) is two actions, and the manifest
// offers exactly one of them on an item. Up to `instantLimit` characters, and fewer than `denseLimit` characters
// of a dense script, the action runs at once and pastes: Apple's model answers that much well inside an action's
// 10-second limit. Longer text runs as a job (`<id>-long`): a card under the menu bar icon shows its progress and
// can cancel it, and it has no time limit, so a long text is rewritten part by part. A task whose answer is as long
// for a line as for a page (an explanation, a commit message, a PR description) is one action, always a job.

/** The longest text, in characters, the at-once action is offered on (the manifest's patterns say 400 too). */
export const instantLimit = 400;

/**
 * How many characters of Chinese, Japanese, Korean or Thai send a text to the job instead (the manifest's patterns
 * say 150 too): those are about a token each, so 150 of them take the model as long as 400 characters of English.
 */
export const denseLimit = 150;

/** How long the at-once action waits for the model before it says so, leaving room under the 10-second limit. */
export const instantDeadline = 8500;

/** The longest text a part-by-part task takes: about 6,000 words, some twenty parts. */
export const maxCharacters = 40_000;

export type Mode = "instant" | "job";

const none = (message: string): Result => ({ none: true, message });

const isYabError = (error: unknown): error is YabError =>
  error instanceof Error && typeof (error as Partial<YabError>).code === "string";

const late = Symbol("late");

type Answer = { answer: string; tag: string };

/**
 * The model's answer. A job waits as long as it takes and lets every error through, `unavailable` with the
 * app's own message. An at-once action turns `unavailable` and a slow model into a notice, with the app's
 * message: a failed action counts toward turning the extension off, and neither is the extension's fault.
 */
async function ask(task: Task, text: string, setting: Setting, mode: Mode, deadline: number): Promise<Answer | Result> {
  const request = buildRequest(task, text, setting);
  const answer = yab.ai.generate(request.prompt, request.options);
  if (mode === "job") return { answer: await answer, tag: request.tag };
  // A failure that comes after the deadline is no one's to handle.
  answer.catch(() => undefined);
  let timer: number | undefined;
  const timeout = new Promise<typeof late>((resolve) => {
    timer = setTimeout(() => resolve(late), Math.max(0, deadline));
  });
  try {
    const first = await Promise.race([answer, timeout]);
    if (first === late) return none(yab.t("slow"));
    return { answer: first, tag: request.tag };
  } catch (error) {
    if (isYabError(error) && error.code === "unavailable") return none(error.message || yab.t("unavailable"));
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The text shortened by `cut` to at most `tokens` tokens, measured again in case the estimate was off. */
function fitted(text: string, size: number, tokens: number, latin: number, cut: (size: number) => string): string {
  let room = Math.min(size, charactersFor(text, tokens, latin));
  let core = cut(room);
  for (let round = 0; round < 3; round++) {
    const used = estimateTokens(core, latin);
    if (used <= tokens) break;
    room = Math.max(1, Math.floor((room * tokens) / used * 0.95));
    core = cut(room);
  }
  return core;
}

/** The stretches of text the model is asked about, one call each, each within the task's characters and tokens. */
function partsFor(task: Task, text: string, setting: Setting): Part[] {
  const input = task.input;
  if (input.kind === "parts") {
    const weigh = (point: number) => pointWeight(point, setting.latin);
    return splitIntoParts(text, input.size, { tokens: input.tokens, weigh });
  }
  const cut = input.kind === "diff"
    ? (size: number) => condenseDiff(text, size)
    : (size: number) => input.prepare(text, size);
  return [{ before: "", core: fitted(text, input.size, input.tokens, setting.latin, cut), after: "" }];
}

/**
 * Whether a rewrite stopped before the end of its part: it is far shorter than the part, or shorter and it stops in
 * the middle of a sentence where the part ends one. A short text is never judged this way.
 */
function cutShort(task: Task, part: string, answer: string): boolean {
  if (part.length < 120 || answer === "") return false;
  if (task.minShare !== undefined && answer.length < part.length * task.minShare) return true;
  return task.keepsSentences === true && answer.length < part.length && stopsMidSentence(part, answer);
}

function formatNumber(value: number, language: string): string {
  try {
    return new Intl.NumberFormat(language).format(value);
  } catch {
    return String(value);
  }
}

/** Shows how far a job is: a state word for one call, "2 / 5 parts" for several. */
function report(task: Task, done: number, total: number): void {
  if (total === 1) yab.job.progress(null, yab.t(`${task.id}.working`));
  else yab.job.progress(done / total, yab.t("parts", { done, total }));
}

async function write(task: Task, mode: Mode, item: Item | null, ctx: Context, deadline: number): Promise<Result> {
  const text = (item?.text ?? "").trim();
  if (text === "") return none(yab.t("empty"));
  if (task.input.kind === "parts" && text.length > maxCharacters) {
    return none(yab.t("tooLong", { max: formatNumber(maxCharacters, ctx.language) }));
  }
  const started = Date.now();
  const setting = settingFor(text, ctx.language, item?.kind === "code" || looksLikeDiff(text) || looksLikeCode(text));
  const parts = partsFor(task, text, setting);
  const answers: string[] = [];
  for (const [index, part] of parts.entries()) {
    ctx.signal.throwIfAborted();
    if (mode === "job") report(task, index, parts.length);
    const reply = await ask(task, part.core, setting, mode, deadline - (Date.now() - started));
    if (!("answer" in reply)) return reply;
    const cleaned = cleanAnswer(reply.answer, part.core, reply.tag);
    const answer = task.keepsSentences ? stripPlaceholderSignature(cleaned, part.core) : cleaned;
    if (!task.replyLike && isRefusal(answer, part.core)) return none(yab.t("declined"));
    // A rewrite that stopped early would paste the text without its end: say so rather than paste it.
    if (cutShort(task, part.core, answer)) return none(yab.t("cutShort"));
    answers.push(task.shape ? task.shape(answer, text) : answer);
  }
  if (mode === "job" && parts.length > 1) report(task, parts.length, parts.length);
  if (answers.every((answer) => answer === "")) return none(yab.t(task.nothing ?? "noAnswer"));
  // A part the model left empty keeps its own text, so nothing of the person's text is lost.
  const joined = task.input.kind === "parts" && task.input.join === "keep"
    ? parts.map((part, index) => part.before + (answers[index] || part.core) + part.after).join("").trim()
    : answers.filter((answer) => answer !== "").join("\n");
  const result = task.shape && parts.length > 1 ? task.shape(joined, text) : joined;
  if (task.unchanged && sameText(result, text)) return none(yab.t(task.unchanged));
  return { text: result };
}

/** One task as an action, at once or as a job. `deadline` is the at-once action's, and only tests change it. */
export function writingAction(task: Task, mode: Mode, deadline = instantDeadline): Action {
  return { run: (item, ctx) => write(task, mode, item, ctx, deadline) };
}

/** The actions of a task, by id: at once and as a job for a split task, the job alone for the others. */
function actionsOf(task: Task): [string, Action][] {
  if (task.form === "job") return [[task.id, writingAction(task, "job")]];
  return [[task.id, writingAction(task, "instant")], [`${task.id}-long`, writingAction(task, "job")]];
}

export const actions: Actions = Object.fromEntries(tasks.flatMap(actionsOf));

export { tasks };
