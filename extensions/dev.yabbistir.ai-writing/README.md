# AI Writing

Ten actions for copied text, written by Apple Intelligence, the on-device model. The text never leaves your Mac.

| Action | Offered on | What it pastes |
|---|---|---|
| Fix spelling and grammar | Text | The same text with its mistakes corrected, and nothing else changed |
| Make shorter | Text | About half as long, with the facts kept |
| Make more formal | Text | The same message in a polite, professional tone |
| Make friendlier | Text | The same message in a warmer, more casual tone |
| Turn into bullet points | Text | One idea per line, each starting with `- ` |
| Extract action items | Text | A checklist: `- [ ] Ada: send the draft by Friday` |
| Draft a reply | Text | A short reply to the message, in its tone |
| Explain this | Text and code | A plain-words explanation, at most about 150 words |
| Write a commit message | A copied diff | A Conventional Commits message |
| Write a PR description | A copied diff | `## Summary` and `## Changes` in Markdown |

Rewrites answer in the language of the text, and never translate it: that is what [Translate](../dev.yabbistir.translate) is for. Translation and summaries are not repeated here.

## Examples

Copy `can u send me the report before the meting tmrw`, press ⇧⌘V, press ⇧ on the item and choose *Fix spelling and grammar*. It pastes:

```text
Can you send me the report before the meeting tomorrow?
```

Copy the output of `git diff --staged` and choose *Write a commit message*:

```text
fix(upload): retry a failed request up to three times

A short network drop no longer fails the whole upload: the client
retries with a growing pause between tries.
```

## Short text at once, long text as a job

An action has 10 seconds, and rewriting a long text takes the model longer than that. So each action comes in two forms, and the panel offers only the one that fits the item:

- **Up to 400 characters** (a chat message, a short mail), the action runs at once and pastes, like any other.
- **Longer text** runs as a job. The panel closes, and a card under the menu bar icon shows the progress ("2 / 5 parts") with a button to cancel. When it is done, the result is pasted if the app you started from is still in front; otherwise it is on the clipboard.

Characters are counted on the trimmed text, as the app counts them: an emoji is one.

## Long texts

The model reads a few thousand words at most, so a long text is prepared first:

- **Fix, Make shorter, Make more formal, Make friendlier, Bullet points, Action items** work part by part. The text is cut at paragraph breaks, then at sentence ends, then between words, and each part is rewritten on its own; the line breaks between parts are kept as they were. Action items from all parts make one checklist, without repeats. These take up to 40,000 characters (about 6,000 words); a longer text is refused with a notice, never cut.
- **Draft a reply** reads the newest message of a copied mail thread: it stops at a line such as `On Mon, 3 May 2026, Ada wrote:` (or the Turkish Apple Mail line, `-----Original Message-----`, an Outlook `From:` / `Sent:` header) and leaves out lines quoted with `>`. A text still longer than 5,000 characters keeps its start and its end.
- **Explain this** keeps the start and the end of a text longer than 5,000 characters.
- **Commit message and PR description** get a condensed diff of at most 6,000 characters: a list of the files with their added and removed lines, then the changes. Lock files (`package-lock.json`, `yarn.lock`, `Cargo.lock` and others), minified files and binaries are counted but not shown. Context lines go first when the diff is too long, then each file keeps an even share of the room. Lines over 300 characters are cut.

## Languages

- Rewrites, lists, replies and explanations of text are in the text's own language. Turkish and English are recognized and named to the model, which keeps its answer in them more reliably; any other language is asked to stay as it is.
- *Explain this* on code answers in the app's language.
- Commit messages and PR descriptions are in English, the convention for both.

## What is cleaned from the answer

A small model sometimes wraps its answer. Before pasting, the extension takes off a code fence around the whole answer, quotes around all of it, a first line such as "Here is the corrected text:" or "İşte düzeltilmiş metin:", and the markers the text was sent in. Each is kept when your own text had it.

- Bullet points become `- ` lines, numbered or not; action items become `- [ ] ` lines.
- A commit message's subject is at most 72 characters, with its type in lower case and no full stop; the body is wrapped at 72 characters.
- A PR description's "Summary:" and "Changes:" become `## Summary` and `## Changes`.
- When the answer is the model declining ("I'm sorry, but I can't help with that"), nothing is pasted and a notice says so. When *Fix* finds no mistake, the notice says "No mistakes found."

## When Apple Intelligence can't answer

Apple Intelligence must be turned on in System Settings, on a Mac that supports it, in a language it supports.

- The action that runs at once shows the app's own message as a notice ("Apple Intelligence is turned off…"). It does not fail: a failed action counts toward turning an extension off, and this is not the extension's fault. If the model takes more than 8.5 seconds, a notice says so, before the 10-second limit.
- A job fails on its card, with the app's own error.
- Cancelling a job stops it at once.

## Permissions

None. The on-device model is a service of the app itself: the extension needs no network, runs no programs and reads no history.

## Privacy

Your text goes only to the on-device model, and only when you choose an action. It is never logged and never put in a notice. It goes into the model's prompt between markers it cannot close, never into the instructions: Apple's model obeys its instructions over the prompt, so text placed there could steer it.

## Limits

- The on-device model is small. It can miss a mistake, misread a tone or describe a diff loosely. Read the result before you send it.
- Parts of a long text are rewritten one by one, so the tone can shift a little from one part to the next.
- A diff is recognized by a `diff --git` line or a hunk header (`@@ -12,7 +12,8 @@`) at the start of a line, within its first 4,000 characters.
- A commit subject the model writes longer than 72 characters is cut between words.
- Needs yabbistir 0.4.0 or later.

## Sources

- Apple, [TN3193: Managing the on-device foundation model's context window](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window): the 4,096-token context shared by instructions, prompt and answer; about three to four characters a token in English; splitting a large task into several calls; why a tight answer limit can cut an answer short.
- Apple, [Improving the safety of generative model output](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output): instructions take precedence over the prompt, so untrusted text stays out of them.
- Apple, [Supporting languages and locales with Foundation Models](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models): the model answers in the language of its input; the exact phrase "The person's locale is tr_TR."; "You MUST respond in …".
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): the `type(scope): description` form, `!` for a breaking change, and the types it names.

The word lists in `src/language.ts` and the list of lock files in `src/diff.ts` are written for this extension.

## Develop

```sh
npm test -- dev.yabbistir.ai-writing          # the tests, against the fake host
npm run build -- dev.yabbistir.ai-writing     # build, check and pack dist/dev.yabbistir.ai-writing-1.0.0.yabext
npm run dev -- dev.yabbistir.ai-writing       # build, link into yabbistir and rebuild on every change
```
