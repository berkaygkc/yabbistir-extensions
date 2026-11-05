import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { actions, detectors } from "../src/index.ts";
import { hostIn, item, spaced, tckn, turkishIban, vkn } from "./synthetic.mjs";

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
const manifest = read("../manifest.json");
const en = read("../locales/en.json");
const tr = read("../locales/tr.json");

describe("manifest", () => {
  test("asksForNoPermission", () => {
    // yab.open needs none, and nothing here reaches the network, runs a program or reads the history.
    assert.equal(manifest.permissions, undefined);
    assert.equal(manifest.network, undefined);
    assert.equal(manifest.requires, undefined);
  });

  test("everyContributionHasItsCode", () => {
    assert.deepEqual(manifest.contributes.detectors.map((entry) => entry.id).sort(), Object.keys(detectors).sort());
    assert.deepEqual(manifest.contributes.actions.map((entry) => entry.id).sort(), Object.keys(actions).sort());
  });

  test("theFormatActionsAreOfferedOnTheirTagsOnly", () => {
    for (const action of manifest.contributes.actions.filter((entry) => entry.id !== "track")) {
      assert.equal(action.hint, true, action.id);
      assert.equal(action.accepts.pattern, undefined, action.id);
      assert.equal(action.accepts.tags.length, 1, action.id);
    }
  });
});

describe("locales", () => {
  test("turkishHasEveryEnglishKeyAndNoOther", () => {
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  });

  test("everyKeyTheCodeUsesExists", () => {
    const code = fs.readdirSync(new URL("../src/", import.meta.url)).map((name) => fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8")).join("\n");
    const used = new Set([...code.matchAll(/yab\.t\("([^"]+)"\)/g)].map((match) => match[1]));
    for (const match of code.matchAll(/(?:key|refused): "([^"]+)"/g)) used.add(match[1]);
    for (const kind of ["mobile", "landline", "nonGeographic", "tollFree"]) used.add(`type.${kind}`);
    for (const name of ["preview.tckn", "rule.tckn", "note.tckn", "preview.vkn", "rule.vkn", "note.vkn"]) used.add(name);
    for (const key of used) {
      assert.ok(Object.hasOwn(en, key), `en: ${key}`);
      assert.ok(Object.hasOwn(tr, key), `tr: ${key}`);
    }
  });

  test("theNamesAreTheBriefs", () => {
    assert.equal(en.name, "Türkiye Pack");
    assert.equal(tr.name, "Türkiye Paketi");
  });

  test("keywordsAreListsOfLowercaseWords", () => {
    for (const locale of [en, tr]) {
      for (const [key, value] of Object.entries(locale)) {
        if (!key.endsWith(".keywords")) continue;
        assert.ok(Array.isArray(value) && value.length > 0, key);
        for (const word of value) assert.equal(word, word.toLocaleLowerCase("tr"), `${key}: ${word}`);
      }
    }
  });

  test("stringsUseTypographicApostrophesAndNoExclamations", () => {
    for (const locale of [en, tr]) {
      for (const [key, value] of Object.entries(locale)) {
        for (const text of [value].flat()) {
          assert.ok(!text.includes("'"), `${key} uses a straight apostrophe`);
          assert.ok(!text.includes("!"), `${key} exclaims`);
        }
      }
    }
  });
});

describe("privacy", () => {
  test("nothingReachesTheLogAndNoNumberIsRepeatedInAMessage", async () => {
    const host = hostIn("en");
    const numbers = [tckn("123456789"), vkn("123456789"), spaced(turkishIban("00064")), "0532 000 00 01", "100000000001"];
    const answers = [];
    for (const text of numbers) {
      for (const detector of Object.values(detectors)) {
        await host.validate(detector, item(text));
        answers.push(await host.preview(detector, item(text)));
      }
      for (const [name, action] of Object.entries(actions)) {
        const variant = name === "track" ? "yurtici" : null;
        answers.push(await host.run(action, item(text), { variant }));
      }
    }
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.notifications, []);
    // The only place a number goes is the one link the person asked for.
    assert.deepEqual(host.opened, ["https://www.yurticikargo.com/en/online-services/tracking?code=100000000001"]);
    for (const answer of answers) {
      const message = answer?.message ?? "";
      for (const text of numbers) assert.ok(!message.includes(text) && !message.includes(text.replace(/ /g, "")), message);
    }
    // TC Kimlik and tax numbers are never shown back, not even in their own previews.
    const previews = JSON.stringify(answers.filter(Array.isArray));
    assert.ok(!previews.includes(numbers[0]) && !previews.includes(numbers[1]));
  });

  test("nothingThrowsOnOddItems", async () => {
    const host = hostIn();
    const odd = [null, { kind: "text" }, { kind: "link", url: "https://example.com/" }, { kind: "text", text: "\u0000￿" }, { kind: "code", text: " " }];
    for (const subject of odd) {
      for (const detector of Object.values(detectors)) {
        if (subject !== null) {
          assert.equal(await host.validate(detector, subject), false);
          assert.deepEqual(await host.preview(detector, subject), []);
        }
      }
      for (const action of Object.values(actions)) {
        const result = await host.run(action, subject, { variant: "aras" });
        assert.equal(result.none, true);
        assert.equal(typeof result.message, "string");
      }
    }
  });
});
