import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

const folder = new URL("..", import.meta.url);
const START = Date.parse("2026-01-01T09:00:00Z");
const FIVE_MINUTES = 5 * 60_000;

let helpers = 0;
/**
 * The extension's `sources` as a newly started helper has them: a module of its own, so no lpass version is known
 * yet and nothing is cached. The fake host does not import the extension; it calls the export it is given.
 */
async function newHelper() {
  return (await import(`../src/index.ts?helper=${++helpers}`)).sources;
}

/** A synthetic vault: what `lpass show --password` and `--username` print for each id, before the newline. */
const ENTRIES = {
  1001: { password: "s3cr3t-örnek", username: "deniz.k" },
  1002: { password: "  s3cr3t örnek\t", username: "deniz.k@ornek.dev" },
  1003: { password: "", username: "" },
  1004: { password: " \t ", username: "  " },
  1005: { password: "s3cr3t-örnek\n", username: "deniz.k" },
};

/** What `lpass ls` prints with the extension's format: id, name, user name and URL, separated by tabs. */
const LISTING = [
  "1001\tornek.dev\tdeniz.k\thttps://ornek.dev",
  "1002\tPosta\tdeniz.k@ornek.dev\thttps://posta.ornek.dev",
  "1003\tKasa\t\thttps://kasa.ornek.dev",
  "0\tPaylaşılan\t\thttp://group",
  "0\tSıfır\tdeniz.k\thttps://sifir.ornek.dev",
  "1010\tİş\t\thttp://group",
  "1011\tWi-Fi notu\t\thttp://sn",
  "1012\t\tdeniz.k\thttps://adsiz.ornek.dev",
  "1013\t  \tdeniz.k\thttps://bosluk.ornek.dev",
  "x1014\tBozuk\tdeniz.k\thttps://ornek.dev",
  "1030\tİkiz\tdeniz.k\thttps://ikiz.ornek.dev",
  "1030\tİkiz yine\tdeniz.k\thttps://ikiz.ornek.dev",
].join("\n") + "\n";

const ROWS = [
  { id: "1001", title: "ornek.dev", subtitle: "deniz.k" },
  { id: "1002", title: "Posta", subtitle: "deniz.k@ornek.dev" },
  { id: "1003", title: "Kasa" },
];

/**
 * A fake lpass answering the extension's commands as the real one does. Change `lpass.state` to log out, age the
 * tool or make a command fail; `show` replaces every `lpass show` answer. `localCopy: false` is lpass right after
 * `lpass logout` and `lpass login`: logging out deletes its local copy of the vault, logging in does not fetch it, so
 * every `--sync=no` command fails until one with `--sync=now` fetches it.
 */
function fakeLpass(changes = {}) {
  const state = { version: "LastPass CLI v1.6.2", loggedIn: true, localCopy: true, listing: LISTING, listExit: 0, listStderr: "", entries: ENTRIES, show: undefined, ...changes };
  const ok = (stdout, stderr = "") => ({ exitCode: 0, stdout, stderr });
  const noCopy = { exitCode: 1, stdout: "", stderr: "Error: Unable to fetch blob.\n" };
  const lpass = (args) => {
    if (args.includes("--sync=now") && state.loggedIn) state.localCopy = true;
    switch (args[0]) {
      case "--version": return ok(`${state.version}\n`);
      case "status": return state.loggedIn ? ok("") : { exitCode: 1, stdout: "", stderr: "" };
      case "ls": return state.localCopy ? { exitCode: state.listExit, stdout: state.listing, stderr: state.listStderr } : noCopy;
      case "show": {
        if (!state.localCopy) return noCopy;
        if (state.show !== undefined) return state.show;
        const entry = state.entries[args.at(-1)];
        if (entry === undefined) return { exitCode: 1, stdout: "", stderr: "Error: Could not find specified account(s).\n" };
        return ok(`${entry[args[1].replace(/^--/, "")]}\n`);
      }
      default: return { exitCode: 1, stdout: "", stderr: "Unknown command.\n" };
    }
  };
  return Object.assign(lpass, { state });
}

function hostWith(sources, lpass, { now = START, language = "en" } = {}) {
  return createFakeHost({ folder, sources, exec: { lpass }, now, context: { language } });
}
/** The arguments of each lpass run, in order. */
const runs = (host) => host.calls.filter((call) => call.api === "exec" && call.args[0] === "lpass").map((call) => call.args[1]);
const commands = (host) => runs(host).map((args) => args[0]);
const listings = (host) => commands(host).filter((command) => command === "ls").length;
const settled = (promise) => promise.then(() => undefined, () => undefined);

