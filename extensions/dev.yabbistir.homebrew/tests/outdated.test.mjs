import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { homepageOf, packageOfRow, parseOutdated, rowID } from "../src/brew.ts";
import { AUTO_UPDATE, OUTDATED, ROWS, TOKEN, cask, fakeBrew, folder, formula, hostWith, infoJSON, newHelper, ok, outdatedJSON } from "./fixtures.mjs";

const START = Date.parse("2026-11-01T09:00:00Z");
const FIVE_MINUTES = 5 * 60_000;
/** How long the column keeps saying brew is slow before it asks brew again. */
const PAUSE = 60_000;
const SLOW = { locked: true, message: "Homebrew is taking too long", command: "brew update" };
const listings = (brew) => brew.runs.filter((args) => args[0] === "outdated").length;
/** Lets the call reach its first await, so a mocked timer it set can be ticked. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("the outdated column", () => {
  test("one row per outdated package, by name, with versions and kind", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)) });
    const host = hostWith(exports, brew);
    assert.deepEqual(await host.list("outdated"), { rows: ROWS });
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"]]);
    assert.deepEqual(host.logs, []);
  });

  test("in Turkish", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)) }), { language: "tr" });
    const { rows } = await host.list("outdated");
    assert.deepEqual(rows.map((row) => row.subtitle), [
      "27.3.1 → 27.4.0 · formül",
      "4.36.0 → 4.37.0 · cask",
      "133.0 → 133.0.3 · cask",
      "22.11.0 → 23.3.0 · formül",
      "0.9.0, 0.9.1 → 1.0.0 · formül",
      "3.12.7 → 3.12.8 · formül · sabitlenmiş",
    ]);
  });

  test("every package comes through, past the 64 KB an exec result keeps", async () => {
    const formulae = Array.from({ length: 3000 }, (_, index) => formula(`aracim-${String(index).padStart(4, "0")}`, "1.0.0", "1.0.1"));
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON({ formulae })) }));
    const { rows } = await host.list("outdated");
    assert.equal(rows.length, 3000);
    assert.deepEqual(rows[0], { id: "formula:aracim-0000", title: "aracim-0000", subtitle: "1.0.0 → 1.0.1 · formula" });
    assert.equal(rows.at(-1).id, "formula:aracim-2999");
  });

  test("standard error, where the auto-update reports, never becomes a row", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON(OUTDATED), AUTO_UPDATE + `{"formulae":[{"name":"${TOKEN.toLowerCase()}"}]}\n`) }));
    assert.deepEqual(await host.list("outdated"), { rows: ROWS });
  });

  test("a line before the JSON is skipped", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok("==> Auto-updated Homebrew!\n" + outdatedJSON(OUTDATED)) }));
    assert.deepEqual(await host.list("outdated"), { rows: ROWS });
  });

  test("only names and versions reach a row", async () => {
    const exports = await newHelper();
    const entry = { ...formula("node", "22.11.0", "23.3.0"), pinned_version: TOKEN, note: TOKEN, [TOKEN]: TOKEN };
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON({ formulae: [entry] })) }));
    const { rows } = await host.list("outdated");
    assert.deepEqual(rows, [{ id: "formula:node", title: "node", subtitle: "22.11.0 → 23.3.0 · formula" }]);
    assert.deepEqual(host.logs, []);
  });

  test("an entry without a usable name is left out; odd versions stay calm", async () => {
    const exports = await newHelper();
    const formulae = [
      { name: "../aracim.rb", installed_versions: ["1"], current_version: "2" },
      { name: 42, installed_versions: ["1"], current_version: "2" },
      { installed_versions: ["1"], current_version: "2" },
      null,
      "node",
      { name: "jq", installed_versions: "1.7", current_version: 1.8, pinned: "yes" },
      { name: "fd", installed_versions: [null, "9.0.0\n", 3], current_version: null },
      formula("node", "22.11.0", "23.3.0"),
      formula("node", "22.11.0", "23.3.0"),
    ];
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON({ formulae, casks: "none" })) }));
    assert.deepEqual(await host.list("outdated"), { rows: [
      { id: "formula:fd", title: "fd", subtitle: "9.0.0, 3 → ? · formula" },
      { id: "formula:jq", title: "jq", subtitle: "1.7 → 1.8 · formula" },
      { id: "formula:node", title: "node", subtitle: "22.11.0 → 23.3.0 · formula" },
    ] });
  });

  test("nothing outdated is no rows, never a locked line", async () => {
    // The app says an empty column is empty in its own words; a locked row would draw a lock beside "up to date".
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: ok(outdatedJSON()) }));
    assert.deepEqual(await host.list("outdated"), { rows: [] });
  });

  test("brew missing is the app's toolMissing, which the column names", async () => {
    const exports = await newHelper();
    const host = createFakeHost({ folder, sources: exports.sources, exec: {} });
    await assert.rejects(host.list("outdated"), { code: "toolMissing" });
  });

  test("brew failing, or printing something else, fails the listing without its output", async () => {
    for (const answer of [
      { exitCode: 1, stdout: outdatedJSON(OUTDATED), stderr: `Error: ${TOKEN}\n` },
      ok(`${TOKEN}\n`),
      ok("[]\n"),
      ok('{"other": []}\n'),
      ok(""),
    ]) {
      const exports = await newHelper();
      const host = hostWith(exports, fakeBrew({ outdated: answer }));
      await assert.rejects(host.list("outdated"), (error) => {
        assert.equal(error.message, "Homebrew couldn’t list your outdated packages.");
        assert.ok(!String(error.stack).includes(TOKEN));
        return true;
      });
      assert.deepEqual(host.logs, []);
    }
  });
});

describe("a slow brew", () => {
  test("past eight seconds, brew is stopped and the column says to update it in Terminal", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const exports = await newHelper();
    let stopped = false;
    const brew = fakeBrew({ outdated: (_args) => new Promise(() => {}) });
    const host = hostWith(exports, brew);
    const listing = host.list("outdated").finally(() => { stopped = true; });
    await settle();
    t.mock.timers.tick(7_999);
    await settle();
    assert.equal(stopped, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await listing, { locked: true, message: "Homebrew is taking too long", command: "brew update" });
  });

  test("an answer inside the budget is listed", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: () => new Promise((resolve) => setTimeout(() => resolve(ok(outdatedJSON(OUTDATED))), 7_900)) });
    const host = hostWith(exports, brew);
    const listing = host.list("outdated");
    await settle();
    t.mock.timers.tick(7_900);
    assert.deepEqual(await listing, { rows: ROWS });
  });

  test("the app cancelling the call is a cancel, not a slow brew", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ outdated: () => new Promise(() => {}) }));
    const listing = host.list("outdated");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(listing, { code: "cancelled" });
  });

  test("a slow answer drops the cached list", async (t) => {
    const exports = await newHelper();
    let slow = false;
    const brew = fakeBrew({ outdated: () => (slow ? new Promise(() => {}) : ok(outdatedJSON(OUTDATED))) });
    await hostWith(exports, brew, { now: START }).list("outdated");
    slow = true;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const listing = hostWith(exports, brew, { now: START + FIVE_MINUTES + 1 }).list("outdated");
    await settle();
    t.mock.timers.tick(8_000);
    assert.equal((await listing).locked, true);
    t.mock.timers.reset();
    slow = false;
    assert.deepEqual(await hostWith(exports, brew, { now: START + FIVE_MINUTES + 1 + PAUSE }).list("outdated"), { rows: ROWS });
    assert.equal(listings(brew), 3);
  });

  /** A helper whose last listing was too slow, at `at`. */
  async function slowAt(t, at) {
    const exports = await newHelper();
    let slow = true;
    const brew = fakeBrew({ outdated: () => (slow ? new Promise(() => {}) : ok(outdatedJSON(OUTDATED))), install: ok() });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const listing = hostWith(exports, brew, { now: at }).list("outdated");
    await settle();
    t.mock.timers.tick(8_000);
    assert.deepEqual(await listing, SLOW);
    t.mock.timers.reset();
    slow = false;
    return { exports, brew };
  }

  test("for a minute after, the column says so again without starting brew", async (t) => {
    // Each slow answer stops brew's own update; asking on every panel open would stop it every time.
    const { exports, brew } = await slowAt(t, START);
    for (const at of [START, START + 1, START + PAUSE - 1]) {
      assert.deepEqual(await hostWith(exports, brew, { now: at }).list("outdated"), SLOW, String(at - START));
    }
    assert.equal(listings(brew), 1);
    assert.deepEqual(await hostWith(exports, brew, { now: START + PAUSE }).list("outdated"), { rows: ROWS });
    assert.equal(listings(brew), 2);
  });

  test("a clock that went back ends the pause", async (t) => {
    const { exports, brew } = await slowAt(t, START);
    assert.deepEqual(await hostWith(exports, brew, { now: START - 1 }).list("outdated"), { rows: ROWS });
    assert.equal(listings(brew), 2);
  });

  test("an install ends the pause: it brought Homebrew up to date on the way", async (t) => {
    const { exports, brew } = await slowAt(t, START);
    const host = hostWith(exports, brew, { now: START + 1 });
    await host.run(exports.actions.install, { kind: "text", text: "brew install wget" });
    assert.deepEqual(await host.list("outdated"), { rows: ROWS });
    assert.equal(listings(brew), 2);
  });
});

