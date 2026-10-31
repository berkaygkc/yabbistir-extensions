# Detectors and previews

A **detector** recognizes a kind of content when it is copied, such as a JSON Web Token, an issue key or a Unix timestamp, and puts a **tag** on the item. The tag shows as a small grey chip on the item, actions can be offered only on tagged items, and the detector can add sections to the item's preview.

## The manifest

```json
{
  "contributes": {
    "detectors": [
      { "id": "timestamp", "tag": "tag", "accepts": { "kinds": ["text"], "pattern": "^[0-9]{10}$" },
        "validate": true, "preview": true }
    ]
  }
}
```

- `accepts` narrows the candidates without running any code: `kinds`, and a `pattern` searched for in the text or URL (write `^…$` to match the whole text). Make it as tight as you can.
- `"validate": true` calls `detectors[id].validate(item)` on each candidate. It returns `true` to keep the tag and `false` to drop it. It must answer at once, without a promise, in at most 50 ms. Return `false` for anything unexpected rather than throwing: a throw is a failure, and repeated failures turn the extension off. Without `validate`, the pattern alone decides.
- `"preview": true` calls `detectors[id].preview(item, ctx)` when the preview of a tagged item opens.
- `tag` is a locale key whose text is the chip: one short word, such as `JWT`.

Detectors run in the background when an item is copied. When a detector is new, or its extension has a new version, it also goes through the existing history once, in the background. Items whose text is over 256 KB are not looked at.

## Tags

A tagged item carries `"<extension id>:<detector id>"` in `item.tags`, for example `"dev.yourname.timestamp:timestamp"`. In a manifest, `accepts.tags` offers an action only on items with one of the tags. A tag of the extension's own detector can be written by its id alone:

```json
{ "id": "toDate", "title": "toDate.title", "keywords": "toDate.keywords", "input": "item",
  "accepts": { "kinds": ["text"], "tags": ["timestamp"] }, "output": "text" }
```

Another extension's tag is written in full: `"tags": ["dev.yabbistir.jwt:jwt"]`. Capture rules never see tags, because they run before any tag exists ([Capture rules](capture-rules.md)).

## Previews

`preview(item, ctx)` returns a list of sections, and the app draws them in the preview, in its own style:

| Section | Fields | For |
|---|---|---|
| `text` | `title`, `text` | A sentence or a paragraph. |
| `code` | `title`, `code`, `language?` | Formatted code; `language` such as `"json"`. |
| `keyValue` | `title`, `rows: [key, value][]` | Short facts. |
| `image` | `title`, `image` | An image handle, such as one from `yab.qr.generate`. |
| `link` | `title`, `url` | A link the person can open. |

A preview runs without effects, in at most 500 ms: no network, programs, notices, AI, translation or history. It can be `async`, but has nothing slow to wait for. Return `[]` when there is nothing to show. Use `ctx.language` to format dates and numbers.

```ts
import type { Detectors, Item, PreviewSection } from "@yabbistir/api";

const tenDigits = /^[0-9]{10}$/;

/** Seconds since 1970 between 2001 and 2286, which is what ten digits that look like a timestamp usually are. */
export function seconds(item: Item): number | null {
  const text = (item.text ?? "").trim();
  if (!tenDigits.test(text)) return null;
  const value = Number(text);
  return value >= 978_307_200 ? value : null;
}

function format(date: Date, language: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "long", timeStyle: "medium", timeZone }).format(date);
  } catch {
    return date.toISOString();
  }
}

export const detectors: Detectors = {
  timestamp: {
    validate: (item) => seconds(item) !== null,
    preview(item, ctx): PreviewSection[] {
      const value = seconds(item);
      if (value === null) return [];
      const date = new Date(value * 1000);
      return [{
        type: "keyValue",
        title: yab.t("preview.title"),
        rows: [
          [yab.t("preview.local"), format(date, ctx.language)],
          ["UTC", format(date, ctx.language, "UTC")],
          ["ISO 8601", date.toISOString()],
        ],
      }];
    },
  },
};
```

## Testing

`host.validate(detectors.id, item)` resolves to `true` or `false`, and `host.preview(detectors.id, item)` to the sections. Both run without effects, as in the app, and the fake host checks that `validate` does not return a promise and that every section has a known `type`.

```js
assert.equal(await host.validate(detectors.timestamp, { text: "1767225600" }), true);
assert.equal(await host.validate(detectors.timestamp, { text: "12345" }), false);
const [section] = await host.preview(detectors.timestamp, { text: "1767225600" });
assert.deepEqual(section.rows[2], ["ISO 8601", "2026-01-01T00:00:00.000Z"]);
```

The [detector template](../templates/detector) (`npm run new -- <id> --template detector`) is a working detector, the [Tag and preview](recipes/tag-and-preview.md) recipe adds an action on the tag, and [JWT](../extensions/dev.yabbistir.jwt) is a real one.
