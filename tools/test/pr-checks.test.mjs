import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_INDEX_BYTES, MAX_PACKAGE_BYTES, authorToMention, changedFiles, checkScope, permissionChanges, readabilityProblems,
  runChecks, sizeProblems,
} from "../lib/pr-checks.mjs";
import { repo } from "./helpers.mjs";

const ID = "dev.example.tool";
const OTHER = "dev.example.other";

const roots = [];
const scratch = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yab-pr-")));
  roots.push(root);
  return root;
};
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function git(root, ...args) {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

describe("one extension folder per pull request", () => {
  test("oneExtensionFolderPasses", () => {
    assert.deepEqual(checkScope([`extensions/${ID}/src/index.ts`, `extensions/${ID}/manifest.json`, `extensions/${ID}/tests/a.test.mjs`]),
      { extensions: [ID], problems: [] });
  });

  test("twoExtensionFoldersFail", () => {
    const { extensions, problems } = checkScope([`extensions/${ID}/src/index.ts`, `extensions/${OTHER}/README.md`]);
    assert.deepEqual(extensions, [OTHER, ID]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /2 extension folders/);
    assert.ok(problems[0].includes(`extensions/${OTHER}/`) && problems[0].includes(`extensions/${ID}/`), problems[0]);
  });

  test("otherFilesBesideAnExtensionFail", () => {
    const { extensions, problems } = checkScope([`extensions/${ID}/src/index.ts`, "tools/build.mjs", "docs/publishing.md"]);
    assert.deepEqual(extensions, [ID]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /tools\/build\.mjs/);
    assert.match(problems[0], /docs\/publishing\.md/);
  });

  test("theLockfileAndTheGeneratedDocsMayChangeWithAnExtension", () => {
    // The video-download manifest is the manifest reference's example, so changing it regenerates these.
    const files = [`extensions/${ID}/manifest.json`, "package-lock.json", "docs/manifest.md", "docs/api.md", "llms-full.txt"];
    assert.deepEqual(checkScope(files), { extensions: [ID], problems: [] });
  });

  test("aPullRequestWithoutAnExtensionPasses", () => {
    assert.deepEqual(checkScope(["tools/build.mjs", "docs/publishing.md", "templates/action/src/index.ts"]), { extensions: [], problems: [] });
    assert.deepEqual(checkScope([]), { extensions: [], problems: [] });
  });

  test("aFileDirectlyInExtensionsIsOutsideTheFolder", () => {
    const { extensions, problems } = checkScope([`extensions/${ID}/README.md`, "extensions/README.md"]);
    assert.deepEqual(extensions, [ID]);
    assert.match(problems[0], /extensions\/README\.md/);
  });

  test("aMoveBetweenFoldersCountsBothFolders", () => {
    const root = scratch();
    git(root, "init", "-q", "-b", "main");
    fs.mkdirSync(path.join(root, "extensions", ID), { recursive: true });
    fs.writeFileSync(path.join(root, "extensions", ID, "index.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(root, "a file with spaces.md"), "x\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "change");
    fs.mkdirSync(path.join(root, "extensions", OTHER));
    git(root, "mv", `extensions/${ID}/index.ts`, `extensions/${OTHER}/index.ts`);
    fs.appendFileSync(path.join(root, "a file with spaces.md"), "y\n");
    git(root, "commit", "-q", "-am", "move");
    const files = changedFiles(root, "main");
    assert.deepEqual([...files].sort(), ["a file with spaces.md", `extensions/${OTHER}/index.ts`, `extensions/${ID}/index.ts`]);
    assert.match(checkScope(files).problems[0], /2 extension folders/);
  });
});

describe("readable source", () => {
  const FILE = `extensions/${ID}/src/index.ts`;
  const handWritten = Array.from({ length: 40 }, (_, index) => `  const value${index} = compute(input, ${index});`).join("\n");

  test("aMinifiedBundleIsRefused", () => {
    const problems = readabilityProblems(FILE, `"use strict";var a=function(){${"return b(c)+d;".repeat(200)}};\n`);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].startsWith(`${FILE}:1: `), problems[0]);
    assert.match(problems[0], /500/);
    assert.match(problems[0], /→ fix: /);
  });

  test("oneLongLineIsRefusedWhereverItIs", () => {
    const text = `${handWritten}\nconst table = "${"x".repeat(520)}";\n${handWritten}\n`;
    const problems = readabilityProblems(FILE, text);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].startsWith(`${FILE}:41: `), problems[0]);
  });

  test("aHighAverageIsRefused", () => {
    const text = Array.from({ length: 30 }, () => "y".repeat(250)).join("\n");
    const problems = readabilityProblems(FILE, text);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].startsWith(`${FILE}: `), problems[0]);
    assert.match(problems[0], /average/);
    assert.match(problems[0], /200/);
  });

  test("blankLinesDoNotHideAHighAverage", () => {
    const text = Array.from({ length: 30 }, () => `${"y".repeat(250)}\n\n\n\n`).join("");
    assert.equal(readabilityProblems(FILE, text).length, 1);
  });

  test("handWrittenSourceWithOneLongLinePasses", () => {
    // A long pattern or URL is fine: 500 characters is the limit, and the file's average stays low.
    const text = `${handWritten}\nconst pattern = /${"a".repeat(481)}/;\n${handWritten}\n`;
    assert.equal(text.split("\n")[40].length, 500);
    assert.deepEqual(readabilityProblems(FILE, text), []);
  });

  test("theLimitsThemselvesPass", () => {
    assert.deepEqual(readabilityProblems(FILE, Array.from({ length: 10 }, () => "z".repeat(200)).join("\n")), []);
    assert.deepEqual(readabilityProblems(FILE, ""), []);
    assert.deepEqual(readabilityProblems(FILE, "\n\n\n"), []);
  });

  test("charactersAreCountedNotBytesAndCrlfIsNotACharacter", () => {
    const turkish = `${handWritten}\nconst text = "${"ğ".repeat(470)}";\r\n${handWritten}\r\n`;
    assert.ok(Buffer.byteLength(turkish.split("\n")[40]) > 500);
    assert.deepEqual(readabilityProblems(FILE, turkish), []);
    assert.deepEqual(readabilityProblems(FILE, `${"w".repeat(500)}\r\n${handWritten}`), []);
  });
});

