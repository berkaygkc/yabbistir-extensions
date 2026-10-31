# Recipe: a link-cleaning rule

A capture rule that removes tracking parameters from links as they are copied, so `https://example.com/p?id=7&utm_source=mail` is stored as `https://example.com/p?id=7`, and the next ⌘V pastes the clean link.

It shows: the `capture` permission, a rule's `accepts`, the `replace` and `keep` results, and keeping a rule pure and fast. [Link Cleaner](../../extensions/dev.yabbistir.link-clean) is the real extension, with a longer list of parameters and hosts.

```sh
npm run new -- dev.yourname.clean-links --template capture-rule
```

Replace the template's files with these, and delete `locales/tr.json` (or translate the keys).

## manifest.json

```json file=manifest.json
{
  "id": "dev.yourname.clean-links",
  "version": "1.0.0",
  "apiVersion": 1,
  "defaultLocale": "en",
  "name": "name",
  "description": "description",
  "icon": "sf:link",
  "author": "your-github-name",
  "license": "MIT",
  "categories": ["links"],
  "permissions": ["capture"],
  "contributes": {
    "captureRules": [
      { "id": "clean", "title": "clean.title", "description": "clean.description",
        "accepts": { "kinds": ["link", "text"], "pattern": "(?i)^\\s*https?://\\S+\\s*$" } }
    ]
  }
}
```

- `capture` is what the person reads as "Can see everything you copy". It is needed for any rule, and for nothing else.
- `accepts` lets only a copied link, or text that is one address and nothing else, reach the code. `(?i)` is ICU for "ignore case".
- No `tags`: rules run before detectors tag anything, so a rule never sees tags ([`captureRuleTags`](../errors.md#captureruletags)).
- `title` and `description` show in Settings, where the person can turn the rule off.

## locales/en.json

```json file=locales/en.json
{
  "name": "Clean Links",
  "description": "Removes tracking parameters from the links you copy.",
  "clean.title": "Remove tracking parameters",
  "clean.description": "Drops utm_* and click ids from copied links."
}
```

## src/index.ts

```ts file=src/index.ts
import type { CaptureResult, CaptureRules } from "@yabbistir/api";

/** Dropped on every host. */
const everywhere = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;
/** Dropped only on these hosts and their subdomains. */
const perHost: [string, RegExp][] = [
  ["youtube.com", /^(si|feature|pp)$/],
  ["youtu.be", /^(si|feature)$/],
];

const parts = /^(https?:\/\/)([^/?#]*)([^?#]*)(?:\?([^#]*))?(#[\s\S]*)?$/i;

function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * The link without tracking parameters, or null when there are none. The rest of the link is kept
 * character for character: rebuilding it with `URL` would change how it is written.
 */
export function clean(link: string): string | null {
  const match = parts.exec(link.trim());
  if (!match || match[4] === undefined) return null;
  const [, scheme, authority, path, query, fragment = ""] = match;
  const host = authority.replace(/^.*@/, "").replace(/:\d*$/, "").toLowerCase();
  const local = perHost.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];
  const pairs = query.split("&");
  const kept = pairs.filter((pair) => {
    const name = decoded(pair.split("=")[0]);
    return pair === "" || !(everywhere.test(name) || local?.test(name));
  });
  if (kept.length === pairs.length) return null;
  return `${scheme}${authority}${path}${kept.length > 0 ? `?${kept.join("&")}` : ""}${fragment}`;
}

export const captureRules: CaptureRules = {
  clean: {
    // Pure and fast: no yab calls, nothing awaited. Keep the copy whenever unsure.
    run(item): CaptureResult {
      if (item.kind === "link" && item.url) {
        const cleaned = clean(item.url);
        return cleaned === null ? { keep: true } : { replace: { url: cleaned } };
      }
      const cleaned = clean(item.text ?? "");
      return cleaned === null ? { keep: true } : { replace: { text: cleaned } };
    },
  },
};
```

- `{ replace: { url } }` stores a link, `{ replace: { text } }` plain text; the kind stays what it was. The app also writes the clean form to the clipboard if the clipboard still holds that copy.
- Everything the rule needs is in the item. A rule has 200 ms, no network and no other `yab` effects; past its time or on an error it is skipped and the copy is stored as it is.

## tests/index.test.mjs

```js file=tests/index.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { captureRules, clean } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const link = (url) => ({ kind: "link", url });

describe("clean", () => {
  test("dropsTrackingParameters", async () => {
    assert.deepEqual(await host.capture(captureRules.clean, link("https://example.com/p?id=7&utm_source=mail&fbclid=1")),
      { replace: { url: "https://example.com/p?id=7" } });
  });

  test("dropsTheQuestionMarkWhenNothingIsLeft", () => {
    assert.equal(clean("https://example.com/p?utm_medium=x#top"), "https://example.com/p#top");
  });

  test("cleansTextThatIsOneAddress", async () => {
    assert.deepEqual(await host.capture(captureRules.clean, { kind: "text", text: " https://example.com/?gclid=9 " }),
      { replace: { text: "https://example.com/" } });
  });

  test("hostRulesApplyOnlyToTheirHosts", () => {
    assert.equal(clean("https://www.youtube.com/watch?v=x&si=abc"), "https://www.youtube.com/watch?v=x");
    assert.equal(clean("https://example.com/?si=abc"), null);
  });

  test("keepsACleanLink", async () => {
    assert.deepEqual(await host.capture(captureRules.clean, link("https://example.com/p?id=7")), { keep: true });
  });

  test("theRuleDoesNotAskForTags", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    assert.equal(manifest.contributes.captureRules[0].accepts.tags, undefined);
  });
});
```

## Try it

```sh
npm test -- dev.yourname.clean-links
npm run validate -- dev.yourname.clean-links
npm run dev -- dev.yourname.clean-links
```

In yabbistir, approve the `capture` permission in Settings → Extensions, then copy a link with `?utm_source=…`: history shows it without, and ⌘V pastes it clean.
