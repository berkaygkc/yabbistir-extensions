# Capture rules

A **capture rule** sees each new copy before it reaches history and decides what happens to it: keep it, store a cleaned version instead, also put it in a category, or not store it at all. A rule that strips tracking parameters from copied links is the classic example.

Rules need the `capture` permission, which the person reads as "Can see everything you copy". Ask for it only when a rule is the extension's purpose.

## The manifest

```json
{
  "permissions": ["capture"],
  "contributes": {
    "captureRules": [
      { "id": "clean", "title": "clean.title", "description": "clean.description",
        "accepts": { "kinds": ["link", "text"], "pattern": "(?i)^\\s*https?://\\S+\\s*$" } }
    ]
  }
}
```

- `accepts` picks the copies the rule runs on, by `kinds` and an optional `pattern` (an ICU regular expression, searched for in the text or URL; `(?i)` makes it ignore case). The pattern is matched against the first 64 KB of the text; the rule itself gets the whole copy.
- **Rules see text and URLs only: no tags, no pixels.** Tags come from detectors, which run after the copy is stored, so `accepts.tags` on a rule would never match; the validator warns with [`captureRuleTags`](errors.md#captureruletags). Use `text`, `code` and `link` kinds.
- `title` and `description` appear in Settings, where the person can turn each rule off.

## The code

`captureRules[id].run(item, ctx)` returns one of:

| Return | Effect |
|---|---|
| `{ keep: true }`, or nothing | Store the copy as it is. |
| `{ replace: { text } }` or `{ replace: { url } }` | Store this plain text or link instead (not empty). Only for text, code and link copies. |
| `{ addToCategory: "Name" }` | Also put it in this category. The category must exist; case and accents are ignored, and an unknown name is ignored. |
| `{ ignore: true }` | Do not store it. The rules after this one do not run. |

```ts
import type { CaptureRules } from "@yabbistir/api";

const tracking = /^(utm_[a-z]+|fbclid|gclid)$/;

/** The link without tracking parameters, or null when it has none. */
export function clean(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  const names = [...url.searchParams.keys()].filter((name) => tracking.test(name));
  if (names.length === 0) return null;
  for (const name of names) url.searchParams.delete(name);
  return url.href;
}

export const captureRules: CaptureRules = {
  clean: {
    run(item) {
      const cleaned = clean(item.url ?? item.text ?? "");
      if (cleaned === null) return { keep: true };
      return item.kind === "link" ? { replace: { url: cleaned } } : { replace: { text: cleaned } };
    },
  },
};
```

## The rules for rules

- **Fast and pure.** A rule has 200 ms. Past that, or if it throws, it is skipped and the copy is stored as it is; the Development log names the rule and the error's code, never the copy.
- **No effects.** No network, no programs, no history, no AI or translation, no notices, no opening links: these throw or reject with `permissionDenied`. `ctx.trigger` is `"capture"`.
- **Keep when unsure.** A rule that changes a copy the person did not expect is worse than one that does nothing.
- **In order.** Rules run one at a time, in the order the extensions are listed in Settings and then in manifest order. Each sees what the ones before it made of the copy.
- **Big copies pass.** A copy whose text or link is over 256 KB meets no rule. Concealed copies, such as passwords, never reach a rule.

## What the person sees

A replaced copy is stored in its clean form. If the clipboard still holds that same copy, the clean form is written there too, as plain text or a link, so the next ⌘V pastes it; rich formats are dropped. While the Stack is open, the clipboard is left alone and the clean form joins the Stack.

## Testing

`host.capture(captureRules.id, item)` runs a rule as the app does, without effects, and checks what it returns.

```js
assert.deepEqual(await host.capture(captureRules.clean, { kind: "link", url: "https://example.com/?id=7&utm_source=x" }),
  { replace: { url: "https://example.com/?id=7" } });
assert.deepEqual(await host.capture(captureRules.clean, { kind: "link", url: "https://example.com/" }), { keep: true });
```

The [capture-rule template](../templates/capture-rule) (`npm run new -- <id> --template capture-rule`), the [link-cleaning recipe](recipes/link-cleaning-rule.md) and [Link Cleaner](../extensions/dev.yabbistir.link-clean) are complete rules.
