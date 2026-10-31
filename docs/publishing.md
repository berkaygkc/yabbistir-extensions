# Publishing

Extensions reach people through the store: this repository, a signed catalog built from it, and the Store tab in yabbistir's Settings → Extensions (coming in yabbistir 0.2.0). Publishing is a pull request.

## The flow

1. **Fork** this repository and make a branch.
2. **Write** the extension in `extensions/<id>/` (`npm run new -- <id> --template <template>`), with tests.
3. **Check** it: `npm test -- <id>`, `npm run validate -- <id>` and `npm run build -- <id>` pass, and you have tried it in the app with `npm run dev -- <id>`.
4. **Open a pull request.** The template asks what the extension does, for an example or a screenshot, for a reason for each permission, and for the tools it needs ([the template](../.github/PULL_REQUEST_TEMPLATE.md)).
5. **Checks** run on the pull request (below). Fix what they report and push again.
6. **Review:** the maintainer reads the code against the [review checklist](review-checklist.md), and may ask for changes.
7. **Merge.** The maintainer squash-merges the pull request. Publishing then runs on `main`: every extension is built into a `.yabext` package, the catalog is generated with each package's SHA-256, signed with an Ed25519 key, and published to GitHub Pages ([how](#how-publishing-runs)).
8. **In the app,** the Store lists the new version the next time someone opens it or presses Refresh. Nothing is fetched in the background.

## What a pull request may change