describe("size limits", () => {
  test("theLimitsAreTheApps", () => {
    assert.equal(MAX_PACKAGE_BYTES, 5_000_000, "the app refuses a larger package");
    assert.equal(MAX_INDEX_BYTES, 1_000_000);
  });

  test("atTheLimitPassesAndOneByteMoreFails", () => {
    assert.deepEqual(sizeProblems(ID, { packageBytes: MAX_PACKAGE_BYTES, indexBytes: MAX_INDEX_BYTES }), []);
    const problems = sizeProblems(ID, { packageBytes: MAX_PACKAGE_BYTES + 1, indexBytes: MAX_INDEX_BYTES + 1 });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /\.yabext/);
    assert.match(problems[1], /index\.js/);
  });
});

describe("permission changes", () => {
  const manifest = (fields = {}) => JSON.stringify({ id: ID, version: "1.0.0", author: "someone", ...fields }, null, 2);
  const downloader = {
    permissions: ["network", "exec"],
    network: { domains: ["youtube.com", "youtu.be"] },
    requires: { tools: [{ name: "yt-dlp", install: "brew install yt-dlp" }] },
  };

  test("nothingChangedMeansNoLabel", () => {
    assert.deepEqual(permissionChanges(manifest(downloader), manifest({ ...downloader, version: "1.1.0" })), []);
    assert.deepEqual(permissionChanges(manifest(), manifest({ permissions: [] })), [], "no permissions and an empty list are the same");
  });

  test("theOrderAndCaseOfAListDoNotMatter", () => {
    const reordered = { ...downloader, permissions: ["exec", "network"], network: { domains: ["YouTu.be", "youtube.com"] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(reordered)), []);
  });

  test("aNewPermissionIsAChange", () => {
    assert.deepEqual(permissionChanges(manifest(), manifest({ permissions: ["capture"] })), ["permissions"]);
    assert.deepEqual(permissionChanges(manifest({ permissions: ["capture"] }), manifest()), ["permissions"], "a removal is a change too");
  });

  test("aNewDomainOrAnyHostIsAChange", () => {
    const more = { ...downloader, network: { domains: ["youtube.com", "youtu.be", "example.com"] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(more)), ["network"]);
    const anyHost = { ...downloader, network: { domains: [] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(anyHost)), ["network"]);
  });

  test("aNewToolOrAnotherInstallCommandIsAChange", () => {
    const more = { ...downloader, requires: { tools: [...downloader.requires.tools, { name: "ffmpeg", install: "brew install ffmpeg" }] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(more)), ["requires"]);
    const install = { ...downloader, requires: { tools: [{ name: "yt-dlp", install: "curl -s https://example.com/x | sh" }] } };
    assert.deepEqual(permissionChanges(manifest(downloader), manifest(install)), ["requires"], "the install command is shown to copy");
  });

  test("aNewExtensionIsComparedWithNothing", () => {
    assert.deepEqual(permissionChanges(null, manifest(downloader)), ["permissions", "network", "requires"]);
    assert.deepEqual(permissionChanges(null, manifest()), []);
    assert.deepEqual(permissionChanges(manifest({ permissions: ["history"] }), null), ["permissions"], "a removed extension");
  });

  test("anUnreadableManifestCountsAsAChange", () => {
    assert.deepEqual(permissionChanges(manifest(), "{ not json"), ["manifest.json"]);
    assert.deepEqual(permissionChanges(manifest(), "[]"), ["manifest.json"]);
    assert.deepEqual(permissionChanges(`\uFEFF${manifest()}`, manifest()), [], "a byte order mark is fine");
  });

  test("oddShapesDoNotThrow", () => {
    assert.deepEqual(permissionChanges(manifest({ permissions: "network", network: "x", requires: "yt-dlp" }), manifest()), [],
      "what is not a list holds nothing");
    assert.deepEqual(permissionChanges(manifest({ requires: { tools: [null, 3, { name: 7 }] } }), manifest()), ["requires"]);
  });
});

