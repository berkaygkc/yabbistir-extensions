import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { EDITORS, QUERY, SQLITE_OPTIONS } from "../src/editors.ts";
import { commandOf, merged, projectOf, projectsIn, shellWord, withoutTrailingSlashes } from "../src/projects.ts";

const folder = new URL("..", import.meta.url);
const START = Date.parse("2026-11-01T09:00:00Z");
const FIVE_MINUTES = 5 * 60_000;
/** The fake host's home folder: what the `home` preference's default "~" becomes. */
const HOME = "/Users/test";

let helpers = 0;
/**
 * The extension's `sources` as a newly started helper has them: a module of its own, so nothing is cached and no
 * unreadable editor has been noted yet. The fake host does not import the extension; it calls the export it is given.
 */
async function newHelper() {
  return (await import(`../src/index.ts?helper=${++helpers}`)).sources;
}

// ---- Synthetic databases ----

const oldDatabase = (support, home = HOME) => `${home}/Library/Application Support/${support}/User/globalStorage/state.vscdb`;
const sharedDatabase = (shared, home = HOME) => `${home}/${shared}/sharedStorage/state.vscdb`;
const VSCODE = oldDatabase("Code");
const VSCODE_SHARED = sharedDatabase(".vscode-shared");
const CURSOR = oldDatabase("Cursor");

