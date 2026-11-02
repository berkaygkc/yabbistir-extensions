import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureFiles, materialize, readExpected, readFixture } from "../lib/fixtures.mjs";
import { ALLOWED_LICENSES, APP_CODES, STORE_CODES, formatIssue, validateExtension } from "../lib/validate.mjs";
import { run as runTool, scratchRoot } from "./helpers.mjs";

const cli = fileURLToPath(new URL("../validate.mjs", import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "yab-validate-"));
after(() => fs.rmSync(work, { recursive: true, force: true }));

let counter = 0;
const scratch = () => fs.mkdtempSync(path.join(work, `${counter++}-`));
const codes = (issues) => [...new Set(issues.map((issue) => issue.code))].sort();

// ---------------------------------------------------------------------------------------------------------------
// A complete store extension, to change one thing at a time.

const ID = "dev.example.tool";

function storeManifest() {
  return {
    id: ID,
    version: "1.0.0",
    apiVersion: 1,
    defaultLocale: "en",
    name: "name",
    description: "description",
    icon: "sf:hammer",
    author: "example",
    license: "MIT",
    categories: ["developer"],
    preferences: [
      { id: "mode", type: "choice", title: "mode.title", default: "short",
        options: [{ id: "short", title: "mode.short" }, { id: "long", title: "mode.long" }] },
    ],
    contributes: {
      actions: [
        { id: "shout", title: "shout.title", keywords: "shout.keywords", input: "item", accepts: { kinds: ["text"] }, output: "text",
          variants: [{ id: "all", title: "all.title", subtitle: "all.subtitle" }] },
      ],
    },
  };
}

function storeLocales() {
  return {
    en: {
      name: "Tool", description: "Does a thing", "mode.title": "Mode", "mode.short": "Short", "mode.long": "Long",
      "shout.title": "Shout", "shout.keywords": ["shout", "upper"], "all.title": "All of it", "all.subtitle": "Every letter",
    },
    tr: { name: "Araç", "shout.title": "Bağır" },
  };
}

/** Writes <root>/extensions/<folder>/ and returns { root, folder }. */
function writeExtension({ manifest = storeManifest(), locales = storeLocales(), files = { "src/index.ts": "export const actions = {};\n",
  "README.md": "# Tool\n", "CHANGELOG.md": "## 1.0.0\n" }, folderName } = {}) {
  const root = scratch();
  const folder = path.join(root, "extensions", folderName ?? manifest.id ?? ID);
  fs.mkdirSync(path.join(folder, "locales"), { recursive: true });
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [language, table] of Object.entries(locales)) {
    fs.writeFileSync(path.join(folder, "locales", `${language}.json`), typeof table === "string" ? table : JSON.stringify(table));
  }
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), text);
  }
  return { root, folder };
}

const withManifest = (change) => {
  const manifest = storeManifest();
  change(manifest);
  return manifest;
};

// ---------------------------------------------------------------------------------------------------------------

describe("the parity corpus", () => {
  const expected = readExpected();
  const files = fixtureFiles();

  test("expected.json lists every fixture and nothing else", () => {
    assert.deepEqual(Object.keys(expected).sort(), files);
  });

  test("it has valid and invalid cases", () => {
    assert.ok(files.filter((file) => file.startsWith("valid/")).length >= 5);
    assert.ok(files.filter((file) => file.startsWith("invalid/")).length >= 14);
  });

  test("every code the app reports has a fixture", () => {
    const covered = new Set(Object.values(expected).flat());
    assert.deepEqual(APP_CODES.filter((code) => !covered.has(code)), []);
  });

  test("its codes are the app's codes", () => {
    const known = new Set(APP_CODES);
    assert.deepEqual(Object.values(expected).flat().filter((code) => !known.has(code)), []);
  });

  for (const file of files) {
    test(file, () => {
      const folder = materialize(readFixture(file), scratch());
      const { issues } = validateExtension(folder, { store: false });
      assert.deepEqual(codes(issues), expected[file], issues.map(formatIssue).join("\n"));
    });
  }
});

