import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const item = (text) => ({ id: 1, kind: "text", text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const DIGEST = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("checksum", () => {
  test("returnsTheDigestAndReportsProgress", async () => {
    // The fake host never runs a program: the tool answers from this table.
    const host = createFakeHost({ folder, exec: { shasum: (args, { input }) => ({ exitCode: 0, stdout: `${DIGEST}  -\n`, stderr: "", seen: { args, input } }) } });
    const result = await host.run(actions.checksum, item("hello"));
    assert.deepEqual(result, { text: DIGEST });
    assert.deepEqual(host.calls.find((call) => call.api === "exec").args.slice(0, 2), ["shasum", ["-a", "256"]]);
    assert.deepEqual(host.progress.map((entry) => entry.fraction), [null, 1]);
  });

  test("aFailingToolFailsTheJob", async () => {
    const host = createFakeHost({ folder, exec: { shasum: () => ({ exitCode: 1, stdout: "", stderr: "boom\n" }) } });
    await assert.rejects(host.run(actions.checksum, item("hello")), /boom/);
  });

  test("aMissingToolSaysHowToInstallIt", async () => {
    const host = createFakeHost({ folder });
    await assert.rejects(host.run(actions.checksum, item("hello")), { code: "toolMissing" });
  });
});