describe("caching", () => {
  test("the list is reused for five minutes", async () => {
    const exports = await newHelper();
    const answer = { current: ok(outdatedJSON(OUTDATED)) };
    const brew = fakeBrew({ outdated: () => answer.current });
    assert.deepEqual(await hostWith(exports, brew, { now: START }).list("outdated"), { rows: ROWS });

    answer.current = ok(outdatedJSON({ formulae: [formula("jq", "1.7", "1.7.1")] }));
    assert.deepEqual(await hostWith(exports, brew, { now: START + FIVE_MINUTES }).list("outdated"), { rows: ROWS });
    assert.equal(listings(brew), 1);

    const later = await hostWith(exports, brew, { now: START + FIVE_MINUTES + 1 }).list("outdated");
    assert.deepEqual(later, { rows: [{ id: "formula:jq", title: "jq", subtitle: "1.7 → 1.7.1 · formula" }] });
    assert.equal(listings(brew), 2);
  });

  test("a clock that went back reads again", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)) });
    await hostWith(exports, brew, { now: START }).list("outdated");
    await hostWith(exports, brew, { now: START - 1 }).list("outdated");
    assert.equal(listings(brew), 2);
  });

  test("being up to date is reused too", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON()) });
    await hostWith(exports, brew, { now: START }).list("outdated");
    assert.deepEqual(await hostWith(exports, brew, { now: START + 60_000 }).list("outdated"), { rows: [] });
    assert.equal(listings(brew), 1);
  });

  test("reused rows speak the app's language of the moment", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)) });
    assert.deepEqual(await hostWith(exports, brew, { now: START }).list("outdated"), { rows: ROWS });
    const { rows } = await hostWith(exports, brew, { now: START + 60_000, language: "tr" }).list("outdated");
    assert.equal(rows.find((row) => row.id === "formula:node").subtitle, "22.11.0 → 23.3.0 · formül");
    assert.equal(rows.find((row) => row.id === "pinned-formula:python@3.12").subtitle, "3.12.7 → 3.12.8 · formül · sabitlenmiş");
    assert.deepEqual(await hostWith(exports, brew, { now: START + 120_000 }).list("outdated"), { rows: ROWS }, "and back");
    assert.equal(listings(brew), 1);
  });

  test("a failed listing is not cached", async () => {
    const exports = await newHelper();
    let fail = true;
    const brew = fakeBrew({ outdated: () => (fail ? { exitCode: 1, stdout: "", stderr: "" } : ok(outdatedJSON(OUTDATED))) });
    await assert.rejects(hostWith(exports, brew, { now: START }).list("outdated"));
    fail = false;
    assert.deepEqual(await hostWith(exports, brew, { now: START + 1 }).list("outdated"), { rows: ROWS });
  });

  test("an install drops it", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)), install: ok() });
    const host = hostWith(exports, brew, { now: START });
    await host.list("outdated");
    await host.run(exports.actions.install, { kind: "text", text: "brew install wget" });
    await host.list("outdated");
    assert.equal(listings(brew), 2);
  });

  test("a failed install drops it too", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)), install: { exitCode: 1, stdout: "", stderr: "" } });
    const host = hostWith(exports, brew, { now: START });
    await host.list("outdated");
    await assert.rejects(host.run(exports.actions.installName, { kind: "text", text: "wget" }));
    await host.list("outdated");
    assert.equal(listings(brew), 2);
  });
});

