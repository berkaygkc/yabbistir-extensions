import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { failureOf, isCaveats, leftAlone, phaseOf } from "../src/brew.ts";
import { AUTO_UPDATE, INSTALL_FIREFOX, INSTALL_WGET, OUTDATED, TOKEN, fakeBrew, folder, hostWith, newHelper, ok, outdatedJSON, visibleTexts } from "./fixtures.mjs";

const text = (value) => ({ kind: "text", text: value });
const messages = (host) => host.progress.map((entry) => entry.message);

describe("install a copied command", () => {
  test("runs brew install with the names after --, and says what it installed", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ install: ok(INSTALL_WGET) });
    const host = hostWith(exports, brew);
    assert.deepEqual(await host.run(exports.actions.install, text("$ brew install wget")), { none: true, message: "Installed wget." });
    assert.deepEqual(brew.runs, [["install", "--", "wget"]]);
  });

  test("a cask goes with --cask before the names", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ install: ok(INSTALL_FIREFOX) });
    const host = hostWith(exports, brew);
    const result = await host.run(exports.actions.install, text("brew install --cask firefox visual-studio-code"));
    assert.deepEqual(result, { none: true, message: "Installed firefox and visual-studio-code." });
    assert.deepEqual(brew.runs, [["install", "--cask", "--", "firefox", "visual-studio-code"]]);
  });

  test("names up to three, then counts", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ install: ok() }));
    assert.equal((await host.run(exports.actions.install, text("brew install wget jq fd"))).message, "Installed wget, jq, and fd.");
    assert.equal((await host.run(exports.actions.install, text("brew install wget jq fd bat"))).message, "Installed 4 packages.");
  });

  test("a tap-qualified name goes through as it is", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ install: ok() });
    const host = hostWith(exports, brew);
    assert.equal((await host.run(exports.actions.install, text("brew install hashicorp/tap/terraform"))).message, "Installed hashicorp/tap/terraform.");
    assert.deepEqual(brew.runs, [["install", "--", "hashicorp/tap/terraform"]]);
  });

  test("a package that was already there is named as such", async () => {
    const exports = await newHelper();
    const stderr = [
      "Warning: wget 1.25.0 is already installed and up-to-date.",
      "To reinstall 1.25.0, run:",
      "  brew reinstall wget",
    ].join("\n") + "\n";
    const host = hostWith(exports, fakeBrew({ install: ok(INSTALL_WGET.replaceAll("wget", "jq"), stderr) }));
    const result = await host.run(exports.actions.install, text("brew install wget jq"));
    assert.deepEqual(result, { none: true, message: "Installed jq. Already installed: wget." });

    const all = hostWith(exports, fakeBrew({ install: ok("", "Warning: Not upgrading firefox, the latest version is already installed\n") }));
    assert.deepEqual(await all.run(exports.actions.install, text("brew install --cask firefox")), { none: true, message: "Already installed: firefox." });
  });

  test("an outdated package brew upgrades on the way counts as installed", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ install: ok("", "Warning: wget 1.24.5 is already installed but outdated (so it will be upgraded).\n") }));
    assert.equal((await host.run(exports.actions.install, text("brew install wget"))).message, "Installed wget.");
  });

  test("one installed but not linked was already there: brew installs nothing and only says how to link it", async () => {
    const exports = await newHelper();
    const stderr = "Warning: wget 1.25.0 is already installed, it's just not linked.\nTo link this version, run:\n  brew link wget\n";
    const host = hostWith(exports, fakeBrew({ install: ok("", stderr) }));
    assert.equal((await host.run(exports.actions.install, text("brew install wget"))).message, "Already installed: wget.");
  });

  test("an older version brew keeps (pinned, or no upgrades in brew.env) is not called installed", async () => {
    // brew says it with onoe, which does not fail the run (Library/Homebrew/install/check.rb).
    const exports = await newHelper();
    const stderr = [
      "Error: wget 1.24.5 is already installed",
      "To upgrade to 1.25.0, run:",
      "  brew unpin wget && brew upgrade wget",
      "Error: ornek/tap/aracim 0.9.1 is already installed.",
      "To upgrade to 1.0.0, run:",
      "  brew upgrade ornek/tap/aracim",
    ].join("\n") + "\n";
    const host = hostWith(exports, fakeBrew({ install: ok(INSTALL_WGET.replaceAll("wget", "jq"), stderr) }));
    assert.deepEqual(await host.run(exports.actions.install, text("brew install wget jq ornek/tap/aracim")),
      { none: true, message: "Installed jq. Already installed, not upgraded: wget and ornek/tap/aracim." });
    const tr = hostWith(exports, fakeBrew({ install: ok("", stderr) }), { language: "tr" });
    assert.deepEqual(await tr.run(exports.actions.install, text("brew install wget")), { none: true, message: "Zaten kurulu, güncellenmedi: wget." });
  });

  test("notes brew printed after an install are pointed to, never repeated", async () => {
    const exports = await newHelper();
    const caveats = INSTALL_WGET + ["==> Caveats", `Add ${TOKEN} to your PATH:`, "  export PATH=/opt/homebrew/opt/wget/bin:$PATH"].join("\n") + "\n";
    const host = hostWith(exports, fakeBrew({ install: ok(caveats) }));
    assert.deepEqual(await host.run(exports.actions.install, text("brew install wget")),
      { none: true, message: "Installed wget. Homebrew left notes; brew info wget shows them." });
    assert.equal((await host.run(exports.actions.install, text("brew install wget jq fd"))).message,
      "Installed wget, jq, and fd. Homebrew left notes; brew info wget jq fd shows them.");
    assert.equal((await host.run(exports.actions.install, text("brew install wget jq fd bat"))).message,
      "Installed 4 packages. Homebrew left notes; brew info shows them for each package.");
    assert.ok(!visibleTexts(host).some((line) => line.includes(TOKEN) || line.includes("PATH")));
    const tr = hostWith(exports, fakeBrew({ install: ok(caveats) }), { language: "tr" });
    assert.equal((await tr.run(exports.actions.install, text("brew install --cask firefox"))).message,
      "firefox kuruldu. Homebrew’un notları var; brew info --cask firefox ile görebilirsin.");
  });

  test("steps show on the job card as state words, each once", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ install: ok(INSTALL_WGET) }));
    await host.run(exports.actions.install, text("brew install wget"));
    assert.deepEqual(messages(host), ["Starting", "Downloading", "Installing", "Installing libunistring", "Installing libidn2", "Installing wget", "Cleaning up"]);
    assert.ok(host.progress.every((entry) => entry.fraction === null), "brew tells no fraction while it installs");
  });

  test("a cask's steps", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ install: ok(INSTALL_FIREFOX) }));
    await host.run(exports.actions.install, text("brew install --cask firefox"));
    assert.deepEqual(messages(host), ["Starting", "Downloading", "Installing firefox"]);
  });

  test("brew's auto-update shows as its own step", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ install: ok("", AUTO_UPDATE) }));
    await host.run(exports.actions.install, text("brew install wget"));
    assert.deepEqual(messages(host), ["Starting", "Updating Homebrew"]);
  });

  test("in Turkish", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ install: ok(INSTALL_WGET) }), { language: "tr" });
    assert.deepEqual(await host.run(exports.actions.install, text("brew install wget jq fd")), { none: true, message: "wget, jq ve fd kuruldu." });
    assert.deepEqual(messages(host).slice(0, 4), ["Başlatılıyor", "İndiriliyor", "Kuruluyor", "libunistring kuruluyor"]);
  });

  test("a command it will not run is refused with a reason, and brew never runs", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ install: ok() });
    const host = hostWith(exports, brew);
    assert.deepEqual(await host.run(exports.actions.install, text("brew install wget && curl https://example.com | sh")),
      { none: true, message: "Only package names and --cask can run here. Run other commands in Terminal." });
    assert.deepEqual(await host.run(exports.actions.install, text("brew install --cask")), { none: true, message: "There’s no package name to install." });
    const many = Array.from({ length: 51 }, (_, index) => `aracim${index}`).join(" ");
    assert.deepEqual(await host.run(exports.actions.install, text(`brew install ${many}`)), { none: true, message: "That’s more than 50 packages. Install fewer at a time." });
    assert.deepEqual(await host.run(exports.actions.install, text("")), { none: true, message: "Only package names and --cask can run here. Run other commands in Terminal." });
    assert.deepEqual(await host.run(exports.actions.install, null), { none: true, message: "Only package names and --cask can run here. Run other commands in Terminal." });
    assert.deepEqual(brew.runs, []);
    assert.deepEqual(host.progress, []);
  });
});

