# Publishing

Extensions reach people through the store: this repository, a signed catalog built from it, and the Store tab in yabbistir's Settings → Extensions (coming in yabbistir 0.2.0). Publishing is a pull request.

## The flow

1. **Fork** this repository and make a branch.
2. **Write** the extension in `extensions/<id>/` (`npm run new -- <id> --template <template>`), with tests.
3. **Check** it: `npm test -- <id>`, `npm run validate -- <id>` and `npm run build -- <id>` pass, and you have tried it in the app with `npm run dev -- <id>`.
4. **Open a pull request.** The template asks what the extension does, for an example or a screenshot, for a reason for each permission, and for the tools it needs ([the template](../.github/PULL_REQUEST_TEMPLATE.md)).
5. **Checks** run on the pull request (below). Fix what they report and push again.
6. **Review:** the maintainer reads the code against the [review checklist](review-checklist.md), and may ask for changes.
7. **Merge.** Publishing then runs on `main`: every extension is built into a `.yabext` package, the catalog is generated with each package's SHA-256, signed with an Ed25519 key, and published to GitHub Pages.
8. **In the app,** the Store lists the new version the next time someone opens it or presses Refresh. Nothing is fetched in the background.

## What a pull request may change

- **One extension folder per pull request:** `extensions/<id>/` and nothing else. A pull request that changes two extension folders fails the checks.
- Changes to the tools, templates, docs or `packages/api` go in a pull request of their own, without an extension.
- **Someone else's extension:** fixes are welcome. The extension's `author` is mentioned on the pull request and can weigh in; the maintainer decides.
- **Every change raises `version`** in manifest.json and adds a `## <version>` section to CHANGELOG.md, newest first.

## The checks

Each pull request runs, for the extension it changes:

- `npm run validate` and `npm run typecheck`.
- `npm run build`: Node modules and globals are caught here ([why](errors.md#node-builtins)).
- `npm test` for the extension, and the tools' own tests.
- Size: the `.yabext` at most 5 MB, `index.js` at most 1 MB.
- Readable source: a line in `src/` over 500 characters, or an average line over 200, is taken for minified or obfuscated code and refused. Write the source by hand, and let the build bundle libraries.
- The license and a complete English locale (from the validator).
- `npm run docs` leaves no difference, for pull requests that touch the docs or what they are made from.

A pull request that changes `permissions`, `network` or `requires` gets the `permissions-changed` label, so the review looks at it closely. Workflows that run on pull requests never see the signing key.

## Updates

An update is the same flow with a higher `version`. Installed copies update when the person chooses to, from the Store. An update that asks for a new permission, a new domain or a new tool waits until the person approves it. Never change the `id`: a new id is a new extension.

## The catalog

The app reads only static files, with no account, token or tracking:

| What | Where |
|---|---|
| Catalog | `https://berkaygkc.github.io/yabbistir-extensions/v1/catalog.json` |
| Its signature | `https://berkaygkc.github.io/yabbistir-extensions/v1/catalog.json.sig`: the base64 of a 64-byte Ed25519 signature over the catalog's exact bytes |
| Packages | `https://berkaygkc.github.io/yabbistir-extensions/v1/packages/<id>-<version>.yabext` |
| File icons | `https://berkaygkc.github.io/yabbistir-extensions/v1/icons/<id>.png`, for extensions with `icon.png` |

Each catalog entry has the extension's id, version, `apiVersion` and `minAppVersion`, its name and description in every language it ships, author, categories, icon, permissions, network hosts and tools, and the package's SHA-256, size and date. The app accepts a catalog only if its signature verifies with one of the keys built into the app, and installs a package only if its SHA-256 matches the catalog. An extension the app is too old for is listed but cannot be installed.

## The .yabext package

`npm run build -- <id>` writes `dist/<id>-<version>.yabext`: a zip whose root is a folder named after the id.

```text
<id>/manifest.json
<id>/index.js
<id>/locales/en.json
<id>/locales/tr.json
<id>/README.md
<id>/CHANGELOG.md
<id>/icon.png           only with a file icon
```

The archive is deterministic: entries in sorted order, every date set to 1980-01-01, fixed permissions, so the same source always gives the same bytes and the same SHA-256. The source (`src/`, `tests/`) is not in it.

To try a package without the store, install it in yabbistir: Settings → Extensions → Development → Install .yabext… (or Install from Folder… with `dist/<id>`). The app asks for the permissions first, and marks it as not signed.
