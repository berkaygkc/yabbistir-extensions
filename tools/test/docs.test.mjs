// The documentation's own tests: what is generated is up to date, every example compiles, every link leads somewhere,
// and every extension the docs spell out file by file really builds and passes its tests.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NODE_DOCS } from "../lib/build.mjs";
import { anchorsOf, codeBlocks, linksOf, markdownFiles, slug } from "../lib/markdown.mjs";
import { APP_CODES, STORE_CODES } from "../lib/validate.mjs";
import { repo, run, scratchRoot } from "./helpers.mjs";

const GENERATED = ["docs/manifest.md", "docs/api.md", "llms-full.txt"];
const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");

const temporary = [];
const scratch = (prefix) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temporary.push(directory);
  return directory;
};
after(() => temporary.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

/** The runtime's error codes, read from the `ExtensionErrorCode` union in index.d.ts. */
function runtimeCodes() {
  const union = /export type ExtensionErrorCode =([^;]+);/.exec(read("packages/api/index.d.ts"))[1];
  return [...union.matchAll(/"(\w+)"/g)].map((match) => match[1]);
}

/**
 * Typechecks TypeScript blocks against packages/api, the way an extension's src/ is checked. Blocks of one document
 * that name a `file=` share a folder, so they can import each other; any other block is a module of its own.
 * @param {{ doc: string, block: { code: string, file?: string, line: number } }[]} entries
 * @returns {{ ok: boolean, output: string }}
 */
function typecheck(entries) {
  const directory = scratch("yab-doc-ts-");
  const where = new Map();
  for (const { doc, block } of entries) {
    const folder = doc.replace(/[^A-Za-z0-9]+/g, "_");
    const relative = block.file ? path.join(folder, block.file) : path.join(folder, `block-at-line-${block.line}.ts`);
    if (where.has(relative)) throw new Error(`${doc}: two blocks are both file=${block.file}; give one another file= or mark it "ts snippet"`);
    where.set(relative, `${doc}:${block.line}`);
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), block.code);
  }
  const api = path.join(repo, "packages", "api", "index.d.ts");
  fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2022", lib: ["es2022"], module: "esnext", moduleResolution: "bundler", strict: true, noEmit: true,
      allowImportingTsExtensions: true, types: [], paths: { "@yabbistir/api": [api] },
    },
    files: [api],
    include: ["**/*.ts"],
  }));
  const result = spawnSync(process.execPath, [path.join(repo, "node_modules", "typescript", "bin", "tsc"), "-p", directory, "--pretty", "false"],
    { encoding: "utf8", cwd: directory });
  // Name each failing block by the document and line it starts on.
  const output = `${result.stdout}${result.stderr}`.replace(/^([^\s(]+\.ts)\((\d+),(\d+)\)/gm, (whole, file, line) => {
    const origin = where.get(path.normalize(file));
    return origin ? `${origin} (block line ${line})` : whole;
  });
  return { ok: result.status === 0, output };
}

/** The TypeScript blocks of the documentation that are meant to compile: ```ts, but not ```ts snippet. */
function compilableBlocks() {
  return markdownFiles(repo).flatMap((doc) => codeBlocks(read(doc))
    .filter((block) => block.lang === "ts" && !block.flags.includes("snippet"))
    .map((block) => ({ doc, block })));
}

/** The documents that spell out a whole extension: a `npm run new` line and blocks with `file=`. */
function extensionsInDocs() {
  const found = [];
  for (const doc of markdownFiles(repo)) {
    const blocks = codeBlocks(read(doc));
    const files = blocks.filter((block) => block.file);
    if (files.length === 0) continue;
    const command = blocks.filter((block) => ["sh", "bash", "console"].includes(block.lang))
      .map((block) => /npm run new -- (\S+) --template (\S+)/.exec(block.code)).find(Boolean);
    found.push({ doc, id: command?.[1], template: command?.[2], files });
  }
  return found;
}