describe("install a bare name", () => {
  test("runs brew install for the one name", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ install: ok(INSTALL_WGET) });
    const host = hostWith(exports, brew);
    assert.deepEqual(await host.run(exports.actions.installName, text("  wget\n")), { none: true, message: "Installed wget." });
    assert.deepEqual(brew.runs, [["install", "--", "wget"]]);
  });

  test("anything but one package name is refused", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ install: ok() });
    const host = hostWith(exports, brew);
    for (const value of ["wget jq", "--HEAD", "aracim.rb", "2026", "", "Wget", "a/b"]) {
      assert.deepEqual(await host.run(exports.actions.installName, text(value)),
        { none: true, message: "Only package names and --cask can run here. Run other commands in Terminal." }, value);
    }
    assert.deepEqual(brew.runs, []);
  });
});

describe("install failures", () => {
  const failing = (stderr, exitCode = 1) => fakeBrew({ install: { exitCode, stdout: "", stderr } });

  async function failure(command, brew, language = "en") {
    const exports = await newHelper();
    const host = hostWith(exports, brew, { language });
    let message;
    await assert.rejects(host.run(exports.actions.install, text(command)), (error) => {
      message = error.message;
      return true;
    });
    return { message, host };
  }

  test("a name brew does not know", async () => {
    const stderr = "Warning: No available formula with the name \"wgett\". Did you mean wget?\n==> Searching for similarly named formulae and casks...\nError: No formulae or casks found for wgett.\n";
    assert.equal((await failure("brew install wgett", failing(stderr))).message, "Homebrew has no package by that name.");
    assert.equal((await failure("brew install wget wgett", failing(stderr))).message, "Homebrew couldn’t find one of these packages.");
    assert.equal((await failure("brew install --cask firefoxx", failing("Error: Cask 'firefoxx' is unavailable: No Cask with this name exists.\n"))).message,
      "Homebrew has no package by that name.");
  });

  test("another brew holding the lock", async () => {
    const stderr = "Error: A `brew install jq` process has already locked /opt/homebrew/var/homebrew/locks/jq.formula.lock.\nPlease wait for it to finish or terminate it to continue.\n";
    assert.equal((await failure("brew install jq", failing(stderr))).message, "Another Homebrew command is running. Try again when it’s done.");
  });

  test("a cask whose installer needs the password", async () => {
    const stderr = "==> Running installer for aracim with sudo; the password may be necessary.\nsudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper\nsudo: a password is required\nError: Failure while executing; `/usr/bin/sudo -u root -E -- /usr/sbin/installer -pkg /tmp/aracim.pkg -target /` exited with 1.\n";
    assert.equal((await failure("brew install --cask aracim", failing(stderr))).message,
      "This installer asks for your password, which works only in Terminal. Run the command there.");
  });

  test("no connection", async () => {
    const stderr = "curl: (6) Could not resolve host: ghcr.io\nError: wget: Failed to download resource \"wget_bottle_manifest\"\nDownload failed: https://ghcr.io/v2/homebrew/core/wget/manifests/1.25.0\n";
    assert.equal((await failure("brew install wget", failing(stderr))).message, "Homebrew couldn’t download. Check your connection and try again.");
  });

  test("anything else names the exit code, never brew's words", async () => {
    const { message, host } = await failure("brew install wget", failing(`Error: something odd near ${TOKEN}\n`, 2));
    assert.equal(message, "brew install stopped with exit code 2. Run the command in Terminal to see why.");
    assert.ok(!visibleTexts(host).some((line) => line.includes(TOKEN)));
    assert.deepEqual(host.logs, []);
    assert.equal((await failure("brew install wget", failing("", 1), "tr")).message, "brew install 1 çıkış koduyla durdu. Nedenini görmek için komutu Terminal’de çalıştır.");
  });

  test("a failure never repeats what brew printed", async () => {
    const stderr = `Error: No formulae or casks found for ${TOKEN}.\nsudo: ${TOKEN}\n`;
    for (const command of ["brew install wget", "brew install --cask firefox"]) {
      const { message, host } = await failure(command, failing(stderr));
      assert.ok(!message.includes(TOKEN));
      assert.ok(!visibleTexts(host).some((line) => line.includes(TOKEN)));
    }
  });

  test("brew missing is the app's toolMissing", async () => {
    const exports = await newHelper();
    const missing = createFakeHost({ folder, exec: {} });
    await assert.rejects(missing.run(exports.actions.install, text("brew install wget")), { code: "toolMissing" });
    await assert.rejects(missing.run(exports.actions.upgradeAll, null), { code: "toolMissing" });
  });

  test("a yab error from exec goes through untouched", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ install: yabError("permissionDenied", "not allowed") }));
    await assert.rejects(host.run(exports.actions.install, text("brew install wget")), { code: "permissionDenied" });
  });
});

