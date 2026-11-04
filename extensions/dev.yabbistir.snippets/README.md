# Snippets

Canned replies, signatures, pull request templates and support answers as a column in yabbistir's panel, read from one plain Markdown file. Because it is just a file, a team can share it in a git repository or in iCloud Drive. ↵ pastes the snippet you pick, with `{date}`, `{time}` and `{clipboard}` filled in, and ⌘C copies it instead.

## Example

Save this as `snippets.md` in a folder:

````markdown
Anything before the first heading is ignored, so a note to yourself can go here.

# Replies

## Thanks
Hi,

Thank you for writing in! We will answer within a day.

{weekday}, {date}

## Signature
Deniz
Support team

# Dev

## PR template
**Summary**

**How to test**

Related to: {clipboard}

## Code sample
```js
// A "## heading" inside a fence is just text.
const braces = {{ literal }};
```
````

In Settings › Extensions › Snippets, choose that folder. The panel gets a *Snippets* column with four rows, such as *Thanks* with `Replies · Hi,` underneath. Type `sig` to find *Signature* and press ↵.

## The file

- Every `## Title` line starts a snippet. Its body runs until the next `##` or `#` heading.
- An optional `# Group` line names the snippets after it. The group is shown in front of the preview in the row's second line, so searching for a group name finds its snippets.
- Fenced code blocks (three or more backticks or tildes) are kept as they are, and a `##` inside one is not a heading.
- Blank lines at the start and end of a body are trimmed; everything else is pasted exactly as written. A `#` or `##` without a space after it (`#hashtag`) is ordinary text.
- A snippet with an empty body is left out, since there would be nothing to paste. Text before the first heading is ignored. Windows (CRLF) line endings are fine.
- Rows are identified by their group and title, so renaming a snippet or moving it to another group makes it a new row; editing its body does not. Two snippets with the same title in the same group stay separate rows.
- The file is read again every time the panel opens and every time you paste, so an edit shows at once. A few thousand snippets list in a fraction of a second.

## Placeholders

| Write | Pasted |
|---|---|
| `{date}` | Today's date, in the app's language: *November 4, 2026* or *4 Kasım 2026* |
| `{time}` | The time: *9:05 AM* or *09:05* |
| `{datetime}` | Both |
| `{weekday}` | The day's name: *Wednesday* or *Çarşamba* |
| `{clipboard}` | The text of the newest item in yabbistir's history (empty when there is none, or it has no text) |
| `{{` and `}}` | A literal `{` and `}` |

Any other `{name}` stays as written, so code and templates with braces are safe. A pasted `{clipboard}` value is never filled again, even if it contains `{date}`.

## Setup

1. Create `snippets.md` (or any name) in a folder you want to use, for example in iCloud Drive or a git repository.
2. Open Settings › Extensions › Snippets and choose the folder. If the file has another name, set it under *File name*.

Until then the column says what is missing: *Choose a folder*, *There is no snippets.md in that folder*, or *snippets.md has no snippets yet*.

## Permissions and privacy

- **history**, only for `{clipboard}`. The extension asks for the single newest history item when you paste a snippet that contains `{clipboard}`, and for nothing otherwise. It uses only its text, which goes into the pasted snippet and nowhere else: it is not logged, stored or shown in a row. If yabbistir does not let a source read history, `{clipboard}` becomes empty and the rest of the snippet is pasted.
- **The folder** needs no permission. The extension reads only inside the folder you chose in Settings, never writes, and the file name must be a plain name (no `/`). It has no network and no exec permission.
- The rows live in yabbistir's memory only; the extension keeps nothing between calls.

## Limits

- Only `{clipboard}`, the date and time placeholders above exist; there is no cursor marker.
- A snippet pastes as plain text.
- The extension never edits the file; use any editor.
