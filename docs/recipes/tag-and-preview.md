# Recipe: tag and preview

A detector that recognizes copied UUIDs, tags them, and shows their version and, for time-based ones, when they were made. An action, offered only on tagged items, pastes the UUID without its dashes.

It shows: a detector with `validate` and `preview`, the item's tags, and an action with `accepts.tags`. [JWT](../../extensions/dev.yabbistir.jwt) is a real detector built the same way.

```sh
npm run new -- dev.yourname.uuid-info --template detector
```

Replace the template's files with these, and delete `locales/tr.json` (or translate the keys).

## manifest.json

```json file=manifest.json
{
  "id": "dev.yourname.uuid-info",
  "version": "1.0.0",
  "apiVersion": 1,
  "defaultLocale": "en",
  "name": "name",
  "description": "description",
  "icon": "sf:number",
  "author": "your-github-name",
  "license": "MIT",
  "categories": ["developer"],
  "contributes": {
    "detectors": [
      { "id": "uuid", "tag": "tag",
        "accepts": { "kinds": ["text", "code"], "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$" },
        "validate": true, "preview": true }
    ],
    "actions": [
      { "id": "compact", "title": "compact.title", "keywords": "compact.keywords", "input": "item",
        "accepts": { "kinds": ["text", "code"], "tags": ["uuid"] }, "output": "text", "hint": true }
    ]
  }
}
```

- The detector's `pattern` does the cheap work without any code: only text shaped like a UUID is a candidate. `validate` then has the last word.
- `"tags": ["uuid"]` on the action names the extension's own detector by its id; the item carries it as `dev.yourname.uuid-info:uuid`. Another extension's tag is written in full.
- The detector needs no permission: it reads only the item.

## locales/en.json

```json file=locales/en.json
{
  "name": "UUID Info",
  "description": "Recognizes copied UUIDs and shows their version and time.",
  "tag": "UUID",
  "preview": "UUID",
  "version": "Version",
  "created": "Created",
  "compact.title": "Remove dashes",
  "compact.keywords": ["uuid", "dashes", "compact", "hex"],
  "notAUUID": "This is not a UUID."
}
```

## src/index.ts

```ts file=src/index.ts
import type { Actions, Detectors, Item, PreviewSection } from "@yabbistir/api";

const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 100-nanosecond steps between 1582-10-15 (where version 1 counts from) and 1970-01-01. */
const gregorianOffset = 122_192_928_000_000_000n;

/** The item's UUID in lowercase, or null when the item is not one. */
export function uuidOf(item: Item): string | null {
  const text = (item.text ?? "").trim();
  return shape.test(text) ? text.toLowerCase() : null;
}

/** The version (1–8, 0 for the nil UUID, 15 for the max UUID) and, for versions 1 and 7, when it was made. */
export function inspect(uuid: string): { version: number; created?: Date } {
  const hex = uuid.replace(/-/g, "");
  const version = parseInt(hex[12], 16);
  if (version === 7) return { version, created: new Date(parseInt(hex.slice(0, 12), 16)) };
  if (version === 1) {
    const ticks = BigInt(`0x${hex.slice(13, 16)}${hex.slice(8, 12)}${hex.slice(0, 8)}`);
    return { version, created: new Date(Number((ticks - gregorianOffset) / 10_000n)) };
  }
  return { version };
}

export const detectors: Detectors = {
  uuid: {
    // Quick and without promises. Anything unexpected is false, never a throw.
    validate(item) {
      const uuid = uuidOf(item);
      if (uuid === null) return false;
      const { version } = inspect(uuid);
      return (version >= 1 && version <= 8) || /^0+$|^f+$/.test(uuid.replace(/-/g, ""));
    },
    // Runs when the preview opens, without effects. The app draws the sections.
    preview(item): PreviewSection[] {
      const uuid = uuidOf(item);
      if (uuid === null) return [];
      const { version, created } = inspect(uuid);
      const rows: [string, string][] = [[yab.t("version"), String(version)]];
      if (created !== undefined && !Number.isNaN(created.getTime())) rows.push([yab.t("created"), created.toISOString()]);
      return [{ type: "keyValue", title: yab.t("preview"), rows }];
    },
  },
};

export const actions: Actions = {
  compact: {
    run(item) {
      const uuid = item === null ? null : uuidOf(item);
      if (uuid === null) return { none: true, message: yab.t("notAUUID") };
      return { text: uuid.replace(/-/g, "") };
    },
  },
};
```

## tests/index.test.mjs

```js file=tests/index.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, detectors } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const text = (value) => ({ kind: "text", text: value });
const V7 = "019b76da-a800-7abc-9def-0123456789ab"; // made at 2026-01-01 00:00 UTC
const V1 = "d0c3c000-e6a4-11f0-8000-0a1b2c3d4e5f"; // the same moment
const V4 = "3f2b8c1e-9a4d-4f6e-8b2a-1c3d5e7f9a0b";

describe("uuid", () => {
  test("tagsUUIDs", async () => {
    for (const uuid of [V7, V1, V4, V4.toUpperCase(), "00000000-0000-0000-0000-000000000000"]) {
      assert.equal(await host.validate(detectors.uuid, text(uuid)), true, uuid);
    }
  });

  test("leavesOtherTextAlone", async () => {
    assert.equal(await host.validate(detectors.uuid, text("not a uuid")), false);
    assert.equal(await host.validate(detectors.uuid, text("3f2b8c1e-9a4d-9f6e-8b2a-1c3d5e7f9a0b")), false, "version 9 does not exist");
  });

  test("previewShowsTheVersionAndTime", async () => {
    assert.deepEqual(await host.preview(detectors.uuid, text(V7)),
      [{ type: "keyValue", title: "UUID", rows: [["Version", "7"], ["Created", "2026-01-01T00:00:00.000Z"]] }]);
    const [section] = await host.preview(detectors.uuid, text(V1));
    assert.deepEqual(section.rows[1], ["Created", "2026-01-01T00:00:00.000Z"]);
  });

  test("previewOfARandomUUIDHasNoTime", async () => {
    const [section] = await host.preview(detectors.uuid, text(V4));
    assert.deepEqual(section.rows, [["Version", "4"]]);
  });

  test("compactRemovesTheDashes", async () => {
    assert.deepEqual(await host.hint(actions.compact, text(V4)), { text: "3f2b8c1e9a4d4f6e8b2a1c3d5e7f9a0b" });
  });

  test("theActionIsOfferedOnlyOnTaggedItems", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.contributes.actions[0].accepts.tags, ["uuid"]);
  });
});
```

## Try it

```sh
npm test -- dev.yourname.uuid-info
npm run validate -- dev.yourname.uuid-info
npm run dev -- dev.yourname.uuid-info
```

Copy a UUID: its item gets the *UUID* chip, its preview shows the version, and ⇧ on it offers *Remove dashes*. UUIDs already in your history are tagged too, in the background, once the extension loads.