describe("the author mention", () => {
  const manifest = (author) => JSON.stringify({ id: ID, author });

  test("someoneElsesExtensionNamesItsAuthor", () => {
    assert.equal(authorToMention(manifest("octo-dev"), "another-dev", "Another Dev"), "octo-dev");
    assert.equal(authorToMention(manifest("Berkay Gökçe"), "another-dev", null), "Berkay Gökçe");
  });

  test("theAuthorsOwnPullRequestIsNotMentioned", () => {
    assert.equal(authorToMention(manifest("octo-dev"), "Octo-Dev", null), null, "logins compare without case");
    assert.equal(authorToMention(manifest("@octo-dev"), "octo-dev", null), null);
    assert.equal(authorToMention(manifest("Berkay Gökçe"), "berkaygkc", "berkay gökçe"), null, "the profile name counts too");
  });

  test("aNewExtensionOrAMissingAuthorMentionsNobody", () => {
    assert.equal(authorToMention(null, "someone", null), null);
    assert.equal(authorToMention(manifest(""), "someone", null), null);
    assert.equal(authorToMention("{ not json", "someone", null), null);
    assert.equal(authorToMention(JSON.stringify({ id: ID }), "someone", null), null);
  });
});

describe("the pull request run", () => {
  /** A repository with extensions/<ID>/src/index.ts; `exec` stands in for npm and records each command. */
  function setUp({ source = "export const actions = {};\n", packageBytes = 4096, indexBytes = 2048, failing = [] } = {}) {
    const root = scratch();
    const folder = path.join(root, "extensions", ID);
    fs.mkdirSync(path.join(folder, "src"), { recursive: true });
    fs.writeFileSync(path.join(folder, "src", "index.ts"), source);
    fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ id: ID, version: "1.2.0" }));
    const calls = [];
    const exec = (args) => {
      const command = args.join(" ");
      calls.push(command);
      if (command === `run build -- ${ID}`) {
        fs.mkdirSync(path.join(root, "dist", ID), { recursive: true });
        fs.copyFileSync(path.join(folder, "manifest.json"), path.join(root, "dist", ID, "manifest.json"));
        for (const [file, size] of [[path.join(root, "dist", ID, "index.js"), indexBytes], [path.join(root, "dist", `${ID}-1.2.0.yabext`), packageBytes]]) {
          fs.writeFileSync(file, "");
          fs.truncateSync(file, size);
        }
      }
      return failing.some((prefix) => command.startsWith(prefix)) ? 1 : 0;
    };
    return { root, calls, exec };
  }
  const failed = (results) => results.filter((result) => !result.ok).map((result) => result.name);

  test("anExtensionPullRequestRunsEveryCheck", () => {
    const { root, calls, exec } = setUp();
    const { ok, results } = runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec });
    assert.equal(ok, true, JSON.stringify(results, null, 2));
    assert.deepEqual(calls.map((call) => call.replace(/--out \S+$/, "--out <dir>")), [
      `run build -- ${ID}`,
      `run validate -- ${ID}`,
      `test -- ${ID}`,
      "run typecheck",
      "run docs -- --check",
      "run test:tools",
      "run catalog -- --out <dir>",
    ]);
    const names = results.map((result) => result.name);
    for (const name of ["one extension folder", "readable source", "size"]) {
      assert.ok(names.some((entry) => entry.includes(name)), `${name} is among ${names.join(", ")}`);
    }
  });

  test("staleDocsFailTheRun", () => {
    const { root, exec } = setUp({ failing: ["run docs"] });
    const { ok, results } = runChecks({ root, files: ["docs/publishing.md"], exec });
    assert.equal(ok, false);
    assert.deepEqual(failed(results), ["npm run docs -- --check"]);
    const docs = results.find((result) => result.name === "npm run docs -- --check");
    assert.match(docs.problems.join("\n"), /npm run docs.*commit/);
  });

  test("aPullRequestWithoutAnExtensionRunsTheRepositoryChecks", () => {
    const { root, calls, exec } = setUp();
    assert.equal(runChecks({ root, files: ["tools/build.mjs"], exec }).ok, true);
    assert.deepEqual(calls.map((call) => call.split(" -- ")[0]), ["run typecheck", "run docs", "run test:tools", "run catalog"]);
  });

  test("anOversizedPackageFails", () => {
    const { root, exec } = setUp({ packageBytes: MAX_PACKAGE_BYTES + 1 });
    const { ok, results } = runChecks({ root, files: [`extensions/${ID}/manifest.json`], exec });
    assert.equal(ok, false);
    assert.equal(failed(results).length, 1);
    assert.match(failed(results)[0], /size/);
  });

  test("minifiedSourceFailsAndTheOtherChecksStillRun", () => {
    const { root, calls, exec } = setUp({ source: `export const actions={${"a:1,".repeat(300)}};\n` });
    const { ok, results } = runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec });
    assert.equal(ok, false);
    assert.equal(failed(results).length, 1);
    assert.match(failed(results)[0], /readable source/);
    assert.ok(calls.includes(`run build -- ${ID}`));
  });

  test("aFailingCommandFailsItsCheck", () => {
    const { root, exec } = setUp({ failing: [`test -- ${ID}`, "run test:tools"] });
    const { ok, results } = runChecks({ root, files: [`extensions/${ID}/src/index.ts`], exec });
    assert.equal(ok, false);
    assert.deepEqual(failed(results), [`npm test -- ${ID}`, "npm run test:tools"]);
  });

  test("twoFoldersFailAndARemovedFolderIsNotBuilt", () => {
    const { root, calls, exec } = setUp();
    const { ok, results } = runChecks({ root, files: [`extensions/${ID}/src/index.ts`, `extensions/${OTHER}/manifest.json`], exec });
    assert.equal(ok, false);
    assert.match(failed(results)[0], /one extension folder/);
    assert.ok(!calls.some((call) => call.includes(OTHER)), "the removed extension has nothing to build");
    assert.ok(calls.includes(`run build -- ${ID}`));
  });
});

