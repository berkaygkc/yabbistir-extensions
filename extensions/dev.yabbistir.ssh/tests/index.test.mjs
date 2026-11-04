import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";
import { sources, parseConfig, words, splitLine, includePath } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const DIR = "/Users/test/.ssh";

function hostWith(files, preferences = { folder: DIR }) {
  return createFakeHost({ folder, sources, preferences, files });
}

const CONFIG = `# my servers
Host *
    ServerAliveInterval 60
    User ignored

Host prod-db
    HostName db.example.test
    User deploy
    Port 2222

host=web
  hostname = 10.0.0.5
  USER = admin

Host "quoted" # trailing comment
    HostName "quoted.example.test"

Host a1 a2 wild* !neg ?x
    HostName shared.example.test
    User multi

Match host foo
    HostName should-not-apply.example.test
    User nope

Host bare

Host plain
    HostName plain
`;

describe("parsing", () => {
  test("realConfigShapes", () => {
    const hosts = parseConfig(CONFIG, DIR);
    assert.deepEqual(hosts.map((h) => h.alias), ["prod-db", "web", "quoted", "a1", "a2", "bare", "plain"]);
    assert.deepEqual(hosts[0], { alias: "prod-db", hostName: "db.example.test", user: "deploy", port: "2222" });
    assert.equal(hosts[1].hostName, "10.0.0.5");
    assert.equal(hosts[1].user, "admin");
    assert.equal(hosts[2].hostName, "quoted.example.test");
    assert.equal(hosts[3].user, "multi");
    assert.equal(hosts[4].hostName, "shared.example.test");
  });

  test("matchBlocksAreIgnored", () => {
    const hosts = parseConfig("Host a\n  User one\nMatch all\n  User two\n  Port 99\n", DIR);
    assert.deepEqual(hosts, [{ alias: "a", user: "one" }]);
  });

  test("firstValueWinsAndDuplicatesMerge", () => {
    const hosts = parseConfig("Host a\n User one\nHost a\n User two\n Port 22\n", DIR);
    assert.deepEqual(hosts, [{ alias: "a", user: "one", port: "22" }]);
  });

  test("crlfAndBom", () => {
    const hosts = parseConfig("﻿Host a\r\n  HostName h.example.test\r\n  Port 22\r\n", DIR);
    assert.deepEqual(hosts, [{ alias: "a", hostName: "h.example.test", port: "22" }]);
  });

  test("tokenizer", () => {
    assert.deepEqual(words('a "b c" d#e # f'), ["a", "b c", "d#e"]);
    assert.deepEqual(splitLine("  Host=a b"), { key: "host", args: ["a", "b"] });
    assert.deepEqual(splitLine("Port   =  22"), { key: "port", args: ["22"] });
    assert.equal(splitLine("   # comment"), undefined);
    assert.equal(splitLine("   "), undefined);
  });

  test("unsafeNamesAreSkipped", () => {
    const hosts = parseConfig('Host "a b" "x;y" $(z) -o ok\n  HostName h\n', DIR);
    assert.deepEqual(hosts.map((h) => h.alias), ["ok"]);
  });

  test("includePaths", () => {
    assert.equal(includePath(DIR, "extra"), `${DIR}/extra`);
    assert.equal(includePath(DIR, `${DIR}/a/b`), `${DIR}/a/b`);
    assert.equal(includePath(DIR, "~/.ssh/extra"), `${DIR}/extra`);
    assert.equal(includePath(DIR, "../other"), undefined);
    assert.equal(includePath(DIR, "/etc/passwd"), undefined);
    assert.equal(includePath(DIR, "sub/../../x"), undefined);
    assert.equal(includePath(DIR, "config.d/*"), undefined);
    assert.equal(includePath(DIR, "~/other"), undefined);
    assert.equal(includePath("/Users/test/keys", "~/.ssh/x"), undefined);
  });
});

describe("rows", () => {
  test("titlesAndSubtitles", async () => {
    const host = hostWith({ [`${DIR}/config`]: CONFIG });
    const listing = await host.list("hosts");
    assert.deepEqual(listing.rows.map((r) => [r.id, r.title, r.subtitle]), [
      ["prod-db", "prod-db", "deploy@db.example.test:2222"],
      ["web", "web", "admin@10.0.0.5"],
      ["quoted", "quoted", "quoted.example.test"],
      ["a1", "a1", "multi@shared.example.test"],
      ["a2", "a2", "multi@shared.example.test"],
      ["bare", "bare", undefined],
      ["plain", "plain", undefined],
    ]);
  });

  test("portAndUserOnly", async () => {
    const host = hostWith({ [`${DIR}/config`]: "Host a\n  User u\nHost b\n  Port 2200\n" });
    const rows = (await host.list("hosts")).rows;
    assert.equal(rows[0].subtitle, "u@a");
    assert.equal(rows[1].subtitle, "b:2200");
  });

  test("percentH", async () => {
    const host = hostWith({ [`${DIR}/config`]: "Host box\n  HostName %h.example.test\nHost bad\n  HostName %n.example.test\n" });
    const rows = (await host.list("hosts")).rows;
    assert.equal(rows[0].subtitle, "box.example.test");
    assert.equal(rows[1].subtitle, undefined);
  });
});

