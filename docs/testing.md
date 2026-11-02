# Testing

An extension's tests run in Node, without the app, against a **fake host**: a stand-in for yabbistir that gives the code a `yab` (and a `fetch`) held to the app's rules. Permissions come from your manifest, calls without effects are refused the way the app refuses them, results are checked against the shapes the app accepts, and nothing reaches the network or runs a program: you give the answers.

```sh
npm test -- dev.yourname.tool                                   # one extension
npm test -- dev.yourname.tool --test-name-pattern=makesASlug     # one test
npm test                                                        # every extension
```

`npm test` runs `extensions/<id>/tests/*.test.mjs` with `node --test`. It needs **Node 22.18 or later**: tests import `src/index.ts` directly, and Node strips its types. That has two consequences for your TypeScript:

- Import types with `import type { … } from "@yabbistir/api"`. The package has no JavaScript, so a plain `import` fails at run time.
- Import your own files with their `.ts` extension: `import { parse } from "./parse.ts"`. Use only syntax Node can strip: no `enum`, no `namespace`, no constructor parameter properties.

## A test file

```js
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";

const folder = new URL("..", import.meta.url);

describe("upper", () => {
  test("upperCasesText", async () => {
    const host = createFakeHost({ folder });
    assert.deepEqual(await host.run(actions.upper, { text: "hello" }), { text: "HELLO" });
  });
});
```

`createFakeHost({ folder })` reads `manifest.json` and `locales/*.json` from the extension's folder. Make a new host for each test when the test changes its state (files, storage, recorded calls), or share one for read-only tests.

An item needs only what matters to the test: the host fills in `id`, `tags: []` and `copiedAt`, and guesses `kind` from the fields (`url` → `link`, `files` → `file`, `image` → `image`, `color` → `color`, else `text`). Give `kind` yourself for `code`.

## Running calls

| Call | Runs | As |
|---|---|---|
| `host.run(action, item?, context?)` | `action.run(item, ctx)` | A run the person started: effects allowed, as far as the permissions go. The result is checked like the app checks it. |
| `host.hint(action, item?, context?)` | the same | A hint: no effects. |
| `host.validate(detector, item?)` | `detector.validate(item)` | Resolves to a boolean; a promise is refused. |
| `host.preview(detector, item?, context?)` | `detector.preview(item, ctx)` | No effects; the sections are checked. |
| `host.capture(rule, item?, context?)` | `rule.run(item, ctx)` | No effects; the result is checked. |
| `host.list(sourceId, context?)` | `sources[sourceId].list(ctx)` | A source's list, as the app calls it: effects allowed, no item. Resolves to the rows the app keeps, or the locked state ([Sources](#sources)). |
| `host.runSource(sourceId, rowId, actionId, context?)` | `sources[sourceId].run(rowId, actionId, ctx)` | The same, for one action; resolves to `{ secret }` or `{ text }`. |

`context` sets parts of `ctx` for that call: `{ language: "tr", variant: "audio", target: { bundleID: "com.apple.finder", name: "Finder", kind: "finder" } }`. Pass `null` as the item for a generator.

A call the app would refuse rejects with the same `code`, so test the code:

```js
await assert.rejects(host.hint(actions.fetchTitle, { url: "https://example.com" }), { code: "permissionDenied" });
await assert.rejects(host.run(actions.broken, { text: "x" }), { code: "badResult" });
```

## Options

| Option | What it sets |
|---|---|
| `folder` | The extension's folder (a path or a `file:` URL): its manifest and locales. |
| `manifest` | Manifest fields over the folder's, such as `{ permissions: [] }` to test a missing permission. |
| `locales` | `{ en: { … }, tr: { … } }` instead of the folder's. |
| `item` | The item a call gets when you pass none. |
| `context` | `{ language, trigger, variant, target }` for every call. |
| `preferences` | Values the person chose in Settings; the rest come from the manifest's defaults. |
| `secrets` | `{ id: value }` for the manifest's `secret` preferences. |
| `http` | Answers for `yab.http.fetch` and `fetch` (see below). |
| `exec` | Answers for `yab.exec` (see below). |
| `ai` | An answer, or `(prompt, options) => answer`, for `yab.ai.generate`. Without it: `unavailable`. |
| `translate` | `{ text, from }`, a string, or `(text, { to, from }) => …`, for `yab.translate`. Without it: `unavailable`. |
| `vision` | `{ ocr, readCodes, removeBackground }`: answers or functions. Without one: `unavailable`. |
| `history` | The items `yab.history` returns, newest first. |
| `files` | `{ path: text or Uint8Array }`: files on the fake disk, such as an item's own files. |
| `storage` | What `yab.storage` holds at the start. |
| `now` | A `Date`, ISO text or milliseconds: `Date.now()` and `new Date()` during calls, and items' `copiedAt`. |
| `sources` | The extension's `sources` export, for `host.list` and `host.runSource`. |

An answer in any table can be an `Error` to make the call fail, and `yabError(code, message)` makes one with a `code`, the way the app's errors have one.