const folderEntry = (uri, extra = {}) => ({ folderUri: uri, ...extra });
const workspaceEntry = (uri, extra = {}) => ({ workspace: { id: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", configPath: uri }, ...extra });
const fileEntry = (uri) => ({ fileUri: uri });
/** A database that holds the recent list with these entries, as the editor writes it (JSON text in ItemTable). */
const withList = (...entries) => ({ value: JSON.stringify({ entries }) });
/** A database that is there but holds no recent list: an editor that opened nothing yet, or one whose list moved. */
const WITHOUT_LIST = {};
/** A database sqlite3 cannot read; its error message names the file, and must never reach a message or the log. */
const CORRUPT = { fail: { exitCode: 26, stderr: `Error: in prepare, file is not a database (26) ${HOME}/Library/x\n` } };

/** VS Code's list: two folders, a workspace, a file (never a project), a remote folder and a Turkish path. */
const VSCODE_LIST = withList(
  folderEntry("file:///Users/test/dev/site"),
  workspaceEntry("file:///Users/test/dev/shop.code-workspace"),
  fileEntry("file:///Users/test/notes.txt"),
  folderEntry("file:///Users/test/My%20Projects/it%27s%20here"),
  folderEntry("vscode-remote://ssh-remote%2Bbuild-box/home/deniz/api", { remoteAuthority: "ssh-remote+build-box", label: "/home/deniz/api [SSH: build-box]" }),
  folderEntry("file:///Users/test/Masa%C3%BCst%C3%BC/%C3%87al%C4%B1%C5%9Fma%20Alan%C4%B1"),
);

const VSCODE_ROWS = [
  { title: "site", subtitle: "VS Code · ~/dev/site" },
  { title: "shop", subtitle: "VS Code · ~/dev/shop.code-workspace" },
  { title: "it's here", subtitle: "VS Code · ~/My Projects/it's here" },
  { title: "api", subtitle: "VS Code · SSH: build-box · /home/deniz/api" },
  { title: "Çalışma Alanı", subtitle: "VS Code · ~/Masaüstü/Çalışma Alanı" },
];

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A fake sqlite3 over synthetic databases, by path: `{ value }` holds the list's JSON text, `{}` holds no list, and
 * `{ fail }` is an error. Like the real one with the extension's query, it prints "1" or "0" (whether the list is
 * there) and then each entry that is an object as one line of JSON; a path with no database is "unable to open".
 */
function fakeSqlite(databases = {}) {
  const runs = [];
  const sqlite3 = (args) => {
    runs.push(args);
    const path = args[args.indexOf("--") + 1];
    const database = databases[path];
    if (database === undefined) {
      return { exitCode: 1, stdout: "", stderr: `Error: unable to open database "${path}": unable to open database file\n` };
    }
    if (database.fail !== undefined) return { exitCode: database.fail.exitCode ?? 1, stdout: database.fail.stdout ?? "", stderr: database.fail.stderr ?? "" };
    if (database.stdout !== undefined) return { exitCode: 0, stdout: database.stdout, stderr: "" };
    if (database.value === undefined) return { exitCode: 0, stdout: "0\n", stderr: "" };
    const parsed = JSON.parse(database.value);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries.filter(isObject).slice(0, 1000) : [];
    return { exitCode: 0, stdout: ["1", ...entries.map((entry) => JSON.stringify(entry))].join("\n") + "\n", stderr: "" };
  };
  return Object.assign(sqlite3, { runs, databases });
}

function hostWith(sources, sqlite3, { now = START, language = "en", preferences = {} } = {}) {
  return createFakeHost({ folder, sources, exec: { sqlite3 }, now, preferences, context: { language } });
}
/** The databases sqlite3 was asked to read, in order. */
const opened = (sqlite3) => sqlite3.runs.map((args) => args[args.indexOf("--") + 1]);
const withoutIds = (rows) => rows.map(({ id, ...rest }) => rest);
const settled = (promise) => promise.then(() => undefined, () => undefined);

async function listed(databases, options) {
  const sqlite3 = fakeSqlite(databases);
  const host = hostWith(await newHelper(), sqlite3, options);
  return { host, sqlite3, listing: await host.list("projects", options?.context) };
}

describe("list", () => {
  test("lists VS Code's folders and workspaces, newest first, without files", async () => {
    const { listing } = await listed({ [VSCODE]: VSCODE_LIST });
    assert.deepEqual(withoutIds(listing.rows), VSCODE_ROWS);
  });

  test("row ids are short, distinct and the same each time", async () => {
    const first = (await listed({ [VSCODE]: VSCODE_LIST })).listing.rows;
    const again = (await listed({ [VSCODE]: VSCODE_LIST })).listing.rows;
    assert.deepEqual(again.map((row) => row.id), first.map((row) => row.id));
    assert.equal(new Set(first.map((row) => row.id)).size, first.length);
    for (const row of first) assert.match(row.id, /^code-[0-9a-f]{16}$/);
    // FNV-1a over "folder file:///Users/test/dev/site": pinned, so a change to how ids are made is noticed.
    assert.equal(first[0].id, "code-2eab49b1e5cc67bd");
  });

  test("runs sqlite3 read-only, in safe mode, with the path after --", async () => {
    const { sqlite3 } = await listed({ [VSCODE]: VSCODE_LIST });
    const args = sqlite3.runs.find((run) => run.includes(VSCODE));
    assert.deepEqual(args, [
      "-readonly", "-safe", "-batch", "-bail", "-init", "/dev/null", "-noheader", "-list", "-cmd", ".timeout 1000",
      "--", VSCODE, QUERY,
    ]);
    assert.equal(args.length, SQLITE_OPTIONS.length + 3);
  });

  test("looks in each editor's old database, and in its shared one only when the old one has no list", async () => {
    const { sqlite3 } = await listed({ [VSCODE]: WITHOUT_LIST, [VSCODE_SHARED]: VSCODE_LIST });
    assert.deepEqual(opened(sqlite3), [
      VSCODE,
      oldDatabase("Cursor"),
      oldDatabase("Windsurf"),
      oldDatabase("VSCodium"),
      oldDatabase("Code - Insiders"),
      VSCODE_SHARED,
    ], "an editor without an old database is not installed: its shared folder is never read");
  });

  test("VS Code 1.118 and later: the list comes from the shared database", async () => {
    const { listing } = await listed({ [VSCODE]: WITHOUT_LIST, [VSCODE_SHARED]: VSCODE_LIST });
    assert.deepEqual(withoutIds(listing.rows), VSCODE_ROWS);
  });

  test("an old database with the list wins, and the shared one is not read", async () => {
    const { listing, sqlite3 } = await listed({ [VSCODE]: VSCODE_LIST, [VSCODE_SHARED]: withList(folderEntry("file:///Users/test/elsewhere")) });
    assert.deepEqual(withoutIds(listing.rows), VSCODE_ROWS);
    assert.ok(!opened(sqlite3).includes(VSCODE_SHARED));
  });

  test("every editor's shared folder", async () => {
    const shared = Object.fromEntries(EDITORS.map((editor) => [editor.id, sharedDatabase(editor.shared)]));
    assert.deepEqual(shared, {
      code: `${HOME}/.vscode-shared/sharedStorage/state.vscdb`,
      cursor: `${HOME}/.cursor-shared/sharedStorage/state.vscdb`,
      windsurf: `${HOME}/.windsurf-shared/sharedStorage/state.vscdb`,
      codium: `${HOME}/.vscode-oss-shared/sharedStorage/state.vscdb`,
      insiders: `${HOME}/.vscode-insiders-shared/sharedStorage/state.vscdb`,
    });
  });

  test("Cursor, Windsurf, VSCodium and VS Code Insiders, with their names", async () => {
    const one = (name) => withList(folderEntry(`file:///Users/test/dev/${name}`));
    const { listing } = await listed({
      [CURSOR]: one("cursor-app"),
      [oldDatabase("Windsurf")]: one("windsurf-app"),
      [oldDatabase("VSCodium")]: WITHOUT_LIST,
      [sharedDatabase(".vscode-oss-shared")]: one("codium-app"),
      [oldDatabase("Code - Insiders")]: one("insiders-app"),
    });
    assert.deepEqual(withoutIds(listing.rows), [
      { title: "cursor-app", subtitle: "Cursor · ~/dev/cursor-app" },
      { title: "windsurf-app", subtitle: "Windsurf · ~/dev/windsurf-app" },
      { title: "codium-app", subtitle: "VSCodium · ~/dev/codium-app" },
      { title: "insiders-app", subtitle: "VS Code Insiders · ~/dev/insiders-app" },
    ]);
    assert.deepEqual(listing.rows.map((row) => row.id.split("-")[0]), ["cursor", "windsurf", "codium", "insiders"]);
  });

  test("no editor installed: an empty column, and nothing logged", async () => {
    const { listing, host } = await listed({});
    assert.deepEqual(listing, { rows: [] });
    assert.deepEqual(host.logs, []);
  });

  test("editors that opened nothing yet: an empty column", async () => {
    const { listing } = await listed({ [VSCODE]: WITHOUT_LIST, [VSCODE_SHARED]: WITHOUT_LIST, [CURSOR]: withList() });
    assert.deepEqual(listing, { rows: [] });
  });

  test("a list with only files, or entries of shapes this version does not know, is empty", async () => {
    const odd = JSON.stringify({ entries: [fileEntry("file:///Users/test/a.txt"), { workspace: "x" }, { workspace: { id: "1" } }, { folderUri: 5 }, { label: "x" }] });
    const { listing } = await listed({ [VSCODE]: { value: odd } });
    assert.deepEqual(listing, { rows: [] });
  });

  test("an unreadable editor is left out, said once in the log without its path, and the others are listed", async () => {
    const sources = await newHelper();
    const sqlite3 = fakeSqlite({ [VSCODE]: VSCODE_LIST, [CURSOR]: CORRUPT });
    const host = hostWith(sources, sqlite3);
    assert.deepEqual(withoutIds((await host.list("projects")).rows), VSCODE_ROWS);
    assert.deepEqual(host.logs, ["Cursor: its recent list couldn’t be read, so its projects are left out."]);
    assert.ok(opened(sqlite3).includes(sharedDatabase(".cursor-shared")), "its shared database is tried too");

    const again = hostWith(sources, sqlite3, { now: START + 1_000 });
    await again.list("projects");
    assert.deepEqual(again.logs, [], "once per helper");
  });

  test("an unreadable old database still lets the shared one be read", async () => {
    const { listing } = await listed({ [VSCODE]: CORRUPT, [VSCODE_SHARED]: VSCODE_LIST });
    assert.deepEqual(withoutIds(listing.rows), VSCODE_ROWS);
  });

  test("when no editor can be read the listing fails, and says so without sqlite3's output", async () => {
    const sqlite3 = fakeSqlite({ [VSCODE]: CORRUPT, [CURSOR]: { fail: { exitCode: 5, stderr: "Error: database is locked\n" } } });
    const host = hostWith(await newHelper(), sqlite3);
    await assert.rejects(host.list("projects"), (error) => {
      assert.equal(error.message, "The editors’ recent lists couldn’t be read.");
      assert.ok(!error.stack.includes(HOME) && !error.stack.includes("locked") && !error.stack.includes("not a database"));
      return true;
    });
  });

  test("output sqlite3 should not print is a failure, not a list", async () => {
    for (const stdout of ["", "2\n", "yes\n{}\n", "0\n{\"folderUri\":\"file:///Users/test/x\"}\n"]) {
      await assert.rejects(listed({ [VSCODE]: { stdout } }), { message: "The editors’ recent lists couldn’t be read." }, JSON.stringify(stdout));
    }
  });

  test("lines that are not JSON objects are skipped", async () => {
    const stdout = ["1", "{\"folderUri\":\"file:///Users/test/dev/a\"}", "not json", "[1,2]", "\"text\"", "{\"folderUri\":\"file:///Users/test/dev/b\"}"].join("\n") + "\n";
    const { listing } = await listed({ [VSCODE]: { stdout } });
    assert.deepEqual(listing.rows.map((row) => row.title), ["a", "b"]);
  });

  test("every line is read, beyond the 64 KB an exec result keeps", async () => {
    const long = "x".repeat(200);
    const entries = Array.from({ length: 900 }, (_, index) => folderEntry(`file:///Users/test/dev/${long}/p${index}`));
    const { listing, host } = await listed({ [VSCODE]: withList(...entries) });
    assert.equal(listing.rows.length, 50);
    assert.equal(listing.rows[0].title, "p0", "the newest come first in the output, and are kept");
    assert.ok(host.calls.length > 0);
  });

  test("at most 50 rows", async () => {
    const entries = Array.from({ length: 80 }, (_, index) => folderEntry(`file:///Users/test/dev/p${index}`));
    const { listing } = await listed({ [VSCODE]: withList(...entries) });
    assert.equal(listing.rows.length, 50);
    assert.equal(listing.rows.at(-1).title, "p49");
  });

  test("two editors are merged rank by rank, and the cap shares the rows", async () => {
    const entries = (prefix) => Array.from({ length: 40 }, (_, index) => folderEntry(`file:///Users/test/${prefix}/p${index}`));
    const { listing } = await listed({ [VSCODE]: withList(...entries("code")), [CURSOR]: withList(...entries("cursor")) });
    assert.equal(listing.rows.length, 50);
    assert.deepEqual(listing.rows.slice(0, 4).map((row) => row.subtitle), [
      "VS Code · ~/code/p0", "Cursor · ~/cursor/p0", "VS Code · ~/code/p1", "Cursor · ~/cursor/p1",
    ]);
    assert.equal(listing.rows.filter((row) => row.subtitle.startsWith("VS Code")).length, 25);
  });

  test("a project in two editors is listed once, where it is most recent", async () => {
    const entry = (name) => folderEntry(`file:///Users/test/dev/${name}`);
    const { listing } = await listed({
      [VSCODE]: withList(entry("a"), entry("b"), entry("shared")),
      [CURSOR]: withList(entry("shared"), entry("c")),
    });
    assert.deepEqual(listing.rows.map((row) => row.subtitle), [
      "VS Code · ~/dev/a", "Cursor · ~/dev/shared", "VS Code · ~/dev/b", "Cursor · ~/dev/c",
    ]);
  });

  test("on the same rank the order of the editors decides", async () => {
    const entry = (name) => folderEntry(`file:///Users/test/dev/${name}`);
    const { listing } = await listed({ [VSCODE]: withList(entry("same")), [CURSOR]: withList(entry("same")) });
    assert.deepEqual(listing.rows.map((row) => row.subtitle), ["VS Code · ~/dev/same"]);
  });

  test("on this Mac case, normalization and a trailing slash make no other project; on a remote one case does", async () => {
    const { listing } = await listed({
      [VSCODE]: withList(
        folderEntry("file:///Users/test/Dev/Site"),
        folderEntry("file:///Users/test/dev/site/"),
        folderEntry(`file:///Users/test/${encodeURIComponent("Masau\u0308stu\u0308")}`),
        folderEntry(`file:///Users/test/${encodeURIComponent("Masaüstü")}`),
        folderEntry("vscode-remote://ssh-remote%2Bbox/srv/App"),
        folderEntry("vscode-remote://ssh-remote%2BBOX/srv/app"),
        folderEntry("vscode-remote://ssh-remote%2BBOX/srv/App"),
      ),
    });
    assert.deepEqual(listing.rows.map((row) => row.subtitle), [
      "VS Code · ~/Dev/Site", "VS Code · ~/Masaüstü", "VS Code · SSH: box · /srv/App", "VS Code · SSH: BOX · /srv/app",
    ]);
  });

  test("untitled workspaces, which live in the editor's own folder, are left out", async () => {
    const { listing } = await listed({
      [VSCODE]: withList(
        workspaceEntry("file:///Users/test/Library/Application%20Support/Code/Workspaces/1730000000000/workspace.json"),
        workspaceEntry("file:///Users/test/dev/team.code-workspace"),
      ),
    });
    assert.deepEqual(listing.rows.map((row) => row.title), ["team"]);
  });

  test("entries that are no path on this Mac, or not a well-formed one, are left out", async () => {
    const { listing } = await listed({
      [VSCODE]: withList(
        folderEntry("file://server/share/project"),
        folderEntry("file:relative/path"),
        folderEntry("file:///Users/test/bad%E0%A4%A"),
        folderEntry("file:///Users/test/line%0Abreak"),
        folderEntry("file:///Users/test/tab%09here"),
        folderEntry("file:///Users/test/raw\nnewline"),
        folderEntry("file:///Users/test/sep%E2%80%A8arator"),
        folderEntry("vscode-remote:///no/authority"),
        folderEntry("vscode-remote://ssh-remote%2Bbox"),
        folderEntry("://no-scheme/x"),
        folderEntry("1bad://x/y"),
        folderEntry(`file:///Users/test/${"a".repeat(17_000)}`),
        folderEntry("file:///Users/test/dev/kept"),
      ),
    });
    assert.deepEqual(listing.rows.map((row) => row.title), ["kept"]);
  });

  test("paths outside the home folder are shown whole", async () => {
    const { listing } = await listed({ [VSCODE]: withList(folderEntry("file:///Volumes/Work/client"), folderEntry("file:///Users/tester/x"), folderEntry("file:///Users/test")) });
    assert.deepEqual(withoutIds(listing.rows), [
      { title: "client", subtitle: "VS Code · /Volumes/Work/client" },
      { title: "x", subtitle: "VS Code · /Users/tester/x" },
      { title: "test", subtitle: "VS Code · ~" },
    ]);
  });

  test("titles: a workspace without its extension, the root, and a name of only spaces (cleaned by the app)", async () => {
    const { listing } = await listed({
      [VSCODE]: withList(
        workspaceEntry("file:///Users/test/dev/Big.CODE-WORKSPACE"),
        workspaceEntry("file:///Users/test/dev/.code-workspace"),
        workspaceEntry("file:///Users/test/dev/notes.json"),
        folderEntry("file:///"),
        folderEntry("file:///Users/test/dev/%20%20"),
        folderEntry("file:///Users/test/dev/%E3%80%80"),
      ),
    });
    assert.deepEqual(withoutIds(listing.rows), [
      { title: "Big", subtitle: "VS Code · ~/dev/Big.CODE-WORKSPACE" },
      { title: ".code-workspace", subtitle: "VS Code · ~/dev/.code-workspace" },
      { title: "notes.json", subtitle: "VS Code · ~/dev/notes.json" },
      { title: "/", subtitle: "VS Code · /" },
      { title: "~/dev/", subtitle: "VS Code · ~/dev/" },
      { title: "~/dev/", subtitle: "VS Code · ~/dev/" },
    ]);
  });

  test("a decomposed name is shown composed and pasted as stored", async () => {
    const stored = "/Users/test/dev/Masau\u0308stu\u0308";
    const sqlite3 = fakeSqlite({ [VSCODE]: withList(folderEntry(`file://${encodeURI(stored)}`)) });
    const host = hostWith(await newHelper(), sqlite3);
    const [row] = (await host.list("projects")).rows;
    assert.equal(row.title, "Masaüstü");
    assert.equal(row.subtitle, "VS Code · ~/dev/Masaüstü");
    assert.deepEqual(await host.runSource("projects", row.id, "path"), { text: stored });
  });

  test("remote projects say where they are", async () => {
    const hex = (value) => Buffer.from(JSON.stringify(value)).toString("hex");
    const remote = (authority, path = "/work/app") => folderEntry(`vscode-remote://${encodeURIComponent(authority)}${path}`);
    const { listing } = await listed({
      [VSCODE]: withList(
        remote("ssh-remote+deniz@build-box"),
        remote(`ssh-remote+${hex({ hostName: "Build-Box.local", user: "deniz" })}`, "/work/a"),
        remote("ssh-remote+deadbeef", "/work/b"),
        remote(`dev-container+${hex({ hostPath: "/Users/test/dev/app" })}`, "/workspaces/app"),
        remote("attached-container+7b7d", "/srv/c"),
        remote("wsl+Ubuntu", "/home/d"),
        remote("tunnel+office", "/home/e"),
        remote("codespaces+fuzzy-space-pancake", "/workspaces/f"),
        remote("k8s-container+pod", "/g"),
        remote("ssh-remote", "/h"),
      ),
    });
    assert.deepEqual(listing.rows.map((row) => row.subtitle), [
      "VS Code · SSH: deniz@build-box · /work/app",
      "VS Code · SSH: Build-Box.local · /work/a",
      "VS Code · SSH: deadbeef · /work/b",
      "VS Code · Dev Container · /workspaces/app",
      "VS Code · Dev Container · /srv/c",
      "VS Code · WSL: Ubuntu · /home/d",
      "VS Code · Tunnel: office · /home/e",
      "VS Code · Codespaces · /workspaces/f",
      "VS Code · k8s-container · /g",
      "VS Code · SSH · /h",
    ]);
  });

  test("virtual projects show their URI", async () => {
    const { listing } = await listed({ [VSCODE]: withList(folderEntry("vscode-vfs://github/ornek/site"), folderEntry("vscode-vfs://github")) });
    assert.deepEqual(withoutIds(listing.rows), [
      { title: "site", subtitle: "VS Code · vscode-vfs://github/ornek/site" },
      { title: "github", subtitle: "VS Code · vscode-vfs://github" },
    ]);
  });

  test("an entry's label, or anything else it holds, never reaches a row", async () => {
    const token = "gh" + "p_" + "a".repeat(36);
    const { listing } = await listed({
      [VSCODE]: withList(folderEntry("file:///Users/test/dev/site", { label: token, remoteAuthority: token, extra: token })),
    });
    assert.ok(!JSON.stringify(listing).includes(token));
  });
});

describe("the home folder", () => {
  test("comes from the preference, whose default the app expands", async () => {
    const home = "/Users/deniz";
    const { listing } = await listed(
      { [oldDatabase("Code", home)]: withList(folderEntry("file:///Users/deniz/dev/site"), folderEntry("file:///Users/test/dev/other")) },
      { preferences: { home: `${home}//` } },
    );
    assert.deepEqual(withoutIds(listing.rows), [
      { title: "site", subtitle: "VS Code · ~/dev/site" },
      { title: "other", subtitle: "VS Code · /Users/test/dev/other" },
    ]);
  });

  test("without one the column says to choose it, and nothing runs", async () => {
    for (const home of ["", "relative/path", "/", "///", "/Users/test\nx", 5]) {
      const sqlite3 = fakeSqlite({ [VSCODE]: VSCODE_LIST });
      const host = hostWith(await newHelper(), sqlite3, { preferences: { home } });
      assert.deepEqual(await host.list("projects"), { locked: true, message: "Choose your home folder in Settings to see your projects" }, JSON.stringify(home));
      await assert.rejects(host.runSource("projects", "code-2eab49b1e5cc67bd", "path"), { message: "Choose your home folder in Settings to see your projects" });
      assert.deepEqual(sqlite3.runs, []);
    }
  });

  test("clearing it drops the projects run would use", async () => {
    const sources = await newHelper();
    const sqlite3 = fakeSqlite({ [VSCODE]: VSCODE_LIST });
    const [row] = (await hostWith(sources, sqlite3).list("projects")).rows;
    await hostWith(sources, sqlite3, { preferences: { home: "" } }).list("projects");
    sqlite3.runs.length = 0;
    const host = hostWith(sources, sqlite3, { now: START + 1_000 });
    assert.deepEqual(await host.runSource("projects", row.id, "path"), { text: "/Users/test/dev/site" });
    assert.ok(sqlite3.runs.length > 0, "read again");
  });
});

describe("run", () => {
  async function rowsAndHost(databases, options) {
    const sources = await newHelper();
    const sqlite3 = fakeSqlite(databases);
    const host = hostWith(sources, sqlite3, options);
    const { rows } = await host.list("projects");
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.id]));
    return { sources, sqlite3, host, byTitle };
  }

  test("↵ pastes the path as it is, ⇧↵ the command that opens it", async () => {
    const { host, byTitle } = await rowsAndHost({ [VSCODE]: VSCODE_LIST });
    const both = async (title) => [
      (await host.runSource("projects", byTitle[title], "path")).text,
      (await host.runSource("projects", byTitle[title], "open")).text,
    ];
    assert.deepEqual(await both("site"), ["/Users/test/dev/site", "code /Users/test/dev/site"]);
    assert.deepEqual(await both("shop"), ["/Users/test/dev/shop.code-workspace", "code /Users/test/dev/shop.code-workspace"]);
    assert.deepEqual(await both("it's here"), ["/Users/test/My Projects/it's here", "code '/Users/test/My Projects/it'\\''s here'"]);
    assert.deepEqual(await both("Çalışma Alanı"), ["/Users/test/Masaüstü/Çalışma Alanı", "code '/Users/test/Masaüstü/Çalışma Alanı'"]);
    assert.deepEqual(await both("api"), ["/home/deniz/api", "code --folder-uri vscode-remote://ssh-remote%2Bbuild-box/home/deniz/api"]);
  });

  test("each editor's own command", async () => {
    const one = (name) => withList(folderEntry(`file:///Users/test/dev/${name}`));
    const { host, byTitle } = await rowsAndHost({
      [CURSOR]: one("c"),
      [oldDatabase("Windsurf")]: one("w"),
      [oldDatabase("VSCodium")]: one("v"),
      [oldDatabase("Code - Insiders")]: one("i"),
    });
    const commands = [];
    for (const title of ["c", "w", "v", "i"]) commands.push((await host.runSource("projects", byTitle[title], "open")).text);
    assert.deepEqual(commands, [
      "cursor /Users/test/dev/c", "windsurf /Users/test/dev/w", "codium /Users/test/dev/v", "code-insiders /Users/test/dev/i",
    ]);
  });

  test("a project elsewhere opens by its URI: --folder-uri for a folder, --file-uri for a workspace", async () => {
    const { host, byTitle } = await rowsAndHost({
      [VSCODE]: withList(
        workspaceEntry("vscode-remote://ssh-remote%2Bbox/home/d/team.code-workspace"),
        folderEntry("vscode-vfs://github/ornek/site"),
        folderEntry("vscode-remote://dev-container%2B7b7d/workspaces/it's"),
      ),
    });
    assert.deepEqual(await host.runSource("projects", byTitle.team, "path"), { text: "/home/d/team.code-workspace" });
    assert.deepEqual(await host.runSource("projects", byTitle.team, "open"), { text: "code --file-uri vscode-remote://ssh-remote%2Bbox/home/d/team.code-workspace" });
    assert.deepEqual(await host.runSource("projects", byTitle.site, "path"), { text: "vscode-vfs://github/ornek/site" });
    assert.deepEqual(await host.runSource("projects", byTitle.site, "open"), { text: "code --folder-uri vscode-vfs://github/ornek/site" });
    assert.deepEqual(await host.runSource("projects", byTitle["it's"], "open"), { text: "code --folder-uri 'vscode-remote://dev-container%2B7b7d/workspaces/it'\\''s'" });
  });

  test("the listing's projects are used for five minutes, then read again", async () => {
    const { sources, sqlite3, byTitle } = await rowsAndHost({ [VSCODE]: VSCODE_LIST });
    sqlite3.runs.length = 0;
    const soon = hostWith(sources, sqlite3, { now: START + FIVE_MINUTES });
    assert.deepEqual(await soon.runSource("projects", byTitle.site, "path"), { text: "/Users/test/dev/site" });
    assert.deepEqual(sqlite3.runs, [], "sqlite3 does not run");

    const later = hostWith(sources, sqlite3, { now: START + FIVE_MINUTES + 1 });
    assert.deepEqual(await later.runSource("projects", byTitle.site, "open"), { text: "code /Users/test/dev/site" });
    assert.ok(sqlite3.runs.length > 0, "read again");
  });

  test("a helper started since the listing reads the lists again", async () => {
    const { sqlite3, byTitle } = await rowsAndHost({ [VSCODE]: VSCODE_LIST });
    const host = hostWith(await newHelper(), sqlite3);
    assert.deepEqual(await host.runSource("projects", byTitle.shop, "path"), { text: "/Users/test/dev/shop.code-workspace" });
  });

  test("a project gone from the list says so", async () => {
    const { sources, sqlite3, byTitle } = await rowsAndHost({ [VSCODE]: VSCODE_LIST });
    sqlite3.databases[VSCODE] = withList(folderEntry("file:///Users/test/dev/new"));
    const host = hostWith(sources, sqlite3, { now: START + FIVE_MINUTES + 1 });
    await assert.rejects(host.runSource("projects", byTitle.site, "path"), { message: "This project is no longer in the editor’s recent list." });
  });

  test("an id this source never lists names no project, and reads nothing", async () => {
    const { sqlite3, host } = await rowsAndHost({ [VSCODE]: VSCODE_LIST });
    sqlite3.runs.length = 0;
    for (const rowId of ["", "1", "code-", "code-1d6e1e5fb5d9df0", "code-1D6E1E5FB5D9DF05", "--help", "code-2eab49b1e5cc67bd ", "/Users/test/dev/site"]) {
      await assert.rejects(host.runSource("projects", rowId, "path"), { message: "This project is no longer in the editor’s recent list." }, JSON.stringify(rowId));
    }
    assert.deepEqual(sqlite3.runs, []);
  });

  test("a well-formed id that is not listed reads the lists once and says so", async () => {
    const { sqlite3, host } = await rowsAndHost({ [VSCODE]: VSCODE_LIST });
    sqlite3.runs.length = 0;
    await assert.rejects(host.runSource("projects", "code-0000000000000000", "path"), { message: "This project is no longer in the editor’s recent list." });
    assert.ok(sqlite3.runs.length > 0);
  });
});

