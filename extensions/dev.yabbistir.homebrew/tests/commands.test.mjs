import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { MAX_NAMES, installArguments, isBareName, isPackageName, parseInstallCommand } from "../src/brew.ts";
import { folder } from "./fixtures.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const accepts = Object.fromEntries(manifest.contributes.actions.filter((action) => action.accepts).map((action) => [action.id, action.accepts]));
const host = createFakeHost({ folder });
const text = (value) => ({ kind: "text", text: value });
const TERMINAL = { bundleID: "com.apple.Terminal", name: "Terminal", kind: "terminal" };
const BROWSER = { bundleID: "com.apple.Safari", name: "Safari", kind: "browser" };
const offers = (value, kind = "text", target = null) => host.offers({ kind, text: value }, { target });

describe("parseInstallCommand", () => {
  const allowed = [
    ["brew install wget", { cask: false, names: ["wget"] }],
    ["  brew install wget  \n", { cask: false, names: ["wget"] }],
    ["$ brew install wget", { cask: false, names: ["wget"] }],
    ["% brew install wget", { cask: false, names: ["wget"] }],
    ["brew  install\twget", { cask: false, names: ["wget"] }],
    ["brew install wget jq ripgrep", { cask: false, names: ["wget", "jq", "ripgrep"] }],
    ["brew install jq jq", { cask: false, names: ["jq"] }],
    ["brew install --cask firefox", { cask: true, names: ["firefox"] }],
    ["brew install firefox --cask", { cask: true, names: ["firefox"] }],
    ["brew install --cask firefox visual-studio-code", { cask: true, names: ["firefox", "visual-studio-code"] }],
    ["brew install --cask firefox@developer-edition", { cask: true, names: ["firefox@developer-edition"] }],
    ["brew install python@3.12 node@22 openssl@3", { cask: false, names: ["python@3.12", "node@22", "openssl@3"] }],
    ["brew install gtk+3 libsigc++@2 sdl2_mixer c-ares", { cask: false, names: ["gtk+3", "libsigc++@2", "sdl2_mixer", "c-ares"] }],
    ["brew install hashicorp/tap/terraform", { cask: false, names: ["hashicorp/tap/terraform"] }],
    ["brew install Ornek-Kisi/ornek_tap/aracim", { cask: false, names: ["Ornek-Kisi/ornek_tap/aracim"] }],
    ["brew install \\\n  wget \\\n  jq", { cask: false, names: ["wget", "jq"] }],
    ["brew install wget \\\r\n  jq", { cask: false, names: ["wget", "jq"] }],
    ["brew install 1password-cli", { cask: false, names: ["1password-cli"] }],
  ];
  for (const [command, expected] of allowed) {
    test(`reads ${JSON.stringify(command)}`, () => {
      assert.deepEqual(parseInstallCommand(command), expected);
    });
  }

  const unsupported = [
    "brew install wget; rm -rf ~",
    "brew install wget && echo done",
    "brew install wget || true",
    "brew install wget | tee log",
    "brew install wget > log",
    "brew install `whoami`",
    "brew install $(whoami)",
    "brew install $HOME",
    "brew install 'wget'",
    "brew install \"wget\"",
    "brew install wget # a comment",
    "brew install https://example.com/aracim.rb",
    "brew install file:///tmp/aracim.rb",
    "brew install ./aracim.rb",
    "brew install aracim.rb",
    "brew install aracim.json",
    "brew install wget--1.25.0.arm64_sequoia.bottle.tar.gz",
    "brew install /tmp/aracim",
    "brew install ~/aracim",
    "brew install ../ornek/tap/aracim",
    "brew install ornek/aracim",
    "brew install ornek//aracim",
    "brew install ornek/tap/aracim/extra",
    "brew install ./tap/aracim",
    "brew install ornek/../aracim",
    "brew install --HEAD wget",
    "brew install -s wget",
    "brew install --build-from-source wget",
    "brew install --formula wget",
    "brew install --casks firefox",
    "brew install --cask=firefox",
    "brew install --appdir=/tmp firefox",
    "brew install -- wget",
    "brew install -v wget",
    "brew install Wget",
    "brew install wget.",
    "brew install python@3.",
    "brew install python@.12",
    "brew install é",
    "sudo brew install wget",
    "brew reinstall wget",
    "brew upgrade wget",
    "brew  wget",
    "brewinstall wget",
    "brew install wget\nbrew install jq",
    "brew install wget\rjq",
    "brew install wget \\ jq",
    "> brew install wget",
    "$brew install wget",
    "brew install " + "a".repeat(129),
  ];
  for (const command of unsupported) {
    test(`refuses ${JSON.stringify(command.slice(0, 60))}`, () => {
      assert.deepEqual(parseInstallCommand(command), { problem: "unsupported" });
    });
  }

  test("a command without a name has nothing to install", () => {
    assert.deepEqual(parseInstallCommand("brew install"), { problem: "noNames" });
    assert.deepEqual(parseInstallCommand("brew install --cask"), { problem: "noNames" });
    assert.deepEqual(parseInstallCommand("brew install --cask --cask"), { problem: "noNames" });
  });

  test(`more than ${MAX_NAMES} different names is too many`, () => {
    const names = Array.from({ length: MAX_NAMES }, (_, index) => `aracim${index}`);
    assert.deepEqual(parseInstallCommand(`brew install ${names.join(" ")}`), { cask: false, names });
    assert.deepEqual(parseInstallCommand(`brew install ${names.join(" ")} fazla`), { problem: "tooMany" });
    assert.deepEqual(parseInstallCommand(`brew install ${names.join(" ")} ${names.join(" ")}`), { cask: false, names }, "repeats count once");
  });

  test("brew gets the names after --, the only option being --cask", () => {
    assert.deepEqual(installArguments({ cask: false, names: ["wget", "jq"] }), ["install", "--", "wget", "jq"]);
    assert.deepEqual(installArguments({ cask: true, names: ["firefox"] }), ["install", "--cask", "--", "firefox"]);
  });
});