const UPDATE = { locked: true, message: "lpass needs an update", command: "brew upgrade lastpass-cli" };
const SHOW_FAILED = "lpass could not read this entry.";

describe("list", () => {
  test("locked when status fails", async () => {
    const host = hostWith(await newHelper(), fakeLpass({ loggedIn: false }));
    const listing = await host.list("vault");
    assert.equal(listing.locked, true);
    assert.equal(listing.message, "LastPass is locked");
    assert.ok(listing.command.startsWith("lpass login --trust"));
    assert.equal(listing.command, "lpass login --trust <email>");
    assert.deepEqual(runs(host), [["--version"], ["status", "-q"]], "nothing is listed while locked");
  });

  test("lists entries without folders or secure notes", async () => {
    const host = hostWith(await newHelper(), fakeLpass());
    assert.deepEqual(await host.list("vault"), { rows: ROWS });
    assert.deepEqual(runs(host), [["--version"], ["status", "-q"], ["ls", "--sync=no", "--color=never", "--format=%ai\t%an\t%au\t%al"]]);
  });

  test("rows come from every line of standard output and none of standard error", async () => {
    // More than the 64 KB of output an exec result keeps: every line still becomes a row.
    const many = Array.from({ length: 2000 }, (_, index) => `${2000 + index}\tornek-${index}.dev, a long synthetic site name\tdeniz.k\thttps://ornek-${index}.dev`);
    const host = hostWith(await newHelper(), fakeLpass({ listing: many.join("\n") + "\n", listStderr: "9999\ts3cr3t-örnek\tdeniz.k\thttps://ornek.dev\n" }));
    const { rows } = await host.list("vault");
    assert.equal(rows.length, 2000);
    assert.deepEqual(rows[0], { id: "2000", title: "ornek-0.dev, a long synthetic site name", subtitle: "deniz.k" });
    assert.equal(rows.at(-1).id, "3999");
    assert.ok(!rows.some((row) => row.id === "9999"));
  });

  test("the list is cached for five minutes", async () => {
    const sources = await newHelper();
    const lpass = fakeLpass();
    const first = hostWith(sources, lpass, { now: START });
    assert.deepEqual(await first.list("vault"), { rows: ROWS });
    assert.equal(listings(first), 1);

    lpass.state.listing = "1020\tYeni\tdeniz.k\thttps://yeni.ornek.dev\n";
    const second = hostWith(sources, lpass, { now: START + FIVE_MINUTES });
    assert.deepEqual(await second.list("vault"), { rows: ROWS });
    assert.deepEqual(commands(second), ["status"], "the lock is checked each time; ls is not run");

    const third = hostWith(sources, lpass, { now: START + FIVE_MINUTES + 1 });
    assert.deepEqual(await third.list("vault"), { rows: [{ id: "1020", title: "Yeni", subtitle: "deniz.k" }] });
    assert.equal(listings(third), 1);
  });

  test("a locked answer drops the cache", async () => {
    const sources = await newHelper();
    const lpass = fakeLpass();
    await hostWith(sources, lpass, { now: START }).list("vault");

    lpass.state.loggedIn = false;
    assert.equal((await hostWith(sources, lpass, { now: START + 1_000 }).list("vault")).locked, true);

    lpass.state.loggedIn = true;
    const after = hostWith(sources, lpass, { now: START + 2_000 });
    assert.deepEqual(await after.list("vault"), { rows: ROWS });
    assert.equal(listings(after), 1, "the rows are read again, well within five minutes");
  });

  test("a tab in a name stays in the name, and a tab in a folder's name still leaves it out", async () => {
    const listing = ["1001\tİş\tPortalı\tdeniz.k\thttps://ornek.dev", "1010\tİş\tKlasörü\t\thttp://group", "1011\tWi-Fi\tnotu\t\thttp://sn"].join("\n") + "\n";
    const host = hostWith(await newHelper(), fakeLpass({ listing }));
    assert.deepEqual(await host.list("vault"), { rows: [{ id: "1001", title: "İş Portalı", subtitle: "deniz.k" }] });
  });

  test("a name with a line break cannot forge another entry's row", async () => {
    // 1001's name is "Sahte\n1002\tPosta": lpass prints it over two lines, and the second claims 1002's id.
    const listing = [
      "1001\tSahte",
      "1002\tPosta\tdeniz.k\thttps://ornek.dev",
      "1002\tPosta\tdeniz.k@ornek.dev\thttps://posta.ornek.dev",
      "1003\tKasa\t\thttps://kasa.ornek.dev",
    ].join("\n") + "\n";
    const host = hostWith(await newHelper(), fakeLpass({ listing }));
    assert.deepEqual(await host.list("vault"), { rows: [{ id: "1003", title: "Kasa" }] }, "every row of a repeated id goes");
  });

  test("a name that is blank once the app cleans it is left out", async () => {
    const listing = ["1001\t\u0085\tdeniz.k\thttps://ornek.dev", "1002\t\u2028 \u3000\tdeniz.k\thttps://ornek.dev", "1003\tKasa\t\thttps://kasa.ornek.dev"].join("\n") + "\n";
    const host = hostWith(await newHelper(), fakeLpass({ listing }));
    assert.deepEqual(await host.list("vault"), { rows: [{ id: "1003", title: "Kasa" }] });
  });

  test("right after lpass login the list fetches lpass's local copy once, then reads it locally again", async () => {
    const lpass = fakeLpass({ localCopy: false });
    const host = hostWith(await newHelper(), lpass);
    assert.deepEqual(await host.list("vault"), { rows: ROWS });
    assert.deepEqual(runs(host).slice(2), [
      ["ls", "--sync=no", "--color=never", "--format=%ai\t%an\t%au\t%al"],
      ["ls", "--sync=now", "--color=never", "--format=%ai\t%an\t%au\t%al"],
    ]);

    const later = hostWith(await newHelper(), lpass);
    assert.deepEqual(await later.list("vault"), { rows: ROWS });
    assert.deepEqual(runs(later).slice(2), [["ls", "--sync=no", "--color=never", "--format=%ai\t%an\t%au\t%al"]]);
  });

  test("a failed listing says so without its output, and is not cached", async () => {
    const sources = await newHelper();
    const lpass = fakeLpass({ listExit: 1, listing: "1001\ts3cr3t-örnek\tdeniz.k\thttps://ornek.dev\n", listStderr: "Error: s3cr3t-örnek\n" });
    const failing = hostWith(sources, lpass);
    await assert.rejects(failing.list("vault"), (error) => {
      assert.equal(error.message, "lpass could not list the vault.");
      assert.ok(!error.stack.includes("s3cr3t"));
      return true;
    });
    assert.equal(listings(failing), 2, "fetching a fresh copy is tried once too");

    Object.assign(lpass.state, { listExit: 0, listing: LISTING, listStderr: "" });
    const host = hostWith(sources, lpass);
    assert.deepEqual(await host.list("vault"), { rows: ROWS });
    assert.equal(listings(host), 1);
  });
});

