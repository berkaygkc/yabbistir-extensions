# Design guidelines

yabbistir has one look: calm, grey, native macOS. Extensions never draw anything. They supply words, an icon and data, and the app draws the rows, tag chips, preview sections, job cards and notices in that one look. An extension's job is to make its words short and its data clean, so it reads as part of the app rather than a guest in it.

## What the app draws for you

| You give | The app draws |
|---|---|
| An action's `title`, `subtitle` and hint | A row in the panel, with your icon in the row's icon slot |
| A detector's `tag` | A small grey chip on the item |
| Preview sections | Blocks in the item's preview, in the preview's type and spacing |
| `yab.job.progress` | The job card's bar and status line |
| `{ none: true, message }`, `yab.notify`, a thrown error | A calm notice, titled with your extension's name |
| Preferences | Controls in Settings |

There is no way to pick a color, a font, a layout or a size, and that is on purpose. Do not try to get around it: no emoji as decoration, no ASCII art, no colored symbols in text, no HTML results meant as a layout. A colorful extension looks broken next to everything else, and a reviewer will ask you to remove it.

## Naming

- **The extension's name:** one to three words, in title case, saying what it is about: "Download Video", "Link Cleaner", "JWT", "Translate". No "for yabbistir", no "Pro", no version numbers.
- **Action titles:** sentence case, starting with a verb, saying what happens to the item: "Download as video", "Translate to Turkish", "Remove tracking parameters". Keep it to about 30 characters; the row has one line.
- **Variant titles:** whole titles of their own, since each is a row: "Download as video" and "Download audio", not "Video" and "Audio".
- **Subtitles:** a short fact, with " · " between parts: "MP4 · best quality", "On this Mac".
- **Tags:** one short word or an abbreviation: "JWT", "ticket". It sits in a chip beside the item.
- **Keywords:** lowercase words people would type, synonyms included: `["slug", "slugify", "url", "permalink"]`.
- **Ids** (extension, action, detector, rule) are for code, never shown: lowercase, plain, stable.

## Words

- Short and plain. Say what happened or what to do: "There is no text to translate." "This post asks you to sign in. You can turn on browser cookies for Download Video in Settings."
- No "Error:", no "Oops", no exclamation marks, no ALL CAPS. The app already marks a failure as one.
- Name the fix when there is one: "yt-dlp may need an update: brew upgrade yt-dlp".
- Notices are cut at 200 characters, and a job card's status line is cut too: put the important words first.
- Progress messages are numbers with units while a fraction is known ("18.4 / 43.7 MB · 1 min left") and a state word when it is not ("Connecting", "Merging").
- Use typographic apostrophes and quotes in strings: "Couldn’t download the video".
- Every string goes through the locale files ([Localization](localization.md)), in English at least.

## Icons

The icon appears in the row's icon slot, on job cards and in Settings, at about 13 to 16 points, in the panel's grey.

- **Use an SF Symbol** whenever one fits: `"icon": "sf:arrow.down.circle"`. The app draws it in its secondary grey, the same as its own icons, in light and dark mode. Pick an outline symbol that says the action rather than the brand. An unknown name falls back to a generic extension symbol, so check the name in the SF Symbols app.
- **A file icon** is `icon.png` next to manifest.json (the only file name the build copies), square, at least 64 × 64 pixels, drawn at 16 points. The app does not tint it, so it must read on both light and dark grey: a simple glyph in a mid grey, on a transparent background. No logos with brand colors, no gradients, no text.

## Previews

- One section per idea, with a one- or two-word title: "Header", "Payload", "Info".
- `keyValue` for short facts, `code` with a `language` for anything structured, `text` for a sentence.
- Show what the item is, not everything you can compute. Three sections is plenty.
- Say what you did not check when it matters: the JWT preview ends with "The signature isn't checked".

## Results

- Return the result in the form the person expects to paste: clean text without trailing newlines, a link as a link, a file with a good name (`Meeting notes.md`, not `output-1.txt`).
- A file's name comes from its subject when there is one, such as the video's title.
- Nothing to do is not an error: `{ none: true, message }` with one short sentence.
