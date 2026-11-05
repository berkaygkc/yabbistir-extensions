import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { AUTO_UPDATE, OUTDATED, TOKEN, UPGRADE_ALL, cask, fakeBrew, formula, hostWith, newHelper, ok, outdatedJSON, upgrading, visibleTexts } from "./fixtures.mjs";

const upgradeOf = (host, exports) => host.run(exports.actions.upgradeAll, null);

describe("upgrade all outdated packages", () => {
  test("checks what is outdated, runs brew upgrade, and names what it upgraded", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON({ formulae: [formula("node", "22.11.0", "23.3.0"), formula("jq", "1.7", "1.7.1")], casks: [] })), upgrade: ok(upgrading("jq", "node")) });
    const host = hostWith(exports, brew);
    assert.deepEqual(await upgradeOf(host, exports), { none: true, message: "Upgraded jq and node." }, "in the order brew went");
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"], ["upgrade"]]);
  });

  test("the bar moves a step for each package brew starts, pinned ones left out", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)), upgrade: ok(UPGRADE_ALL) }));
    // Four formulae (one pinned) and two casks: five to upgrade.
    assert.deepEqual(await upgradeOf(host, exports), { none: true, message: "Upgraded 5 packages." });
    assert.deepEqual(host.progress, [
      { fraction: null, message: "Checking for updates" },
      { fraction: null, message: "Downloading" },
      { fraction: 0, message: "1 / 5 · node" },
      { fraction: 0.2, message: "2 / 5 · ornek/tap/aracim" },
      { fraction: 0.4, message: "3 / 5 · docker" },
      { fraction: 0.6, message: "4 / 5 · firefox" },
      { fraction: 0.8, message: "5 / 5 · docker" },
      { fraction: 1, message: "5 / 5" },
    ]);
  });

  test("a step counts once, and a package brew names by its short name still counts", async () => {
    const exports = await newHelper();
    const stdout = ["==> Upgrading aracim", "==> Upgrading aracim", "==> Upgrading 2 dependents of upgraded formulae:", "==> Upgrading libuv", "==> Upgrading node"].join("\n");
    const outdated = outdatedJSON({ formulae: [formula("ornek/tap/aracim", "0.9.0", "1.0.0"), formula("node", "22.11.0", "23.3.0")] });
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdated), upgrade: ok(stdout) }));
    await upgradeOf(host, exports);
    assert.deepEqual(host.progress.map((entry) => entry.message), ["Checking for updates", "1 / 2 · ornek/tap/aracim", "2 / 2 · node", "2 / 2"]);
  });

  test("the auto-update on the way shows as its own step", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON({ formulae: [formula("jq", "1.7", "1.7.1")] }), AUTO_UPDATE), upgrade: ok() }));
    await upgradeOf(host, exports);
    assert.deepEqual(host.progress.slice(0, 2).map((entry) => entry.message), ["Checking for updates", "Updating Homebrew"]);
  });

  test("nothing outdated: brew upgrade never runs", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON()), upgrade: ok() });
    const host = hostWith(exports, brew);
    assert.deepEqual(await upgradeOf(host, exports), { none: true, message: "Everything is up to date." });
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"]]);
  });

  test("only pinned packages outdated: brew upgrade never runs", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON({ formulae: [formula("python@3.12", "3.12.7", "3.12.8", { pinned: true })], casks: [cask("firefox", "133.0", "133.0.3", { pinned: true })] })), upgrade: ok() });
    const host = hostWith(exports, brew);
    assert.deepEqual(await upgradeOf(host, exports), { none: true, message: "Only pinned packages are outdated. brew upgrade leaves them as they are." });
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"]]);
  });

  test("in Turkish", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)), upgrade: ok(UPGRADE_ALL) }), { language: "tr" });
    assert.deepEqual(await upgradeOf(host, exports), { none: true, message: "5 paket güncellendi." });
    assert.equal(host.progress[0].message, "Güncellemeler denetleniyor");
    const few = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON({ formulae: [formula("node", "1", "2"), formula("jq", "1", "2")] })), upgrade: ok(upgrading("node", "jq")) }), { language: "tr" });
    assert.deepEqual(await upgradeOf(few, exports), { none: true, message: "node ve jq güncellendi." });
    const skipped = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON({ formulae: [formula("node", "1", "2"), formula("jq", "1", "2")] })), upgrade: ok(upgrading("node")) }), { language: "tr" });
    assert.deepEqual(await upgradeOf(skipped, exports),
      { none: true, message: "node güncellendi. Güncellenmedi: jq. Nedenini görmek için brew upgrade komutunu Terminal’de çalıştır." });
  });

  test("a package brew leaves out without failing is named as not upgraded", async () => {
    // brew can skip a cask, or find one upgraded meanwhile, and still exit 0: the notice follows what it started.
    const exports = await newHelper();
    const outdated = ok(outdatedJSON({ formulae: [formula("node", "22.11.0", "23.3.0"), formula("jq", "1.7", "1.7.1")], casks: [cask("firefox", "133.0", "133.0.3")] }));
    const host = hostWith(exports, fakeBrew({ outdated, upgrade: ok(upgrading("node", "jq"), `Warning: ${TOKEN}\n`) }));
    assert.deepEqual(await upgradeOf(host, exports),
      { none: true, message: "Upgraded node and jq. Not upgraded: firefox. Run brew upgrade in Terminal to see why." });
    assert.deepEqual(host.progress.at(-1), { fraction: 1 / 3, message: "2 / 3 · jq" }, "the bar never claims the third");
    assert.ok(!visibleTexts(host).some((line) => line.includes(TOKEN)));
  });

  test("brew upgrading none of them says so", async () => {
    const exports = await newHelper();
    const outdated = ok(outdatedJSON({ formulae: [formula("node", "22.11.0", "23.3.0")], casks: [cask("docker", "4.36.0", "4.37.0")] }));
    const host = hostWith(exports, fakeBrew({ outdated, upgrade: ok("==> Upgrading 0 outdated packages:\n") }));
    assert.deepEqual(await upgradeOf(host, exports),
      { none: true, message: "Not upgraded: node and docker. Run brew upgrade in Terminal to see why." });
    assert.deepEqual(host.progress, [{ fraction: null, message: "Checking for updates" }]);
  });
});