describe("the app's rules", () => {
  test("captureRuleTags keeps the app's wording and is a warning", () => {
    const folder = materialize(readFixture("valid/capture-rule-tags-warning.json"), scratch());
    const { issues } = validateExtension(folder, { store: false });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "captureRuleTags");
    assert.equal(issues[0].level, "warning");
    assert.equal(issues[0].field, "contributes.captureRules[0].accepts.tags");
    assert.equal(issues[0].message, "capture rules never see tags; this rule would never run");
  });

  test("every issue says how to fix it", () => {
    for (const file of fixtureFiles()) {
      const folder = materialize(readFixture(file), scratch());
      for (const issue of validateExtension(folder).issues) {
        assert.ok(issue.fix && issue.fix.length > 0, `${file}: ${formatIssue(issue)}`);
        assert.ok(issue.level === "error" || issue.level === "warning");
      }
    }
  });

  test("an issue names the file and the field", () => {
    const folder = materialize(readFixture("invalid/version-not-semver.json"), scratch());
    const [issue] = validateExtension(folder, { store: false, relativeTo: path.dirname(folder) }).issues;
    assert.deepEqual({ path: issue.path, field: issue.field, code: issue.code, expected: issue.expected },
      { path: "dev.example.sample/manifest.json", field: "version", code: "invalidVersion", expected: "MAJOR.MINOR.PATCH" });
    assert.equal(issue.message, "\"1.0\" is not semantic versioning");
    assert.equal(issue.fix, "Write the version as \"1.0.0\".");
  });

  test("a source folder with src/index.ts needs no index.js yet; the app's rules still do", () => {
    const { folder } = writeExtension();
    assert.ok(!codes(validateExtension(folder).issues).includes("indexMissing"));
    assert.ok(codes(validateExtension(folder, { store: false }).issues).includes("indexMissing"));
    fs.rmSync(path.join(folder, "src"), { recursive: true });
    assert.ok(codes(validateExtension(folder).issues).includes("indexMissing"));
  });

  test("a pattern the store cannot verify is refused, and says why", () => {
    const manifest = withManifest((m) => { m.contributes.actions[0].accepts.pattern = "^\\p{Block=Bogus}+$"; });
    const { folder } = writeExtension({ manifest });
    const issues = validateExtension(folder).issues;
    assert.deepEqual(codes(issues), ["invalidPattern"]);
    assert.equal(issues[0].field, "contributes.actions[0].accepts.pattern");
    assert.equal(issues[0].message, "the store validator cannot verify \\p{Block=Bogus} in \"^\\p{Block=Bogus}+$\"");
    assert.match(issues[0].fix, /simpler pattern, e\.g\. a character class/);
    const plain = withManifest((m) => { m.contributes.actions[0].accepts.pattern = "^\\p{Latin}+$"; });
    assert.deepEqual(codes(validateExtension(writeExtension({ manifest: plain }).folder).issues), []);
  });

  test("the folder name must equal the id", () => {
    const { folder } = writeExtension({ folderName: "dev.example.other" });
    assert.deepEqual(codes(validateExtension(folder).issues), ["idFolderMismatch"]);
  });
});