describe("lpass version", () => {
  test("an old lpass shows a calm row with the command that updates it", async () => {
    const host = hostWith(await newHelper(), fakeLpass({ version: "LastPass CLI v1.6.0" }));
    assert.deepEqual(await host.list("vault"), UPDATE);
    assert.deepEqual(commands(host), ["--version"], "nothing else runs");
  });

  test("versions are compared as numbers, and an unreadable one asks for an update", async () => {
    for (const version of ["LastPass CLI v1.6.2", "LastPass CLI v1.6.10", "LastPass CLI v1.10.0", "LastPass CLI v2.0.0"]) {
      const listing = await hostWith(await newHelper(), fakeLpass({ version })).list("vault");
      assert.deepEqual(listing, { rows: ROWS }, version);
    }
    for (const version of ["LastPass CLI v1.6.1", "LastPass CLI v1.5.9", "LastPass CLI v0.9.9", "LastPass CLI", ""]) {
      assert.deepEqual(await hostWith(await newHelper(), fakeLpass({ version })).list("vault"), UPDATE, version);
    }
  });

  test("the version is asked once per helper", async () => {
    const sources = await newHelper();
    const lpass = fakeLpass();
    const first = hostWith(sources, lpass);
    await first.list("vault");
    const second = hostWith(sources, lpass, { now: START + 1_000 });
    await second.list("vault");
    assert.deepEqual(commands(first), ["--version", "status", "ls"]);
    assert.deepEqual(commands(second), ["status"]);
  });

  test("an update is noticed without a restart", async () => {
    const sources = await newHelper();
    const lpass = fakeLpass({ version: "LastPass CLI v1.6.0" });
    assert.deepEqual(await hostWith(sources, lpass).list("vault"), UPDATE);
    const again = hostWith(sources, lpass);
    assert.deepEqual(await again.list("vault"), UPDATE, "an old lpass is asked about every time");
    assert.deepEqual(commands(again), ["--version"]);
    lpass.state.version = "LastPass CLI v1.6.2";
    assert.deepEqual(await hostWith(sources, lpass).list("vault"), { rows: ROWS });
  });
});