describe("package names", () => {
  test("names brew installs from its taps, and nothing else", () => {
    for (const name of ["wget", "python@3.12", "node@22", "firefox@developer-edition", "gtk+3", "sdl2_mixer", "hashicorp/tap/terraform", "0-ad", "x264"]) {
      assert.equal(isPackageName(name), true, name);
    }
    for (const name of ["", "-wget", "--cask", "Wget", "wget.rb", "a.json", "a/b", "a/b/c/d", "./a", "../a/b", "a/./b", ".a/b/c", "a b", "a\tb", "a;b", "a:b", "é", "a@", "a@.1", "a@1.", "a@1.x"]) {
      assert.equal(isPackageName(name), false, JSON.stringify(name));
    }
  });

  test("a bare name has a letter, so a copied number is not one", () => {
    for (const name of ["wget", "1password", "7zip", "0-ad", "hashicorp/tap/terraform"]) assert.equal(isBareName(name), true, name);
    for (const name of ["2026", "42", "1-2", "3.14", "hashicorp/tap/2026"]) assert.equal(isBareName(name), false, name);
  });
});

describe("where the actions are offered", () => {
  test("a brew install command gets the install action", () => {
    for (const command of [
      "brew install wget",
      "$ brew install --cask firefox",
      "% brew install wget jq",
      "brew install hashicorp/tap/terraform",
      "brew install python@3.12",
      "brew install \\\n  wget \\\n  jq",
      "brew install --cask --cask firefox",
      "brew install --cask \\\n  firefox",
    ]) {
      for (const target of [null, TERMINAL, BROWSER]) assert.deepEqual(offers(command, "text", target), ["install"], JSON.stringify(command));
    }
    assert.deepEqual(offers("brew install wget", "code"), ["install"]);
  });

  test("a command without a package name is not offered: it could only say there is nothing to install", () => {
    for (const command of ["brew install --cask", "brew install --cask --cask", "$ brew install --cask \\\n  --cask", "brew install"]) {
      assert.deepEqual(offers(command), [], JSON.stringify(command));
    }
  });

  test("a bare package name gets the name action in Terminal", () => {
    for (const name of ["wget", "python@3.12", "firefox@developer-edition", "hashicorp/tap/terraform", "1password"]) {
      assert.deepEqual(offers(name, "text", TERMINAL), ["installName"], name);
      assert.deepEqual(offers(name, "code", TERMINAL), ["installName"], name);
    }
    assert.deepEqual(offers("  wget\n", "text", TERMINAL), ["installName"], "surrounding whitespace is trimmed first");
  });

  test("elsewhere a lone lowercase word is just a word", () => {
    // Words, identifiers, slugs and branch names look like package names too: outside Terminal, none offers an install.
    for (const value of ["wget", "hello", "tree", "make", "feature-login", "2f9a1c3", "my_variable"]) {
      for (const target of [null, BROWSER, { bundleID: "com.example.editor", name: "Editor", kind: "editor" }]) {
        assert.deepEqual(offers(value, "text", target), [], `${value} in ${target?.kind ?? "no target"}`);
      }
    }
  });

  test("anything else gets neither", () => {
    for (const value of [
      "brew install wget; rm -rf ~",
      "brew install wget && brew install jq",
      "brew install ./aracim.rb",
      "brew install aracim.rb",
      "brew install https://example.com/aracim.rb",
      "brew install --HEAD wget",
      "brew install Wget",
      "brew install wget\nbrew install jq",
      "sudo brew install wget",
      "brew upgrade",
      "brew install",
      "Install wget with brew install wget",
      "Hello world",
      "Wget",
      "2026",
      "example.com",
      "deniz.k@ornek.dev",
      "a/b",
      "",
    ]) {
      assert.deepEqual(offers(value), [], JSON.stringify(value));
      assert.deepEqual(offers(value, "text", TERMINAL), [], `${JSON.stringify(value)} in Terminal`);
    }
    assert.deepEqual(host.offers({ kind: "link", url: "https://brew.sh", text: "https://brew.sh" }), []);
  });

  test("what the install pattern takes, the parser runs", () => {
    // A seeded walk through commands made of brew's words and stray characters: whenever the pattern offers the
    // action, the parser runs the command, so nothing offered is refused as unsupported or as having no name.
    let seed = 7;
    const random = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = ["wget", "jq", "--cask", "--HEAD", "python@3.12", "a.rb", "ornek/tap/aracim", "ornek/aracim", ";", "&&", " ", "\t", " \\\n", "'", "Wget", "-", "@", "1"];
    let offered = 0;
    for (let round = 0; round < 3000; round++) {
      const parts = Array.from({ length: 1 + random(5) }, () => pieces[random(pieces.length)]);
      const command = `brew install ${parts.join(random(2) === 0 ? " " : "")}`;
      if (!acceptsMatch(accepts.install, text(command))) continue;
      offered++;
      const parsed = parseInstallCommand(command);
      assert.ok("names" in parsed, `${JSON.stringify(command)}: ${JSON.stringify(parsed)}`);
    }
    assert.ok(offered > 100, `only ${offered} commands were offered`);
  });
});

