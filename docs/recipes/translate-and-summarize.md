# Recipe: translate and summarize on the Mac

Two actions on copied text: *Translate to English* and *Translate to Turkish* with the system's translation, and *Summarize* with Apple Intelligence, the on-device model. Nothing leaves the Mac, so neither needs a permission.

It shows: `yab.translate`, `yab.ai.generate`, variants, a job for the slower call, and letting the app's own messages through. [Translate](../../extensions/dev.yabbistir.translate) is the real extension.

```sh
npm run new -- dev.yourname.translate --template action
```

Replace the template's files with these, and delete `locales/tr.json` (or translate the keys).

## manifest.json

```json file=manifest.json
{
  "id": "dev.yourname.translate",
  "version": "1.0.0",
  "apiVersion": 1,
  "defaultLocale": "en",
  "name": "name",
  "description": "description",
  "icon": "sf:character.bubble",
  "author": "your-github-name",
  "license": "MIT",
  "categories": ["text", "ai"],
  "contributes": {
    "actions": [
      { "id": "translate", "title": "translate.title", "keywords": "translate.keywords", "input": "item",
        "accepts": { "kinds": ["text"] }, "output": "text",
        "variants": [
          { "id": "en", "title": "en.title", "subtitle": "onThisMac" },
          { "id": "tr", "title": "tr.title", "subtitle": "onThisMac" }
        ] },
      { "id": "summarize", "title": "summarize.title", "keywords": "summarize.keywords", "input": "item",
        "accepts": { "kinds": ["text"] }, "output": "text", "job": true, "verb": "summarize.verb", "failTitle": "summarize.failed" }
    ]
  }
}
```

- The two variants are two rows; `ctx.variant` is `"en"` or `"tr"`.
- Summarizing can take several seconds, so it is a job: the card shows it working, and the person can cancel. Translation is quick enough for an action.
- No permissions: translation and the on-device model are the app's services.

## locales/en.json

```json file=locales/en.json
{
  "name": "Translate",
  "description": "Translates and summarizes text on this Mac.",
  "translate.title": "Translate",
  "translate.keywords": ["translate", "translation", "english", "turkish"],
  "en.title": "Translate to English",
  "tr.title": "Translate to Turkish",
  "onThisMac": "On this Mac",
  "already.en": "The text is already in English.",
  "already.tr": "The text is already in Turkish.",
  "empty": "There is no text to work on.",
  "summarize.title": "Summarize",
  "summarize.keywords": ["summarize", "summary", "shorten", "tl;dr"],
  "summarize.verb": "Summarize",
  "summarize.failed": "Couldn’t summarize",
  "summarizing": "Summarizing",
  "instructions": "Summarize the text in at most three sentences, in the language it is written in. Write only the summary."
}
```

## src/index.ts

```ts file=src/index.ts
import type { Actions } from "@yabbistir/api";

/** The model reads a few thousand words at most; longer text is cut first, never in the middle of a character. */
export const maxCharacters = 6000;

export function cut(text: string, limit = maxCharacters): string {
  const characters = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return characters.length <= limit ? text : characters.slice(0, limit).join("");
}

// The app's errors (no language pack, Apple Intelligence turned off, a cancel) are never caught here:
// they carry the app's own message, in the person's language.
export const actions: Actions = {
  translate: {
    async run(item, ctx) {
      const text = item?.text ?? "";
      if (text.trim() === "") return { none: true, message: yab.t("empty") };
      const to = ctx.variant === "tr" ? "tr" : "en";
      const result = await yab.translate(text, { to });
      // A text already in the target language comes back as it is; say so instead of pasting a copy.
      if (result.from.split("-")[0].toLowerCase() === to) return { none: true, message: yab.t(`already.${to}`) };
      return { text: result.text };
    },
  },
  summarize: {
    async run(item) {
      const text = (item?.text ?? "").trim();
      if (text === "") return { none: true, message: yab.t("empty") };
      yab.job.progress(null, yab.t("summarizing"));
      const summary = await yab.ai.generate(cut(text), { instructions: yab.t("instructions"), temperature: 0.3, maxTokens: 300 });
      return { text: summary.trim() };
    },
  },
};
```

- `yab.translate` recognizes the source language when `from` is left out, and says which it was.
- `yab.ai.generate` rejects with `unavailable` when this Mac cannot run the model, it is turned off, or still getting ready; the message says which. Let it through.
- Both work only in a run the person started: never as a hint, in a detector or in a rule.

## tests/index.test.mjs

```js file=tests/index.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions, cut } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const text = (value) => ({ kind: "text", text: value });

describe("translate", () => {
  test("translatesToTheChosenLanguage", async () => {
    const seen = [];
    const host = createFakeHost({ folder, translate: (input, options) => {
      seen.push(options);
      return { text: "Merhaba dünya", from: "en" };
    } });
    assert.deepEqual(await host.run(actions.translate, text("Hello world"), { variant: "tr" }), { text: "Merhaba dünya" });
    assert.deepEqual(seen, [{ to: "tr" }]);
  });

  test("saysSoWhenTheTextIsAlreadyInThatLanguage", async () => {
    const host = createFakeHost({ folder, translate: (input) => ({ text: input, from: "en-GB" }) });
    assert.deepEqual(await host.run(actions.translate, text("Hello"), { variant: "en" }), { none: true, message: "The text is already in English." });
  });

  test("letsTheAppsMessageThrough", async () => {
    const host = createFakeHost({ folder, translate: () => yabError("unavailable", "The language pack isn’t downloaded.") });
    await assert.rejects(host.run(actions.translate, text("Hello"), { variant: "tr" }), { code: "unavailable", message: "The language pack isn’t downloaded." });
  });
});

describe("summarize", () => {
  test("summarizesWithTheInstructions", async () => {
    const seen = [];
    const host = createFakeHost({ folder, ai: (prompt, options) => {
      seen.push({ prompt, options });
      return " A short summary. ";
    } });
    assert.deepEqual(await host.run(actions.summarize, text("A long text.")), { text: "A short summary." });
    assert.equal(seen[0].prompt, "A long text.");
    assert.match(seen[0].options.instructions, /three sentences/);
    assert.deepEqual(host.progress, [{ fraction: null, message: "Summarizing" }]);
  });

  test("cutsLongTextOnACharacterBoundary", () => {
    assert.equal(cut("ab👍🏽cd", 3), "ab👍🏽");
  });

  test("anUnavailableModelIsLetThrough", async () => {
    const host = createFakeHost({ folder });
    await assert.rejects(host.run(actions.summarize, text("Text")), { code: "unavailable" });
  });

  test("neverRunsWithoutThePersonAsking", async () => {
    const host = createFakeHost({ folder, ai: "unused" });
    await assert.rejects(host.hint(actions.summarize, text("Text")), { code: "permissionDenied" });
  });
});
```

## Try it

```sh
npm test -- dev.yourname.translate
npm run validate -- dev.yourname.translate
npm run dev -- dev.yourname.translate
```

Summarizing needs Apple Intelligence turned on in System Settings. A missing translation language pack is offered for download by the app itself.