describe("helpers", () => {
  const editor = EDITORS[0];

  test("shellWord leaves plain words alone and quotes the rest", () => {
    assert.equal(shellWord("/Users/test/dev/site-2.0_final"), "/Users/test/dev/site-2.0_final");
    assert.equal(shellWord("/Users/test/Masaüstü/Çalışma"), "/Users/test/Masaüstü/Çalışma");
    assert.equal(shellWord("vscode-remote://ssh-remote%2Bbox/a:b,c@d"), "vscode-remote://ssh-remote%2Bbox/a:b,c@d");
    for (const word of ["a b", "it's", "$HOME", "a*", "~/x", "a;b", "a|b", "a&b", "$(x)", "`x`", "a!b", "#a", "a=b", "[a]", "a\\b", "\"a\"", "{a,b}", "a?"]) {
      assert.match(shellWord(word), /^'.*'$/s, word);
    }
    assert.equal(shellWord("it's"), "'it'\\''s'");
    assert.equal(shellWord(""), "''");
  });

  test("withoutTrailingSlashes", () => {
    assert.equal(withoutTrailingSlashes("/a/b///"), "/a/b");
    assert.equal(withoutTrailingSlashes("/"), "/");
    assert.equal(withoutTrailingSlashes("///"), "/");
    assert.equal(withoutTrailingSlashes(""), "");
  });

  test("projectsIn skips files and keeps the order", () => {
    const lines = [folderEntry("file:///a/one"), fileEntry("file:///a/f"), workspaceEntry("file:///a/w.code-workspace")].map((entry) => JSON.stringify(entry));
    assert.deepEqual(projectsIn(lines, editor, HOME).map((project) => [project.kind, project.path]), [["folder", "/a/one"], ["workspace", "/a/w.code-workspace"]]);
  });

  test("merged keeps the first of each project and stops at the cap", () => {
    const project = (path) => projectOf(folderEntry(`file://${path}`), editor, HOME);
    const lists = [[project("/a"), project("/b")], [project("/B"), project("/c")]];
    // "/B" is the second list's newest, "/b" only the first one's second: the same folder, kept where it is newer.
    assert.deepEqual(merged(lists).map((each) => each.path), ["/a", "/B", "/c"]);
    assert.deepEqual(merged(lists, 2).map((each) => each.path), ["/a", "/B"]);
    assert.deepEqual(merged([]), []);
  });

  test("commandOf quotes the path only when it must", () => {
    const project = (uri) => projectOf(folderEntry(uri), editor, HOME);
    assert.equal(commandOf(project("file:///Users/test/dev/site")), "code /Users/test/dev/site");
    assert.equal(commandOf(project("file:///Users/test/a%20b%24c")), "code '/Users/test/a b$c'");
  });
});

