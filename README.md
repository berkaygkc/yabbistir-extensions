# yabbistir extensions

The open extension store for [yabbistir](https://github.com/berkaygkc/yabbistir), a clipboard history app for macOS. This repository holds the extensions, the tools to write, test and build them, and the docs. An extension adds commands to the panel, recognizes what you copy, or cleans copies before they are stored. It is TypeScript bundled into one file that runs inside yabbistir, which draws everything, so every extension looks like part of the app. Each one asks for only the permissions it needs, and you decide before it is installed.

## Install extensions

In yabbistir, open Settings → Extensions → Store, pick the extensions you want, and press Install. The Store is coming in yabbistir 0.2.0. The Store reads a signed catalog only when you open it or press Refresh; yabbistir never checks in the background.

Until then, build an extension here (`npm run build -- <id>`) and install `dist/<id>-<version>.yabext` from Settings → Extensions → Development → Install .yabext….

| Extension | What it does | Permissions |
|---|---|---|
| [Download Video](extensions/dev.yabbistir.video-download) | Downloads YouTube, Instagram and X links as MP4 video or M4A audio with yt-dlp; drops the file into Finder | network, exec |
| [Link Cleaner](extensions/dev.yabbistir.link-clean) | Strips tracking parameters from links as you copy them | capture |
| [JWT](extensions/dev.yabbistir.jwt) | Recognizes copied JSON Web Tokens and shows what is inside | none |
| [Translate](extensions/dev.yabbistir.translate) | Translates and summarizes text on your Mac | none |

## Write one

You need macOS 26 or later on Apple silicon with yabbistir, and Node 22.18 or later.

1. Clone this repository and run `npm install`.
2. `npm run new -- dev.yourname.tool --template action` creates `extensions/dev.yourname.tool/` from a template (`action`, `detector`, `capture-rule` or `job`).
3. Edit `manifest.json`, `src/index.ts` and `locales/en.json`, and the tests in `tests/`.
4. `npm test -- dev.yourname.tool`, `npm run validate -- dev.yourname.tool` and `npm run build -- dev.yourname.tool` check it.
5. `npm run dev -- dev.yourname.tool` links it into yabbistir and rebuilds on every change. When it is ready, open a pull request.

Read next:

- [Getting started](docs/getting-started.md): a first extension, step by step.
- [Concepts](docs/concepts.md): what an extension can do, and which kind fits your idea.
- [Manifest](docs/manifest.md) and [API](docs/api.md) references, [Permissions](docs/permissions.md), [Errors](docs/errors.md).
- Guides: [jobs](docs/jobs.md), [results and targets](docs/results-and-targets.md), [detectors and previews](docs/detectors-and-previews.md), [capture rules](docs/capture-rules.md), [localization](docs/localization.md), [testing](docs/testing.md), [design guidelines](docs/design-guidelines.md).
- [Recipes](docs/concepts.md#recipes): six small, complete extensions.
- [Publishing](docs/publishing.md) and the [review checklist](docs/review-checklist.md).

Coding agents: start with [AGENTS.md](AGENTS.md). [llms.txt](llms.txt) indexes the docs, and `llms-full.txt` holds them all in one file.

## Repository

```text
extensions/<id>/    the extensions, one folder each
templates/          what npm run new copies
packages/api/       the API's types (@yabbistir/api) and the fake host for tests
tools/              new, dev, validate, test, build, docs, catalog, pr-checks
schema/             the manifest's and the catalog's JSON Schemas
docs/               guides and references
.github/            the pull request template, and the workflows that check, label and publish
```

## License

MIT, for the tools and the docs. Each extension states its own license in its manifest.