describe("actions", () => {
  const files = { [`${DIR}/config`]: CONFIG };

  test("enterPastesTheAlias", async () => {
    const host = hostWith(files);
    assert.deepEqual(await host.runSource("hosts", "prod-db", "alias"), { text: "ssh prod-db" });
    assert.deepEqual(await host.runSource("hosts", "bare", "alias"), { text: "ssh bare" });
  });

  test("shiftEnterPastesTheFullCommand", async () => {
    const host = hostWith(files);
    assert.deepEqual(await host.runSource("hosts", "prod-db", "full"), { text: "ssh deploy@db.example.test -p 2222" });
    assert.deepEqual(await host.runSource("hosts", "web", "full"), { text: "ssh admin@10.0.0.5" });
    assert.deepEqual(await host.runSource("hosts", "bare", "full"), { text: "ssh bare" });
  });

  test("portOnlyUsesTheAlias", async () => {
    const host = hostWith({ [`${DIR}/config`]: "Host b\n  Port 2200\n" });
    assert.deepEqual(await host.runSource("hosts", "b", "full"), { text: "ssh b -p 2200" });
  });

  test("unsafeValuesNeverReachTheLine", async () => {
    const host = hostWith({
      [`${DIR}/config`]: 'Host a\n  HostName "x;rm -rf ~"\n  User "$(id)"\n  Port 22; ls\nHost b\n  Port 99999\n  User -oProxyCommand=x\n',
    });
    assert.deepEqual(await host.runSource("hosts", "a", "full"), { text: "ssh a" });
    assert.deepEqual(await host.runSource("hosts", "b", "full"), { text: "ssh b" });
    const rows = (await host.list("hosts")).rows;
    assert.deepEqual(rows.map((r) => r.subtitle), [undefined, undefined]);
  });

  test("unknownRowIsRefused", async () => {
    const host = hostWith(files);
    await assert.rejects(host.runSource("hosts", "nope; rm -rf", "alias"), { message: "This host is no longer in the SSH config." });
    await assert.rejects(host.runSource("hosts", "*", "alias"), /no longer/);
  });

  test("noLinkOpenedNoNotice", async () => {
    const host = hostWith(files);
    await host.runSource("hosts", "web", "full");
    assert.deepEqual(host.opened, []);
    assert.deepEqual(host.notifications, []);
  });
});

describe("includes", () => {
  test("followsFilesInsideTheFolder", async () => {
    const host = hostWith({
      [`${DIR}/config`]: "Include work\nInclude ~/.ssh/home\nInclude sub/more\nHost main\n  User m\n",
      [`${DIR}/work`]: "Host w1\n  HostName w1.example.test\n",
      [`${DIR}/home`]: "Host h1\n",
      [`${DIR}/sub/more`]: "Host s1\n  Include ../work\n",
    });
    const rows = (await host.list("hosts")).rows;
    assert.deepEqual(rows.map((r) => r.id), ["w1", "h1", "s1", "main"]);
  });

  test("optionsAfterAnIncludeStayWithTheOuterBlock", async () => {
    const host = hostWith({
      [`${DIR}/config`]: "Host a\n  Include extra\n  User outer\n",
      [`${DIR}/extra`]: "Host z\n",
    });
    const rows = (await host.list("hosts")).rows;
    assert.deepEqual(rows.map((r) => [r.id, r.subtitle]), [["a", "outer@a"], ["z", undefined]]);
  });

  test("outsideTheFolderGlobsAndMissingAreSkipped", async () => {
    const host = hostWith({
      [`${DIR}/config`]: "Include /etc/ssh/ssh_config ../outside config.d/* nothere\nHost only\n",
      "/etc/ssh/ssh_config": "Host leaked\n",
      "/Users/test/outside": "Host leaked2\n",
    });
    assert.deepEqual((await host.list("hosts")).rows.map((r) => r.id), ["only"]);
  });

  test("cyclesEnd", async () => {
    const host = hostWith({
      [`${DIR}/config`]: "Include a\nHost m\n",
      [`${DIR}/a`]: "Include b\nHost a1\n",
      [`${DIR}/b`]: "Include a\nInclude config\nHost b1\n",
    });
    assert.deepEqual((await host.list("hosts")).rows.map((r) => r.id), ["b1", "a1", "m"]);
  });

  test("depthIsLimited", async () => {
    const files = { [`${DIR}/config`]: "Include f0\n" };
    for (let i = 0; i < 20; i++) files[`${DIR}/f${i}`] = `Host h${i}\nInclude f${i + 1}\n`;
    const rows = (await hostWith(files).list("hosts")).rows;
    assert.equal(rows.length, 8);
  });
});