describe("run", () => {
  test("the password is a secret, the username is text", async () => {
    const host = hostWith(await newHelper(), fakeLpass());
    assert.deepEqual(await host.runSource("vault", "1001", "password"), { secret: "s3cr3t-örnek" });
    assert.deepEqual(await host.runSource("vault", "1001", "username"), { text: "deniz.k" });
    assert.deepEqual(runs(host), [
      ["show", "--password", "--sync=no", "--color=never", "1001"],
      ["show", "--username", "--sync=no", "--color=never", "1001"],
    ]);
  });

  test("only the one trailing newline is taken off", async () => {
    const host = hostWith(await newHelper(), fakeLpass());
    assert.deepEqual(await host.runSource("vault", "1002", "password"), { secret: "  s3cr3t örnek\t" });
    assert.deepEqual(await host.runSource("vault", "1005", "password"), { secret: "s3cr3t-örnek\n" });
  });

  test("an empty password is refused", async () => {
    const host = hostWith(await newHelper(), fakeLpass());
    const message = "This entry’s password couldn’t be read (lpass may need an update).";
    await assert.rejects(host.runSource("vault", "1003", "password"), { message });
    await assert.rejects(host.runSource("vault", "1004", "password"), { message }, "whitespace only is empty too");
  });

  test("an empty username is refused", async () => {
    const host = hostWith(await newHelper(), fakeLpass());
    await assert.rejects(host.runSource("vault", "1003", "username"), { message: "This entry has no username." });
    await assert.rejects(host.runSource("vault", "1004", "username"), { message: "This entry has no username." });
  });

  test("a failed show never echoes its output", async () => {
    const show = { exitCode: 1, stdout: "s3cr3t-örnek\n", stderr: "Error: s3cr3t-örnek could not be decrypted\n" };
    const host = hostWith(await newHelper(), fakeLpass({ show }));
    for (const action of ["password", "username"]) {
      await assert.rejects(host.runSource("vault", "1001", action), (error) => {
        assert.equal(error.message, SHOW_FAILED);
        assert.ok(!error.message.includes("s3cr3t-örnek"));
        assert.ok(!error.stack.includes("s3cr3t"));
        return true;
      });
    }
  });

  test("a show that fails because LastPass locked says so, and the list is read again", async () => {
    const sources = await newHelper();
    const lpass = fakeLpass();
    await hostWith(sources, lpass).list("vault");
    Object.assign(lpass.state, { loggedIn: false, show: { exitCode: 1, stdout: "", stderr: "Error: Could not find decryption key.\n" } });
    const host = hostWith(sources, lpass, { now: START + 1_000 });
    await assert.rejects(host.runSource("vault", "1001", "password"), { message: "LastPass is locked" });
    assert.deepEqual(runs(host), [["show", "--password", "--sync=no", "--color=never", "1001"], ["status", "-q"]]);

    Object.assign(lpass.state, { loggedIn: true, show: undefined });
    const after = hostWith(sources, lpass, { now: START + 2_000 });
    assert.deepEqual(await after.list("vault"), { rows: ROWS });
    assert.equal(listings(after), 1, "the rows went with the lock");
  });

  test("logged out and in again since the list: the entry is read once lpass fetches its copy", async () => {
    const sources = await newHelper();
    const lpass = fakeLpass();
    await hostWith(sources, lpass).list("vault");
    lpass.state.localCopy = false;
    const host = hostWith(sources, lpass, { now: START + 1_000 });
    assert.deepEqual(await host.runSource("vault", "1001", "password"), { secret: "s3cr3t-örnek" });
    assert.deepEqual(runs(host), [
      ["show", "--password", "--sync=no", "--color=never", "1001"],
      ["status", "-q"],
      ["show", "--password", "--sync=now", "--color=never", "1001"],
    ]);
  });

  test("row ids must be numbers", async () => {
    const host = hostWith(await newHelper(), fakeLpass());
    for (const rowId of ["1; rm", "--help", "-1", "", "12\n", "１２", "1001 "]) {
      await assert.rejects(host.runSource("vault", rowId, "password"), { message: SHOW_FAILED }, JSON.stringify(rowId));
    }
    assert.deepEqual(runs(host), [], "show never runs");
  });
});