describe("a row's actions", () => {
  const infoFor = (homepage) => ({
    info: (args) => {
      const name = args.at(-1);
      return ok(args.includes("--cask")
        ? infoJSON({ casks: [{ token: name, full_token: name, homepage, version: "133.0.3", url: "https://example.com/x.dmg" }] })
        : infoJSON({ formulae: [{ name, full_name: name, homepage, versions: { stable: "23.3.0" } }] }));
    },
  });

  test("↵ pastes the upgrade command for just that package, --cask for a cask", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)) });
    const host = hostWith(exports, brew);
    assert.deepEqual(await host.runSource("outdated", "formula:node", "upgrade"), { text: "brew upgrade node" });
    assert.deepEqual(await host.runSource("outdated", "cask:firefox", "upgrade"), { text: "brew upgrade --cask firefox" });
    assert.deepEqual(await host.runSource("outdated", "cask:docker", "upgrade"), { text: "brew upgrade --cask docker" });
    assert.deepEqual(await host.runSource("outdated", "formula:docker", "upgrade"), { text: "brew upgrade docker" });
    assert.deepEqual(await host.runSource("outdated", "formula:ornek/tap/aracim", "upgrade"), { text: "brew upgrade ornek/tap/aracim" });
    assert.deepEqual(brew.runs, [], "the command needs no brew run");
  });

  test("↵ on a pinned package unpins it first, as brew suggests: brew upgrade refuses a pinned one", async () => {
    const exports = await newHelper();
    const brew = fakeBrew({ outdated: ok(outdatedJSON(OUTDATED)) });
    const host = hostWith(exports, brew);
    const { rows } = await host.list("outdated");
    const pinned = rows.find((row) => row.title === "python@3.12");
    assert.deepEqual(await host.runSource("outdated", pinned.id, "upgrade"), { text: "brew unpin python@3.12 && brew upgrade python@3.12" });
    assert.deepEqual(await host.runSource("outdated", "pinned-cask:firefox", "upgrade"), { text: "brew unpin --cask firefox && brew upgrade --cask firefox" });
    assert.deepEqual(await host.runSource("outdated", "pinned-formula:ornek/tap/aracim", "upgrade"), { text: "brew unpin ornek/tap/aracim && brew upgrade ornek/tap/aracim" });
    assert.deepEqual(brew.runs, [["outdated", "--json=v2"]]);
  });

  test("a pinned row's homepage is read like any other", async () => {
    const exports = await newHelper();
    const brew = fakeBrew(infoFor("https://www.python.org/"));
    const host = hostWith(exports, brew);
    assert.deepEqual(await host.runSource("outdated", "pinned-formula:python@3.12", "homepage"), { text: "https://www.python.org/" });
    assert.deepEqual(brew.runs, [["info", "--json=v2", "--formula", "--", "python@3.12"]]);
  });

  test("⇧↵ pastes the package's homepage, read from brew info", async () => {
    const exports = await newHelper();
    const brew = fakeBrew(infoFor("https://nodejs.org/"));
    const host = hostWith(exports, brew);
    assert.deepEqual(await host.runSource("outdated", "formula:node", "homepage"), { text: "https://nodejs.org/" });
    assert.deepEqual(await host.runSource("outdated", "cask:firefox", "homepage"), { text: "https://nodejs.org/" });
    assert.deepEqual(brew.runs, [["info", "--json=v2", "--formula", "--", "node"], ["info", "--json=v2", "--cask", "--", "firefox"]]);
  });

  test("a package without a web homepage says so", async () => {
    for (const homepage of [undefined, "", "   ", "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "not a url", "https://exa mple.com"]) {
      const exports = await newHelper();
      const host = hostWith(exports, fakeBrew(infoFor(homepage)));
      await assert.rejects(host.runSource("outdated", "formula:node", "homepage"), { message: "This package has no homepage." }, String(homepage));
    }
  });

  test("brew info failing, or answering for nothing, says so without its output", async () => {
    for (const answer of [
      { exitCode: 1, stdout: "", stderr: `Error: No available formula with the name "node". ${TOKEN}\n` },
      ok(TOKEN),
      ok(infoJSON({ formulae: [] })),
      ok(infoJSON({ formulae: [{ name: "other", homepage: "https://example.com" }, { name: "another", homepage: "https://example.org" }] })),
    ]) {
      const exports = await newHelper();
      const host = hostWith(exports, fakeBrew({ info: answer }));
      await assert.rejects(host.runSource("outdated", "formula:node", "homepage"), (error) => {
        assert.equal(error.message, "Homebrew couldn’t read this package’s details.");
        assert.ok(!String(error.stack).includes(TOKEN));
        return true;
      });
      assert.deepEqual(host.logs, []);
    }
  });

  test("an id this extension did not list never reaches brew", async () => {
    const exports = await newHelper();
    const brew = fakeBrew(infoFor("https://example.com"));
    const host = hostWith(exports, brew);
    for (const id of ["node", "formula:", "formula:--HEAD", "cask:../x.rb", "tap:node", "formula:node; rm -rf ~", "formula:node --cask", ":node", "FORMULA:node",
      "pinned-:node", "pinned:node", "pinned-pinned-formula:node", "pinnedformula:node", "pinned-tap:node", "pinned-formula:node && rm -rf ~"]) {
      for (const action of ["upgrade", "homepage"]) {
        await assert.rejects(host.runSource("outdated", id, action), { message: "This package isn’t in the list anymore. Open the panel again." }, id);
      }
    }
    assert.deepEqual(brew.runs, []);
  });

  test("an action the manifest lacks is refused before the source runs", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew());
    await assert.rejects(host.runSource("outdated", "formula:node", "install"), { code: "notFound" });
  });

  test("the run gets the app's cancel", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew({ info: () => new Promise(() => {}) }));
    const running = host.runSource("outdated", "formula:node", "homepage");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("in Turkish", async () => {
    const exports = await newHelper();
    const host = hostWith(exports, fakeBrew(infoFor("")), { language: "tr" });
    await assert.rejects(host.runSource("outdated", "formula:node", "homepage"), { message: "Bu paketin ana sayfası yok." });
    await assert.rejects(host.runSource("outdated", "node", "upgrade"), { message: "Bu paket artık listede yok. Paneli yeniden aç." });
  });
});

