# Errors

Errors come from three places:

- **The validator** (`npm run validate`, and `npm run build` after it compiles): problems in the manifest, the locale files and the folder. Each has a code; [Validator messages](#validator-messages).
- **The build** (`npm run build`, `npm run dev`): code that cannot be bundled for JavaScriptCore; [Build errors](#build-errors).
- **The runtime** (the app, and the fake host in tests): a `yab` call or an extension call that failed, with a `code`; [Runtime errors](#runtime-errors).

## Reading the validator

`npm run validate -- <id>` prints one line per problem:

```text
extensions/dev.yourname.tool/manifest.json: contributes.actions[0].output: "txt" is not an output (expected text, html, image, link, file, files, none) → fix: Use one of: text, html, image, link, file, files, none.
```

That is the file, the field (as a path into the JSON), the message, what was expected, and a fix. A warning says `warning:` before its message. The command exits with 1 when there is any error, and with 0 for warnings alone. A clean extension prints `extensions/<id>: ok`.

`npm run build -- <id>` compiles `index.js` into `dist/<id>/`, checks that folder with the same rules, and packs nothing if there is an error. When that build is newer than everything in `extensions/<id>/` except `tests/`, `npm run validate` checks the build, `index.js` included, and names each issue at its source file; a clean result reads `extensions/<id>: ok, with its build in dist/<id>`. Without a build, or once the source has changed since, it checks the source folder and ends with `note: not built yet (or out of date): run npm run build -- <id> to check index.js too`.

### The store is stricter than the app

The validator runs the app's own checks, with the app's messages, and then the store's. So a manifest the app would load can still fail here:

- Fields the schema does not know are errors ([`unknownField`](#unknownfield)); the app ignores them.
- The schema's own limits are checked ([`schemaMismatch`](#schemamismatch)): option ids must be plain, `null` is not allowed in optional fields, `version` must use ASCII digits, and an action with `"input": "none"` still lists non-empty `kinds` if it has `accepts`.
- `accepts.pattern` may use only what the store can verify ([`invalidPattern`](#invalidpattern)).
- A license, README.md, CHANGELOG.md and a complete `locales/en.json` are required.
- The folder holds regular files and folders only ([`notARegularFile`](#notaregularfile)).

## Validator messages

The quoted text is the message; `<…>` stands for what the validator fills in.

### `manifestMissing`

`manifest.json is missing`. There is no `manifest.json` at the folder's root. **Fix:** add it; `npm run new` makes one.

### `manifestNotObject`

`manifest.json is not a JSON object`. The file is not valid JSON, or holds something other than an object. **Fix:** check commas, quotes and brackets; a trailing comma or a comment is not JSON.

### `manifestUnreadable`

`"<field>" must be <a string, true or false, a whole number, a list, an object>`, or `<field> must hold only text`. A field has the wrong type, such as `"hint": "yes"`, `"priority": 1.5` or `"minAppVersion": 2`. It is reported only once every other check passes. **Fix:** write the type the [manifest reference](manifest.md) gives.

### `missingField`

`"<field>" is missing`. A required field is not there. `apiVersion` gets this message when it is missing or not a number (`"1"` is a string). **Fix:** add the field; see the [manifest reference](manifest.md).

### `notAString`

`"<field>" must be a non-empty string`. A required text field is empty or not text. **Fix:** give it a value in quotes.

### `invalidID`

`"<id>" is not a reverse-domain id`. The id is not lowercase letters, digits and dashes in dot-separated parts, with at least two parts. **Fix:** use something like `dev.yourname.tool`, and rename the folder to match.

### `idFolderMismatch`

`the id "<id>" does not match the folder name "<folder>"`. **Fix:** the folder under `extensions/` is named exactly the id; rename one of them.

### `invalidVersion`

`"<version>" is not semantic versioning`. **Fix:** write `MAJOR.MINOR.PATCH`, such as `"1.0.0"`, optionally with a `-beta.1` suffix.

### `unsupportedAPIVersion`

`API version <n> is not supported`. **Fix:** `"apiVersion": 1`.

### `defaultLocaleMissing`

`there is no locales/<language>.json for the default locale`. **Fix:** add the file, or set `defaultLocale` to a language you ship (`"en"`).

### `unknownLocaleKey`

`the key "<key>" is not in locales/<default locale>.json`. A manifest field names a string key the default locale's file lacks. If any locale file is broken, the app reads none, and every key is reported; fix [`localeUnreadable`](#localeunreadable) first. **Fix:** add the key to the file. A `keywords` key's value is a list of strings.

### `unknownCategory`

`"<category>" is not a category`. **Fix:** use `text`, `links`, `images`, `files`, `developer`, `media`, `ai` or `productivity`.

### `unknownPermission`

`"<permission>" is not a permission`. **Fix:** use `network`, `exec`, `capture` or `history` ([Permissions](permissions.md)). AI, translation and files need none.

### `captureRulesNeedCapture`

`captureRules need the capture permission`. **Fix:** add `"capture"` to `permissions`, or remove the rules.

### `networkNeedsDomains`

`"network" needs a list of domains`. `network` is there but has no `domains` list. **Fix:** `"network": { "domains": ["api.example.com"] }`. An empty list allows any host.

### `invalidDomain`

`"<domain>" is not a plain lowercase host name`. **Fix:** write the host only: `api.example.com`, not `https://api.example.com/v1` or `*.example.com`. A domain covers its subdomains already.

### `execNeedsTools`

`"exec" needs the tools the extension runs`. **Fix:** list them: `"requires": { "tools": [{ "name": "yt-dlp", "install": "brew install yt-dlp" }] }`.

### `toolsNeedExec`

`tools are listed but "exec" is not a permission`. **Fix:** add `"exec"` to `permissions`, or remove `requires`.

### `notAnObject`

`a tool must be an object`, `a preference must be an object`, `an action must be an object`, `a variant must be an object`, `a capture rule must be an object`, `a detector must be an object`, or `"accepts" must be an object`. **Fix:** write that entry as `{ … }` with its fields.

### `invalidToolName`

`"<name>" is not a usable tool name`. **Fix:** use the command's bare name (`ffmpeg`), never a path (`/opt/homebrew/bin/ffmpeg`) or arguments.

### `invalidMemberID`

`"<id>" is not a usable <action, variant, preference, capture rule, detector> id`. **Fix:** use only letters, digits, `.`, `_` and `-`.

### `duplicateID`

`the <action, variant, preference, capture rule, detector> id "<id>" is used twice`. **Fix:** give each its own id within its list.

### `unknownPreferenceType`

`"<type>" is not a preference type`. **Fix:** use `text`, `toggle`, `choice`, `secret` or `folder`.

### `secretDefault`

`a secret cannot have a default`. **Fix:** remove `default`; the person types the secret in Settings.

### `folderDefault`

`a folder default must start with "~"`. **Fix:** write it as `"~/Downloads"`, or leave it out.

### `choiceNeedsOptions`

`a choice needs options`. **Fix:** add `"options": [{ "id": "short", "title": "format.short" }, …]`.

### `unknownInput`

`"<input>" is not an input`. **Fix:** `"item"` for a transform, `"none"` for a generator.

### `unknownOutput`

`"<output>" is not an output`. **Fix:** use `text`, `html`, `image`, `link`, `file`, `files` or `none` ([Results](results-and-targets.md)).

### `unknownTarget`

`"<target>" is not a target`. **Fix:** use `finder`, `terminal`, `browser`, `editor` or `other`.

### `targetsOnlyNeedsTargets`

`"targetsOnly" needs at least one entry in "targets"`. **Fix:** add `"targets": ["finder"]`, or remove `targetsOnly`.

### `acceptsMissing`

`an action that takes an item needs "accepts"`, `a capture rule needs "accepts"`, or `a detector needs "accepts"`. **Fix:** add `"accepts": { "kinds": ["text"] }`, narrowed with a `pattern` where it helps.

### `kindsEmpty`

`"kinds" is empty`. **Fix:** list at least one of `text`, `code`, `link`, `color`, `image`, `file`.

### `unknownKind`

`"<kind>" is not a kind`. **Fix:** use `text`, `code`, `link`, `color`, `image` or `file`. A URL is a `link`.

### `invalidPattern`

Either `"<pattern>" is not a valid regular expression`, or `the store validator cannot verify <construct> in "<pattern>"`.

`accepts.pattern` is an ICU regular expression, the kind macOS uses, not a JavaScript one. They differ: `(?i)` works in ICU, while a bare `{` or `[^]` does not.

The second message means the pattern uses something the store cannot check against the app, so it refuses it rather than risk a pattern the app rejects. That covers `\N{…}` character names and most `\p{Name=Value}` properties.

**Fix:** use the constructs listed in [Patterns](concepts.md#patterns): character classes such as `[A-Za-z0-9_-]`, `\d`, `\s`, `\w`, anchors, groups, alternation, `{m,n}`, look-around, and `\p{L}`, `\p{Lu}` or a script such as `\p{Latin}`. Escape a literal `{` as `\{`, and write `^…$` to match the whole text.

### `captureRuleTags`

A warning: `capture rules never see tags; this rule would never run`. A rule's `accepts` lists `tags`, but rules run before detectors tag anything, so it would never match. **Fix:** remove `tags`; filter on `kinds` and `pattern`.

### `indexMissing`

`index.js is missing`. A built folder has no `index.js`, or a source folder has neither `src/index.ts` nor `src/index.js`. **Fix:** add `src/index.ts` and run `npm run build -- <id>`.

### `licenseNotAllowed`

`"<license>" is not a license the store accepts`. **Fix:** use one of `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC` or `MPL-2.0`; MIT is the usual choice.

### `readmeMissing`

`README.md is missing`. **Fix:** add one: what the extension does, an example, and why it needs each permission.

### `changelogMissing`

`CHANGELOG.md is missing`. **Fix:** add one with a `## <version>` section per version, newest first.

### `enLocaleMissing`

`locales/en.json is missing`. Every extension in the store ships English. **Fix:** add `locales/en.json` with every key.

### `enLocaleKeyMissing`

`the key "<key>" is not in locales/en.json`. **Fix:** add the key to `locales/en.json`.

### `localeUnreadable`

`locales/<language>.json is not a JSON object`. One broken locale file and the app reads no locale at all, so the extension would show bare keys. **Fix:** make the file valid JSON: one object of keys and strings (lists for keywords).

### `unknownField`

`"<name>" is not a manifest field here`. A misspelled or invented field, such as `"permision"` or `"jsAccepts"`. **Fix:** remove it, or correct the spelling against the [manifest reference](manifest.md).

### `schemaMismatch`

A schema rule the app's own checks do not cover, such as `"Not Plain" does not have the expected form` (an option id), `must not be empty`, or `must be a string, not null`. **Fix:** compare the field with the [manifest reference](manifest.md): leave optional fields out rather than setting them to `null`.

### `notARegularFile`

`it is a symbolic link, and an extension holds only regular files and folders`, or `it is not a regular file`. The build copies files into the package, and a link would bring whatever it points at, so the store refuses links, pipes and devices anywhere in the extension's folder; `node_modules` is left to npm. `npm run build` stops on it before it copies anything. **Fix:** put a copy of the file itself in the folder, or remove the link.

## Build errors

The build prefixes each message with `extensions/<id>:` and ends with `build failed: <id>`.

### Node builtins

```text
extensions/dev.yourname.tool: extensions/dev.yourname.tool/src/index.ts:1:16: "node:fs" is a Node.js module, and extensions do not run in Node. Use the `yab` API or a web standard instead (see docs/errors.md#node-builtins).
extensions/dev.yourname.tool: `process` is a Node.js global, and extensions do not run in Node. Use the `yab` API or a web standard instead (see docs/errors.md#node-builtins).
```

**Why.** Extensions run in JavaScriptCore inside yabbistir's helper process, not in Node. Node's modules (`fs`, `path`, `child_process`, `http`, `crypto`, …) and globals (`process`, `Buffer`, `require`, `global`, `__dirname`, `__filename`) do not exist there, and code that reaches for them would fail at run time. The build stops it earlier:

- Any import of a Node module, with or without `node:`, is refused. That includes **npm packages whose names are Node's**, such as `events`, `util`, `url`, `buffer`, `assert`, `path`, `punycode` and `string_decoder`, even when installed from npm: the build cannot tell them apart.
- Any use of `process`, `Buffer`, `require`, `global`, `__dirname` or `__filename` that the code does not define itself is refused. That includes guards such as `typeof process !== "undefined"` or `typeof require === "function"` inside a bundled library.
- An import that is never used is dropped before the check, so it does not fail.

**What to use instead:**

| Node | In an extension |
|---|---|
| `fs` | `yab.files.write`, `read` and `exists` (the call's work folder, the item's files, chosen folders) |
| `path` | String operations on `/`-separated paths, or `new URL(…)` |
| `child_process` | `yab.exec` with the `exec` permission ([Permissions](permissions.md#exec)) |
| `http`, `https`, `net` | `fetch` or `yab.http.fetch` with the `network` permission |
| `crypto` | `crypto.getRandomValues`, `crypto.randomUUID`, or a pure-JavaScript library |
| `Buffer` | `Uint8Array`, `TextEncoder`, `TextDecoder`, `atob`, `btoa` |
| `process.env`, `process.platform` | Preferences, secrets (`yab.secrets.get`), `yab.language`; it is always macOS |
| `url` | The global `URL` and `URLSearchParams` |
| `events`, `util` | A few lines of your own, or a library that does not import them |
| `setImmediate`, `process.nextTick` | `setTimeout(fn, 0)` or `await Promise.resolve()` |

For an npm package, choose one made for browsers without Node polyfills, or with no dependencies. If a library only works in Node, it does not work in an extension. `npm run typecheck` shows the same problem early: `process`, `Buffer` and `require` have no types here.

### Could not resolve

`extensions/<id>/src/index.ts:<line>:<column>: Could not resolve "<package>"`. The import names a package that is not installed, or a file that is not there. **Fix:** check the spelling, and import your own files with their `.ts` extension (`./parse.ts`). A library goes in a `package.json` in the extension's own folder, at an exact version; run `npm install` from the repository's root, which uses npm workspaces ([Testing](testing.md#libraries)).

### Other build messages

- `"<id>" is not an extension id`: pass the folder name under `extensions/`, such as `dev.yourname.tool`.
- `extensions/<id>: there is no such extension folder`: create it with `npm run new`, or check the id.
- `extensions/<id>/manifest.json: it is missing or is not valid JSON`: see [`manifestNotObject`](#manifestnotobject).
- `extensions/<id>/src/index.ts: it is missing`: add it; it exports `actions`, `detectors` and/or `captureRules`.
- A syntax error names the file, line and column: fix the code there.
- Validator lines after a successful compile: the built folder failed a check above; nothing was packed.

`npm run dev` refuses to touch `~/Library/Application Support/yabbistir/Extensions/<id>` when it is a real folder, an installed copy: `… is a real folder (an installed copy of <id>), so dev leaves it alone`. Remove that copy in Settings → Extensions, then run it again.

## Runtime errors

Every error a `yab` function throws or rejects with has a `code` ([`ExtensionErrorCode`](api.md#extensionerrorcode)), and so does a failed call into the extension. Test it as `error.code`. An `Error` you throw yourself with one of these codes keeps it; any other thrown error is `script`.

### `script`

The extension threw. **Cause:** your code, a failed check of your own, or a `yab` error you wrapped. **Fix:** for a real failure, throw an `Error` whose message a person can act on (`yab.t`). For an expected situation (no input, wrong shape), return `{ none: true, message }` instead: in an action, thrown errors count toward [turning the extension off](#turned-off-after-repeated-errors).

### `syntax`

`index.js` does not parse. Any load that fails, this or a top level that throws, is logged in the Development log as `index.js could not load: …`. **Fix:** run `npm run build` again; keep the top level to declarations, free of work that can throw.

### `timeout`

The call ran past its limit: 500 ms for a hint or a preview, 50 ms for `validate`, 200 ms for a capture rule, 10 seconds for an action. **Fix:** make it a [job](jobs.md) if it is slow by nature; otherwise do less, or narrow `accepts` so it runs less often.

### `notFound`

The app called an action, detector or rule the code does not export. **Fix:** the ids in the manifest and the keys of `actions`, `detectors` and `captureRules` in `src/index.ts` must match exactly.

### `badResult`

What the call returned is not a result the app accepts, or a `yab` call got arguments it cannot use. Examples: `run` returned a string instead of `{ text }`, a file result outside `yab.files.workDir`, a preview section of an unknown `type`, `yab.exec` with arguments that are not strings, `yab.files.write` with `..` in the name, `yab.job.progress` with a fraction that is not a number. The app logs the reason to the Development log. **Fix:** return one of the [result shapes](results-and-targets.md); the fake host reports the same reason in tests.

### `unavailable`

What was asked for cannot be done on this Mac right now: Apple Intelligence is off or not ready, a translation language pack is missing, WebP cannot be written, Vision found no subject, the helper is restarting, or the extension was turned off. The message says which, in the app's language. **Fix:** let it through so the person sees it; there is nothing to retry in code.

### `unsupported`

The extension needs something this version of the app does not offer. **Fix:** set `minAppVersion` to the version that has it.

### `interrupted`

Cut short by something else: another call's timeout restarted the helper, or the helper stopped. It never counts against the extension. **Fix:** nothing; the person can try again.

### `permissionDenied`

A call the manifest does not allow, or that is not allowed in this kind of call: the network without `network`, a host outside `network.domains`, a tool not in `requires.tools`, `yab.history` without `history`, or any effect (network, programs, notices, opening links, AI, translation, history) in a hint, detector, preview or capture rule. **Fix:** add the permission or the domain if the extension really needs it, and move effects into an action the person starts.

### `toolMissing`

A tool from `requires.tools` is not installed. The message says how to install it (the manifest's `install`), and Settings shows that command. **Fix:** let it through; in tests, a tool missing from the fake host's `exec` table gives this error.

### `cancelled`

The person cancelled the job, or `signal` was aborted. Every pending `yab` promise rejects with it. **Fix:** let it through; never catch it and carry on.

### `networkError`

A request failed: no connection, a redirect outside `network.domains`, or a text body over 10 MB without `toFile`. **Fix:** let it through, or catch it and throw a clearer message (keep `cancelled` untouched); stream large bodies with `toFile`.

## Turned off after repeated errors

Three failures in a row turn an extension off; Settings shows it as off and a notice says so. A success resets the count. Not every failure counts:

- **Never counted:** `cancelled`, `interrupted`, `toolMissing`, `networkError`, `permissionDenied`.
- **In a job,** only a broken extension counts: `badResult`, `notFound`, `syntax`. A job's own thrown errors are reported to the person, not counted.
- **Everywhere else** (actions, hints, detectors, previews, rules), any other failure counts, `script` and `timeout` included.
- A load that fails (`index.js could not load`) counts too.

The person turns it back on in Settings. Read Settings → Extensions → Development → Log to see why.

## Test failures

Messages the fake host gives in `npm test`:

- `<host>: the request failed (no fake response for GET <url>)` (`networkError`): the code made a request the test did not answer. Add it to `http`, with the whole URL.
- `<host> is not in the extension's domains` (`permissionDenied`): add the domain to `network.domains`, or fix the URL.
- `<tool> is not installed. Install it with: …` (`toolMissing`): add the tool to the fake host's `exec` table.
- `<tool> is not in the extension's required tools` (`permissionDenied`): add it to `requires.tools`.
- `the fake host has no AI answer; pass createFakeHost({ ai })` (`unavailable`), and the same for `translate` and `vision`.
- `run returned … ; expected {text}, {html, text}, …` (`badResult`): return a result shape.
- `… is not available in hints, detectors and previews` (`permissionDenied`): an effect in a call without effects.
- `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, or a TypeScript import that Node cannot load: use `import type` for `@yabbistir/api`, import your files with `.ts`, avoid `enum` and `namespace`, and use Node 22.18 or later ([Testing](testing.md)).
