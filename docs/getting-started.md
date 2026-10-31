# Getting started

This page takes you from an empty folder to a working action: **Slugify**, which turns copied text such as `Release notes 2.0!` into `release-notes-2-0`. You will scaffold it, write it, test it without the app, and then run it in yabbistir.

You need:

- macOS 26 or later on Apple silicon, with yabbistir installed (only to try the extension in the app; writing and testing it needs nothing but Node).
- Node 22.18 or later. The tests import TypeScript directly, which older Node versions cannot do. `node --version` tells you.
- A clone of this repository with its dependencies: `npm install` in its root folder.

Every command below runs from the repository's root folder.

## 1. Scaffold the extension

Pick an id: a reverse-domain name you control, lowercase, such as `dev.yourname.slugify`. It becomes the folder name and never changes once published.

```sh
npm run new -- dev.yourname.slugify --template action --author your-github-name
```

`--author` sets the manifest's `author`: how you want to be credited in the store, your name or your GitHub user name. Leave it out and `npm run new` uses your `git config user.name`, and prints it so you can change it in manifest.json.

This creates `extensions/dev.yourname.slugify/` from the action template:

```text
extensions/dev.yourname.slugify/
  manifest.json        what the extension is and what it adds
  src/index.ts         the code
  locales/en.json      English strings (required)
  locales/tr.json      Turkish strings (optional: translate them or delete the file)
  tests/index.test.mjs tests that run against a fake host, without the app
  README.md            what it does, an example, and why it needs each permission
  CHANGELOG.md         a "## <version>" section per version
```

The template is a working "Reverse text" action, and its files describe that sample. Replace them with the ones below:

- **Only English is required; Turkish is optional.** The template's `locales/tr.json` holds Turkish strings for its sample, so delete it, or translate your new keys into it ([Localization](localization.md)). This page deletes it.
- Its README.md and CHANGELOG.md are placeholders until you rewrite them in step 8.

## 2. The manifest

`manifest.json` tells the app everything it needs without running any code: the name, the icon, and the action, with the items it is offered on.

```json file=manifest.json
{
  "id": "dev.yourname.slugify",
  "version": "1.0.0",
  "apiVersion": 1,
  "defaultLocale": "en",
  "name": "name",
  "description": "description",
  "icon": "sf:textformat.abc",
  "author": "your-github-name",
  "license": "MIT",
  "categories": ["text"],
  "contributes": {
    "actions": [
      { "id": "slugify", "title": "slugify.title", "keywords": "slugify.keywords", "input": "item",
        "accepts": { "kinds": ["text"], "pattern": "^.{1,200}$" }, "output": "text", "hint": true }
    ]
  }
}
```

What the fields mean:

- `name`, `description`, `title` and `keywords` are **keys** into `locales/en.json`, never the text itself.
- `"input": "item"` makes it a transform: it works on the item the person picked. A generator, which makes something from nothing, says `"input": "none"`.
- `accepts` decides where the action is offered, from the manifest alone; no JavaScript runs while the person types. Here it is offered on text of one line, up to 200 characters. The pattern is searched for, so `^…$` makes it match the whole text.
- `"hint": true` runs the action early and shows its result on the row, so the person sees `release-notes-2-0` before choosing it. A hint runs without effects (no network, no programs) and must finish in 500 ms. Its result is what gets pasted.
- `author` is how you want to be credited: your name or your GitHub user name. When it is the GitHub user name you commit with, a pull request by someone else that changes your extension mentions you.

Every field is in the [manifest reference](manifest.md).

## 3. The strings

```json file=locales/en.json
{
  "name": "Slugify",
  "description": "Turns copied text into a URL slug.",
  "slugify.title": "Slugify",
  "slugify.keywords": ["slug", "slugify", "url", "permalink"],
  "empty": "There is nothing to turn into a slug."
}
```

`keywords` is a list: search offers the action when one of them starts with what the person typed.

## 4. The code

`src/index.ts` exports `actions`, an object keyed by the action ids in the manifest. Each action has a `run(item, ctx)` that returns a result. The app writes the result to the clipboard, pastes it, and adds it to history; the extension never touches the clipboard itself.

```ts file=src/index.ts
import type { Actions } from "@yabbistir/api";

/** "Crème Brûlée, 2 ways!" → "creme-brulee-2-ways": ASCII letters and digits joined by single dashes. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // the accents NFKD split off: é → e
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const actions: Actions = {
  slugify: {
    run(item) {
      const slug = slugify(item?.text ?? "");
      // Nothing to paste: say why. The app shows the message as a calm notice.
      if (slug === "") return { none: true, message: yab.t("empty") };
      return { text: slug };
    },
  },
};
```

