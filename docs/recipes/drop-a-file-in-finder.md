# Recipe: drop a file into Finder

An action that saves copied text as a Markdown note, named after its first line. With Finder in front, pasting it drops `Meeting notes.md` into the open folder.

It shows: writing a file with `yab.files.write`, a `file` result, and `targets` with `targetsOnly`. yabbistir's built-in *Paste to Finder as a File* does this for any item; this recipe shows how an extension makes its own file. [Download Video](../../extensions/dev.yabbistir.video-download) returns a file the same way, made by a program.

```sh
npm run new -- dev.yourname.save-note --template action
```

Replace the template's files with these, and delete `locales/tr.json` (or translate the keys).

## manifest.json

```json file=manifest.json
{
  "id": "dev.yourname.save-note",
  "version": "1.0.0",
  "apiVersion": 1,
  "defaultLocale": "en",
  "name": "name",
  "description": "description",
  "icon": "sf:doc.text",
  "author": "your-github-name",
  "license": "MIT",
  "categories": ["files", "text"],
  "contributes": {
    "actions": [
      { "id": "saveNote", "title": "saveNote.title", "subtitle": "saveNote.subtitle", "keywords": "saveNote.keywords",
        "input": "item", "accepts": { "kinds": ["text", "code"] }, "output": "file",
        "targets": ["finder"], "targetsOnly": true }
    ]
  }
}
```

- `"output": "file"`: `run` returns `{ file }`, a path in the call's work folder.
- `"targets": ["finder"]` with `"targetsOnly": true`: the action is offered only while Finder is the paste target, and comes first there. Anywhere else it would only paste a file reference, which is not what the person wants.
- No permission: writing in the work folder needs none, and the app moves the file to Finder.

## locales/en.json

```json file=locales/en.json
{
  "name": "Save Note",
  "description": "Saves copied text as a Markdown note in Finder.",
  "saveNote.title": "Save as Markdown note",
  "saveNote.subtitle": "Named after its first line",
  "saveNote.keywords": ["save", "note", "markdown", "file", "md"],
  "untitled": "Untitled note",
  "empty": "There is no text to save."
}
```

## src/index.ts

```ts file=src/index.ts
import type { Actions } from "@yabbistir/api";

/** "# Meeting notes" → "Meeting notes.md": the first line that has text, without Markdown heading marks or path characters. */
export function noteName(text: string, fallback: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const clean = first.replace(/^\s*#+\s*/, "").replace(/[/:\\]/g, "-").replace(/\s+/g, " ").trim();
  const short = Array.from(clean).slice(0, 60).join("").trim();
  return `${short || fallback}.md`;
}

export const actions: Actions = {
  saveNote: {
    run(item) {
      const text = item?.text ?? "";
      if (text.trim() === "") return { none: true, message: yab.t("empty") };
      // The work folder is the only place an extension writes; a file result must be there.
      const file = yab.files.write(noteName(text, yab.t("untitled")), text.endsWith("\n") ? text : `${text}\n`);
      return { file };
    },
  },
};
```

- `yab.files.write(name, data)` returns the file's path. `/` and `:` in a name become `-`, and `..` or an empty name is refused, but a good name is the extension's job.
- The work folder is removed when the call ends, unless the result names its files; then the app takes them into its output folder, Finder gets its copy, and the file joins history.

## tests/index.test.mjs

```js file=tests/index.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, noteName } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const finder = { target: { bundleID: "com.apple.finder", name: "Finder", kind: "finder" } };

describe("saveNote", () => {
  test("savesTheTextAsAMarkdownFile", async () => {
    const host = createFakeHost({ folder });
    const result = await host.run(actions.saveNote, { kind: "text", text: "# Meeting notes\n\n- ship it" }, finder);
    assert.match(result.file, /\/Meeting notes\.md$/);
    assert.equal(new TextDecoder().decode(host.files.get(result.file)), "# Meeting notes\n\n- ship it\n");
  });

  test("namesTheFileSafely", () => {
    assert.equal(noteName("  \n Q3/Q4: plans \n", "Untitled note"), "Q3-Q4- plans.md");
    assert.equal(noteName("###", "Untitled note"), "Untitled note.md");
    assert.equal(noteName("x".repeat(100), "Untitled note"), `${"x".repeat(60)}.md`);
  });

  test("saysSoWhenThereIsNothingToSave", async () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(await host.run(actions.saveNote, { kind: "text", text: "  " }, finder), { none: true, message: "There is no text to save." });
  });

  test("isOfferedOnlyForFinder", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    const [action] = manifest.contributes.actions;
    assert.deepEqual([action.targets, action.targetsOnly, action.output], [["finder"], true, "file"]);
  });
});
```

## Try it

```sh
npm test -- dev.yourname.save-note
npm run validate -- dev.yourname.save-note
npm run dev -- dev.yourname.save-note
```

Open a folder in Finder, copy some text in another app, then click the Finder window, press ⇧⌘V, select the text and press ⇧: *Save as Markdown note* leads the list, and ↵ drops the file into the folder.