describe("markdown helpers", () => {
  test("slugsAreGitHubAnchors", () => {
    assert.equal(slug("Node builtins"), "node-builtins");
    assert.equal(slug("`yab.files.write`"), "yabfileswrite");
    assert.equal(slug("What's a job?"), "whats-a-job");
    assert.equal(slug("`requires.tools[]`"), "requirestools");
    assert.equal(slug("1. Make the folder"), "1-make-the-folder");
    assert.equal(slug("[Linked](x.md) title"), "linked-title");
  });

  test("anchorsCountRepeatsAndExplicitIds", () => {
    const anchors = anchorsOf("# A\n## A\n<a id=\"node-builtins\"></a>\n```md\n# Not a heading\n```\n");
    assert.deepEqual([...anchors].sort(), ["a", "a-1", "node-builtins"]);
  });

  test("codeBlocksReadTheInfoString", () => {
    const blocks = codeBlocks("x\n```ts file=src/index.ts\nconst a = 1;\n```\n\n````md\n```ts\ninner\n```\n````\n```ts snippet\nfoo\n```\n");
    assert.deepEqual(blocks.map(({ lang, flags, file, line }) => ({ lang, flags, file, line })), [
      { lang: "ts", flags: [], file: "src/index.ts", line: 2 },
      { lang: "md", flags: [], file: undefined, line: 6 },
      { lang: "ts", flags: ["snippet"], file: undefined, line: 11 },
    ]);
    assert.equal(blocks[0].code, "const a = 1;\n");
  });

  test("linksSkipCode", () => {
    const links = linksOf("See [a](a.md#x) and `[b](b.md)`.\n```\n[c](c.md)\n```\n[d](https://example.com) ![e](e.png)\n");
    assert.deepEqual(links.map((link) => link.target), ["a.md#x", "https://example.com", "e.png"]);
  });
});

