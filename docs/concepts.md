# Concepts

An extension is a folder: a `manifest.json` that says what it adds, a `src/index.ts` that does the work, and strings in `locales/`. The app reads the manifest to decide where the extension appears, and calls into its code only when there is work to do. The extension computes and returns plain data. The app draws every row, chip, preview, card and notice, in its own calm grey look, so an extension never picks a color or lays anything out.

## Where the code runs

yabbistir runs extensions in a helper process, each in its own JavaScriptCore context, isolated from the app and from each other. The language level is ES2022.

- **There:** JavaScript's built-ins (`JSON`, `Math`, `Intl`, `RegExp`, `Map`, `Promise` …), the web standards listed under [Globals](api.md#globals) (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `atob`, `btoa`, `setTimeout`, `AbortController`, `crypto.getRandomValues`, `crypto.randomUUID`, `fetch`, `console`), and the global `yab`, the extension's way to the app ([The yab object](api.md#the-yab-object)).
- **Not there:** anything from Node (`fs`, `path`, `child_process`, `process`, `Buffer`, `require`) or from a browser page (`document`, `window`, `localStorage`). The build refuses Node modules and globals; see [errors](errors.md#node-builtins) for what to use instead.
- **npm packages** that are plain JavaScript are bundled into the one `index.js` by the build. A package that needs Node will not work.
- `console.log` writes to Settings → Extensions → Development → Log.

## The item

An action, detector or rule gets the clipboard **item** it is about ([`Item`](api.md#item)):

| `kind` | What it carries |
|---|---|
| `text`, `code` | `text` |
| `link` | `url` (and often `text`); read it as `item.url ?? item.text` |
| `color` | `color`: `hex`, `r`, `g`, `b` (0–255), `a` (0–1) |
| `image` | `image`: a handle to pass to `yab.image`, `yab.vision` or return; the pixels stay in the app |
| `file` | `files`: `path`, `name`, `size`, `uti` for each |

Every item also has `id`, `tags` (set by detectors, as `"extension.id:detector"`), `copiedAt` (ISO 8601), and sometimes `source` (the app it was copied from) and `richText.html`. Copies that apps mark as concealed, such as passwords, never reach an extension.

## The context

Each call also gets a **context** ([`Context`](api.md#context)): `language` (the app's language, such as `"en"` or `"tr"`), `preferences` (the extension's settings), `variant` (the chosen variant's id), `target` (the app the result is headed for: `bundleID`, `name` and a `kind` of `finder`, `terminal`, `browser`, `editor` or `other`), `trigger` (where the call came from) and `signal` (aborts when the person cancels).

## Actions

An **action** is a command in the panel. Its manifest entry says what it is called, which items it takes and what it returns; `actions[id].run(item, ctx)` in `src/index.ts` does the work and returns a [result](results-and-targets.md).

- **Transforms** (`"input": "item"`) work on an item: Base64-encode it, download the video a link points to. `accepts` says which items: `kinds`, an optional regular expression `pattern` over the text or URL, and optional detector `tags`.
- **Generators** (`"input": "none"`) make something from nothing, such as a UUID. `run` gets `null` for the item.
- **Variants** are ready-made choices of one action, each its own row: "Download as video" and "Download audio". `ctx.variant` says which one was chosen. A variant can name one of the extension's `toggle` preferences in `preference`: it is offered only while that toggle is on, so the person can hide the ones they don't use.
- **Hints** (`"hint": true`) run the action before it is picked, without effects, and show the result on the row. The result shown is the one pasted. A hint that returns `{ none: true }` leaves the action offered, and its row shows no preview.
- **Jobs** (`"job": true`) are long actions: a card under the menu bar icon shows their progress and lets the person cancel. See [Jobs](jobs.md).

Where actions appear:

- **Search:** typing in the panel (⇧⌘V) offers an action when one of its keywords starts with what was typed (two letters or more). A transform also needs the selected item to match `accepts`; a generator always qualifies.
- **The ⇧ panel:** ⇧ on an item lists every transform that accepts it.
- **⌘K:** the full action list for an item.

Actions whose `targets` include the paste target's kind come first, and `targetsOnly` keeps an action to those targets alone. ↵ pastes the result into the app the panel opened for; ⌘C copies it instead.

**Which actions appear is decided from manifests alone.** No extension code runs on a keystroke. A hint runs once its row is shown.

## Patterns

`accepts.pattern` (on actions, detectors and capture rules) is a regular expression in **ICU** syntax, the kind macOS uses, not JavaScript's. It is *searched for* in the item's text, or its URL for a link, after surrounding whitespace is trimmed: write `^…$` to match the whole text. Matching is case-sensitive unless the pattern starts with `(?i)`.

The store accepts only what it can check against the app, so `npm run validate` refuses anything else with [`invalidPattern`](errors.md#invalidpattern). What it accepts:

- **Plain syntax:** literals, `.`, `^`, `$`, `|`, groups `( )`, `(?: )`, named groups `(?<name> )` with `\k<name>`, back references `\1`.
- **Quantifiers:** `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`, lazy (`*?`) and possessive (`*+`) forms, atomic groups `(?> )`.
- **Look-around:** `(?= )`, `(?! )`, and look-behind `(?<= )`, `(?<! )` of bounded length (no `*`, `+` or `{n,}` inside).
- **Flags:** `(?i)` (ignore case), `(?m)`, `(?s)`, `(?x)`, `(?w)`, at the start or scoped as `(?i: )`.
- **Escapes:** `\d`, `\w`, `\s` and their capitals (`\d` is any decimal digit, not only 0–9), `\b`, `\B`, `\A`, `\z`, `\Z`, `\t`, `\n`, `\r`, `\xhh`, `\x{h…}`, `\uhhhh`, `\Q…\E`, `\X`. Escape a literal `{` as `\{`.
- **Sets:** `[abc]`, `[^a-z]`, nested sets `[[a-z][0-9]]`, intersection `[\p{L}&&[a-z]]`, difference `[a-z--[aeiou]]`, and POSIX classes in lowercase (`[[:alpha:]]`, `[[:digit:]]`).
- **Unicode properties**, with `\p{…}`, or `\P{…}` for the opposite, spelled exactly as ICU spells them:
  - general categories: `\p{L}`, `\p{Lu}`, `\p{Ll}`, `\p{N}`, `\p{Nd}`, `\p{P}`, `\p{S}`, `\p{Z}`, or long names such as `\p{Letter}` and `\p{Uppercase_Letter}`;
  - scripts: `\p{Latin}`, `\p{Greek}`, `\p{Cyrillic}`, `\p{Arabic}`, `\p{Han}`, `\p{Hiragana}`, …;
  - binary properties: `\p{Alphabetic}`, `\p{White_Space}`, `\p{Emoji}`, `\p{ASCII}`, `\p{Any}`, …;
  - blocks with `In`: `\p{InBasic_Latin}`;
  - and the `=` forms of those four only: `\p{gc=Lu}`, `\p{Script=Latin}`, `\p{scx=Latin}`, `\p{Block=Basic_Latin}`.

  [`tools/lib/icu-properties.json`](../tools/lib/icu-properties.json) lists every spelling the store accepts.

Refused, because the store cannot verify them: character names (`\N{…}`), any other `\p{Name=Value}` (`Name=`, `Age=`, `Line_Break=`, `East_Asian_Width=`, `Numeric_Value=`, `Bidi_Class=` …), spellings off the list (`\p{IsL}`, `\p{L&}`, `\p{all}`, `[[:ALPHA:]]`, extra spaces), and an unbounded look-behind. Refused because ICU rejects them: JavaScript-only syntax such as a bare `{`, `[^]` or an empty pattern.

In tests, [`host.offers(item)` and `acceptsMatch(accepts, item)`](testing.md#where-an-action-is-offered) apply a manifest's `accepts` to a sample item, close to the app's matching.

## Detectors

A **detector** tags items as they are copied: a JWT, an issue key, a timestamp. Its manifest entry names the tag and `accepts` the items it looks at; an optional `validate(item)` has the last word, quickly and without promises. A detector can also add sections (text, code, key-value rows, an image, a link) to a tagged item's preview, and actions can be offered only on items with a tag. A new detector scans the existing history once, in the background. See [Detectors and previews](detectors-and-previews.md).

## Capture rules

A **capture rule** sees each new copy before it is stored and decides: keep it, store a cleaned version instead, put it in a category too, or do not store it at all. Rules need the `capture` permission, see text and URLs only (never tags or pixels), and have 200 ms. See [Capture rules](capture-rules.md).

## Sources

A **source** is a list the app shows in a column of its own in the panel: snippets, a team's canned replies, a vault's entries. `sources[id].list(ctx)` returns the rows, or that the source is locked; `sources[id].run(rowId, actionId, ctx)` returns the value one of the source's one or two actions pastes, as `{ text }` or, for a `sensitive` source, `{ secret }`. Rows and values stay in the app's memory, never in the history or on disk. See [Sources](sources.md).

## Calls with effects and calls without

Some calls happen because the person chose something: running an action or a job, and a source's `list` and `run`. Those may use the network, run programs, show notices, open links, ask the on-device model or translate, as far as the extension's permissions allow.

Other calls happen on their own: hints, detector checks, previews and capture rules. They run without effects: `yab.http.fetch`, `fetch`, `yab.exec`, `yab.notify`, `yab.open`, `yab.ai`, `yab.translate` and `yab.history` reject or throw `permissionDenied` there. They can still read the item, the preferences, secrets and storage, and use pure functions such as `yab.t`.

## Time limits

| Call | Limit |
|---|---|
| Hint, and a detector's preview | 500 ms |
| Detector `validate` | 50 ms, no promises |
| Capture rule | 200 ms (then it is skipped and the copy is stored as it is) |
| Action | 10 seconds |
| A source's `list` and `run` | 10 seconds each |
| Job | none; the person can cancel it |

A call that runs over is cut off.

## When something goes wrong

- A `run` that throws fails: the app shows "Extension failed" with the extension's name and the error's message. Write messages for people, with `yab.t`.
- Three failures in a row turn the extension off; Settings shows it as off and the person is told. A source's failures never count. Failures that are not the extension's fault do not count either: `cancelled`, `interrupted`, `toolMissing`, `networkError` and `permissionDenied`. A job's thrown error does not count either; only a broken result (`badResult`, `notFound`, `syntax`) does.
- So an expected situation (nothing to do, input of the wrong shape) returns `{ none: true, message }` rather than throwing, and a detector's `validate` returns `false` rather than throwing.

Every error code is in [errors](errors.md#runtime-errors).

## Permissions

An extension starts with no permissions, and most need none: text transforms, detectors, on-device AI and translation, image work and files in the call's work folder are all free. Four permissions exist, each shown to the person before install: `network`, `exec`, `capture` and `history`. See [Permissions](permissions.md).

## Which contribution point fits an idea

| Idea | Use | Start from |
|---|---|---|
| Change a copy when the person asks (encode, reformat, convert), and paste the result | An action, `"input": "item"`; no permission | `--template action`, [Getting started](getting-started.md) |
| Change every copy automatically, as it is copied (clean, rewrite, drop) | A capture rule; needs `capture`, which the person reads as "Can see everything you copy" | `--template capture-rule`, [A link-cleaning rule](recipes/link-cleaning-rule.md) |
| Mark copies for the person, without changing them | A detector: its tag shows as a chip on the item; no permission | `--template detector`, [Tag and preview](recipes/tag-and-preview.md) |
| Make something new (UUID, timestamp, lorem ipsum) | An action, `"input": "none"` | `--template action` |
| A few fixed flavors of one action (to Turkish / to English) | `variants` on one action | [Translate and summarize](recipes/translate-and-summarize.md) |
| Let the person hide the flavors they don't use | A `toggle` preference per variant, named in the variant's `preference` | [Manifest reference](manifest.md#contributesactionsvariants) |
| Show the result before it is chosen | `"hint": true` | [Getting started](getting-started.md) |
| Something that takes seconds or minutes (download, convert) | An action with `"job": true` | `--template job`, [Download with yt-dlp](recipes/download-with-yt-dlp.md) |
| Hand a file to Finder | An action with `"output": "file"` and `"targets": ["finder"]` | [Drop a file into Finder](recipes/drop-a-file-in-finder.md) |
| Recognize a kind of text (token, key, ID) and explain it | A detector with `validate` and `preview` | `--template detector`, [Tag and preview](recipes/tag-and-preview.md) |
| Offer an action only on items a detector tagged | `accepts.tags` on the action | [Tag and preview](recipes/tag-and-preview.md) |
| Call a web service | An action with the `network` permission | [Call an API with a key](recipes/call-an-api-with-a-key.md) |
| Run a command-line program | An action or job with the `exec` permission | `--template job` |
| Summarize, rewrite or translate on the Mac | `yab.ai.generate`, `yab.translate` (no permission) | [Translate and summarize](recipes/translate-and-summarize.md) |
| Work with earlier copies | `yab.history` (the `history` permission) | [Permissions](permissions.md#history) |
| A list of the extension's own in the panel (snippets, canned replies), a row's text pasted on ↵ | A source | `--template source`, [Sources](sources.md) |
| Paste passwords or tokens from a command-line vault | A `sensitive` source with a `secret` action and the `exec` permission | [Sources](sources.md#secrets) |

**A capture rule cannot show a tag or a chip.** Only detectors tag items, and they run after the copy is stored, so a rule never sees tags or adds them. To change copies and mark them too, put a rule and a detector in one extension.

Not possible: drawing your own interface, running in the background on a timer, reading the clipboard directly, writing outside the call's work folder, reaching the network from a detector or a rule.

## Several contributions in one extension

One extension can add any mix of actions, detectors, capture rules and sources. Scaffold with the template nearest to the main thing it does, then add the others by hand:

1. In `manifest.json`, add the other lists under `contributes` (`actions`, `detectors`, `captureRules`, `sources`), each entry with its own id. Copy an entry's shape from the [manifest reference](manifest.md) or from the template that has it.
2. In `src/index.ts`, export the matching objects, keyed by those ids: `export const detectors: Detectors = { … }` next to `export const actions: Actions = { … }`.
3. Add every new string key to `locales/en.json`, and tests for each part.

Permissions belong to the whole extension: a capture rule needs `capture` even when the rest of the extension needs nothing, and the person sees it for the whole extension. [Tag and preview](recipes/tag-and-preview.md) is a detector and an action in one extension, the action offered only on the detector's tag.

## Recipes

Each recipe is a small, complete extension: manifest, strings, code and tests that pass `npm run validate`, `npm run build` and `npm test`.

- [Download video and audio with yt-dlp](recipes/download-with-yt-dlp.md): a job that runs a program and returns a file.
- [Call an API with a key](recipes/call-an-api-with-a-key.md): the `network` permission and a secret preference.
- [Tag and preview](recipes/tag-and-preview.md): a detector with `validate` and `preview`, and an action offered on its tag.
- [A link-cleaning rule](recipes/link-cleaning-rule.md): a capture rule that rewrites links.
- [Translate and summarize on the Mac](recipes/translate-and-summarize.md): `yab.translate` and `yab.ai`.
- [Drop a file into Finder](recipes/drop-a-file-in-finder.md): a file result aimed at Finder.