describe("long and hostile input", () => {
  // A list call has 10 seconds. Everything here must stay linear, far inside that, on input no real entry has.
  const LIMIT_MS = 500;
  const timed = (work) => {
    const start = performance.now();
    work();
    return performance.now() - start;
  };
  const editor = EDITORS[0];

  test("odd URIs are parsed quickly", () => {
    const n = 50_000;
    const cases = [
      `file:///${"/".repeat(n)}x`,
      `file:///Users/test/${"/".repeat(n)}`,
      `file:///Users/test/${"%".repeat(n)}`,
      `file:///Users/test/${"%41".repeat(n / 10)}`,
      `${"a".repeat(n)}`,
      `${"a".repeat(n)}://x/y`,
      `file:${"/".repeat(n)}`,
      `file:///${"?#".repeat(n / 4)}`,
      `vscode-remote://ssh-remote%2B${"ab".repeat(1000)}/x`,
      `vscode-remote://ssh-remote%2B${"7b".repeat(n / 10)}/x`,
      `vscode-remote://${"+".repeat(n / 10)}/x`,
    ];
    for (const uri of cases) {
      const ms = timed(() => {
        const project = projectOf(folderEntry(uri), editor, HOME);
        if (project !== undefined) commandOf(project);
      });
      assert.ok(ms < LIMIT_MS, `${uri.slice(0, 40)}…: ${ms.toFixed(1)} ms`);
    }
  });

  test("a full list of long, odd names is listed quickly", async () => {
    const names = [" ".repeat(5000), "\u3000".repeat(5000), "'".repeat(5000), "a b".repeat(2000), "/".repeat(5000) + "x"];
    const entries = Array.from({ length: 500 }, (_, index) => folderEntry(`file:///Users/test/${encodeURIComponent(names[index % names.length])}${index}`));
    const sqlite3 = fakeSqlite({ [VSCODE]: withList(...entries), [CURSOR]: withList(...entries) });
    const host = hostWith(await newHelper(), sqlite3);
    const start = performance.now();
    const { rows } = await host.list("projects");
    for (const row of rows.slice(0, 5)) await host.runSource("projects", row.id, "open");
    const ms = performance.now() - start;
    assert.equal(rows.length, 50);
    assert.ok(ms < 2_000, `${ms.toFixed(1)} ms`);
  });
});