describe("docs", () => {
  test("generatedDocsAreUpToDate", () => {
    const checked = run("docs", ["--check"]);
    assert.equal(checked.status, 0, `run npm run docs and commit the result:\n${checked.out}`);
    for (const file of GENERATED) assert.ok(fs.existsSync(path.join(repo, file)), `${file} is generated`);
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", ...GENERATED], { cwd: repo, encoding: "utf8" });
    if (tracked.error === undefined && fs.existsSync(path.join(repo, ".git"))) {
      assert.equal(tracked.status, 0, `the generated files are committed:\n${tracked.stderr}`);
    }
  });

  test("aStaleGeneratedFileIsReported", () => {
    const root = scratch("yab-docs-");
    for (const entry of ["schema", "packages/api/index.d.ts", "docs", "llms.txt", "README.md", "AGENTS.md", ".claude", ".github",
      "extensions/dev.yabbistir.video-download/manifest.json"]) {
      fs.cpSync(path.join(repo, entry), path.join(root, entry), { recursive: true });
    }
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"));
    assert.equal(run("docs", ["--root", root]).status, 0);
    assert.equal(run("docs", ["--root", root, "--check"]).status, 0);
    fs.appendFileSync(path.join(root, "docs", "api.md"), "\nedited by hand\n");
    const stale = run("docs", ["--root", root, "--check"]);
    assert.equal(stale.status, 1);
    assert.match(stale.out, /docs\/api\.md/);
  });

  test("everyTsExampleTypechecks", () => {
    const entries = compilableBlocks();
    assert.ok(entries.length >= 15, `only ${entries.length} TypeScript examples were found`);
    const { ok, output } = typecheck(entries);
    assert.ok(ok, output);
  });

  test("aBrokenExampleFailsTheTypecheck", () => {
    const { ok, output } = typecheck([
      { doc: "docs/x.md", block: { line: 3, code: "import type { Actions } from \"@yabbistir/api\";\nexport const actions: Actions = { a: { run: () => ({ txt: \"x\" }) } };\n" } },
    ]);
    assert.equal(ok, false);
    assert.match(output, /docs\/x\.md:3/);
  });

  test("llmsTxtLinksResolve", () => {
    const text = read("llms.txt");
    assert.match(text, /^# .+\n\n> .+/, "llms.txt starts with a title and a one-line summary");
    const links = linksOf(text);
    assert.ok(links.length >= 15, "llms.txt lists the docs");
    for (const { target, line } of links) {
      assert.doesNotMatch(target, /^[a-z]+:/, `llms.txt:${line}: ${target} should be a path in this repository`);
      const [file, anchor] = target.split("#");
      assert.ok(fs.existsSync(path.join(repo, file)), `llms.txt:${line}: ${file} does not exist`);
      if (anchor) assert.ok(anchorsOf(read(file)).has(anchor), `llms.txt:${line}: ${file} has no #${anchor}`);
    }
    const listed = new Set(links.map((link) => link.target.split("#")[0]));
    for (const doc of markdownFiles(repo).filter((file) => file.startsWith("docs/"))) {
      assert.ok(listed.has(doc), `llms.txt does not list ${doc}`);
    }
  });

  test("errorsDocHasTheNodeBuiltinsAnchor", () => {
    assert.equal(NODE_DOCS, "docs/errors.md#node-builtins", "the build's messages point here");
    assert.ok(anchorsOf(read("docs/errors.md")).has("node-builtins"));
  });

  test("errorsDocCoversEveryCode", () => {
    const anchors = anchorsOf(read("docs/errors.md"));
    for (const code of [...APP_CODES, ...STORE_CODES, ...runtimeCodes()]) {
      assert.ok(anchors.has(slug(code)), `docs/errors.md has no heading for ${code}`);
    }
  });

  test("everyDocLinkResolves", () => {
    for (const doc of markdownFiles(repo)) {
      const text = read(doc);
      for (const { target, line } of linksOf(text)) {
        if (/^[a-z]+:/.test(target)) continue;
        const [file, anchor] = target.split("#");
        const resolved = file === "" ? doc : path.join(path.dirname(doc), file);
        assert.ok(fs.existsSync(path.join(repo, resolved)), `${doc}:${line}: ${target} does not exist`);
        if (anchor && resolved.endsWith(".md")) {
          assert.ok(anchorsOf(read(resolved)).has(anchor), `${doc}:${line}: ${resolved} has no #${anchor}`);
        }
      }
    }
  });

  test("everyExtensionInTheDocsBuildsAndPassesItsTests", () => {
    const found = extensionsInDocs();
    assert.ok(found.length >= 7, `getting started and the six recipes spell out an extension (found ${found.length})`);
    for (const { doc, id, template, files } of found) {
      assert.ok(id && template, `${doc}: has file= blocks but no "npm run new -- <id> --template <template>" line`);
      const root = scratchRoot("yab-doc-ext-");
      temporary.push(root);
      const made = run("new", [id, "--template", template, "--author", "your-github-name"], { root });
      assert.equal(made.status, 0, `${doc}: ${made.out}`);
      const folder = path.join(root, "extensions", id);
      // The docs say to delete the template's Turkish strings unless they give new ones.
      if (!files.some((block) => block.file === "locales/tr.json")) fs.rmSync(path.join(folder, "locales", "tr.json"));
      for (const block of files) {
        fs.mkdirSync(path.dirname(path.join(folder, block.file)), { recursive: true });
        fs.writeFileSync(path.join(folder, block.file), block.code);
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
      assert.equal(manifest.id, id, `${doc}: the manifest's id is the one given to npm run new`);
      const validated = run("validate", [id], { root });
      assert.equal(validated.status, 0, `${doc}: npm run validate\n${validated.out}`);
      assert.doesNotMatch(validated.out, /warning/, `${doc}: ${validated.out}`);
      const built = run("build", [id], { root });
      assert.equal(built.status, 0, `${doc}: npm run build\n${built.out}`);
      assert.doesNotMatch(built.out, /warning/, `${doc}: ${built.out}`);
      const tested = run("test", [id], { root });
      assert.equal(tested.status, 0, `${doc}: npm test\n${tested.out}`);
      assert.match(tested.out, /(# pass|ℹ pass) [1-9]/, `${doc}: its tests ran`);
    }
  });

  test("docsStayClean", () => {
    const files = [...markdownFiles(repo), "llms.txt"];
    for (const file of files) {
      const text = read(file);
      // /Users/test is the fake host's home folder, not anyone's.
      assert.doesNotMatch(text, /\/Users\/(?!test\b)|\/home\/[a-z]/, `${file}: no local paths`);
      assert.doesNotMatch(text, /superpowers|DESIGN\.md|PRODUCT\.md|\bM4[abc]?\b|\bM5\b/, `${file}: no internal documents or milestones`);
    }
    assert.equal(read("CLAUDE.md").trim(), "@AGENTS.md");
    const skill = read(".claude/skills/yabbistir-extension/SKILL.md");
    assert.match(skill, /^---\nname: yabbistir-extension\ndescription: .+\n---\n/, "the skill has its frontmatter");
  });
});
