---
name: yabbistir-extension
description: Use when creating, changing, testing or preparing a pull request for a yabbistir extension in this repository (anything under extensions/, an action, detector, capture rule or job for the yabbistir clipboard app).
---

# Writing a yabbistir extension

An extension is `extensions/<id>/`: `manifest.json`, `src/index.ts`, `locales/en.json`, `tests/*.test.mjs`, `README.md`, `CHANGELOG.md`. Its code runs in JavaScriptCore inside yabbistir, not in Node, and the app draws all UI. AGENTS.md at the repository's root has the rules and the definition of done; follow it. Run every command from the root, with Node 24 (22.18 or later works).18 or later, after `npm install`.

## 1. Understand the idea

Decide what the extension does to what, and where the person meets it. Then pick the contribution point ([docs/concepts.md](../../../docs/concepts.md#which-contribution-point-fits-an-idea)):

| The idea | Contribution point | Template |
|---|---|---|
| Turn the selected item into something to paste | Action, `"input": "item"` | `action` |
| Make something from nothing (an id, a date) | Action, `"input": "none"` | `action` |
| Takes seconds or minutes, or runs a program | Action with `"job": true` | `job` |
| Recognize a kind of content and explain it | Detector with `validate` and `preview` | `detector` |
| Change or drop copies before they are stored | Capture rule | `capture-rule` |

If a recipe in [docs/recipes/](../../../docs/concepts.md#recipes) is close, start from it: each is a complete extension.

## 2. Choose permissions

Start with none. Add one only when the extension cannot work without it ([docs/permissions.md](../../../docs/permissions.md)):

- `network` with `network.domains` listing the exact hosts: to call a web service.
- `exec` with `requires.tools`: to run a program. Fixed arguments, item content after `--`, no shell.
- `capture`: only for capture rules.
- `history`: only to read earlier copies.

On-device AI (`yab.ai.generate`), translation (`yab.translate`), images, preferences, secrets and files in the work folder need none.

## 3. Create it

```sh
npm run new -- dev.yourname.tool --template action --author <name>
```

The id is a lowercase reverse-domain name and equals the folder name. `author` is how the person wants to be credited, their name or their GitHub user name: ask them, or check the `author:` line `npm run new` prints when it took the git user name. Then:

1. Edit `manifest.json`. Every field a person reads holds a key into `locales/en.json`. Look fields up in [docs/manifest.md](../../../docs/manifest.md); never invent one.
2. Add the keys to `locales/en.json`; a `keywords` key's value is a list. Only English is required: the template's `locales/tr.json` describes its sample, so delete it, or translate every key into it.
3. Write `src/index.ts`: `export const actions: Actions = { <id>: { run(item, ctx) { … } } }` (or `detectors`, `captureRules`), with `import type { … } from "@yabbistir/api"`. Look `yab` up in [docs/api.md](../../../docs/api.md). Import your own files as `./file.ts`.
4. Return `{ none: true, message: yab.t("…") }` for expected situations; throw only for real failures.
5. Run `npm run validate -- <id>` and fix each line it prints; the fix is in the line, and [docs/errors.md](../../../docs/errors.md) explains every code.

## 4. Test it

Replace `tests/index.test.mjs` with tests for your code ([docs/testing.md](../../../docs/testing.md)):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";
import { actions } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });

test("doesTheThing", async () => {
  assert.deepEqual(await host.run(actions.tool, { kind: "text", text: "in" }), { text: "out" });
});
```

- Cover the main path, every message the person can see, and the expected failures.
- Answer network calls with `http`, programs with `exec`, the model with `ai`, translation with `translate`.
- Use `host.hint`, `host.validate`, `host.preview` and `host.capture` for calls that run without effects.
- Run `npm test -- <id>` until it passes.

## 5. Build and check

```sh
npm test -- dev.yourname.tool
npm run build -- dev.yourname.tool
npm run validate -- dev.yourname.tool
npm run typecheck
```

All four pass with no errors and no warnings, in this order. After the build, `npm run validate` checks the build too, `index.js` included, and ends with `ok, with its build in dist/<id>`. Its "not built yet (or out of date)" note is not a warning: it appears when there is no build or the source changed since, and building, then validating, clears it. A Node module or global fails the build ([docs/errors.md#node-builtins](../../../docs/errors.md#node-builtins)). To try it in the app, the person runs `npm run dev -- <id>` on their Mac.

## 6. Prepare the pull request

- `README.md`: what it does, an example, every permission and tool with its reason.
- `CHANGELOG.md`: a `## <version>` section matching the manifest's `version`, raised for every change to an existing extension.
- Only `extensions/<id>/` changed, plus the root `package-lock.json` when the extension adds a library. Anything only the maintainer changes ([the list](../../../docs/publishing.md#what-a-pull-request-may-change)) fails the static checks for anyone but the maintainer.
- Go through [docs/review-checklist.md](../../../docs/review-checklist.md) and fill in [the pull request template](../../../.github/PULL_REQUEST_TEMPLATE.md): what it does, an example or screenshot, a reason per permission, the tools needed.
- Names and messages follow [docs/design-guidelines.md](../../../docs/design-guidelines.md): short, plain, sentence-case action titles that start with a verb.
