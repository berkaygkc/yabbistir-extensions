import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { parseListeners, sources } from "../src/index.ts";

const folder = new URL("..", import.meta.url);

/** Synthetic `lsof -nP +c 0 -iTCP -sTCP:LISTEN -F pcun` output: p, c, u per process, then one n per socket. */
const OUTPUT = [
  "p4100", "cnode", "u501", "n127.0.0.1:3000", "n[::1]:3000",
  "p4200", "cvite", "u501", "n*:5173", "n*:5173",
  "p4300", "cpython3.12", "u501", "n[::1]:8080",
  "p4400", "cGoogle\\x20Chrome\\x20Helper", "u501", "n127.0.0.1:9222",
  "p4500", "cControl\\xc3\\x87enter", "u501", "n*:7000",
  "p1", "claunchd", "u0", "n*:22",
  "p4600", "cnode", "u501", "n127.0.0.1:3000",
  "",
].join("\n");

const hostWith = (exec) => createFakeHost({ folder, sources, exec });
const lsof = (result) => ({ lsof: result });
const idle = lsof({ exitCode: 0, stdout: "", stderr: "" });

describe("parsing", () => {
  test("groupsIPv4AndIPv6OfOnePidAndPort", () => {
    const found = parseListeners(OUTPUT).find((entry) => entry.pid === 4100);
    assert.deepEqual(found, { pid: 4100, command: "node", port: 3000, addresses: ["127.0.0.1", "::1"] });
  });

  test("twoWildcardsAreOneAddress", () => {
    assert.deepEqual(parseListeners(OUTPUT).find((entry) => entry.pid === 4200)?.addresses, ["*"]);
  });

  test("decodesEscapedNames", () => {
    const commands = parseListeners(OUTPUT).map((entry) => entry.command);
    assert.ok(commands.includes("Google Chrome Helper"));
    assert.ok(commands.includes("ControlÇenter"));
  });

  test("skipsRootAndKeepsTheSamePortOfAnotherPid", () => {
    const pids = parseListeners(OUTPUT).map((entry) => entry.pid);
    assert.ok(!pids.includes(1));
    assert.deepEqual(pids.filter((pid) => pid === 4100 || pid === 4600), [4100, 4600]);
  });

  test("sortsByPortThenPid", () => {
    const ports = parseListeners(OUTPUT).map((entry) => `${entry.port}:${entry.pid}`);
    assert.deepEqual(ports, ["3000:4100", "3000:4600", "5173:4200", "7000:4500", "8080:4300", "9222:4400"]);
  });

  test("ignoresGarbageAndConnections", () => {
    const text = ["pabc", "cx", "n*:1", "p10", "cok", "u501", "n127.0.0.1:3000->127.0.0.1:5000", "n*:0", "n*:70000", "nnonsense", "n*:80", "\r", "zzz"].join("\n");
    assert.deepEqual(parseListeners(text), [{ pid: 10, command: "ok", port: 80, addresses: ["*"] }]);
    assert.deepEqual(parseListeners(""), []);
  });

  test("anOddCommandNameStaysOnOneLine", () => {
    const [entry] = parseListeners("p9\ncweird\\x09name\\x0a\nu501\nn*:81\n");
    assert.ok(entry && !/[\n\t]/.test(entry.command));
  });
});