describe("sources", () => {
  // The corpus pins which codes a folder gets; these pin how often, where, and in which words.
  const sourceManifest = (change = () => {}) => withManifest((m) => {
    m.permissions = ["exec"];
    m.requires = { tools: [{ name: "vault-cli", install: "brew install vault-cli" }] };
    m.contributes.sources = [{ id: "vault", title: "vault.title", sensitive: true, actions: [
      { id: "password", kind: "secret", title: "password.title", label: "password.label" },
      { id: "username", kind: "text", title: "username.title", label: "username.label", copyTitle: "username.copy", copied: "username.copied" },
    ] }];
    change(m);
  });
  const sourceLocales = () => {
    const locales = storeLocales();
    Object.assign(locales.en, { "vault.title": "Vault", "password.title": "Paste password", "password.label": "Password",
      "username.title": "Paste username", "username.label": "Username", "username.copy": "Copy username", "username.copied": "Username copied." });
    return locales;
  };
  const issuesOf = (manifest, { store = false, locales = sourceLocales() } = {}) =>
    validateExtension(writeExtension({ manifest, locales, files: { "index.js": "", "src/index.ts": "", "README.md": "#\n", "CHANGELOG.md": "##\n" } }).folder,
      { store }).issues;
  const summary = (issues) => issues.map(({ field, code }) => `${field} ${code}`);

  test("a sensitive source with a secret and a text action is clean, in the store too", () => {
    assert.deepEqual(issuesOf(sourceManifest()).map(formatIssue), []);
    assert.deepEqual(issuesOf(sourceManifest(), { store: true }).map(formatIssue), []);
  });

  test("sourceCopyNeedsText is reported once for each key a secret action has", () => {
    const manifest = sourceManifest((m) => Object.assign(m.contributes.sources[0].actions[0], { copyTitle: "username.copy", copied: "username.copied" }));
    const issues = issuesOf(manifest);
    assert.deepEqual(summary(issues), ["contributes.sources[0].actions[0].copyTitle sourceCopyNeedsText",
      "contributes.sources[0].actions[0].copied sourceCopyNeedsText"]);
    assert.equal(issues[0].message, "a secret action has no \"copyTitle\"; secrets are never copied to be kept");
    assert.equal(issues[1].fix, "Remove \"copied\" or make the action \"kind\": \"text\".");
  });

  test("sourceSecretNeedsSensitive is once per source, sourceSecretWithNetwork once per manifest", () => {
    const manifest = sourceManifest((m) => {
      m.permissions = ["exec", "network"];
      m.network = { domains: ["ornek.dev"] };
      delete m.contributes.sources[0].sensitive;
      m.contributes.sources.push({ ...structuredClone(m.contributes.sources[0]), id: "second", sensitive: false });
    });
    const issues = issuesOf(manifest);
    assert.deepEqual(summary(issues), ["contributes.sources[0].sensitive sourceSecretNeedsSensitive",
      "contributes.sources[1].sensitive sourceSecretNeedsSensitive", "permissions sourceSecretWithNetwork"]);
    assert.equal(issues[0].message, "a source with a secret action must be sensitive");
    assert.equal(issues[0].fix, "Add \"sensitive\": true to the source.");
    assert.equal(issues[2].message, "an extension with a secret source action cannot ask for \"network\"");
    assert.equal(issues[2].fix, "Remove \"network\" from \"permissions\", or make the actions \"kind\": \"text\".");
  });

  test("an unknown kind is not a secret", () => {
    const manifest = sourceManifest((m) => {
      m.permissions = ["exec", "network"];
      m.network = { domains: ["ornek.dev"] };
      m.contributes.sources[0].sensitive = false;
      m.contributes.sources[0].actions[0].kind = "password";
      m.contributes.sources[0].actions[0].copied = "username.copied";
    });
    const issues = issuesOf(manifest);
    assert.deepEqual(summary(issues), ["contributes.sources[0].actions[0].kind unknownSourceActionKind"]);
    assert.deepEqual([issues[0].message, issues[0].expected, issues[0].fix], ["\"password\" is not a source action kind", "secret, text", "Use \"secret\" or \"text\"."]);
  });

  test("the action count, the shapes, the ids and the keys keep the app's words", () => {
    const counted = issuesOf(sourceManifest((m) => { delete m.contributes.sources[0].actions; }));
    assert.deepEqual(summary(counted), ["contributes.sources[0].actions sourceActionCount"]);
    assert.deepEqual([counted[0].message, counted[0].expected, counted[0].fix],
      ["a source needs one or two actions, not 0", "1 or 2", "List one action, or two: ↵ runs the first and ⇧↵ the second."]);
    const shapes = issuesOf(sourceManifest((m) => { m.contributes.sources.push("vault"); m.contributes.sources[0].actions.push(3); }));
    assert.deepEqual(summary(shapes), ["contributes.sources[0].actions sourceActionCount", "contributes.sources[0].actions[2] notAnObject",
      "contributes.sources[1] notAnObject"]);
    assert.deepEqual(shapes.slice(1).map((issue) => issue.message), ["a source action must be an object", "a source must be an object"]);
    const ids = issuesOf(sourceManifest((m) => {
      m.contributes.sources[0].actions[1].id = "pass word";
      m.contributes.sources.push({ ...structuredClone(m.contributes.sources[0]), actions: [structuredClone(m.contributes.sources[0].actions[1])] });
      delete m.contributes.sources[1].actions[0].kind;
      m.contributes.sources[1].actions[0].label = "missing.key";
    }));
    assert.deepEqual(summary(ids), ["contributes.sources[0].actions[1].id invalidMemberID", "contributes.sources[1].id duplicateID",
      "contributes.sources[1].actions[0].id invalidMemberID", "contributes.sources[1].actions[0].kind missingField",
      "contributes.sources[1].actions[0].label unknownLocaleKey"]);
    assert.deepEqual(ids.slice(0, 2).map((issue) => issue.message), ["\"pass word\" is not a usable source action id", "the source id \"vault\" is used twice"]);
    assert.equal(ids[3].fix, "Add \"kind\": \"secret\" or \"text\".");
  });

  test("a value of the wrong type is unreadable once the checks pass", () => {
    const textOnly = issuesOf(sourceManifest((m) => { m.contributes.sources[0].actions.shift(); m.contributes.sources[0].sensitive = "yes"; }));
    assert.deepEqual(summary(textOnly), ["contributes.sources[0].sensitive manifestUnreadable"]);
    assert.deepEqual(summary(issuesOf(sourceManifest((m) => { m.contributes.sources[0].sensitive = "yes"; }))),
      ["contributes.sources[0].sensitive sourceSecretNeedsSensitive"], "only true is sensitive");
    assert.deepEqual(summary(issuesOf(sourceManifest((m) => { m.contributes.sources = { vault: {} }; }))), ["contributes.sources manifestUnreadable"]);
    assert.deepEqual(summary(issuesOf(sourceManifest((m) => { m.contributes.sources[0].sensitive = null; }))),
      ["contributes.sources[0].sensitive sourceSecretNeedsSensitive"], "null is no sensitive");
  });

  test("the store wants every source key in English", () => {
    const locales = sourceLocales();
    locales.tr = { ...locales.en };
    delete locales.en["username.copied"];
    delete locales.en["vault.title"];
    const issues = issuesOf(sourceManifest((m) => { m.defaultLocale = "tr"; }), { store: true, locales });
    assert.deepEqual(summary(issues).sort(), ["contributes.sources[0].actions[1].copied enLocaleKeyMissing", "contributes.sources[0].title enLocaleKeyMissing"]);
  });
});