describe("patterns and parsing stay fast on long text", () => {
  // The app matches the patterns as the person types, and runs the parser in the job: both must be linear.
  const adversarial = [
    "brew install " + "a ".repeat(30_000) + ";",
    "brew install " + "a".repeat(60_000) + "!",
    "brew install a" + " ".repeat(60_000) + "!",
    "brew install " + "a\t".repeat(30_000) + "A",
    "brew install" + " \\\n".repeat(20_000) + "!",
    "brew install " + "ab/".repeat(20_000) + "!",
    "brew install a@" + "1.".repeat(30_000) + "x",
    "brew install " + "--cask ".repeat(10_000) + "--casks",
    "$ ".repeat(30_000) + "brew install wget",
    "a".repeat(100_000) + "!",
    "1".repeat(100_000),
    "a-".repeat(50_000) + ".",
    "ab/".repeat(30_000),
    "ornek/tap/" + "a@1.".repeat(25_000) + "!",
  ];

  test("each pattern answers within 250 ms", () => {
    for (const value of adversarial) {
      for (const [id, block] of Object.entries(accepts)) {
        const started = performance.now();
        acceptsMatch(block, text(value));
        const took = performance.now() - started;
        assert.ok(took < 250, `${id} took ${took.toFixed(1)} ms on ${JSON.stringify(value.slice(0, 30))}…`);
      }
    }
  });

  test("the parser answers within 250 ms", () => {
    for (const value of [...adversarial, "brew install " + Array.from({ length: 20_000 }, (_, index) => `aracim${index}`).join(" ")]) {
      const started = performance.now();
      parseInstallCommand(value);
      isBareName(value);
      const took = performance.now() - started;
      assert.ok(took < 250, `took ${took.toFixed(1)} ms on ${JSON.stringify(value.slice(0, 30))}…`);
    }
  });
});