Three things to know about this code:

- It runs in JavaScriptCore, not Node. Web standards such as `URL`, `TextEncoder` and `fetch` are there, and so are JavaScript's own built-ins such as `Intl`. `fs`, `process`, `Buffer` and `require` are not. The global `yab` is the way to the app: here `yab.t` reads a string from the locale files in the app's language. See the [API reference](api.md).
- An expected situation, such as nothing to work on, returns `{ none: true, message }`. Throwing is for real failures: the app shows the error's message, and an action that keeps failing gets turned off.
- Helpers such as `slugify` can be exported, which makes them easy to test.

## 5. Test it

Tests run in Node against a fake host that holds the extension to the app's rules: it reads the manifest's permissions, refuses what the app would refuse, and never touches the network or runs a program. `host.run` runs an action the way a person's choice does, and `host.hint` runs it as a hint, without effects.

```js file=tests/index.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, slugify } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const text = (value) => ({ kind: "text", text: value });

describe("slugify", () => {
  test("makesASlug", async () => {
    assert.deepEqual(await host.run(actions.slugify, text("Release notes 2.0!")), { text: "release-notes-2-0" });
  });

  test("dropsAccents", () => {
    assert.equal(slugify("Crème Brûlée, 2 ways!"), "creme-brulee-2-ways");
  });

  test("worksAsAHint", async () => {
    // A hint runs before the person picks the row, without effects; its result is the one pasted.
    assert.deepEqual(await host.hint(actions.slugify, text("Hello, World")), { text: "hello-world" });
  });

  test("saysSoWhenNothingIsLeft", async () => {
    assert.deepEqual(await host.run(actions.slugify, text("!!!")), { none: true, message: "There is nothing to turn into a slug." });
  });
});
```

The fake host fills in what an item needs (`id`, `tags`, `copiedAt`), so a test passes only what matters. Run the tests and the checks:

```sh
npm test -- dev.yourname.slugify
npm run validate -- dev.yourname.slugify
```

`npm run validate` prints one line per problem: the file, the field, what was wrong and how to fix it. There is no build yet, so it also notes "not built yet (or out of date)": the build in the next step makes `index.js` and checks it. [Testing](testing.md) covers the fake host in full, and [Errors](errors.md) lists every message.

## 6. Build it

```sh
npm run build -- dev.yourname.slugify
```

The build bundles `src/index.ts` and everything it imports into one `dist/dev.yourname.slugify/index.js`, copies the manifest, the locales, the README and the CHANGELOG next to it, checks that folder with the store's rules, and packs it into `dist/dev.yourname.slugify-1.0.0.yabext`. If the code imports a Node module or uses a Node global, the build stops and says so ([why](errors.md#node-builtins)). From now on, `npm run validate` checks this build too, `index.js` included, as long as it is newer than your source; after a change it notes "not built yet (or out of date)" until you build again.

## 7. Run it in yabbistir

```sh
npm run dev -- dev.yourname.slugify
```

`npm run dev` builds the extension and links `dist/dev.yourname.slugify` into `~/Library/Application Support/yabbistir/Extensions/`. The app lists it in Settings → Extensions with the source "Development" and reloads it whenever the files change. `npm run dev` keeps watching `src/`, `locales/` and the manifest and rebuilds on every save; stop it with Ctrl-C. It never replaces a real folder: if an installed copy with the same id is there, remove that copy in Settings first.

Then, in yabbistir: copy a sentence, press ⇧⌘V, and type `slug`. The row shows the hint; ↵ pastes the slug. Or select a text item and press ⇧ to see every transform for it.

`console.log` in your code writes to Settings → Extensions → Development → Log, together with the extension's errors.

## 8. Finish

Before you call it done:

- Rewrite `README.md`: what the extension does, an example, and why it needs each permission (Slugify needs none).
- Keep `CHANGELOG.md` with a `## 1.0.0` section.
- `npm test`, `npm run validate` and `npm run build` pass for your id.

To share it, open a pull request: see [Publishing](publishing.md).

## Where next

- [Concepts](concepts.md): items, actions, detectors, capture rules, jobs, and which one fits your idea.
- [Recipes](concepts.md#recipes): six small, complete extensions to start from.
- [Design guidelines](design-guidelines.md): names, icons and words that fit the app.