describe("empty and failing", () => {
  test("noFolderChosen", async () => {
    const host = createFakeHost({ folder, sources });
    const listing = await host.list("hosts");
    assert.equal(listing.locked, true);
    assert.equal(listing.message, "Choose your SSH folder in Settings");
    const blank = await createFakeHost({ folder, sources, preferences: { folder: "" } }).list("hosts");
    assert.equal(blank.message, "Choose your SSH folder in Settings");
  });

  test("noConfigFile", async () => {
    const listing = await hostWith({}).list("hosts");
    assert.deepEqual(listing, { locked: true, message: "No readable config file in the SSH folder" });
  });

  test("noHosts", async () => {
    const listing = await hostWith({ [`${DIR}/config`]: "Host *\n  User x\n# nothing\n" }).list("hosts");
    assert.deepEqual(listing, { locked: true, message: "No hosts found in the config" });
  });

  test("onlyUnusableNamesSaySo", async () => {
    const listing = await hostWith({ [`${DIR}/config`]: 'Host "my box" -bad\n  User x\n' }).list("hosts");
    assert.deepEqual(listing, { locked: true, message: "No usable hosts: names with spaces or a leading dash are skipped" });
  });

  test("ipv6SubtitleIsBracketed", async () => {
    const listing = await hostWith({ [`${DIR}/config`]: "Host v6\n  HostName ::1\n  User u\n  Port 22\n" }).list("hosts");
    assert.equal(listing.rows[0].subtitle, "u@[::1]:22");
  });

  test("folderNotChosenInSettingsIsNotReadable", async () => {
    // A path in the preference's default grants nothing until the person chooses it.
    const host = createFakeHost({
      folder, sources, files: { [`${DIR}/config`]: "Host a\n" },
      manifest: { preferences: [{ id: "folder", type: "folder", title: "folder.title", default: "~/.ssh" }] },
    });
    const listing = await host.list("hosts");
    assert.equal(listing.locked, true);
  });

  test("tooLargeConfigFails", async () => {
    const host = hostWith({ [`${DIR}/config`]: "#" + "x".repeat(4_100_000) });
    await assert.rejects(host.list("hosts"), { message: "The SSH config could not be read." });
  });

  test("turkish", async () => {
    const host = createFakeHost({ folder, sources, preferences: { folder: DIR }, context: { language: "tr" } });
    assert.equal((await host.list("hosts")).message, "SSH klasöründe okunabilir config dosyası yok");
  });
});

describe("speed and secrets", () => {
  test("largeConfigIsQuick", async () => {
    const lines = [];
    for (let i = 0; i < 5000; i++) lines.push(`Host srv${i}`, `  HostName srv${i}.example.test`, "  User u", "  Port 2200", "# note", "");
    lines.push("Host " + "w".repeat(50_000) + "*", "#" + " ".repeat(50_000));
    const host = hostWith({ [`${DIR}/config`]: lines.join("\n") });
    const started = Date.now();
    const rows = (await host.list("hosts")).rows;
    assert.equal(rows.length, 5000);
    assert.ok(Date.now() - started < 2000, "listing 5000 hosts stays far under the 10 s limit");
  });

  test("adversarialLines", async () => {
    const long = "\"" + "a ".repeat(40_000);
    const host = hostWith({ [`${DIR}/config`]: `Host x\n  HostName ${long}\n  User ${"=".repeat(50_000)}\nHost ${"y".repeat(60_000)}\n` });
    const started = Date.now();
    await host.list("hosts");
    assert.ok(Date.now() - started < 1000);
  });

  test("nothingIsLogged", async () => {
    const host = hostWith({ [`${DIR}/config`]: CONFIG });
    await host.list("hosts");
    await host.runSource("hosts", "prod-db", "full");
    await assert.rejects(host.runSource("hosts", "ghost", "alias"));
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.calls.filter((c) => c.api !== "files.exists"), []);
  });
});
