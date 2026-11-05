# Review checklist

Every pull request is read against this list before it is merged. Authors: go through it before you open one, and say in the pull request how each point that applies is met. The automated checks ([Publishing](publishing.md#the-checks)) cover what a machine can see. This list is for what takes a person.

## Data

- [ ] Nothing about the person leaves the Mac except what the action is for, and only when the person runs it. No analytics, no telemetry, no "phone home", no tracking parameters added to requests.
- [ ] The item's content goes only to the host the action is about, and the README says so.
- [ ] `console.log` and thrown messages never contain the item's content, a secret or a token; the Development log is still a log.
- [ ] Secrets are read with `yab.secrets.get` only where needed, never logged, never put in a result, never sent anywhere but their own service.
- [ ] `yab.storage` holds settings or small caches, not copies of the person's clipboard.
- [ ] Files are written only in the work folder; a `folder` preference is only read.

## Permissions

- [ ] Each permission has a reason in the pull request and in the README, and the extension cannot do its job without it.
- [ ] `network` lists the hosts it needs. An empty list (any host) needs a strong reason, such as an action whose whole point is any link.
- [ ] `capture` only for extensions whose purpose is a capture rule. A rule is fast, pure and keeps the copy when unsure.
- [ ] `history` only when the action is about earlier copies.
- [ ] On-device features (`yab.ai`, `yab.translate`) are preferred over a web service when they can do the job.

## exec

- [ ] Each tool in `requires.tools` is needed, named by its bare command, with an `install` command that works (`brew install …`).
- [ ] **Arguments are fixed or checked by the extension.** Anything that comes from the item (a link, a file name, text) is one argument, after `--` when the tool accepts it, so it can never be read as an option.
- [ ] No option that runs another program, reads a config file from elsewhere or writes outside the work folder (for yt-dlp: no `--exec`, `--config-locations`, `--batch-file`, `--netrc`), unless the reason is in the pull request.
- [ ] No shell (`sh`, `bash`, `zsh`) as a tool.
- [ ] `osascript` only with a script written in the extension's code, the same on every run: never one built from the item, a preference or anything else. The item's content reaches the script only as arguments (`on run argv`), after `--`. The README names the apps the script talks to; macOS asks the person once for each app, and only yabbistir 0.4.1 or later can ask.
- [ ] The exit code is checked; output is parsed, not trusted.
- [ ] Cancelling stops the tool: `ctx.signal` is passed to `yab.exec`.

## Sources

- [ ] Rows and values are never logged, never put in an error message, and never written to `yab.storage` or a file. A tool's output stays out of messages.
- [ ] Rows are cached, if at all, only in a module variable with a short lifetime, dropped when the source answers `locked`. Values are never cached.
- [ ] `sensitive` is set only when the values are secrets, and every `secret` action is in such a source; an extension with one has no `network`.
- [ ] Row ids are stable and come back to `run` unchanged; `run` checks them before passing them to a tool.
- [ ] A `sensitive` source passes no row or value to a tool argument other than the row's id.
- [ ] A `sensitive` source's tools cannot send its data elsewhere: they talk only to the service the source is for, with no option that uploads, syncs or shares.
- [ ] An empty value is a clear error, never pasted.

## Download Video and browser cookies

- [ ] The browser-cookies preference is **off by default** and asks for confirmation (`confirm`) when turned on.
- [ ] Cookies are handed **only to yt-dlp**, by naming the browser (`--cookies-from-browser <browser>`). The extension never reads, logs, stores or sends them anywhere else.
- [ ] The confirmation text and the README say so plainly, and say that Safari needs Full Disk Access.
- [ ] YouTube needs `deno` for yt-dlp's challenges; it is listed in `requires.tools`.

## Behaviour

- [ ] Expected situations return `{ none: true, message }`; thrown errors are real failures with a message a person can act on.
- [ ] `cancelled` errors are let through, never swallowed.
- [ ] Hints, detectors, previews and rules have no effects and stay well inside their time limits.
- [ ] `accepts` is as narrow as it can be: the action appears only where it can help.
- [ ] Jobs report progress calmly (state words, whole percents) and have a `failTitle`.

## Naming and words

- [ ] Names, titles, subtitles, tags and messages follow the [design guidelines](design-guidelines.md#naming): short, plain, sentence-case actions starting with a verb.
- [ ] `locales/en.json` is complete and reads naturally. Other languages are welcome.
- [ ] Keywords are what people would type.

## Design

- [ ] The extension leaves drawing to the app: no attempts at color, emoji decoration, ASCII art or HTML used as a layout.
- [ ] The icon is an SF Symbol (`sf:…`), or an `icon.png` that is a simple grey glyph that reads in light and dark mode, without brand colors ([Icons](design-guidelines.md#icons)).
- [ ] Preview sections are few and plain.

## Code and package

- [ ] The source is readable and written by hand. Libraries, if any, are in the extension's own `package.json` at exact versions, and are plain JavaScript.
- [ ] No Node modules or globals (the build checks), no `eval` or `new Function`, no code fetched at run time.
- [ ] Tests cover the main path, the messages, and the expected failures.
- [ ] README: what it does, an example, every permission with its reason, the tools to install. CHANGELOG has the new version.
- [ ] The license is MIT or another the store accepts, and any bundled library's license allows it.
- [ ] The pull request changes one extension folder and raises its version.