describe("the store's rules", () => {
  test("a complete extension has no issues", () => {
    const { folder } = writeExtension();
    assert.deepEqual(validateExtension(folder).issues.map(formatIssue), []);
  });

  test("the license must be on the list", () => {
    for (const license of ALLOWED_LICENSES) {
      const { folder } = writeExtension({ manifest: withManifest((m) => { m.license = license; }) });
      assert.deepEqual(codes(validateExtension(folder).issues), [], license);
    }
    const { folder } = writeExtension({ manifest: withManifest((m) => { m.license = "GPL-3.0"; }) });
    const issues = validateExtension(folder).issues;
    assert.deepEqual(codes(issues), ["licenseNotAllowed"]);
    assert.equal(issues[0].field, "license");
    assert.match(issues[0].expected, /MIT, Apache-2\.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2\.0/);
  });

  test("README.md and CHANGELOG.md must exist", () => {
    const { folder } = writeExtension({ files: { "src/index.ts": "" } });
    const issues = validateExtension(folder).issues;
    assert.deepEqual(codes(issues), ["changelogMissing", "readmeMissing"]);
    assert.ok(issues.every((issue) => issue.field === ""));
    assert.ok(issues.some((issue) => issue.path.endsWith("README.md")));
  });

  test("en must have every key, including ones the app does not check", () => {
    const locales = storeLocales();
    locales.tr = { ...locales.en, "all.subtitle": "Her harf", "mode.long": "Uzun" };
    delete locales.en["all.subtitle"];
    delete locales.en["mode.long"];
    const { folder } = writeExtension({ manifest: withManifest((m) => { m.defaultLocale = "tr"; }), locales });
    const issues = validateExtension(folder).issues;
    assert.deepEqual(codes(issues), ["enLocaleKeyMissing"]);
    assert.deepEqual(issues.map((issue) => issue.field).sort(),
      ["contributes.actions[0].variants[0].subtitle", "preferences[0].options[1].title"]);
    assert.equal(issues[0].message.includes("locales/en.json"), true);
  });

  test("a key missing from the default en locale is reported once", () => {
    const locales = storeLocales();
    delete locales.en["shout.title"];
    const { folder } = writeExtension({ locales });
    assert.deepEqual(codes(validateExtension(folder).issues), ["unknownLocaleKey"]);
  });

  test("en must exist", () => {
    const locales = storeLocales();
    locales.tr = { ...locales.en };
    delete locales.en;
    const { folder } = writeExtension({ manifest: withManifest((m) => { m.defaultLocale = "tr"; }), locales });
    assert.deepEqual(codes(validateExtension(folder).issues), ["enLocaleMissing"]);
  });

  test("a locale file that is not JSON is named", () => {
    const { folder } = writeExtension({ locales: { ...storeLocales(), tr: "{ \"name\": " } });
    const issues = validateExtension(folder).issues;
    assert.ok(issues.some((issue) => issue.code === "localeUnreadable" && issue.path.endsWith(path.join("locales", "tr.json"))),
      issues.map(formatIssue).join("\n"));
  });

  test("fields the schema does not know are rejected", () => {
    const manifest = withManifest((m) => {
      m.homepage = "https://example.com";
      m.contributes.actions[0].colour = "red";
    });
    const { folder } = writeExtension({ manifest });
    const issues = validateExtension(folder).issues;
    assert.deepEqual(codes(issues), ["unknownField"]);
    assert.deepEqual(issues.map((issue) => issue.field).sort(), ["contributes.actions[0].colour", "homepage"]);
  });

  test("the schema catches what the app's checks leave out", () => {
    const manifest = withManifest((m) => {
      m.preferences[0].options[0].id = "sh ort";
      m.contributes.actions.push({ id: "now", title: "shout.title", keywords: "shout.keywords", input: "none", accepts: { kinds: [] }, output: "text" });
    });
    const { folder } = writeExtension({ manifest });
    const issues = validateExtension(folder).issues;
    assert.deepEqual(codes(issues), ["schemaMismatch"]);
    assert.deepEqual(issues.map((issue) => issue.field).sort(), ["contributes.actions[1].accepts.kinds", "preferences[0].options[0].id"]);
  });

  test("a schema issue never repeats an app issue", () => {
    const { folder } = writeExtension({ manifest: withManifest((m) => { m.version = "1.0"; m.categories = ["games"]; }) });
    assert.deepEqual(codes(validateExtension(folder).issues), ["invalidVersion", "unknownCategory"]);
  });

  test("type mismatches show next to other errors", () => {
    const { folder } = writeExtension({ manifest: withManifest((m) => { m.version = "1.0"; m.contributes.actions[0].hint = "yes"; }) });
    const issues = validateExtension(folder).issues;
    assert.deepEqual(codes(issues), ["invalidVersion", "schemaMismatch"]);
    assert.equal(issues.find((issue) => issue.code === "schemaMismatch").field, "contributes.actions[0].hint");
  });

  test("linksAndSpecialFilesAreRefused", () => {
    const { root, folder } = writeExtension();
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "not part of the extension");
    fs.symlinkSync(outside, path.join(folder, "icon.png"));
    fs.symlinkSync(root, path.join(folder, "src", "linked"));
    const pipe = spawnSync("mkfifo", [path.join(folder, "pipe")]).status === 0;
    // node_modules belongs to npm, which links freely.
    fs.mkdirSync(path.join(folder, "node_modules", ".bin"), { recursive: true });
    fs.symlinkSync(outside, path.join(folder, "node_modules", ".bin", "tool"));

    const issues = validateExtension(folder, { relativeTo: root }).issues.filter((issue) => issue.code === "notARegularFile");
    const expected = [`extensions/${ID}/icon.png`, `extensions/${ID}/src/linked`, ...(pipe ? [`extensions/${ID}/pipe`] : [])];
    assert.deepEqual(issues.map((issue) => issue.path).sort(), expected.sort());
    assert.match(formatIssue(issues.find((issue) => issue.path.endsWith("icon.png"))), /symbolic link.*→ fix: /);
    if (pipe) assert.match(formatIssue(issues.find((issue) => issue.path.endsWith("pipe"))), /not a regular file/);
    assert.deepEqual(validateExtension(folder, { store: false }).issues.filter((issue) => issue.code === "notARegularFile"), [],
      "a store rule: the app reads folders itself");
  });

  test("app mode leaves the store's rules out", () => {
    const { folder } = writeExtension({ manifest: withManifest((m) => { m.license = "GPL-3.0"; m.homepage = "x"; }), files: { "index.js": "" } });
    assert.deepEqual(codes(validateExtension(folder, { store: false }).issues), []);
    assert.ok(codes(validateExtension(folder).issues).length >= 3);
  });

  test("store codes and app codes do not overlap", () => {
    assert.deepEqual(STORE_CODES.filter((code) => APP_CODES.includes(code)), []);
  });
});