describe("everywhere", () => {
  test("nothing is stored, and sqlite3 is the only thing called, always with the call's signal", async () => {
    const sqlite3 = fakeSqlite({ [VSCODE]: VSCODE_LIST });
    const host = hostWith(await newHelper(), sqlite3);
    const signals = [];
    const exec = host.yab.exec;
    host.yab.exec = (tool, args, options) => {
      signals.push(options?.signal);
      return exec(tool, args, options);
    };
    const { rows } = await host.list("projects");
    await host.runSource("projects", rows[0].id, "path");
    await settled(host.runSource("projects", "code-0000000000000000", "open"));
    assert.deepEqual(host.storage, {});
    assert.deepEqual(host.logs, []);
    assert.deepEqual([...new Set(host.calls.map((call) => call.api))], ["exec"]);
    assert.ok(host.calls.every((call) => call.args[0] === "sqlite3"));
    // The listing and the run of an unknown id each read VS Code's old database and the four other editors' old ones,
    // which are not there; the run of a listed row reads nothing.
    assert.equal(signals.length, 2 * 5);
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  });

  test("answers in Turkish", async () => {
    const { listing } = await listed({ [VSCODE]: VSCODE_LIST, [CURSOR]: withList(folderEntry("vscode-remote://dev-container%2B7b7d/w/x"), folderEntry("vscode-remote://tunnel%2Bofis/w/y")) }, { language: "tr" });
    assert.deepEqual(listing.rows.slice(0, 4).map((row) => row.subtitle), [
      "VS Code · ~/dev/site", "Cursor · Geliştirme kapsayıcısı · /w/x", "VS Code · ~/dev/shop.code-workspace", "Cursor · Tünel: ofis · /w/y",
    ]);
    const home = hostWith(await newHelper(), fakeSqlite({}), { language: "tr", preferences: { home: "" } });
    assert.deepEqual(await home.list("projects"), { locked: true, message: "Projelerini görmek için Ayarlar’dan kullanıcı klasörünü seç" });
    const failing = hostWith(await newHelper(), fakeSqlite({ [VSCODE]: CORRUPT }), { language: "tr" });
    await assert.rejects(failing.list("projects"), { message: "Düzenleyicilerin son açılanlar listesi okunamadı." });
    const gone = hostWith(await newHelper(), fakeSqlite({ [VSCODE]: VSCODE_LIST }), { language: "tr" });
    await assert.rejects(gone.runSource("projects", "x", "path"), { message: "Bu proje artık düzenleyicinin son açılanlar listesinde yok." });
    const logged = hostWith(await newHelper(), fakeSqlite({ [VSCODE]: VSCODE_LIST, [CURSOR]: CORRUPT }), { language: "tr" });
    await logged.list("projects");
    assert.deepEqual(logged.logs, ["Cursor: son açılanlar listesi okunamadı, bu yüzden projeleri listede yok."]);
  });

  test("without sqlite3 the column fails as toolMissing, with the manifest's install command", async () => {
    const host = createFakeHost({ folder, sources: await newHelper() });
    await assert.rejects(host.list("projects"), { code: "toolMissing", message: /brew install sqlite/ });
  });

  test("cancelling stops the listing", async () => {
    const host = createFakeHost({ folder, sources: await newHelper(), exec: { sqlite3: () => new Promise(() => {}) } });
    const listing = host.list("projects");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(listing, { code: "cancelled" });
  });

  test("the manifest asks only to run sqlite3, and the source is not sensitive", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.permissions, ["exec"]);
    assert.deepEqual(manifest.requires.tools.map((tool) => tool.name), ["sqlite3"]);
    assert.equal(manifest.network, undefined);
    const [source] = manifest.contributes.sources;
    assert.equal(source.sensitive, undefined);
    assert.deepEqual(source.actions.map((action) => [action.id, action.kind]), [["path", "text"], ["open", "text"]]);
    assert.deepEqual(manifest.preferences, [{ id: "home", type: "folder", title: "home.title", default: "~" }]);
  });
});

