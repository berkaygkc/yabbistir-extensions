import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { captureRules } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const link = (url) => ({ id: 1, kind: "link", url, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const text = (value) => ({ id: 2, kind: "text", text: value, tags: [], copiedAt: "2026-01-01T00:00:00Z" });

describe("tidy", () => {
  test("takesPunctuationOffALink", async () => {
    assert.deepEqual(await host.capture(captureRules.tidy, link("https://example.com/a).")), { replace: { url: "https://example.com/a" } });
  });

  test("takesPunctuationOffCopiedText", async () => {
    assert.deepEqual(await host.capture(captureRules.tidy, text("https://example.com/a,")), { replace: { text: "https://example.com/a" } });
  });

  test("keepsACleanLinkAsItIs", async () => {
    assert.equal(await host.capture(captureRules.tidy, link("https://example.com/a")), undefined);
  });

  test("theManifestRuleDoesNotAskForTags", () => {
    // Rules run before tags exist, so a tag filter would never match (the store validator warns about it).
    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    const rule = manifest.contributes.captureRules[0];
    assert.equal(rule.accepts.tags, undefined);
  });
});