- **One extension folder per pull request:** `extensions/<id>/` and nothing else, apart from the root `package-lock.json` when the extension adds a library, and the files `npm run docs` regenerates (the manifest reference quotes a real extension's manifest). A pull request that changes two extension folders, or other files next to its folder, fails the checks.
- Changes to the tools, templates, docs or `packages/api` go in a pull request of their own, without an extension.
- **Someone else's extension:** fixes are welcome. A comment on the pull request names the extension's `author`, and mentions them when `author` is the GitHub login they committed the extension with, so they can weigh in; the maintainer decides.
- **Every change raises `version`** in manifest.json and adds a `## <version>` section to CHANGELOG.md, newest first.

## The checks

Each pull request runs, for the extension it changes:

- `npm run validate` and `npm run typecheck`.
- `npm run build`: Node modules and globals are caught here ([why](errors.md#node-builtins)).
- `npm test` for the extension, and the tools' own tests.
- Size: the `.yabext` at most 5 MB (5,000,000 bytes, the most the app downloads), `index.js` at most 1 MB.
- Readable source: a line over 500 characters, or a file whose lines average over 200 (blank lines aside), is taken for minified or obfuscated code and refused. This covers every file in `src/` and every file of the extension's folder that the build bundles, wherever it sits (`node_modules` aside). Write the source by hand, and let the build bundle libraries.
- Libraries from npm only: an extension's `package.json` names each library by a version, range or tag on the npm registry (no git, `file:`, `link:` or URL dependency, no `bundleDependencies`), and has no `bin`, `scripts`, `directories` or `gypfile`; the folder has no `binding.gyp` and no committed `node_modules`. npm would otherwise fetch or run something no review saw. To add a library, write `extensions/<id>/package.json` as `{ "name": "<id>", "private": true }` (not with `npm init`, which adds `scripts`), then run `npm install <library>@<version> -w extensions/<id>` and commit both files.
- The lockfile, on every pull request that changes it: each changed entry is its own package's tarball on the npm registry (`https://registry.npmjs.org/<name>/-/<name>-<version>.tgz`, so the address names the package and the version the entry claims) with a `sha512` integrity hash, or a workspace folder. An `npm:` alias entry names the package the alias asks for, and entries bundled inside another package (`inBundle`) are refused, since no address of their own can be checked. A dependency spec that names a tarball file (`lib.tgz`) is refused like any other file. Beside an extension, only that extension's own libraries change: not the tools' packages or their platform builds, not another extension's, not one shared with them; and none has an install script or a command-line program. Without an extension, every change must follow from a change to a `package.json` that asks for it. `package-lock.json` is always exactly what `npm install --package-lock-only` writes.
- The license, a complete English locale, and regular files only: no symbolic links anywhere in the folder (from the validator).
- The install state of the whole repository (`node tools/lockfile-state.mjs`): every entry of the lockfile, not only the changed ones, passes the rule above; there is no `npm-shrinkwrap.json` and no `.npmrc` at the root, which npm would read instead of, or on top of, the lockfile; and no two paths under `extensions/` differ only in letter case, which a case-insensitive disk would merge.
- `npm run docs` leaves no difference: a pull request that touches the docs, or what they are made from, commits what `npm run docs` writes.
- `npm run catalog` builds the store's catalog with the change, so a merge never stops publishing.

They run in two jobs:

- **Static checks**: the rules that only read files and git, which are the one-folder rule, `package.json`, the lockfile and the install state. The job checks out the pull request as data and the checker (`tools/static-checks.mjs`, `tools/lib/static-rules.mjs` and `tools/lockfile-state.mjs`) from the base branch, installs nothing, and runs nothing of the pull request, so neither the pull request's tests nor its edits to `tools/` can change its result. Merging waits for it.
- **Checks**: everything, the static rules included, with the pull request's own code: `npm ci --ignore-scripts` on macOS with Node 24 (npm 11), then build, validate, the tests, the docs and the catalog. These run code from the pull request in the same job, so their result shows a contributor what to fix; the static job, and the review, are what a merge relies on.

Every check runs even when one fails, and the log ends with a list of them all. `npm run pr-checks` runs them all on your machine, for the commits since `origin/main` (add `-- --base <ref>` for another starting point); `node tools/static-checks.mjs` runs the static ones alone.

A pull request that changes `permissions`, `network` or `requires` (a tool's install command included), or adds an extension that asks for any of them, gets the `permissions-changed` label, so the review looks at it closely; so does one whose manifest the labelling cannot read. The workflow that labels reads the pull request through GitHub's API and never runs its code, and workflows that run on pull requests never see the signing key.

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
| Schemas | `https://berkaygkc.github.io/yabbistir-extensions/v1/catalog.schema.json` ([source](../schema/catalog.schema.json)) and `…/v1/manifest.schema.json` |

Each catalog entry has the extension's id, version, `apiVersion` and `minAppVersion`, its name and description in every language it ships, author, categories, icon, permissions, network hosts and tools, the package's SHA-256 and size, and the time of the last commit on `main` that changed the extension's folder (main's own commits, the merges: a branch's commits carry whatever date their author gave them). The same commit always gives the same catalog, byte for byte; `npm run catalog -- --out site/v1` writes it locally, unsigned. The app accepts a catalog only if its signature verifies with one of the keys built into the app, and installs a package only if its SHA-256 matches the catalog. An extension the app is too old for is listed but cannot be installed.

## How publishing runs

`.github/workflows/publish.yml` runs on every push to `main`, in three jobs:

1. **Build**, with no secret: first `node tools/lockfile-state.mjs` checks the install state of `main` as merged, with nothing installed, and stops the publish on any problem; then `npm ci --ignore-scripts` on Node 24, then `node tools/catalog.mjs --out site/v1` writes the catalog, the packages and the icons, unsigned. Node 24 brings npm 11: npm 10 still runs a git dependency's `prepare` script under `--ignore-scripts`. esbuild needs no install script: its platform build comes as an optional dependency.
2. **Sign**, in the `publish` environment, the only place the signing key exists. It checks out two paths, [`tools/sign.mjs`](../tools/sign.mjs) and `keys/catalog-public-keys.json`, and nothing else: no `package.json`, no `npm`, no `node_modules`. The signer uses Node's built-in modules only. Before it signs, it checks what it signs: format 1, every package under the `packages/` address above and next to the catalog with the size and SHA-256 the catalog states, every file icon under `icons/`, every readme on this repository, and nothing else in `site/` (only the catalog, the packages and icons it names, and the two schemas). Once the repository holds the app's public keys in `keys/catalog-public-keys.json` (`{ "keys": ["<base64 of a raw 32-byte key>", …] }`), it also refuses a signature none of them verifies, so a wrong secret never publishes a catalog every app rejects.
3. **Deploy** the signed `site/` to GitHub Pages, from the `github-pages` environment.

Signing and deploying run only for `main`.

### What these checks do not cover

- **The npm registry is trusted.** A library is what its author published: the checks make sure the lockfile installs exactly that package and version, with npm verifying its hash, and the review reads what the extension uses. They cannot tell whether the published code is good.
- **Tool upgrades rely on review.** A pull request that raises a version in the root `package.json` may change everything that version brings with it; the maintainer reviews such pull requests by hand.
- **The checks job runs the pull request's code**, so its result is a guide, not a guarantee. The static job, the install-state check before every publish, and the review are what keep a change from reaching the catalog unseen.

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
