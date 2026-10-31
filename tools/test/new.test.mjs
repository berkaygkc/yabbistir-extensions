import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { run, scratchRoot } from "./helpers.mjs";

const roots = [];
const fresh = () => {
  const root = scratchRoot();
  roots.push(root);
  return root;
};
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const TEMPLATES = ["action", "detector", "capture-rule", "job"];

describe("npm run new", () => {
  for (const template of TEMPLATES) {
    test(`newCreatesAnExtensionThatValidatesAndTests (${template})`, () => {
      const root = fresh();
      const id = "dev.example.sample";
      const made = run("new", [id, "--template", template], { root });
      assert.equal(made.status, 0, made.out);

      const folder = path.join(root, "extensions", id);
      for (const file of ["manifest.json", "src/index.ts", "locales/en.json", "locales/tr.json", "tests/index.test.mjs", "README.md", "CHANGELOG.md"]) {
        assert.ok(fs.existsSync(path.join(folder, file)), `${file} is created`);
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
      assert.equal(manifest.id, id);
      for (const file of ["manifest.json", "src/index.ts", "locales/en.json", "locales/tr.json", "tests/index.test.mjs", "README.md", "CHANGELOG.md"]) {
        assert.doesNotMatch(fs.readFileSync(path.join(folder, file), "utf8"), /\{\{/, `${file} has no placeholder left`);
      }

      const validated = run("validate", [id], { root });
      assert.equal(validated.status, 0, validated.out);
      assert.doesNotMatch(validated.out, /warning/, validated.out);
      assert.match(validated.out, /build/i, "a source-only extension is told to build first");

      const tested = run("test", [id], { root });
      assert.equal(tested.status, 0, tested.out);
      assert.match(tested.out, /(# pass|ℹ pass) [1-9]/);
    });
  }

  test("newRefusesAnExistingId", () => {
    const root = fresh();
    const id = "dev.example.sample";
    assert.equal(run("new", [id, "--template", "action"], { root }).status, 0);
    const marker = path.join(root, "extensions", id, "README.md");
    fs.writeFileSync(marker, "mine");
    const again = run("new", [id, "--template", "job"], { root });
    assert.equal(again.status, 1);
    assert.match(again.out, /already exists/);
    assert.equal(fs.readFileSync(marker, "utf8"), "mine", "nothing is overwritten");
  });

  test("newRefusesABadIdOrTemplate", () => {
    const root = fresh();
    assert.equal(run("new", ["Not An Id", "--template", "action"], { root }).status, 1);
    assert.equal(run("new", ["../escape.x", "--template", "action"], { root }).status, 1);
    const unknown = run("new", ["dev.example.x", "--template", "nope"], { root });
    assert.equal(unknown.status, 1);
    assert.match(unknown.out, /action, detector, capture-rule, job/);
    assert.deepEqual(fs.readdirSync(path.join(root, "extensions")), []);
  });
});
