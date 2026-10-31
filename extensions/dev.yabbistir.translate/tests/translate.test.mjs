import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions, cut, maxSummaryCharacters } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const translating = (detected, language = "en") =>
  createFakeHost({ folder, context: { language }, translate: (text, { to }) => ({ text: `[${to}] ${text}`, from: detected }) });

describe("translate", () => {
  test("asksTheAppForTheTarget", async () => {
    const host = translating("en");
    assert.deepEqual(await host.run(actions.translate, item("Good morning"), { variant: "tr" }), { text: "[tr] Good morning" });
    const call = host.calls.find((entry) => entry.api === "translate");
    // The extension names only the target: the recognizer decides the source.
    assert.deepEqual(call.args, ["Good morning", { to: "tr" }]);
    const english = translating("tr");
    assert.deepEqual(await english.run(actions.translate, item("Günaydın"), { variant: "en" }), { text: "[en] Günaydın" });
    assert.deepEqual(english.calls.find((entry) => entry.api === "translate").args, ["Günaydın", { to: "en" }]);
  });

  test("anUnknownVariantTranslatesToTurkish", async () => {
    const host = translating("en");
    assert.deepEqual(await host.run(actions.translate, item("Hi"), {}), { text: "[tr] Hi" });
  });

  test("theSameLanguageSaysSo", async () => {
    const host = translating("tr");
    assert.deepEqual(await host.run(actions.translate, item("Günaydın"), { variant: "tr" }), { none: true, message: "The text is already in Turkish" });
    const regional = translating("en-GB");
    assert.deepEqual(await regional.run(actions.translate, item("Good morning"), { variant: "en" }), { none: true, message: "The text is already in English" });
    const turkish = translating("tr", "tr");
    assert.deepEqual(await turkish.run(actions.translate, item("Günaydın"), { variant: "tr" }), { none: true, message: "Metin zaten Türkçe" });
  });

  test("emptyTextHasNothingToDo", async () => {
    const host = translating("en");
    assert.deepEqual(await host.run(actions.translate, item(" \n "), { variant: "tr" }), { none: true, message: "There’s no text to translate" });
    assert.deepEqual(await host.run(actions.summarize, item("")), { none: true, message: "There’s no text to summarize" });
    assert.equal(host.calls.some((entry) => entry.api === "translate" || entry.api === "ai.generate"), false);
  });

  test("anUnavailableTranslatorKeepsItsError", async () => {
    // No translate answer in the fake host: yab.translate is "unavailable", and the extension doesn't mask it.
    const host = createFakeHost({ folder });
    await assert.rejects(host.run(actions.translate, item("Hello"), { variant: "tr" }), { code: "unavailable" });
  });

  test("aMissingLanguagePackKeepsItsMessage", async () => {
    const message = "English → Turkish language pack is not downloaded";
    const host = createFakeHost({ folder, translate: () => { throw yabError("unavailable", message); } });
    await assert.rejects(host.run(actions.translate, item("Hello"), { variant: "tr" }), { code: "unavailable", message });
  });
});

describe("summarize", () => {
  const summarizing = (answer = "A short summary.", language = "en") =>
    createFakeHost({ folder, context: { language }, ai: (prompt, options) => (typeof answer === "function" ? answer(prompt, options) : answer) });

  test("isAJobWithInstructions", async () => {
    const host = summarizing();
    assert.deepEqual(await host.run(actions.summarize, item("A long text.")), { text: "A short summary." });
    const call = host.calls.find((entry) => entry.api === "ai.generate");
    assert.equal(call.args[0], "A long text.");
    assert.deepEqual(call.args[1], {
      instructions: "Summarize this text in plain English in at most 3 sentences. Write only the summary.",
      temperature: 0.3,
      maxTokens: 400,
    });
    assert.deepEqual(host.progress, [{ fraction: null, message: "Summarizing" }]);
  });

  test("speaksTheAppsLanguage", async () => {
    const host = summarizing("Kısa özet.", "tr");
    await host.run(actions.summarize, item("Uzun bir metin."));
    assert.deepEqual(host.progress.map((entry) => entry.message), ["Özetleniyor"]);
    assert.match(host.calls.find((entry) => entry.api === "ai.generate").args[1].instructions, /Türkçe/);
  });

  test("cutsLongTextsToTheLimitOnACharacterBoundary", async () => {
    assert.equal(maxSummaryCharacters, 6000);
    const family = "👨‍👩‍👧";
    const host = summarizing();
    await host.run(actions.summarize, item(family.repeat(7000)));
    const prompt = host.calls.find((entry) => entry.api === "ai.generate").args[0];
    assert.equal(prompt, family.repeat(6000));
    const exact = "a".repeat(6000);
    const whole = summarizing();
    await whole.run(actions.summarize, item(exact));
    assert.equal(whole.calls.find((entry) => entry.api === "ai.generate").args[0], exact);
    assert.equal(cut("héllo", 10), "héllo");
  });

  test("anUnavailableModelKeepsItsMessage", async () => {
    const message = "Apple Intelligence is turned off";
    const host = createFakeHost({ folder, ai: () => { throw yabError("unavailable", message); } });
    await assert.rejects(host.run(actions.summarize, item("Some text")), { code: "unavailable", message });
    const missing = createFakeHost({ folder });
    await assert.rejects(missing.run(actions.summarize, item("Some text")), { code: "unavailable" });
  });
});