## What the host records

| Field | Holds |
|---|---|
| `host.calls` | Every `yab` call in order, as `{ api, args }`, such as `{ api: "exec", args: ["yt-dlp", [...]] }`. Callbacks and signals are left out, and so are `t` and plain reads (`storage.get`, `files.read`, `files.exists`, `image.info`). |
| `host.results` | What each call returned; a source's answers are left out, as the app keeps no value. |
| `host.logs` | Console lines and the host's own notes: each `console` line written during the host's calls or outside any call (the module's top level, a timer), and notes such as a listing cut at 10,000 rows; what the app would write to the extension's Development log. The console is the app's from the moment the fake host is imported: `log`, `info`, `warn`, `error` and `debug`, while the rest (`table`, `dir`, `trace`, …) throw, as in the app. The lines still reach your console too. |
| `host.notifications` | The `yab.notify` messages, cut to 200 characters. |
| `host.opened` | The links `yab.open` got. |
| `host.progress` | Each `yab.job.progress` as `{ fraction, message }`. |
| `host.files` | The fake disk: a `Map` from path to bytes. |
| `host.storage` | The store. |

`host.yab` is the fake `yab` itself, and `host.cancel()` cancels the calls in progress the way the person's ✕ does.

## The network

`http` maps `"<url>"` or `"<METHOD> <url>"` (the whole URL, query included) to a response, or is a function `(request) => response` that gets `{ method, url, headers, body }`, with the headers as your code wrote them. A response is `{ status = 200, headers, text | json | body }`, an `Error`, or a function returning either.

```js
const host = createFakeHost({
  folder,
  secrets: { apiKey: "test-key" },
  http: ({ method, url, headers }) => {
    assert.equal(headers.authorization, "Bearer test-key");
    return method === "GET" && url === "https://api.example.com/v1/define?word=apple"
      ? { json: { definition: "a fruit" } }
      : { status: 404, text: "not found" };
  },
});
```

The manifest's permission and `network.domains` are checked first, as in the app: a host outside the list rejects with `permissionDenied`. A request with no answer rejects with `networkError`, so a test notices a request it did not expect.

## Jobs and programs

`exec` maps a tool's name to `{ exitCode, stdout, stderr }`, an `Error`, or `(args, { input, workDir, host }) => result`. Only tools in `requires.tools` run; one listed in the manifest but missing from the table rejects with `toolMissing`, which tests the "not installed" path. `onLine` hears the answer's lines once the tool has "finished", standard output first.

A tool that writes files writes them on the fake disk itself, in `workDir`:

```js
const host = createFakeHost({
  folder,
  exec: {
    "yt-dlp": (args, { host, workDir }) => {
      assert.equal(args.at(-2), "--", "the link comes after --");
      host.files.set(`${workDir}/video.mp4`, new Uint8Array([0]));
      host.files.set(`${workDir}/result.txt`, new TextEncoder().encode(`${workDir}/video.mp4\n`));
      return { exitCode: 0, stdout: "yab 50 100\nyab 100 100\n", stderr: "" };
    },
  },
});
const result = await host.run(actions.download, { url: "https://www.youtube.com/watch?v=x" }, { variant: "video" });
assert.match(result.file, /video\.mp4$/);
```

Test cancelling by starting a call and cancelling it while it waits:

```js
const host = createFakeHost({ folder, exec: { slow: () => new Promise(() => {}) } });
const running = host.run(actions.convert, { text: "x" });
setTimeout(() => host.cancel(), 10);
await assert.rejects(running, { code: "cancelled" });
```

## Where an action is offered

The app offers an action, and runs a detector or a rule, only on items its manifest's `accepts` takes. Two helpers apply `accepts` in a test:

- `host.offers(item?, context?)` returns the ids of the actions the app would offer on the item, in the app's order: `"input": "item"` actions whose `accepts` takes it, highest `priority` first, the paste target's own actions first, and a `targetsOnly` action only for its targets (`context: { target: { … } }`).
- `acceptsMatch(accepts, item, { extensionID }?)`, exported next to `createFakeHost`, applies any one `accepts` block, such as a detector's or a rule's. `extensionID` lets a tag written as `"tag"` stand for the extension's own detector, as in the app.

```js
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

const host = createFakeHost({ folder });
assert.deepEqual(host.offers({ kind: "text", text: "Ada@Example.com" }), ["lower"]);
assert.deepEqual(host.offers({ kind: "text", text: "no address here" }), []);

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
assert.equal(acceptsMatch(manifest.contributes.detectors[0].accepts, { kind: "text", text: "ABC-123" }), true);
```

Both check the kind (a single image file counts for `image`), the tags, and the [pattern](concepts.md#patterns), searched for in the trimmed text or URL. The app matches patterns with ICU; the helpers use JavaScript's `RegExp` with the `u` flag, after turning a leading `(?i)`, `(?s)` or `(?m)` into flags, `\d` into any decimal digit, and a bare script name such as `\p{Greek}` into `\p{Script=Greek}`. That is close to the app, not identical: `\w` and `\s` differ slightly, and ICU-only syntax (`a++`, `(?>…)`, `(?x)`, a flag group after the start, sets with `&&` or `--`, `[[:alpha:]]`, `\Q…\E`, block properties) throws an error that says so. `npm run validate` remains the judge of whether a pattern is valid ICU, and `npm run dev` shows the app's real matching.

## Sources

`host.list` and `host.runSource` call a source the way the app does: as the person's own call, so `yab.exec` works with the `exec` permission, with `ctx.trigger` `"source"`, and with no item, variant or target. Pass the extension's `sources` export when you make the host:

```js
import { sources } from "../src/index.ts";

const host = createFakeHost({
  folder,
  sources,
  exec: { "vault-cli": (args) => ({ exitCode: 0, stdout: args[0] === "list" ? "42\texample.com\tada\n" : "s3cret\n", stderr: "" }) },
});
assert.deepEqual(await host.list("vault"), { rows: [{ id: "42", title: "example.com", subtitle: "ada" }] });
assert.deepEqual(await host.runSource("vault", "42", "password"), { secret: "s3cret" });
assert.deepEqual(host.logs, []);
```

What they resolve to is what the app keeps:

- `host.list` gives `{ rows }` with each title and subtitle on one line and cut to 256 characters, at most 10,000 rows (and a line in `host.logs` past that), or `{ locked: true, message, command? }`.
- `host.runSource` gives `{ secret }` or `{ text }`, whichever the manifest's `kind` for the action says.
- Anything else rejects with `badResult` and the app's reason: a value of the other kind, an empty value, a row without a title, two rows with one id. The reason names shapes and places, never a value.
- Before calling, both fail as the app would: `notFound` for a source or action the manifest does not have, or an export missing from `sources`, and `toolMissing` for a tool of `requires.tools` missing from `exec`.

Test the locked answer, an empty value, a failing tool, and that nothing reaches `host.logs`. The rules are in [Sources](sources.md).

## Everything else

- **Preferences:** `preferences: { format: "short" }`; the rest come from the manifest's defaults. A `folder` preference's `~` becomes `/Users/test`, and `yab.files.read` may read inside a folder only when the test set it in `preferences`, as when the person chose it.
- **Secrets:** `secrets: { apiKey: "test-key" }`; `yab.secrets.get` returns only declared `secret` preferences.
- **History:** `history: [ … ]`, newest first. Items come back trimmed the app's way: text and HTML cut to 64 KB with `truncated: true`, images with their size only. The `history` permission is checked.
- **AI and translation:** `ai: (prompt, options) => "A summary."`, `translate: (text, { to }) => ({ text: "Merhaba", from: "en" })`. Both refuse to run without effects.
- **Images:** handles are fake. `yab.image.convert` and `resize` work out the new size; `yab.files.write` of a handle writes placeholder bytes.
- **Time:** `now: "2026-01-01T00:00:00Z"` fixes the clock during calls.
- **Language:** `context: { language: "tr" }` on the host or one call; `yab.t` answers from that locale.

## What the fake host does not do

- `host.run` runs an action on whatever item you pass, whether its `accepts` takes it or not; check that with `host.offers` ([above](#where-an-action-is-offered)), and let `run` cope with an item it did not expect.
- It enforces no time limits: keep hints, validators and rules fast yourself.
- It does not limit notices to one every 3 seconds, as the app does.
- It runs no real program, request, model, translation or image operation. Test the code around them, and try the real thing with `npm run dev`.

## Testing the manifest

Some promises live in the manifest. Read it in a test when it matters:

```js
import fs from "node:fs";

test("theRuleDoesNotAskForTags", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.contributes.captureRules[0].accepts.tags, undefined);
});
```

Tests are Node code, so they may use `node:fs` and friends; only `src/` runs in the app.

## Libraries

Most extensions need none. When one helps, it must be plain JavaScript that runs without Node ([errors](errors.md#node-builtins)). Put it in a `package.json` in the extension's own folder, at an exact version, and run `npm install` from the repository's root:

```json
{
  "name": "dev.yourname.tool",
  "private": true,
  "type": "module",
  "dependencies": { "some-library": "1.2.3" }
}
```

The repository uses npm workspaces, so the library is installed for the whole repository and the build bundles it into `index.js`. Keep `"type": "module"`: the tests load `src/index.ts` as a module. The pull request then changes the extension's folder and the root `package-lock.json`.

`npm run typecheck` needs the library's types. A library that ships none fails it with "Could not find a declaration file for module"; add `src/<library>.d.ts` holding `declare module "<library>";`, or pick a library with types.

## Before a pull request

`npm test -- <id>`, `npm run validate -- <id>` and `npm run build -- <id>` all pass. Cover the main path, every message the person can see (in each language you ship), and the failures you expect: no input, a missing tool, a failed request, a cancel.