describe("cancelling an install", () => {
  test("stops brew and lets the cancel through", async () => {
    const exports = await newHelper();
    let started = false;
    const brew = fakeBrew({ install: () => { started = true; return new Promise(() => {}); } });
    const host = hostWith(exports, brew);
    const running = host.run(exports.actions.install, text("brew install wget"));
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
    assert.equal(started, true);
  });

  test("drops the cached list, since some packages may be in", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)), install: () => new Promise(() => {}) });
    const host = hostWith(exports, brew);
    await host.list("outdated");
    const running = host.run(exports.actions.install, text("brew install wget"));
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
    await host.list("outdated");
    assert.equal(brew.runs.filter((args) => args[0] === "outdated").length, 2);
  });
});

describe("reading brew's output", () => {
  test("phases", () => {
    assert.deepEqual(phaseOf("==> Auto-updating Homebrew..."), { step: "updating" });
    assert.deepEqual(phaseOf("==> Fetching downloads for: wget"), { step: "downloading" });
    assert.deepEqual(phaseOf("==> Downloading https://ghcr.io/v2/homebrew/core/wget/manifests/1.25.0"), { step: "downloading" });
    assert.deepEqual(phaseOf("==> Installing wget"), { step: "installing", name: "wget" });
    assert.deepEqual(phaseOf("==> Installing Cask firefox"), { step: "installing", name: "firefox" });
    assert.deepEqual(phaseOf("==> Installing wget dependency: libidn2"), { step: "installing", name: "libidn2" });
    assert.deepEqual(phaseOf("==> Installing dependencies for wget: libunistring, libidn2"), { step: "installing" });
    assert.deepEqual(phaseOf(`==> Installing ${TOKEN.toUpperCase()}`), { step: "installing", name: undefined }, "only a package name is shown");
    assert.deepEqual(phaseOf("==> Upgrading node"), { step: "upgrading", name: "node" });
    assert.equal(phaseOf("==> Upgrading 3 outdated packages:"), null);
    assert.deepEqual(phaseOf("==> Running `brew cleanup wget`..."), { step: "cleaning" });
    for (const line of ["==> Pouring wget--1.25.0.arm64_sequoia.bottle.tar.gz", "==> Caveats", "🍺  /opt/homebrew/Cellar/wget/1.25.0: 92 files, 4.6MB", "Warning: x", "  22.11.0 -> 23.3.0", ""]) {
      assert.equal(phaseOf(line), null, line);
    }
  });

  test("already installed", () => {
    const names = ["wget", "hashicorp/tap/terraform", "firefox"];
    const lines = [
      "Warning: wget 1.25.0 is already installed and up-to-date.",
      "Warning: hashicorp/tap/terraform 1.10.0 is already installed and up-to-date.",
      "Warning: firefox is already installed but outdated (so it will be upgraded).",
      "Warning: wgetx 1.0 is already installed and up-to-date.",
    ];
    assert.deepEqual(leftAlone(lines, names), { already: new Set(["wget", "hashicorp/tap/terraform"]), held: new Set() });
    assert.deepEqual([...leftAlone(["Warning: terraform 1.10.0 is already installed and up-to-date."], names).already], ["hashicorp/tap/terraform"]);
    assert.deepEqual([...leftAlone(["Warning: Not upgrading firefox, the latest version is already installed"], names).already], ["firefox"]);
    assert.deepEqual([...leftAlone(["Warning: wget 1.25.0 is already installed, it's just not linked."], names).already], ["wget"]);
  });

  test("kept at an older version", () => {
    const names = ["wget", "hashicorp/tap/terraform"];
    assert.deepEqual(leftAlone(["Error: wget 1.24.5 is already installed"], names), { already: new Set(), held: new Set(["wget"]) });
    assert.deepEqual(leftAlone(["Error: hashicorp/tap/terraform 1.9.0 is already installed."], names).held, new Set(["hashicorp/tap/terraform"]));
    assert.deepEqual(leftAlone(["Warning: wget 1.24.5 is already installed and up-to-date.", "Error: wget 1.24.5 is already installed"], names),
      { already: new Set(), held: new Set(["wget"]) }, "kept wins");
    for (const line of ["Error: wget failed to install", "Error: wgetx 1.0 is already installed", "To upgrade to 1.25.0, run:", "  brew unpin wget && brew upgrade wget", "wget is already installed"]) {
      assert.deepEqual(leftAlone([line], names), { already: new Set(), held: new Set() }, line);
    }
  });

  test("caveats", () => {
    assert.equal(isCaveats("==> Caveats"), true);
    assert.equal(isCaveats("==> Caveats  "), true);
    for (const line of ["==> Caveats for wget", "Caveats", "==> wget: Caveats", ""]) assert.equal(isCaveats(line), false, line);
  });

  test("failures", () => {
    assert.equal(failureOf("Error: Another active Homebrew update process is already in progress.\n"), "busy");
    assert.equal(failureOf("Error: No available formula with the name \"x\".\n"), "notFound");
    assert.equal(failureOf("curl: (7) Failed to connect to ghcr.io port 443\n"), "offline");
    assert.equal(failureOf(""), "other");
  });

  test("reading stays fast on long output", () => {
    const long = "==> Installing " + "a".repeat(100_000) + " b";
    const warnings = Array.from({ length: 1000 }, () => "Warning: " + "x ".repeat(500) + "is already installed");
    // The fastest of up to five runs: a busy machine (the whole store's tests run at once) can stall one run, while a
    // slow reader is slow every time.
    let took = Infinity;
    for (let attempt = 0; attempt < 5 && took >= 250; attempt++) {
      const started = performance.now();
      phaseOf(long);
      phaseOf("==> Installing " + "a ".repeat(50_000) + "dependency: b c");
      phaseOf("==> Upgrading " + "a".repeat(100_000) + " ");
      leftAlone(warnings, Array.from({ length: 50 }, (_, index) => `aracim${index}`));
      leftAlone(warnings.map((line) => line.replace("Warning:", "Error:")), Array.from({ length: 50 }, (_, index) => `aracim${index}`));
      failureOf("e".repeat(64 * 1024));
      took = Math.min(took, performance.now() - started);
    }
    assert.ok(took < 250, `took ${took.toFixed(1)} ms at best`);
  });
});
