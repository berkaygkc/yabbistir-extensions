# Send To

Sends what you copied to a notes or task app without switching to it. Copy text or a link, open the actions and choose *Send to Things* (or Obsidian, Bear, Drafts, OmniFocus, Reminders, Notes). Nothing is pasted: a short notice says "Sent to Things".

## Example

Copy `Buy oat milk` followed by a second line `two cartons`, choose *Send to Things*. A to-do titled "Buy oat milk" with the notes "two cartons" appears in the Things Inbox.

| Destination | What is created | How |
|---|---|---|
| Obsidian | A note named after the first line; the whole text is its content. Settings can name a vault and a folder. | `obsidian://new` with `vault`, `name` or `file`, `content` |
| Things | A to-do in the Inbox: first line is the title, the rest the notes. | `things:///add` with `title`, `notes` |
| Bear | A note with the whole text (Bear takes its title from the first line). It is created without opening Bear's window. | `bear://x-callback-url/create` with `text`, `open_note=no`, `show_window=no` |
| Drafts | A draft with the whole text. | `drafts://create` with `text` |
| OmniFocus | An Inbox item: first line is the name, the rest the note. | `omnifocus:///add` with `name`, `note`, `autosave=true` |
| Apple Reminders | A reminder in your default list: first line is the title, the rest the notes. | AppleScript through `osascript` |
| Apple Notes | A note; the first line becomes a heading. | AppleScript through `osascript` |

A link is sent as its address.

## Permissions and tools

- **exec**, limited to two programs that ship with macOS:
  - `open`, to open the destination app's URL. yabbistir's own `yab.open` opens only http and https links, so an app's own scheme (`things:///…`) needs `open`. The extension passes `-g` (stay in the background) and one argument, a URL the extension built itself that always starts with one of the five fixed schemes above, so it can never be read as an option.
  - `osascript`, only for Reminders and Notes. The AppleScript is a fixed text inside the extension. Your text is passed as separate arguments, each prefixed with a letter that the script removes, so quotes, backslashes and AppleScript keywords in it are plain data, never code.
- No network permission. Your text goes only to the app you chose, on this Mac.

Nothing to install: both tools are part of macOS.

## Setup

1. Open the extension's settings and turn on the destinations you use. Reminders and Notes are off by default because macOS asks for permission the first time.
2. Optional: set the Obsidian vault name (Obsidian uses the vault you last had open when this is empty) and a folder inside the vault, such as `Inbox/Clips`.
3. The first time you use Reminders or Notes, macOS asks whether yabbistir may control it. Allow it (System Settings › Privacy & Security › Automation). If the question stays open longer than ten seconds the first send may time out; just send again.

## Limits

- Turning a destination off in settings does not hide its row: the manifest format has no per-variant visibility field, so all seven rows are always listed and a disabled one answers "turned off" without doing anything. Reminders and Notes are off by default, so they show up as rows that ask you to turn them on first.
- Reminders and Notes use `osascript`, which `docs/review-checklist.md` lists among shells. It is a constant script with your text passed only as arguments (no injection is possible); if a maintainer rejects it, the fallback is to drop those two destinations.
- OmniFocus: `name`, `note` and `autosave=true` come from community write-ups, not an official page. If OmniFocus ignores `autosave`, the item may wait as an unsaved draft in the Inbox.
- An encoded URL is cut to 30,000 characters (our own conservative limit: the apps' documents name no limit except Things' notes, 10,000 characters). Cut text ends with an ellipsis and the notice says "cut to fit".
- Things: titles are cut to 250 characters; when the first line is longer, the whole text goes in the notes.
- Obsidian: file-name characters Obsidian forbids are replaced by spaces; if a note with that name exists, Obsidian decides what happens. When the first line is empty of usable characters, the name is "Clipboard <date> <time>".
- Notes and Reminders get at most 100,000 characters.
- The extension cannot tell whether an app actually saved the item: `open` reports only whether the URL could be handed to an app. If none handles the scheme it says the app could not be reached.

## Sources

URL scheme parameters come from each app's documentation: Things URL Scheme (culturedcode.com/things/support/articles/2803573), Obsidian URI (obsidian.md/help/Extending+Obsidian/Obsidian+URI), Bear x-callback-url (bear.app/faq/x-callback-url-scheme-documentation), Drafts URL Schemes (docs.getdrafts.com/docs/automation/urlschemes). OmniFocus does not publish a page we could reach; `name`, `note` and `autosave=true` follow its documented iOS and Mac URL scheme as described in community write-ups (learnomnifocus.com, Omni Group forums).
