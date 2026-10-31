import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { detectors } from "../src/index.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });

describe("ticket", () => {
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