describe("everywhere", () => {
  /** Every path through list and run, each on a host of its own; resolves to the hosts. */
  async function everyPath() {
    const hosts = [];
    const on = async (changes, work, sources) => {
      const host = hostWith(sources ?? await newHelper(), fakeLpass(changes));
      hosts.push(host);
      await settled(work(host));
    };
    const sources = await newHelper();
    await on({}, (host) => host.list("vault"), sources);
    await on({}, (host) => host.list("vault"), sources);
    await on({ loggedIn: false }, (host) => host.list("vault"));
    await on({ version: "LastPass CLI v1.6.0" }, (host) => host.list("vault"));
    await on({ listExit: 1, listStderr: "Error: s3cr3t-örnek\n" }, (host) => host.list("vault"));
    await on({ localCopy: false }, (host) => host.list("vault"));
    await on({ localCopy: false }, (host) => host.runSource("vault", "1001", "password"));
    await on({}, async (host) => {
      await host.runSource("vault", "1001", "password");
      await host.runSource("vault", "1001", "username");
    });
    await on({}, (host) => host.runSource("vault", "1003", "password"));
    await on({}, (host) => host.runSource("vault", "1003", "username"));
    await on({ show: { exitCode: 1, stdout: "", stderr: "Error: s3cr3t-örnek\n" } }, (host) => host.runSource("vault", "1001", "password"));
    await on({ loggedIn: false, show: { exitCode: 1, stdout: "s3cr3t-örnek\n", stderr: "" } }, (host) => host.runSource("vault", "1001", "password"));
    await on({}, (host) => host.runSource("vault", "1; rm", "password"));
    return hosts;
  }

  test("nothing is logged", async () => {
    for (const host of await everyPath()) assert.deepEqual(host.logs, []);
  });

  test("nothing is stored", async () => {
    for (const host of await everyPath()) {
      assert.deepEqual(host.storage, {});
      assert.deepEqual(host.calls.filter((call) => call.api !== "exec"), [], "lpass is the only thing it calls");
    }
  });

  test("every lpass run carries the call's signal", async () => {
    const lpass = fakeLpass();
    const host = hostWith(await newHelper(), lpass);
    const signals = [];
    const exec = host.yab.exec;
    host.yab.exec = (tool, args, options) => {
      signals.push(options?.signal);
      return exec(tool, args, options);
    };
    await host.list("vault");
    await host.runSource("vault", "1001", "password");
    lpass.state.show = { exitCode: 1, stdout: "", stderr: "" };
    await settled(host.runSource("vault", "1001", "password"));
    assert.equal(signals.length, 7, "the status and the fetching show after a failed show too");
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  });

  test("answers in Turkish", async () => {
    const locked = hostWith(await newHelper(), fakeLpass({ loggedIn: false }), { language: "tr" });
    assert.deepEqual(await locked.list("vault"), { locked: true, message: "LastPass kilitli", command: "lpass login --trust <e-posta>" });
    const host = hostWith(await newHelper(), fakeLpass(), { language: "tr" });
    await assert.rejects(host.runSource("vault", "1003", "password"), { message: "Bu kaydın şifresi okunamadı (lpass güncellenmeli olabilir)." });
    await assert.rejects(host.runSource("vault", "x", "password"), { message: "lpass bu kaydı okuyamadı." });
    const old = hostWith(await newHelper(), fakeLpass({ version: "LastPass CLI v1.6.0" }), { language: "tr" });
    assert.deepEqual(await old.list("vault"), { locked: true, message: "lpass güncellenmeli", command: "brew upgrade lastpass-cli" });
  });

  test("without lpass every call fails as toolMissing, with the manifest's install command", async () => {
    const host = createFakeHost({ folder, sources: await newHelper() });
    await assert.rejects(host.list("vault"), { code: "toolMissing", message: /brew install lastpass-cli/ });
  });
});