describe("upgrade failures", () => {
  async function failure(brew) {
    const exports = await newHelper();
    const host = hostWith(exports, brew);
    let message;
    await assert.rejects(upgradeOf(host, exports), (error) => {
      message = error.message;
      return true;
    });
    return { message, host };
  }
  const outdated = ok(outdatedJSON({ formulae: [formula("node", "22.11.0", "23.3.0")] }));

  test("brew upgrade failing names the exit code, never brew's words", async () => {
    const { message, host } = await failure(fakeBrew({ outdated, upgrade: { exitCode: 1, stdout: "", stderr: `Error: node: ${TOKEN}\n` } }));
    assert.equal(message, "brew upgrade stopped with exit code 1. Run it in Terminal to see why.");
    assert.ok(!visibleTexts(host).some((line) => line.includes(TOKEN)));
    assert.deepEqual(host.logs, []);
  });

  test("known causes in the person's words", async () => {
    const cases = [
      ["Error: A `brew upgrade` process has already locked /opt/homebrew/var/homebrew/locks/node.formula.lock.\n", "Another Homebrew command is running. Try again when it’s done."],
      ["curl: (6) Could not resolve host: ghcr.io\n", "Homebrew couldn’t download. Check your connection and try again."],
      ["sudo: a terminal is required to read the password\n", "This installer asks for your password, which works only in Terminal. Run the command there."],
    ];
    for (const [stderr, expected] of cases) {
      assert.equal((await failure(fakeBrew({ outdated, upgrade: { exitCode: 1, stdout: "", stderr } }))).message, expected);
    }
  });

  test("brew outdated failing stops before any upgrade", async () => {
    const brew = fakeBrew({ outdated: { exitCode: 1, stdout: "", stderr: `Error: ${TOKEN}\n` }, upgrade: ok() });
    const { message, host } = await failure(brew);
    assert.equal(message, "Homebrew couldn’t list your outdated packages.");
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"]]);
    assert.ok(!visibleTexts(host).some((line) => line.includes(TOKEN)));
  });

  test("output that is not brew's JSON stops before any upgrade", async () => {
    const brew = fakeBrew({ outdated: ok("node (22.11.0) < 23.3.0\n"), upgrade: ok() });
    assert.equal((await failure(brew)).message, "Homebrew couldn’t list your outdated packages.");
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"]]);
  });
});

describe("cancelling the upgrade", () => {
  test("while brew upgrade runs: it stops and the cancel goes through", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)), upgrade: () => new Promise(() => {}) }));
    const running = upgradeOf(host, exports);
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("while brew checks what is outdated", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: () => new Promise(() => {}), upgrade: ok() });
    const host = hostWith(exports, brew);
    const running = upgradeOf(host, exports);
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"]], "brew upgrade never starts");
  });

  test("an upgrade drops the cached list", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)), upgrade: ok() });
    const host = hostWith(exports, brew);
    await host.list("outdated");
    await upgradeOf(host, exports);
    await host.list("outdated");
    assert.equal(brew.runs.filter((args) => args[0] === "outdated").length, 3, "list, upgrade's own check, list again");
  });
});