describe("list", () => {
  test("showsOneRowPerPidAndPort", async () => {
    const host = hostWith(lsof({ exitCode: 0, stdout: OUTPUT, stderr: "" }));
    const { rows } = await host.list("servers");
    assert.deepEqual(rows, [
      { id: "4100-3000", title: "node · 3000", subtitle: "pid 4100 · 127.0.0.1, ::1" },
      { id: "4600-3000", title: "node · 3000", subtitle: "pid 4600 · 127.0.0.1" },
      { id: "4200-5173", title: "vite · 5173", subtitle: "pid 4200 · all interfaces" },
      { id: "4500-7000", title: "ControlÇenter · 7000", subtitle: "pid 4500 · all interfaces" },
      { id: "4300-8080", title: "python3.12 · 8080", subtitle: "pid 4300 · ::1" },
      { id: "4400-9222", title: "Google Chrome Helper · 9222", subtitle: "pid 4400 · 127.0.0.1" },
    ]);
  });

  test("idsAreStableAndUniqueAcrossListings", async () => {
    const host = hostWith(lsof({ exitCode: 0, stdout: OUTPUT, stderr: "" }));
    const first = (await host.list("servers")).rows.map((row) => row.id);
    const second = (await host.list("servers")).rows.map((row) => row.id);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length);
  });

  test("runsLsofWithFixedArgumentsAndNoShell", async () => {
    const host = hostWith(lsof({ exitCode: 0, stdout: OUTPUT, stderr: "" }));
    await host.list("servers");
    assert.deepEqual(host.calls.filter((call) => call.api === "exec").map((call) => call.args[0]), ["lsof"]);
    const args = host.calls.find((call) => call.api === "exec").args[1];
    assert.ok(args.includes("-sTCP:LISTEN") && args.includes("-iTCP") && args.includes("-nP"));
  });

  test("nothingListeningIsAnEmptyList", async () => {
    const host = hostWith(lsof({ exitCode: 1, stdout: "", stderr: "" }));
    assert.deepEqual(await host.list("servers"), { rows: [] });
  });

  test("exitOneWithOutputStillShowsTheRows", async () => {
    const host = hostWith(lsof({ exitCode: 1, stdout: "p10\ncnode\nu501\nn*:3000\n", stderr: "lsof: WARNING: something" }));
    assert.equal((await host.list("servers")).rows.length, 1);
  });

  test("aFailureSaysSoWithoutToolOutput", async () => {
    const host = hostWith(lsof({ exitCode: 2, stdout: "", stderr: "secret-ish stderr text" }));
    await assert.rejects(host.list("servers"), (error) => error.message === "lsof could not list the servers." && !/secret/.test(error.message));
  });

  test("aMissingToolRejects", async () => {
    const host = createFakeHost({ folder, sources, exec: {} });
    await assert.rejects(host.list("servers"), { code: "toolMissing" });
  });

  test("withoutTheExecPermissionItIsRefused", async () => {
    const host = createFakeHost({ folder, sources, manifest: { permissions: [] }, exec: lsof({ exitCode: 0, stdout: "", stderr: "" }) });
    await assert.rejects(host.list("servers"), { code: "permissionDenied" });
  });

  test("aLargeListingIsReadInFull", async () => {
    let text = "";
    for (let pid = 1000; pid < 3000; pid++) text += `p${pid}\ncnode\nu501\nn127.0.0.1:${pid + 2000}\n`;
    const { rows } = await hostWith(lsof({ exitCode: 0, stdout: text, stderr: "" })).list("servers");
    assert.equal(rows.length, 2000);
  });

  test("longAdversarialInputIsFast", () => {
    const text = `p5\nc${"a".repeat(50000)}\nu501\nn${"[".repeat(50000)}:1\nn${"1.".repeat(30000)}:2\n`;
    const started = Date.now();
    parseListeners(text);
    assert.ok(Date.now() - started < 1000);
  });

  test("manyEscapesInACommandNameAreFast", () => {
    const text = `p5\nc${"\\x41".repeat(50000)}\nu501\nn127.0.0.1:1\n`;
    const started = Date.now();
    parseListeners(text);
    assert.ok(Date.now() - started < 1000);
  });
});

describe("run", () => {
  test("enterPastesTheLocalhostLink", async () => {
    assert.deepEqual(await hostWith(idle).runSource("servers", "4100-3000", "url"), { text: "http://localhost:3000" });
  });

  test("shiftEnterPastesTheAddressAndStopsNothing", async () => {
    const host = hostWith(idle);
    assert.deepEqual(await host.runSource("servers", "4100-3000", "address"), { text: "localhost:3000" });
    assert.equal(host.calls.filter((call) => call.api === "exec").length, 0, "no kill, no tool at all");
  });

  test("anIdThatIsNotOursNeverBecomesAPaste", async () => {
    for (const id of ["", "3000", "abc-80", "1-0", "1-70000", "1-80; rm", "1-80\n", "-80"]) {
      await assert.rejects(hostWith(idle).runSource("servers", id, "url"), { message: "This server is no longer listed." }, id);
    }
  });

  test("anUnknownActionIdPastesNothing", async () => {
    await assert.rejects(hostWith(idle).runSource("servers", "4100-3000", "kill"), { message: "This server is no longer listed." });
  });

  test("nothingLandsInLogsOrNotices", async () => {
    const host = hostWith(lsof({ exitCode: 0, stdout: OUTPUT, stderr: "" }));
    await host.list("servers");
    await host.runSource("servers", "4100-3000", "url");
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.notifications, []);
  });
});
