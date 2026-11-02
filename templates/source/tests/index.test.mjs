import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { sources } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
// The fake host calls the source the way the app does, and holds what it returns to the app's rules.
const hostWith = (preferences = {}, context) => createFakeHost({ folder, sources, preferences, context });

describe("snippets", () => {
  test("listsTheSnippetsFromSettings", async () => {
    const host = hostWith({ snippets: "Thank you! |  | Best regards " });
    assert.deepEqual(await host.list("snippets"), { rows: [{ id: "0", title: "Thank you!" }, { id: "1", title: "Best regards" }] });
  });

  test("startsWithTheDefaultSnippets", async () => {
    const { rows } = await hostWith().list("snippets");
    assert.deepEqual(rows.map((row) => row.title), ["Thank you!", "Best regards", "See you tomorrow."]);
  });

  test("anEmptyListHasNoRows", async () => {
    assert.deepEqual(await hostWith({ snippets: "" }).list("snippets"), { rows: [] });
  });

  test("pastesTheSnippetOfTheRow", async () => {
    const host = hostWith({ snippets: "Thank you! | Best regards" });
    assert.deepEqual(await host.runSource("snippets", "1", "paste"), { text: "Best regards" });
  });

  test("aSnippetGoneFromSettingsSaysSo", async () => {
    const host = hostWith({ snippets: "Thank you!" });
    await assert.rejects(host.runSource("snippets", "3", "paste"), { message: "This snippet is no longer in Settings." });
  });

  test("answersInTheAppsLanguage", async () => {
    const host = hostWith({ snippets: "Teşekkürler!" }, { language: "tr" });
    await assert.rejects(host.runSource("snippets", "3", "paste"), { message: "Bu metin artık Ayarlar’da yok." });
  });
});