describe("the real sqlite3", () => {
  // The fake above answers as sqlite3 does; this checks that claim against the sqlite3 macOS ships, on a synthetic
  // database made for the test in a temporary folder. It never opens an editor's real database.
  const SQLITE = "/usr/bin/sqlite3";
  const skip = process.platform !== "darwin" || !fs.existsSync(SQLITE) ? "needs macOS's /usr/bin/sqlite3" : false;

  async function syntheticDatabase(rows) {
    const { DatabaseSync } = await import("node:sqlite");
    const os = await import("node:os");
    const path = await import("node:path");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recent-projects-"));
    const file = path.join(directory, "With Space", "state.vscdb");
    fs.mkdirSync(path.dirname(file));
    const database = new DatabaseSync(file);
    // The table as VS Code makes it (src/vs/base/parts/storage/node/storage.ts).
    database.exec("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
    const insert = database.prepare("INSERT INTO ItemTable VALUES (?, ?)");
    for (const [key, value] of rows) insert.run(key, value);
    database.close();
    return { directory, file };
  }

  async function sqlite3(file) {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(SQLITE, [...SQLITE_OPTIONS, "--", file, QUERY], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" } });
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  test("prints whether the list is there, then each object entry on a line of its own", { skip }, async () => {
    const entries = [
      folderEntry("file:///Users/test/dev/Masa%C3%BCst%C3%BC%20proje", { label: "two\nlines" }),
      workspaceEntry("file:///Users/test/dev/shop.code-workspace"),
      "not an object",
      fileEntry("file:///Users/test/notes.txt"),
      folderEntry("vscode-remote://ssh-remote%2Bbuild-box/home/deniz/api", { remoteAuthority: "ssh-remote+build-box" }),
    ];
    // Pretty-printed and stored as a BLOB, the two forms a value could take: each entry still prints on one line.
    const value = Buffer.from(JSON.stringify({ entries }, null, 2));
    const { directory, file } = await syntheticDatabase([["history.recentlyOpenedPathsList", value], ["other.key", "x"]]);
    try {
      const result = await sqlite3(file);
      assert.equal(result.exitCode, 0, result.stderr);
      const lines = result.stdout.split("\n").filter((line) => line !== "");
      assert.equal(lines[0], "1");
      assert.deepEqual(lines.slice(1).map((line) => JSON.parse(line)), entries.filter(isObject));
      assert.deepEqual(projectsIn(lines.slice(1), EDITORS[0], HOME).map((project) => project.path), [
        "/Users/test/dev/Masaüstü proje", "/Users/test/dev/shop.code-workspace", "/home/deniz/api",
      ]);
      assert.deepEqual(fs.readdirSync(`${directory}/With Space`), ["state.vscdb"], "nothing is written next to it");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a database without the list prints 0", { skip }, async () => {
    const { directory, file } = await syntheticDatabase([["other.key", "x"]]);
    try {
      const result = await sqlite3(file);
      assert.deepEqual([result.exitCode, result.stdout], [0, "0\n"]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a missing database is 'unable to open database', and is not created", { skip }, async () => {
    const { directory } = await syntheticDatabase([]);
    const missing = `${directory}/Missing/state.vscdb`;
    try {
      const result = await sqlite3(missing);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /unable to open database/);
      assert.equal(fs.existsSync(missing), false);
      assert.equal(fs.existsSync(`${directory}/Missing`), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a file that is not a database fails without 'unable to open database'", { skip }, async () => {
    const { directory } = await syntheticDatabase([]);
    const file = `${directory}/not-a-database`;
    fs.writeFileSync(file, "plain text, not SQLite\n".repeat(100));
    try {
      const result = await sqlite3(file);
      assert.notEqual(result.exitCode, 0);
      assert.doesNotMatch(result.stderr, /unable to open database/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
