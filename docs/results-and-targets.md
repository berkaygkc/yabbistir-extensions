# Results and targets

An action's `run` returns a **result**: plain data the app turns into a clipboard item. The app writes it to the clipboard, pastes it into the app the panel opened for, and adds it to history. An extension never writes the clipboard or sends keystrokes itself.

## Result shapes

| Manifest `output` | `run` returns | What the app does |
|---|---|---|
| `text` | `{ text }` | Pastes plain text. |
| `html` | `{ html, text }` | Writes both: apps that take rich text get the HTML, others the plain text. |
| `image` | `{ image }` | Pastes the image. The handle comes from the item, `yab.image`, `yab.vision`, `yab.qr` or `yab.image.fromBytes`. A copy is also kept as a file, so Finder can take it. |
| `link` | `{ link: { url, title? } }` | Pastes a link. |
| `file` | `{ file }` | A path in the call's work folder. The app moves the file into its own output folder, and it joins history as a file item. |
| `files` | `{ files: [...] }` | The same, for several files (at least one). |
| `none` | `{ none: true, message? }` | Pastes nothing. A non-empty `message` shows as a calm notice. |

Declare in `output` the shape `run` returns. Anything that is not one of these shapes fails the call with [`badResult`](errors.md#badresult), and the reason goes to the Development log.

```ts
import type { Actions } from "@yabbistir/api";

/** **bold** and _italic_ in copied Markdown, as rich text with the plain text beside it. */
function inlineMarkdown(text: string): { html: string; text: string } {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>");
  return { html, text: text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/_(.+?)_/g, "$1") };
}

export const actions: Actions = {
  richText: {
    run(item) {
      return inlineMarkdown(item?.text ?? "");
    },
  },
  search: {
    run(item) {
      const query = (item?.text ?? "").trim();
      if (query === "") return { none: true, message: yab.t("empty") };
      return { link: { url: `https://example.com/search?q=${encodeURIComponent(query)}`, title: query } };
    },
  },
  qr: {
    run(item) {
      const text = item?.url ?? item?.text ?? "";
      if (text === "") return { none: true, message: yab.t("empty") };
      return { image: yab.qr.generate(text, { size: 512 }) };
    },
  },
};
```

## Files

A file result must be a file in the call's work folder, `yab.files.workDir`. Ways to put one there:

- `yab.files.write(name, data)` writes a string, bytes or an image (as PNG) and returns the path.
- `yab.http.fetch(url, { toFile: true })` streams a download there (`network` permission).
- A program run with `yab.exec` runs in that folder, so what it writes lands there (`exec` permission).

The work folder is made on first use and removed when the call ends, unless the result names files in it. The app then moves those files into its own output folder. Any path outside the work folder is refused. Read files with `yab.files.read`: the work folder, the item's own `files`, or a folder the person chose in a `folder` preference.

## Paste targets

`ctx.target` is the app the result is headed for, when known: its `bundleID`, `name` and a `kind`, one of `finder`, `terminal`, `browser`, `editor` or `other`. The manifest uses the kinds:

- `"targets": ["finder"]`: with Finder in front, the action leads the list.
- `"targetsOnly": true`: the action is offered only for those targets.

When the target is Finder, a `file` or `files` result lands in the open Finder folder as a file. Text and image results behave as they always do. See [Drop a file into Finder](recipes/drop-a-file-in-finder.md).

Use `ctx.target` to shape a result, not to decide whether to act: for example, a path quoted for a terminal and plain for an editor.

```ts
import type { Actions } from "@yabbistir/api";

export const actions: Actions = {
  path: {
    run(item, ctx) {
      const path = item?.files?.[0]?.path ?? "";
      if (path === "") return { none: true, message: yab.t("noFile") };
      const quoted = `'${path.replace(/'/g, `'\\''`)}'`;
      return { text: ctx.target?.kind === "terminal" ? quoted : path };
    },
  },
};
```

## How the person gets the result

- **↵** pastes the result into the target app. **⌘C** copies it instead.
- With the Stack open, a copied result joins the Stack.
- A [job](jobs.md) finishes later: if the target app is still in front, the result is pasted; otherwise it goes to the clipboard and a notice says "Ready, ⌘V to paste". A file for Finder lands in Finder.
- Every result joins history, like any other copy.

## Notices and links

Besides its result, a run the person started can:

- **Show a notice** with `yab.notify(message)`: a calm notice titled with the extension's name. The message is cut to 200 characters. The app shows at most one notice every 3 seconds per extension and drops the rest without an error; the helper also stops a flood at 5 notices in 10 seconds. Prefer `{ none: true, message }` when the message is the whole answer.
- **Open a web link** in the default browser with `yab.open(url)`; only `http` and `https` links open.

Neither needs a permission, and neither works in hints, detectors, previews or capture rules (`permissionDenied`). Both return at once.

## Generators and hints

A generator (`"input": "none"`) gets `null` for the item. With `"hint": true` it runs once its row is shown, and the value on the row is the value pasted; the next time, it runs again for a new value.

```ts
import type { Actions } from "@yabbistir/api";

export const actions: Actions = {
  timestamp: {
    run() {
      return { text: String(Math.floor(Date.now() / 1000)) };
    },
  },
};
```

A transform with `"hint": true` runs early on the selected item. Hints never run for jobs, `file` or `files` output, images, or text over 256 KB; those rows show their `subtitle` instead.

A hint that returns `{ none: true }` does not hide the action: it stays offered, and its row shows no preview. With a `message`, that message is the row's preview line, and picking the row shows it as a notice. So a hint can say "There is nothing to turn into a slug." before the person picks it.