describe("npm run validate", () => {
  const run = (root, ...args) => spawnSync(process.execPath, [cli, "--root", root, ...args], { encoding: "utf8" });

  test("prints one line per issue and exits 1", () => {
    const { root } = writeExtension({ manifest: withManifest((m) => { m.version = "1.0"; }) });
    const result = run(root, ID);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout.split("\n").includes(
      `extensions/${ID}/manifest.json: version: "1.0" is not semantic versioning (expected MAJOR.MINOR.PATCH) → fix: Write the version as "1.0.0".`),
      result.stdout);
  });

  test("names a missing file without a field", () => {
    const { root } = writeExtension({ files: { "src/index.ts": "", "CHANGELOG.md": "" } });
    const result = run(root, ID);
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`^extensions/${ID.replaceAll(".", "\\.")}/README\\.md: README\\.md is missing → fix: `, "m"));
  });

  test("exits 0 with warnings only", () => {
    const manifest = withManifest((m) => {
      m.permissions = ["capture"];
      m.contributes.captureRules = [{ id: "clean", title: "shout.title", accepts: { kinds: ["link"], tags: ["x"] } }];
    });
    const { root } = writeExtension({ manifest });
    const result = run(root, ID);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /contributes\.captureRules\[0\]\.accepts\.tags: warning: capture rules never see tags; this rule would never run/);
  });

  test("exits 0 for a clean extension", () => {
    const { root } = writeExtension();
    const result = run(root, ID);
    assert.equal(result.status, 0, result.stdout);
  });

  test("checks every extension when no id is given", () => {
    const { root } = writeExtension();
    const bad = path.join(root, "extensions", "dev.example.bad");
    fs.cpSync(path.join(root, "extensions", ID), bad, { recursive: true });
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^extensions\/dev\.example\.bad\/manifest\.json: id: the id "dev\.example\.tool" does not match the folder name "dev\.example\.bad"/m);
    assert.match(result.stdout, new RegExp(`^extensions/${ID.replaceAll(".", "\\.")}: ok$`, "m"));
  });

  test("says so when an extension does not exist", () => {
    const { root } = writeExtension();
    const result = run(root, "dev.example.nothing");
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /extensions\/dev\.example\.nothing/);
  });
});

