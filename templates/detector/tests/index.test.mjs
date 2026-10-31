import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { detectors } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

describe("ticket", () => {
  test("theManifestPatternFindsTheCandidates", () => {
    // The app matches `accepts.pattern` as ICU; acceptsMatch comes close in JavaScript, so a test can check it.
    const { accepts } = manifest.contributes.detectors[0];
    assert.equal(acceptsMatch(accepts, item("ABC-123")), true);
    assert.equal(acceptsMatch(accepts, item("  PLAT-9\n")), true, "the text is trimmed first");
    assert.equal(acceptsMatch(accepts, item("see ABC-123")), false);
  });

  test("keepsTheTagForAnIssueKey", async () => {
    assert.equal(await host.validate(detectors.ticket, item("ABC-123")), true);
    assert.equal(await host.validate(detectors.ticket, item("  PLAT-9\n")), true);
  });

  test("dropsTheTagForOtherText", async () => {
    assert.equal(await host.validate(detectors.ticket, item("abc-123")), false);
    assert.equal(await host.validate(detectors.ticket, item("ABC-")), false);
    assert.equal(await host.validate(detectors.ticket, item("see ABC-123")), false);
  });

  test("previewShowsTheParts", async () => {
    const sections = await host.preview(detectors.ticket, item("ABC-123"));
    assert.deepEqual(sections, [{ type: "keyValue", title: "Issue key", rows: [["Project", "ABC"], ["Number", "123"]] }]);
  });

  test("previewOfSomethingElseIsEmpty", async () => {
    assert.deepEqual(await host.preview(detectors.ticket, item("hello")), []);
  });
});
