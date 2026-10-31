import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });

describe("reverse", () => {
  test("turnsTheTextAround", async () => {
    const result = await host.run(actions.reverse, item("hello"));
    assert.deepEqual(result, { text: "olleh" });
  });

  test("keepsAccentedLettersWhole", async () => {
    const result = await host.run(actions.reverse, item("café"));
    assert.deepEqual(result, { text: "éfac" });
  });

  test("saysSoWhenThereIsNothingToReverse", async () => {
    const result = await host.run(actions.reverse, item(""));
    assert.deepEqual(result, { none: true, message: "There is no text to reverse." });
  });

  test("answersInTheAppsLanguage", async () => {
    const turkish = createFakeHost({ folder: new URL("..", import.meta.url), context: { language: "tr" } });
    const result = await turkish.run(actions.reverse, item(""));
    assert.equal(result.message, "Ters çevrilecek metin yok.");
  });
});