describe("npm run validate and the build", () => {
  const BUILT = "dev.example.built";
  const roots = [];
  after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
  /** A scratch repository with a new action extension, built when `build` says so. */
  function extension({ build }) {
    const root = scratchRoot("yab-validate-build-");
    roots.push(root);
    assert.equal(runTool("new", [BUILT, "--template", "action", "--author", "example"], { root }).status, 0);
    if (build) assert.equal(runTool("build", [BUILT], { root }).status, 0);
    return root;
  }
  const source = (root, file) => path.join(root, "extensions", BUILT, file);
  const later = (file) => {
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(file, future, future);
  };
  /** A problem only the build has, to tell which folder was checked. */
  function breakTheBuild(root) {
    const manifest = path.join(root, "dist", BUILT, "manifest.json");
    fs.writeFileSync(manifest, fs.readFileSync(manifest, "utf8").replace('"version": "1.0.0"', '"version": "1.0"'));
  }
  const NOTE = `extensions/${BUILT}: note: not built yet (or out of date): run npm run build -- ${BUILT} to check index.js too`;

  test("aFreshBuildIsCheckedIndexJsIncluded", () => {
    const root = extension({ build: true });
    later(source(root, "tests/index.test.mjs")); // tests are not part of the build
    const clean = runTool("validate", [BUILT], { root });
    assert.equal(clean.status, 0, clean.out);
    assert.ok(clean.out.split("\n").includes(`extensions/${BUILT}: ok, with its build in dist/${BUILT}`), clean.out);
    assert.doesNotMatch(clean.out, /not built/);

    breakTheBuild(root);
    const broken = runTool("validate", [BUILT], { root });
    assert.equal(broken.status, 1, broken.out);
    // Named at the source file, where it is fixed.
    assert.match(broken.out, new RegExp(`^extensions/${BUILT.replaceAll(".", "\\.")}/manifest\\.json: version: "1\\.0" is not semantic versioning`, "m"));
    assert.doesNotMatch(broken.out, /dist\//);
  });

  test("aStaleBuildIsNotUsed", () => {
    for (const changed of ["src/index.ts", "manifest.json", "locales/en.json"]) {
      const root = extension({ build: true });
      breakTheBuild(root);
      later(source(root, changed));
      const result = runTool("validate", [BUILT], { root });
      assert.equal(result.status, 0, `${changed}: the source is checked, not the old build\n${result.out}`);
      assert.ok(result.out.split("\n").includes(NOTE), `${changed}\n${result.out}`);
    }
  });

  test("aLinkAddedAfterTheBuildIsStillFound", () => {
    const root = extension({ build: true });
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "x");
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(outside, old, old);
    fs.symlinkSync(outside, source(root, "notes.txt"));
    const result = runTool("validate", [BUILT], { root });
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, new RegExp(`^extensions/${BUILT.replaceAll(".", "\\.")}/notes\\.txt: it is a symbolic link`, "m"));
  });

  test("anExtensionNeverBuiltIsToldToBuild", () => {
    const root = extension({ build: false });
    const result = runTool("validate", [BUILT], { root });
    assert.equal(result.status, 0, result.out);
    assert.ok(result.out.split("\n").includes(`extensions/${BUILT}: ok`), result.out);
    assert.ok(result.out.split("\n").includes(NOTE), result.out);
  });
});