describe("reading brew's JSON", () => {
  test("the documented outdated shape", () => {
    assert.deepEqual(parseOutdated(outdatedJSON({ formulae: [formula("node", "22.11.0", "23.3.0")], casks: [cask("firefox", "133.0", "133.0.3", { pinned: true })] })), [
      { kind: "formula", name: "node", installed: ["22.11.0"], current: "23.3.0", pinned: false },
      { kind: "cask", name: "firefox", installed: ["133.0"], current: "133.0.3", pinned: true },
    ]);
    assert.deepEqual(parseOutdated('{"formulae": []}'), []);
    assert.deepEqual(parseOutdated('{"casks": []}'), []);
    assert.equal(parseOutdated('{"formulae": {}}'), undefined);
    assert.equal(parseOutdated("null"), undefined);
  });

  test("row ids", () => {
    assert.deepEqual(packageOfRow("formula:node"), { kind: "formula", name: "node", pinned: false });
    assert.deepEqual(packageOfRow("cask:firefox@developer-edition"), { kind: "cask", name: "firefox@developer-edition", pinned: false });
    assert.deepEqual(packageOfRow("pinned-formula:python@3.12"), { kind: "formula", name: "python@3.12", pinned: true });
    assert.equal(packageOfRow("formula:node:extra"), undefined);
    for (const pkg of [{ kind: "formula", name: "node", pinned: false }, { kind: "cask", name: "firefox", pinned: true }, { kind: "formula", name: "ornek/tap/aracim", pinned: true }]) {
      assert.deepEqual(packageOfRow(rowID(pkg)), pkg);
    }
  });

  test("the homepage of the package asked for", () => {
    const text = infoJSON({ formulae: [{ name: "other", full_name: "ornek/tap/other", homepage: "https://example.org" }, { name: "node", homepage: "https://nodejs.org/" }] });
    assert.equal(homepageOf(text, { kind: "formula", name: "node" }), "https://nodejs.org/");
    assert.equal(homepageOf(text, { kind: "formula", name: "ornek/tap/other" }), "https://example.org");
    assert.equal(homepageOf(text, { kind: "cask", name: "node" }), undefined, "a formula is not a cask");
    assert.equal(homepageOf(infoJSON({ casks: [{ token: "firefox", homepage: " https://www.mozilla.org/firefox/ " }] }), { kind: "cask", name: "firefox" }), "https://www.mozilla.org/firefox/");
  });

  test("reading stays fast on a large list", () => {
    const formulae = Array.from({ length: 20_000 }, (_, index) => formula(`aracim-${index}`, ["1.0.0", "1.0.1"], "1.0.2"));
    const text = outdatedJSON({ formulae });
    const started = performance.now();
    assert.equal(parseOutdated(text).length, 20_000);
    parseOutdated("x".repeat(1_000_000) + "\n" + text);
    parseOutdated("\n{".repeat(100_000));
    const took = performance.now() - started;
    assert.ok(took < 2_000, `took ${took.toFixed(1)} ms`);
  });
});
