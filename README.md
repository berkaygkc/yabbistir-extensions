# yabbistir extensions

The open extension store for [yabbistir](https://github.com/berkaygkc/yabbistir), a clipboard history app for macOS. This repository holds the extensions, the tools to write, test and build them, and the docs. An extension adds commands to the panel, recognizes what you copy, cleans copies before they are stored, fills a column of its own, or runs a long job under the menu bar icon. It is TypeScript bundled into one file that runs inside yabbistir, which draws everything, so every extension looks like part of the app. Each one asks for only the permissions it needs, and you decide before it is installed.

## Install extensions

In yabbistir, open Settings → Extensions → Store, pick the extensions you want, and press Install. The Store reads a signed catalog only when you open it or press Refresh; yabbistir never checks in the background.

To try an extension that isn't in the store yet, build it here (`npm run build -- <id>`) and install `dist/<id>-<version>.yabext` from Settings → Extensions → Development → Install .yabext….

## Extensions

Thirty-six so far, each with a README that says what it does, every permission and tool it uses and why, and its limits.

### Passwords, codes and safety

| Extension | What it does | Permissions |
|---|---|---|
| [1Password](extensions/dev.yabbistir.onepassword) | Your logins in a column: ↵ pastes the password, ⇧↵ the username, and a second column pastes one-time codes, through the `op` command-line tool | exec |
| [Bitwarden](extensions/dev.yabbistir.bitwarden) | Your logins in a column: ↵ pastes the password, ⇧↵ the username, and a second column pastes TOTP codes, through the `bw` command-line tool | exec |
| [LastPass](extensions/dev.yabbistir.lastpass) | Lists your LastPass entries in a column of their own: ↵ pastes the password, ⇧↵ the username, through the `lpass` command-line tool | exec |
| [Authenticator](extensions/dev.yabbistir.authenticator) | Two-factor codes worked out on your Mac from your authenticator's export (LastPass, Google, Aegis, 2FAS, Bitwarden or `otpauth` links): ↵ pastes the current code | none |
| [Password Generator](extensions/dev.yabbistir.password-generator) | Strong passwords, passphrases, PINs and random keys | none |
| [Secret Guard](extensions/dev.yabbistir.secret-guard) | Keeps the API keys, private keys and other secrets you copy out of your history | capture |
| [Safe Paste](extensions/dev.yabbistir.safe-paste) | Spots hidden characters, look-alike letters and risky commands in what you copy, and pastes it cleaned | none |

### Developer tools

| Extension | What it does | Permissions |
|---|---|---|
| [GitHub](extensions/dev.yabbistir.github) | Review requests, your pull requests and your issues in a column: ↵ pastes the link, ⇧↵ a Markdown link. Shares copied code as a secret gist, through `gh` | exec |
| [Linear](extensions/dev.yabbistir.linear) | Your open issues in a column; a copied issue key becomes a link and a copied error a new issue | network |
| [Jira](extensions/dev.yabbistir.jira) | Your open Jira Cloud issues in a column; a copied issue key becomes a link and copied text a new issue | network |
| [Docker](extensions/dev.yabbistir.docker) | Your containers in a column: ↵ pastes the name, ⇧↵ a `docker exec` command. Docker Desktop, OrbStack and Colima | exec |
| [Kubernetes](extensions/dev.yabbistir.kubernetes) | The pods of your current context in a column: ↵ pastes the name, ⇧↵ a `kubectl logs` or `exec` command | exec |
| [SSH Hosts](extensions/dev.yabbistir.ssh) | The hosts in your SSH config in a column: ↵ pastes `ssh <alias>`, ⇧↵ the full command | none |
| [Dev Servers](extensions/dev.yabbistir.dev-servers) | The servers listening on your Mac in a column: ↵ pastes `http://localhost:<port>` | exec |
| [Homebrew](extensions/dev.yabbistir.homebrew) | Installs what a copied `brew install` command names; your outdated packages in a column, upgraded together in the background | exec |
| [Recent Projects](extensions/dev.yabbistir.recent-projects) | The folders you opened lately in VS Code, Cursor, Windsurf or VSCodium: ↵ pastes the path, ⇧↵ the command that opens it | exec |
| [JWT](extensions/dev.yabbistir.jwt) | Recognizes copied JSON Web Tokens and shows what is inside | none |
| [Hash & Encode](extensions/dev.yabbistir.hash-encode) | MD5 and SHA hashes, and URL, HTML, Unicode, hex, ROT13 and Punycode encodings | none |
| [Timestamp](extensions/dev.yabbistir.timestamp) | Recognizes Unix timestamps and ISO dates, shows the moment they stand for and converts them | none |
| [Fake Data](extensions/dev.yabbistir.fake-data) | Fake names, emails, phones, addresses, Turkish ID and IBAN numbers, test cards and JSON users for forms and tests | none |

### Writing and text

| Extension | What it does | Permissions |
|---|---|---|
| [AI Writing](extensions/dev.yabbistir.ai-writing) | Fixes, shortens and rewrites copied text, explains it and writes commit messages, with Apple Intelligence on your Mac | none |
| [Translate](extensions/dev.yabbistir.translate) | Translates and summarizes text on your Mac | none |
| [Change Case](extensions/dev.yabbistir.change-case) | camelCase, snake_case, Title Case, a URL slug and more, with the result shown first | none |
| [HTML to Markdown](extensions/dev.yabbistir.html-to-markdown) | Turns rich text copied from web pages and documents into clean Markdown | none |
| [Snippets](extensions/dev.yabbistir.snippets) | Canned replies, signatures and templates from a Markdown file, in a column; `{date}`, `{time}` and more are filled in | none |
| [Symbols](extensions/dev.yabbistir.symbols) | Mac key symbols, arrows, typography, math, currency and kaomoji in two columns | none |

### Links and the web

| Extension | What it does | Permissions |
|---|---|---|
| [Browser Tabs](extensions/dev.yabbistir.browser-tabs) | Your open tabs in Safari, Chrome, Arc, Brave, Edge and Vivaldi in a column: ↵ pastes the link, ⇧↵ a Markdown link | exec |
| [Link Cleaner](extensions/dev.yabbistir.link-clean) | Strips tracking parameters from links as you copy them | capture |
| [Link Tools](extensions/dev.yabbistir.link-tools) | Shows where an is.gd or v.gd short link goes, and makes short links | network |
| [Download Video](extensions/dev.yabbistir.video-download) | Downloads YouTube, Instagram and X links as MP4 video or M4A audio with yt-dlp; drops the file into Finder | network, exec |
| [QR Code](extensions/dev.yabbistir.qr) | Shows text and links as a QR code, and reads the QR codes in an image | none |
| [Send To](extensions/dev.yabbistir.send-to) | Sends copied text or a link to Obsidian, Things, Bear, Drafts, OmniFocus, Reminders or Notes without switching to them | exec |

### Numbers, colors and Türkiye

| Extension | What it does | Permissions |
|---|---|---|
| [Calculator](extensions/dev.yabbistir.calculator) | Recognizes a copied sum such as `12 * 3 + 4` or `15% of 80` and pastes the answer | none |
| [Units & Currency](extensions/dev.yabbistir.units-currency) | Recognizes amounts with a unit or a currency and converts them, with the European Central Bank's rates | network |
| [Color Tools](extensions/dev.yabbistir.color-tools) | The nearest CSS and Tailwind color, contrast, and lighter, darker or opposite shades of a copied color | none |
| [Türkiye Pack](extensions/dev.yabbistir.turkiye) | Checks IBANs, TC Kimlik and tax numbers, formats Turkish phone numbers and tracks packages | none |

## Write one

You need macOS 26 or later on Apple silicon with yabbistir, and Node 24 (22.18 or later works).

1. Clone this repository and run `npm install`.
2. `npm run new -- dev.yourname.tool --template action --author <name>` creates `extensions/dev.yourname.tool/` from a template (`action`, `detector`, `capture-rule`, `job` or `source`). `--author` is how you want to be credited, your name or your GitHub user name; without it, your git user name is used and printed.
3. Edit `manifest.json`, `src/index.ts` and `locales/en.json`, and the tests in `tests/`. Only English is required: the template's `locales/tr.json` holds Turkish for its sample, so translate it or delete it.
4. `npm test -- dev.yourname.tool`, then `npm run build -- dev.yourname.tool`, then `npm run validate -- dev.yourname.tool` check it.
5. `npm run dev -- dev.yourname.tool` links it into yabbistir and rebuilds on every change. When it is ready, open a pull request.

Read next:

- [Getting started](docs/getting-started.md): a first extension, step by step.
- [Concepts](docs/concepts.md): what an extension can do, and which kind fits your idea.
- [Manifest](docs/manifest.md) and [API](docs/api.md) references, [Permissions](docs/permissions.md), [Errors](docs/errors.md).
- Guides: [jobs](docs/jobs.md), [results and targets](docs/results-and-targets.md), [detectors and previews](docs/detectors-and-previews.md), [capture rules](docs/capture-rules.md), [sources](docs/sources.md), [localization](docs/localization.md), [testing](docs/testing.md), [design guidelines](docs/design-guidelines.md).
- [Recipes](docs/concepts.md#recipes): six small, complete extensions.
- [Publishing](docs/publishing.md) and the [review checklist](docs/review-checklist.md).

Coding agents: start with [AGENTS.md](AGENTS.md). [llms.txt](llms.txt) indexes the docs, and `llms-full.txt` holds them all in one file.

## Repository

```text
extensions/<id>/    the extensions, one folder each
templates/          what npm run new copies
packages/api/       the API's types (@yabbistir/api) and the fake host for tests
tools/              new, dev, validate, test, build, docs, catalog, sign, pr-checks
schema/             the manifest's and the catalog's JSON Schemas
docs/               guides and references
.github/            the pull request template, and the workflows that check, label and publish
```

## Security

Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says; it also sums up how the catalog is signed.

## License

MIT, for the tools and the docs. Each extension states its own license in its manifest.