describe("the workflows", () => {
  const workflow = (name) => fs.readFileSync(path.join(repo, ".github", "workflows", name), "utf8");
  const lines = (text) => text.split("\n").map((line) => line.trim()).filter((line) => line !== "").join("\n");

  test("theLabelWorkflowCarriesTheTestedFunctions", () => {
    const script = lines(workflow("pr-label.yml"));
    for (const fn of [permissionChanges, authorToMention]) {
      assert.ok(script.includes(lines(fn.toString())), `pr-label.yml holds ${fn.name} exactly as tools/lib/pr-checks.mjs has it`);
    }
  });

  test("theLabelScriptLabelsAndMentionsThroughTheApi", async () => {
    const text = workflow("pr-label.yml");
    const script = text.slice(text.indexOf("script: |\n") + "script: |\n".length).split("\n").map((line) => line.slice(12)).join("\n");
    const AsyncFunction = (async () => {}).constructor;
    const manifest = (fields) => JSON.stringify({ id: ID, author: "octo-dev", ...fields });

    /** Runs the script for a pull request by `login` that turns `base` into `head`; returns the label and comment calls. */
    async function label({ login, base, head, comments = [] }) {
      const calls = [];
      const notFound = () => Object.assign(new Error("Not Found"), { status: 404 });
      const github = {
        paginate: async (method, params) => (await method(params)).data,
        rest: {
          pulls: { listFiles: async () => ({ data: [{ filename: `extensions/${ID}/src/index.ts` }, { filename: "README.md" }] }) },
          repos: {
            getContent: async ({ path: file, ref }) => {
              const content = file === `extensions/${ID}/manifest.json` ? { base, head }[ref] : undefined;
              if (content == null) throw notFound();
              return { data: { type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") } };
            },
            listCommits: async ({ author }) => ({ data: author === "octo-dev" ? [{ sha: "c0ffee" }] : [] }),
          },
          users: { getByUsername: async ({ username }) => ({ data: { name: username === "octo-dev" ? "Octo Dev" : null } }) },
          issues: {
            addLabels: async ({ labels }) => calls.push(["label", ...labels]),
            listComments: async () => ({ data: comments }),
            createComment: async ({ body }) => calls.push(["comment", body]),
          },
        },
      };
      const context = { repo: { owner: "owner", repo: "store" },
        payload: { pull_request: { number: 7, user: { login }, base: { sha: "base" }, head: { sha: "head" } } } };
      await new AsyncFunction("github", "context", "core", script)(github, context, { info() {} });
      return calls;
    }

    const others = await label({ login: "another-dev", base: manifest(), head: manifest({ permissions: ["network"] }) });
    assert.deepEqual(others[0], ["label", "permissions-changed"]);
    assert.equal(others[1][0], "comment");
    assert.match(others[1][1], /`dev\.example\.tool` by @octo-dev/);
    assert.deepEqual(await label({ login: "octo-dev", base: manifest(), head: manifest({ version: "1.0.1" }) }), [], "the author's own fix");
    assert.deepEqual(await label({ login: "another-dev", base: manifest(), head: manifest(), comments: [{ body: others[1][1] }] }), [],
      "one comment per pull request");
    assert.deepEqual(await label({ login: "another-dev", base: null, head: manifest({ permissions: ["exec"], requires: { tools: [{ name: "x" }] } }) }),
      [["label", "permissions-changed"]], "a new extension: no one else to name");
    const named = await label({ login: "another-dev", base: manifest({ author: "Octo" }), head: manifest({ author: "Octo" }) });
    assert.match(named[0][1], /by Octo$/m, "a name that has no commits here is written, not mentioned");
  });

  test("theLabelWorkflowNeverRunsPullRequestCode", () => {
    const text = workflow("pr-label.yml");
    assert.match(text, /^\s+pull_request_target:/m);
    assert.doesNotMatch(text, /actions\/checkout/);
    assert.doesNotMatch(text, /^\s*(- )?run:/m, "no shell steps, only the API");
    assert.doesNotMatch(text, /\bnpm\b|\bnode\s/);
    assert.match(text, /^permissions:\n {2}contents: read\n {2}pull-requests: write\n(?! )/m);
  });

  test("pullRequestChecksRunWithAReadOnlyToken", () => {
    const text = workflow("pr.yml");
    assert.match(text, /^on:\n {2}pull_request:/m);
    assert.doesNotMatch(text, /pull_request_target|secrets\./);
    assert.match(text, /^permissions:\n {2}contents: read\n(?! )/m);
    assert.match(text, /fetch-depth: 0/);
    assert.match(text, /node tools\/pr-checks\.mjs/);
  });

  test("onlyThePublishEnvironmentSeesTheSigningKey", () => {
    const text = workflow("publish.yml");
    assert.match(text, /^on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:/m);
    assert.equal(text.match(/secrets\./g)?.length, 1, "the key is read once");
    const job = text.slice(text.indexOf("environment: publish"));
    assert.ok(text.includes("environment: publish") && job.includes("secrets.CATALOG_SIGNING_KEY"), "inside the publish environment's job");
    assert.match(text, /--sign-key-env CATALOG_SIGNING_KEY/);
    assert.match(text, /catalog\.json\.sig/, "the job fails without a signature");
  });
});
