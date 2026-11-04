import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

const folder = new URL("..", import.meta.url);
const START = Date.parse("2026-01-01T09:00:00Z");
const FIVE_MINUTES = 5 * 60_000;

let helpers = 0;
/**
 * The extension as a newly started helper has it: a module of its own, so no op version is known yet, nothing is
 * cached and no listing is on its way. The fake host does not import the extension; it calls the export it is given.
 */
async function newHelper() {
  return (await import(`../src/index.ts?helper=${++helpers}`)).sources;
}
const { DEADLINE } = await import("../src/index.ts");

// Synthetic values, put together here so that nothing in this file looks like a real credential.
const PASSWORD = ["s3cr3t", "örnek", "parola"].join("-");
const OTHER_SECRET = ["gizli", "deger", "42"].join("_");
const CODE = "48" + "2913";
/** Every value a test hands op that must never reach a row, a log line or a message. */
const SECRETS = [PASSWORD, OTHER_SECRET, CODE];
const leaks = (text) => SECRETS.some((secret) => String(text).includes(secret));

/** A synthetic 1Password id: 26 letters and digits. */
const idOf = (name) => `${name}${"0".repeat(26)}`.slice(0, 26);
const ID = {
  posta: idOf("posta"),
  ornek: idOf("ornek"),
  kasa: idOf("kasa"),
  yerel: idOf("yerel"),
  zeplin: idOf("zeplin"),
  note: idOf("note"),
  only: idOf("onlypassword"),
};

/** What `op item list --categories Login --format json` prints, item by item; the non-Logins test the filter. */
const login = (id, title, more = {}) => ({
  id, title, version: 3, vault: { id: idOf("vault"), name: "Kişisel" }, category: "LOGIN",
  last_edited_by: idOf("editor"), created_at: "2025-06-01T10:00:00Z", updated_at: "2025-12-01T10:00:00Z", ...more,
});
const ITEMS = [
  login(ID.posta, "Posta", { additional_information: "deniz.k@ornek.dev", urls: [{ label: "website", primary: true, href: "https://posta.ornek.dev/giris" }] }),
  login(ID.ornek, "ornek.dev", { additional_information: "deniz.k", urls: [{ primary: true, href: "https://www.ornek.dev" }] }),
  login(ID.kasa, "Kasa", { additional_information: "", urls: [{ href: "kasa.ornek.dev:8443/panel" }] }),
  login(ID.yerel, "Yerel ağ"),
  login(ID.zeplin, "Zeplin", { favorite: true, additional_information: "deniz", urls: [{ primary: true, href: "https://zeplin.ornek.dev" }] }),
  { ...login(ID.note, "Wi-Fi notu"), category: "SECURE_NOTE" },
  { ...login(ID.only, "Yalnız şifre"), category: "PASSWORD" },
];
const ROWS = [
  { id: ID.zeplin, title: "Zeplin", subtitle: "deniz · zeplin.ornek.dev" },
  { id: ID.kasa, title: "Kasa", subtitle: "kasa.ornek.dev" },
  { id: ID.ornek, title: "ornek.dev", subtitle: "deniz.k" },
  { id: ID.posta, title: "Posta", subtitle: "deniz.k@ornek.dev · posta.ornek.dev" },
  { id: ID.yerel, title: "Yerel ağ" },
];

/** Each item's fields as `op item get --fields label=… --format json` gives them, and its current one-time code. */
const FIELDS = {
  [ID.posta]: { password: PASSWORD, username: "deniz.k@ornek.dev" },
  [ID.ornek]: { password: `  ${PASSWORD}, "quoted"\t\n`, username: " deniz.k " },
  [ID.kasa]: { password: "", username: "" },
  [ID.yerel]: { password: " \t ", username: "  " },
  [ID.zeplin]: { password: PASSWORD, username: "deniz" },
};
const CODES = { [ID.posta]: CODE, [ID.zeplin]: CODE };

const LIST = ["item", "list", "--categories", "Login", "--format", "json"];
const passwordRead = (id, ...more) => ["item", "get", id, "--fields", "label=password", "--format", "json", "--reveal", ...more];
const usernameRead = (id, ...more) => ["item", "get", id, "--fields", "label=username", "--format", "json", "--reveal", ...more];
const codeRead = (id, ...more) => ["item", "get", id, "--otp", ...more];

const ERROR = (text) => `[ERROR] 2026/01/01 09:00:00 ${text}\n`;
const NO_ACCOUNTS = ERROR("No accounts configured for use with 1Password CLI.");
const NOT_SIGNED_IN = ERROR("You are not currently signed in. Please run `op signin --help` for instructions");
const NO_APP = ERROR("error initializing client: connecting to desktop app: read: connection reset, make sure 1Password CLI is installed correctly, then open the 1Password app, select 1Password > Settings > Developer and make sure the 'Integrate with 1Password CLI' setting is turned on.");
const DISMISSED = ERROR("authorization prompt dismissed, please try again");

/**
 * A fake op answering the extension's commands the way the real one does with the 1Password app integration. Change
 * `op.state` to lock the app, turn the integration off, age the tool or make a command fail:
 *   approved     whether op answers for the app without asking (`op whoami` succeeds); a listing that the person
 *                approves makes it true again
 *   unlocked     false: 1Password is locked and the person dismisses its prompt
 *   list / get   replace every `op item list` / `op item get` answer (a result, a promise or a function of the args)
 */
function fakeOp(changes = {}) {
  const state = { version: "2.32.0", integration: true, approved: true, unlocked: true, items: ITEMS, fields: FIELDS, codes: CODES, list: undefined, get: undefined, ...changes };
  const ok = (stdout) => ({ exitCode: 0, stdout, stderr: "" });
  const fail = (stderr) => ({ exitCode: 1, stdout: "", stderr });
  const op = (args) => {
    if (args[0] === "--version") return ok(`${state.version}\n`);
    if (!state.integration) return fail(NO_ACCOUNTS);
    if (args[0] === "whoami") {
      return state.approved && state.unlocked
        ? ok(`${JSON.stringify({ url: "https://my.1password.com", email: "deniz.k@ornek.dev", user_uuid: idOf("user"), account_uuid: idOf("account") })}\n`)
        : fail(ERROR("account is not signed in"));
    }
    if (!state.unlocked) return fail(DISMISSED);
    state.approved = true;
    if (args[0] === "item" && args[1] === "list") {
      if (state.list !== undefined) return typeof state.list === "function" ? state.list(args) : state.list;
      return ok(`${JSON.stringify(state.items, null, 2)}\n`);
    }
    if (args[0] === "item" && args[1] === "get") {
      if (state.get !== undefined) return typeof state.get === "function" ? state.get(args) : state.get;
      const id = args[2];
      const fields = state.fields[id];
      if (fields === undefined) return fail(ERROR(`"${id}" isn't an item. Specify the item with its UUID, name, or domain.`));
      if (args.includes("--otp")) {
        const code = state.codes[id];
        return code === undefined ? fail(ERROR(`item "${id}" does not have a one-time password field`)) : ok(`${code}\n`);
      }
      const label = args[args.indexOf("--fields") + 1].replace(/^label=/, "");
      const purpose = { password: "PASSWORD", username: "USERNAME" }[label];
      const field = { id: label, type: label === "password" ? "CONCEALED" : "STRING", purpose, label, value: fields[label], reference: `op://Kişisel/${id}/${label}` };
      return ok(`${JSON.stringify(field, null, 2)}\n`);
    }
    return fail(ERROR(`unknown command "${args[0]}" for "op"`));
  };
  return Object.assign(op, { state });
}

function hostWith(sources, op, { now = START, language = "en", preferences = {} } = {}) {
  return createFakeHost({ folder, sources, exec: { op }, now, context: { language }, preferences });
}
/** The arguments of each op run, in order. */
const runs = (host) => host.calls.filter((call) => call.api === "exec" && call.args[0] === "op").map((call) => call.args[1]);
const commands = (host) => runs(host).map((args) => (args[0] === "item" ? `item ${args[1]}` : args[0]));
const listings = (host) => commands(host).filter((command) => command === "item list").length;
const settled = (promise) => promise.then(() => undefined, () => undefined);
/** A promise op never answers, as when it waits for a prompt nobody answers. */
const never = () => new Promise(() => {});
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
/** For tests that wait on op: a regression fails them instead of leaving them waiting. */
const WAITS = { timeout: 5_000 };

const SETUP = { locked: true, message: "Open 1Password and turn on “Integrate with 1Password CLI” in Settings › Developer." };
const LOCKED = { locked: true, message: "1Password is locked or didn’t allow access. Unlock it and approve its prompt, then open this column again." };
const UPDATE = { locked: true, message: "op needs an update", command: "brew upgrade 1password-cli" };
const READ_FAILED = "op could not read this item.";
const LIST_FAILED = "op could not list your logins.";

describe("list", () => {
  test("logins: favorites first, then by name, with the username and the website below", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    assert.deepEqual(await host.list("logins"), { rows: ROWS });
    assert.deepEqual(runs(host), [["--version"], LIST]);
  });

  test("the codes column lists the same logins", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    assert.deepEqual(await host.list("codes"), { rows: ROWS });
  });

  test("only Login items are listed", async () => {
    const items = [
      login(idOf("a"), "Giriş"),
      { ...login(idOf("b"), "Not"), category: "SECURE_NOTE" },
      { ...login(idOf("c"), "Kart"), category: "CREDIT_CARD" },
      { ...login(idOf("d"), "Şifre"), category: "PASSWORD" },
      { ...login(idOf("e"), "Kategorisiz"), category: undefined },
      { ...login(idOf("f"), "Küçük harf"), category: "login" },
    ];
    const host = hostWith(await newHelper(), fakeOp({ items }));
    assert.deepEqual(await host.list("logins"), { rows: [{ id: idOf("a"), title: "Giriş" }, { id: idOf("f"), title: "Küçük harf" }] });
  });

  test("odd characters in a title stay, on one line", async () => {
    const titles = ["Ev\tWi-Fi", "Çok\nsatırlı", "  boşluklu  ", "שלום · مرحبا", "“Tırnak” 'işareti' & <etiket>", "Kedi 🐈‍⬛"];
    const items = titles.map((title, index) => login(idOf(`odd${index}`), title));
    const host = hostWith(await newHelper(), fakeOp({ items }));
    const { rows } = await host.list("logins");
    assert.deepEqual(rows.map((row) => row.title).sort(), ["Ev Wi-Fi", "Çok satırlı", "boşluklu", "שלום · مرحبا", "“Tırnak” 'işareti' & <etiket>", "Kedi 🐈‍⬛"].sort());
  });

  test("a login without a name takes its website's, and one without either is left out", async () => {
    const items = [
      login(idOf("named"), "", { urls: [{ primary: true, href: "https://adsiz.ornek.dev" }], additional_information: "deniz" }),
      login(idOf("blank"), " \u2028\u3000 "),
      login(idOf("none")),
    ];
    const host = hostWith(await newHelper(), fakeOp({ items }));
    assert.deepEqual(await host.list("logins"), { rows: [{ id: idOf("named"), title: "adsiz.ornek.dev", subtitle: "deniz" }] });
  });

  test("the website is its host only, and only for web links", async () => {
    const cases = [
      [[{ primary: true, href: "https://www.ornek.dev/giris?x=1#y" }], "ornek.dev"],
      [[{ href: "http://ornek.dev:8080" }], "ornek.dev"],
      [[{ href: "ORNEK.dev." }], "ornek.dev"],
      [[{ href: "https://örnek.dev" }], "örnek.dev"],
      [[{ href: "https://ilk.ornek.dev" }, { primary: true, href: "https://asil.ornek.dev" }], "asil.ornek.dev"],
      [[{ href: `https://deniz:${PASSWORD}@ornek.dev/` }], "ornek.dev"],
      [[{ href: `https://deniz:${OTHER_SECRET}/x@ornek.dev/` }], ""],
      [[{ href: `deniz:${OTHER_SECRET}@ornek.dev` }], "ornek.dev"],
      [[{ href: "ssh://sunucu.ornek.dev" }], ""],
      [[{ href: "androidapp://dev.ornek.app" }], ""],
      [[{ href: "https://[::1]:8080" }], ""],
      [[{ href: "" }], ""],
      [[{ label: "website" }], ""],
      ["https://ornek.dev", ""],
    ];
    for (const [urls, host] of cases) {
      const items = [login(idOf("site"), "Site", { urls })];
      const listing = await hostWith(await newHelper(), fakeOp({ items })).list("logins");
      assert.deepEqual(listing, { rows: [host === "" ? { id: idOf("site"), title: "Site" } : { id: idOf("site"), title: "Site", subtitle: host }] }, JSON.stringify(urls));
      assert.ok(!leaks(JSON.stringify(listing)), "a password written into a link never shows");
    }
  });

  test("ids op would not take back are left out, and an id listed twice keeps its first row", async () => {
    const items = [
      login(idOf("first"), "İlk"),
      login(idOf("first"), "İkinci"),
      login("--reveal", "Seçenek"),
      login("ab cd", "Boşluklu"),
      login("x".repeat(65), "Uzun"),
      login("", "Boş"),
      login(42, "Sayı"),
      login("１２", "Geniş"),
      { title: "Kimliksiz", category: "LOGIN" },
      null,
      "metin",
    ];
    const host = hostWith(await newHelper(), fakeOp({ items }));
    assert.deepEqual(await host.list("logins"), { rows: [{ id: idOf("first"), title: "İlk" }] });
  });

  test("an empty vault has no rows", async () => {
    for (const stdout of ["[]\n", "", "\n"]) {
      const host = hostWith(await newHelper(), fakeOp({ list: { exitCode: 0, stdout, stderr: "" } }));
      assert.deepEqual(await host.list("logins"), { rows: [] }, JSON.stringify(stdout));
    }
  });

  test("rows come from every line of standard output, and none of standard error", async () => {
    // Far more than the 64 KB of output an exec result keeps: every item still becomes a row.
    const items = Array.from({ length: 2000 }, (_, index) =>
      login(`bulk${String(index).padStart(4, "0")}`.padEnd(26, "0"), `Site ${index}`, { additional_information: "deniz.k", urls: [{ primary: true, href: `https://site-${index}.ornek.dev` }] }));
    const stdout = `${JSON.stringify(items, null, 2)}\n`;
    assert.ok(stdout.length > 64 * 1024 * 4);
    const stderr = `${JSON.stringify([login(idOf("hidden"), PASSWORD)])}\n`;
    const host = hostWith(await newHelper(), fakeOp({ list: { exitCode: 0, stdout, stderr } }));
    const { rows } = await host.list("logins");
    assert.equal(rows.length, 2000);
    assert.deepEqual(rows[0], { id: "bulk0000".padEnd(26, "0"), title: "Site 0", subtitle: "deniz.k · site-0.ornek.dev" });
    assert.equal(rows.at(-1).title, "Site 1999", "names are ordered as a person counts");
    assert.ok(!rows.some((row) => row.id === idOf("hidden")));
  });

  test("output that is not op's JSON list fails in the extension's own words, and is not cached", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    for (const stdout of [`[{"id": "${idOf("x")}", "title": "${PASSWORD}"`, `{"title": "${PASSWORD}"}`, `"${PASSWORD}"`, "null"]) {
      op.state.list = { exitCode: 0, stdout, stderr: "" };
      const host = hostWith(sources, op);
      await assert.rejects(host.list("logins"), (error) => {
        assert.equal(error.message, LIST_FAILED);
        assert.ok(!leaks(error.message) && !leaks(error.stack), "never the parser's message, which quotes the output");
        return true;
      }, stdout);
    }
    op.state.list = undefined;
    const host = hostWith(sources, op);
    assert.deepEqual(await host.list("logins"), { rows: ROWS });
    assert.equal(listings(host), 1);
  });

  test("the list is reused for five minutes while op still answers for the app", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    const first = hostWith(sources, op, { now: START });
    assert.deepEqual(await first.list("logins"), { rows: ROWS });

    op.state.items = [login(idOf("new"), "Yeni")];
    const second = hostWith(sources, op, { now: START + FIVE_MINUTES });
    assert.deepEqual(await second.list("codes"), { rows: ROWS }, "either column");
    assert.deepEqual(runs(second), [["whoami"]], "op whoami, which never asks for Touch ID; no listing");

    const third = hostWith(sources, op, { now: START + FIVE_MINUTES + 1 });
    assert.deepEqual(await third.list("logins"), { rows: [{ id: idOf("new"), title: "Yeni" }] });
    assert.deepEqual(runs(third), [LIST]);
  });

  test("once op stops answering for the app, the rows go and the listing asks again", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    await hostWith(sources, op).list("logins");
    op.state.approved = false;
    op.state.items = [login(idOf("new"), "Yeni")];
    const host = hostWith(sources, op, { now: START + 1_000 });
    assert.deepEqual(await host.list("logins"), { rows: [{ id: idOf("new"), title: "Yeni" }] });
    assert.deepEqual(runs(host), [["whoami"], LIST], "the listing is what shows 1Password’s prompt");
  });

  test("a clock that went back lists again", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    await hostWith(sources, op, { now: START }).list("logins");
    const host = hostWith(sources, op, { now: START - 1 });
    await host.list("logins");
    assert.deepEqual(runs(host), [LIST]);
  });

  test("both columns opened at once share one listing, and one prompt", async () => {
    const op = fakeOp();
    const host = hostWith(await newHelper(), op);
    const [logins, codes] = await Promise.all([host.list("logins"), host.list("codes")]);
    assert.deepEqual(logins, { rows: ROWS });
    assert.deepEqual(codes, { rows: ROWS });
    assert.equal(listings(host), 1);
    assert.equal(commands(host).filter((command) => command === "--version").length, 1);
  });

  test("a column whose shared op was stopped with the other column’s call lists again on its own", WAITS, async () => {
    const sources = await newHelper();
    let answer;
    const op = fakeOp();
    op.state.list = () => new Promise((resolve) => { answer = resolve; });
    const first = hostWith(sources, op);
    const second = hostWith(sources, op);
    const cancelled = first.list("logins");
    await nextTurn();
    const waiting = second.list("codes");
    await nextTurn();
    op.state.list = undefined;
    first.cancel();
    await assert.rejects(cancelled, { code: "cancelled" });
    assert.deepEqual(await waiting, { rows: ROWS });
    assert.equal(listings(second), 1, "its own listing, after the shared one stopped");
    answer?.({ exitCode: 0, stdout: "[]", stderr: "" });
  });

  test("cancelling lets the cancel through and stops op", WAITS, async () => {
    const host = hostWith(await newHelper(), fakeOp({ list: never }));
    const signals = [];
    const exec = host.yab.exec;
    host.yab.exec = (tool, args, options) => {
      signals.push(options?.signal);
      return exec(tool, args, options);
    };
    const listing = host.list("logins");
    await nextTurn();
    assert.equal(signals.at(-1).aborted, false);
    host.cancel();
    await assert.rejects(listing, { code: "cancelled" });
    assert.equal(signals.at(-1).aborted, true, "op's own signal aborts with the last call waiting for it");
  });
});

describe("locked", () => {
  test("with the CLI integration off, the row says where to turn it on", async () => {
    const host = hostWith(await newHelper(), fakeOp({ integration: false }));
    assert.deepEqual(await host.list("logins"), SETUP);
    assert.deepEqual(runs(host), [["--version"], LIST]);
  });

  test("not signed in, or without the app, says the same", async () => {
    for (const stderr of [NOT_SIGNED_IN, NO_APP, ERROR("LostConnectionToApp")]) {
      const host = hostWith(await newHelper(), fakeOp({ list: { exitCode: 1, stdout: "", stderr } }));
      assert.deepEqual(await host.list("codes"), SETUP, stderr);
    }
  });

  test("a locked 1Password, or a dismissed prompt, asks to unlock it", async () => {
    const host = hostWith(await newHelper(), fakeOp({ unlocked: false }));
    assert.deepEqual(await host.list("logins"), LOCKED);
    for (const stderr of [ERROR("authorization timeout"), ERROR("authorization denied"), ERROR("1Password is locked")]) {
      const other = hostWith(await newHelper(), fakeOp({ list: { exitCode: 1, stdout: "", stderr } }));
      assert.deepEqual(await other.list("logins"), LOCKED, stderr);
    }
  });

  test("a locked answer lets the rows go", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    await hostWith(sources, op, { now: START }).list("logins");

    Object.assign(op.state, { unlocked: false });
    assert.deepEqual(await hostWith(sources, op, { now: START + 1_000 }).list("logins"), LOCKED);

    Object.assign(op.state, { unlocked: true, approved: true });
    const after = hostWith(sources, op, { now: START + 2_000 });
    assert.deepEqual(await after.list("logins"), { rows: ROWS });
    assert.deepEqual(runs(after), [LIST], "listed again, well within five minutes");
  });

  test("any other failure says so without op’s output, and is not cached", async () => {
    const sources = await newHelper();
    const op = fakeOp({ list: { exitCode: 1, stdout: PASSWORD, stderr: ERROR(`something broke near ${PASSWORD}`) } });
    await assert.rejects(hostWith(sources, op).list("logins"), (error) => {
      assert.equal(error.message, LIST_FAILED);
      assert.ok(!leaks(error.message) && !leaks(error.stack));
      return true;
    });
    op.state.list = undefined;
    const host = hostWith(sources, op);
    assert.deepEqual(await host.list("logins"), { rows: ROWS });
    assert.equal(listings(host), 1);
  });

  test("without op every call fails as toolMissing, with the manifest’s install command", async () => {
    const host = createFakeHost({ folder, sources: await newHelper() });
    await assert.rejects(host.list("logins"), { code: "toolMissing", message: /brew install 1password-cli/ });
    await assert.rejects(host.runSource("logins", ID.posta, "password"), { code: "toolMissing" });
    await assert.rejects(host.runSource("codes", ID.posta, "code"), { code: "toolMissing" });
  });
});

describe("op version", () => {
  test("an old op shows a calm row with the command that updates it", async () => {
    const host = hostWith(await newHelper(), fakeOp({ version: "2.29.0" }));
    assert.deepEqual(await host.list("logins"), UPDATE);
    assert.deepEqual(runs(host), [["--version"]], "nothing else runs");
  });

  test("versions are compared as numbers, and an unreadable one asks for an update", async () => {
    for (const version of ["2.30.0", "2.30.1", "2.32.0-beta.01", "2.100.0", "3.0.0"]) {
      assert.deepEqual(await hostWith(await newHelper(), fakeOp({ version })).list("logins"), { rows: ROWS }, version);
    }
    for (const version of ["2.29.9", "2.3.0", "1.12.4", "op", ""]) {
      assert.deepEqual(await hostWith(await newHelper(), fakeOp({ version })).list("logins"), UPDATE, version);
    }
  });

  test("the version is asked once per helper, and every time until it is recent enough", async () => {
    const sources = await newHelper();
    const op = fakeOp({ version: "2.24.0" });
    assert.deepEqual(await hostWith(sources, op).list("logins"), UPDATE);
    assert.deepEqual(await hostWith(sources, op).list("logins"), UPDATE);
    op.state.version = "2.32.0";
    const updated = hostWith(sources, op);
    assert.deepEqual(await updated.list("logins"), { rows: ROWS }, "noticed without a restart");
    const later = hostWith(sources, op, { now: START + 1_000 });
    await later.list("logins");
    await later.runSource("logins", ID.posta, "password");
    assert.deepEqual(commands(later), ["whoami", "item get"]);
  });

  test("a value is not read with an old op", async () => {
    const host = hostWith(await newHelper(), fakeOp({ version: "2.29.0" }));
    await assert.rejects(host.runSource("logins", ID.posta, "password"), { message: "op needs an update: brew upgrade 1password-cli" });
    assert.deepEqual(runs(host), [["--version"]]);
  });
});

describe("settings", () => {
  test("the account and the vault reach op as one argument each", async () => {
    const preferences = { account: "  my.1password.com ", vault: ` İş "Ortak" -- --reveal ` };
    const host = hostWith(await newHelper(), fakeOp(), { preferences });
    await host.list("logins");
    await host.runSource("logins", ID.posta, "password");
    await host.runSource("codes", ID.posta, "code");
    assert.deepEqual(runs(host), [
      ["--version"],
      [...LIST, `--vault=İş "Ortak" -- --reveal`, "--account=my.1password.com"],
      passwordRead(ID.posta, "--account=my.1password.com"),
      codeRead(ID.posta, "--account=my.1password.com"),
    ]);
    const later = hostWith(await newHelper(), fakeOp(), { preferences: { account: "https://ornek-sirket.1password.eu" } });
    await later.list("logins");
    await later.list("logins");
    assert.deepEqual(runs(later).at(-1), ["whoami", "--account=https://ornek-sirket.1password.eu"]);
  });

  test("an account that is neither an address nor an ID never reaches op", async () => {
    const message = "The account in Settings should be a sign-in address, such as my.1password.com, or an ID.";
    for (const account of ["--debug", "-x", "iki kelime", "satır\nsonu", "a".repeat(256), "ünlü.1password.com"]) {
      const host = hostWith(await newHelper(), fakeOp(), { preferences: { account } });
      assert.deepEqual(await host.list("logins"), { locked: true, message }, JSON.stringify(account));
      await assert.rejects(host.runSource("logins", ID.posta, "password"), { message });
      assert.deepEqual(runs(host), []);
    }
  });

  test("a vault that is not on one line never reaches op", async () => {
    const message = "The vault in Settings should be one vault’s name or ID, on one line.";
    for (const vault of ["İş\nEv", "İş\u2028Ev", "\u0000", "k".repeat(256)]) {
      const host = hostWith(await newHelper(), fakeOp(), { preferences: { vault } });
      assert.deepEqual(await host.list("logins"), { locked: true, message }, JSON.stringify(vault));
      assert.deepEqual(runs(host), []);
    }
  });

  test("other settings list again, without the rows of the last ones", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    await hostWith(sources, op).list("logins");
    const host = hostWith(sources, op, { now: START + 1_000, preferences: { vault: "İş" } });
    await host.list("logins");
    assert.deepEqual(runs(host), [[...LIST, "--vault=İş"]]);
  });

  test("a vault or an account 1Password does not have is named", async () => {
    const vault = hostWith(await newHelper(), fakeOp({ list: { exitCode: 1, stdout: "", stderr: ERROR(`"Locked Stuff" isn't a vault in this account. Specify the vault with its ID or name.`) } }), { preferences: { vault: "Locked Stuff" } });
    assert.deepEqual(await vault.list("logins"), { locked: true, message: "1Password has no vault “Locked Stuff”. Check the vault in Settings." }, "the vault’s name never reads as a lock");
    const account = hostWith(await newHelper(), fakeOp({ list: { exitCode: 1, stdout: "", stderr: ERROR(`no account found for filter "ornek.1password.com"`) } }), { preferences: { account: "ornek.1password.com" } });
    assert.deepEqual(await account.list("logins"), { locked: true, message: "1Password has no account “ornek.1password.com”. Check the account in Settings." });
    const named = hostWith(await newHelper(), fakeOp({ list: { exitCode: 1, stdout: "", stderr: ERROR(`no account found for filter "locked.1password.com"`) } }), { preferences: { account: "locked.1password.com" } });
    assert.deepEqual(await named.list("logins"), { locked: true, message: "1Password has no account “locked.1password.com”. Check the account in Settings." }, "the account’s name never reads as a lock");
  });

  test("settings that never reach op let the rows go too", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    await hostWith(sources, op).list("logins");
    assert.equal((await hostWith(sources, op, { now: START + 1_000, preferences: { account: "-x" } }).list("logins")).locked, true);
    const after = hostWith(sources, op, { now: START + 2_000 });
    await after.list("logins");
    assert.deepEqual(runs(after), [LIST], "listed again, not reused");
  });
});

describe("run", () => {
  test("the password is a secret, the username is text, each read as one field", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    assert.deepEqual(await host.runSource("logins", ID.posta, "password"), { secret: PASSWORD });
    assert.deepEqual(await host.runSource("logins", ID.posta, "username"), { text: "deniz.k@ornek.dev" });
    assert.deepEqual(runs(host), [["--version"], passwordRead(ID.posta), usernameRead(ID.posta)]);
  });

  test("a value is pasted exactly as 1Password keeps it", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    assert.deepEqual(await host.runSource("logins", ID.ornek, "password"), { secret: `  ${PASSWORD}, "quoted"\t\n` });
    assert.deepEqual(await host.runSource("logins", ID.ornek, "username"), { text: " deniz.k " });
  });

  test("of several fields with the label, the Login’s own is pasted", async () => {
    const fields = [
      { id: idOf("custom"), type: "CONCEALED", label: "password", value: OTHER_SECRET, section: { id: "extra" } },
      { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: PASSWORD },
    ];
    const host = hostWith(await newHelper(), fakeOp({ get: { exitCode: 0, stdout: JSON.stringify(fields), stderr: "" } }));
    assert.deepEqual(await host.runSource("logins", ID.posta, "password"), { secret: PASSWORD });
  });

  test("an empty password or username is never pasted", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    for (const id of [ID.kasa, ID.yerel]) {
      await assert.rejects(host.runSource("logins", id, "password"), { message: "This item has no password." });
      await assert.rejects(host.runSource("logins", id, "username"), { message: "This item has no username." });
    }
    for (const stdout of ["", "\n", "[]", `{"id": "password", "label": "password"}`, `{"id": "password", "value": 42}`]) {
      const other = hostWith(await newHelper(), fakeOp({ get: { exitCode: 0, stdout, stderr: "" } }));
      await assert.rejects(other.runSource("logins", ID.posta, "password"), { message: "This item has no password." }, JSON.stringify(stdout));
    }
  });

  test("the code is the current one-time code", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    assert.deepEqual(await host.runSource("codes", ID.zeplin, "code"), { secret: CODE });
    assert.deepEqual(runs(host), [["--version"], codeRead(ID.zeplin)]);
  });

  test("an item without a one-time code says so", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    await assert.rejects(host.runSource("codes", ID.ornek, "code"), { message: "This item has no one-time code." });
    for (const answer of [{ exitCode: 1, stdout: "", stderr: ERROR("no OTP field found") }, { exitCode: 0, stdout: "\n", stderr: "" }]) {
      const other = hostWith(await newHelper(), fakeOp({ get: answer }));
      await assert.rejects(other.runSource("codes", ID.ornek, "code"), { message: "This item has no one-time code." });
    }
  });

  test("a failed read never echoes op’s output", async () => {
    const get = { exitCode: 1, stdout: `${PASSWORD}\n`, stderr: ERROR(`could not decrypt ${OTHER_SECRET}`) };
    const host = hostWith(await newHelper(), fakeOp({ get }));
    for (const [source, action] of [["logins", "password"], ["logins", "username"], ["codes", "code"]]) {
      await assert.rejects(host.runSource(source, ID.posta, action), (error) => {
        assert.equal(error.message, READ_FAILED);
        assert.ok(!leaks(error.message) && !leaks(error.stack));
        return true;
      });
    }
  });

  test("output that is not op’s JSON fails in the extension’s own words", async () => {
    for (const stdout of [PASSWORD, `{"value": "${PASSWORD}"`, `"${PASSWORD}"`, "12"]) {
      const host = hostWith(await newHelper(), fakeOp({ get: { exitCode: 0, stdout, stderr: "" } }));
      await assert.rejects(host.runSource("logins", ID.posta, "password"), (error) => {
        assert.equal(error.message, READ_FAILED);
        assert.ok(!leaks(error.message) && !leaks(error.stack));
        return true;
      }, stdout);
    }
  });

  test("an item gone since the list says it could not be read", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    await assert.rejects(host.runSource("logins", idOf("gone"), "password"), { message: READ_FAILED });
    await assert.rejects(host.runSource("codes", idOf("gone"), "code"), { message: READ_FAILED });
  });

  test("a read refused because 1Password locked says so, and the rows go with the lock", async () => {
    const sources = await newHelper();
    const op = fakeOp();
    await hostWith(sources, op).list("logins");
    op.state.unlocked = false;
    const host = hostWith(sources, op, { now: START + 1_000 });
    const message = "1Password is locked or didn’t allow access. Unlock it and approve its prompt, then try again.";
    await assert.rejects(host.runSource("logins", ID.posta, "password"), { message });
    await assert.rejects(host.runSource("codes", ID.posta, "code"), { message });

    Object.assign(op.state, { unlocked: true, approved: true });
    const after = hostWith(sources, op, { now: START + 2_000 });
    assert.deepEqual(await after.list("logins"), { rows: ROWS });
    assert.deepEqual(runs(after), [LIST], "the rows went with the lock");
  });

  test("a read without the integration says where to turn it on", async () => {
    const host = hostWith(await newHelper(), fakeOp({ integration: false }));
    await assert.rejects(host.runSource("logins", ID.posta, "username"), { message: SETUP.message });
    await assert.rejects(host.runSource("codes", ID.posta, "code"), { message: SETUP.message });
  });

  test("an id named like a lock does not read as one", async () => {
    const id = `unlock${"0".repeat(20)}`;
    const host = hostWith(await newHelper(), fakeOp({ get: { exitCode: 1, stdout: "", stderr: ERROR(`"${id}" isn't an item.`) } }));
    await assert.rejects(host.runSource("logins", id, "password"), { message: READ_FAILED });
  });

  test("row ids must be letters and digits", async () => {
    const host = hostWith(await newHelper(), fakeOp());
    for (const rowId of ["--otp", "-x", "", "ab cd", `${ID.posta}\n`, "１２", "a".repeat(65), "op://Kişisel/x/password", "../x"]) {
      await assert.rejects(host.runSource("logins", rowId, "password"), { message: READ_FAILED }, JSON.stringify(rowId));
      await assert.rejects(host.runSource("codes", rowId, "code"), { message: READ_FAILED }, JSON.stringify(rowId));
    }
    assert.deepEqual(runs(host), [], "op never runs");
  });

  test("each column reads only its own values", async () => {
    const sources = await newHelper();
    const host = hostWith(sources, fakeOp());
    const restore = host.install();
    try {
      await assert.rejects(sources.logins.run(ID.posta, "code", host.context()), { message: READ_FAILED });
      await assert.rejects(sources.codes.run(ID.posta, "password", host.context()), { message: READ_FAILED });
    } finally {
      restore();
    }
    assert.deepEqual(runs(host), []);
    await assert.rejects(host.runSource("codes", ID.posta, "password"), { code: "notFound" });
  });
});

describe("time", () => {
  test("a listing op does not finish in time asks to approve 1Password’s prompt", WAITS, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const host = hostWith(await newHelper(), fakeOp({ list: never }));
      const listing = host.list("logins");
      await nextTurn();
      mock.timers.tick(DEADLINE - 1);
      await nextTurn();
      mock.timers.tick(1);
      assert.deepEqual(await listing, { locked: true, message: "1Password didn’t answer in time. Approve its prompt if it shows one, then open this column again." });
    } finally {
      mock.timers.reset();
    }
  });

  test("a read op does not finish in time says so", WAITS, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const host = hostWith(await newHelper(), fakeOp({ get: never }));
      const read = host.runSource("codes", ID.posta, "code");
      await nextTurn();
      mock.timers.tick(DEADLINE);
      await assert.rejects(read, { message: "1Password didn’t answer in time. Approve its prompt if it shows one, then try again." });
    } finally {
      mock.timers.reset();
    }
  });

  test("op is stopped well inside the app’s 10 seconds", () => {
    assert.ok(DEADLINE >= 5_000 && DEADLINE <= 9_000);
  });
});

describe("everywhere", () => {
  /** Every path through list and run, each on a host of its own; resolves to the hosts. */
  async function everyPath() {
    const hosts = [];
    const on = async (changes, work, sources, preferences) => {
      const host = hostWith(sources ?? await newHelper(), fakeOp(changes), { preferences });
      hosts.push(host);
      await settled(work(host));
    };
    const sources = await newHelper();
    await on({}, (host) => host.list("logins"), sources);
    await on({}, (host) => host.list("codes"), sources);
    await on({ approved: false }, (host) => host.list("logins"), sources);
    await on({ unlocked: false }, (host) => host.list("logins"));
    await on({ integration: false }, (host) => host.list("logins"));
    await on({ version: "2.20.0" }, (host) => host.list("logins"));
    await on({ list: { exitCode: 1, stdout: PASSWORD, stderr: ERROR(PASSWORD) } }, (host) => host.list("logins"));
    await on({ list: { exitCode: 0, stdout: `[{"title": "${PASSWORD}"`, stderr: "" } }, (host) => host.list("logins"));
    await on({}, (host) => host.list("logins"), undefined, { account: "--debug" });
    await on({}, async (host) => {
      await host.runSource("logins", ID.posta, "password");
      await host.runSource("logins", ID.posta, "username");
      await host.runSource("codes", ID.posta, "code");
    });
    await on({}, (host) => host.runSource("logins", ID.kasa, "password"));
    await on({}, (host) => host.runSource("codes", ID.kasa, "code"));
    await on({ get: { exitCode: 1, stdout: PASSWORD, stderr: ERROR(OTHER_SECRET) } }, (host) => host.runSource("logins", ID.posta, "password"));
    await on({ get: { exitCode: 0, stdout: PASSWORD, stderr: "" } }, (host) => host.runSource("logins", ID.posta, "password"));
    await on({ unlocked: false }, (host) => host.runSource("codes", ID.posta, "code"));
    await on({}, (host) => host.runSource("logins", "--otp", "password"));
    return hosts;
  }

  test("nothing is logged", async () => {
    for (const host of await everyPath()) assert.deepEqual(host.logs, []);
  });

  test("nothing is stored, and op is the only thing called", async () => {
    for (const host of await everyPath()) {
      assert.deepEqual(host.storage, {});
      assert.deepEqual(host.calls.filter((call) => call.api !== "exec"), []);
      assert.ok(!leaks(JSON.stringify(host.results)), "no value is kept among the results");
    }
  });

  test("no row ever carries a value", async () => {
    // A listing that, against op's habits, carried values: none reaches a row.
    const items = [login(ID.posta, "Posta", { additional_information: "deniz", password: PASSWORD, fields: [{ value: OTHER_SECRET }], notesPlain: CODE, urls: [{ href: `https://deniz:${PASSWORD}@ornek.dev` }] })];
    const listing = await hostWith(await newHelper(), fakeOp({ items })).list("logins");
    assert.deepEqual(listing, { rows: [{ id: ID.posta, title: "Posta", subtitle: "deniz · ornek.dev" }] });
    assert.ok(!leaks(JSON.stringify(listing)));
  });

  test("every op run carries a signal", async () => {
    const op = fakeOp();
    const host = hostWith(await newHelper(), op);
    const signals = [];
    const exec = host.yab.exec;
    host.yab.exec = (tool, args, options) => {
      signals.push(options?.signal);
      return exec(tool, args, options);
    };
    await host.list("logins");
    await host.list("codes");
    await host.runSource("logins", ID.posta, "password");
    await host.runSource("codes", ID.posta, "code");
    op.state.unlocked = false;
    await settled(host.runSource("logins", ID.posta, "username"));
    assert.equal(signals.length, 6);
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  });

  test("answers in Turkish", async () => {
    const tr = { language: "tr" };
    assert.deepEqual(await hostWith(await newHelper(), fakeOp({ integration: false }), tr).list("logins"),
      { locked: true, message: "1Password’ü aç ve Settings › Developer’da “Integrate with 1Password CLI” ayarını aç." });
    assert.deepEqual(await hostWith(await newHelper(), fakeOp({ unlocked: false }), tr).list("logins"),
      { locked: true, message: "1Password kilitli ya da erişime izin vermedi. Kilidini aç ve isteğini onayla, sonra bu sütunu yeniden aç." });
    assert.deepEqual(await hostWith(await newHelper(), fakeOp({ version: "2.1.0" }), tr).list("logins"),
      { locked: true, message: "op güncellenmeli", command: "brew upgrade 1password-cli" });
    const host = hostWith(await newHelper(), fakeOp(), tr);
    await assert.rejects(host.runSource("logins", ID.kasa, "password"), { message: "Bu kayıtta şifre yok." });
    await assert.rejects(host.runSource("logins", ID.kasa, "username"), { message: "Bu kayıtta kullanıcı adı yok." });
    await assert.rejects(host.runSource("codes", ID.kasa, "code"), { message: "Bu kayıtta tek kullanımlık kod yok." });
    await assert.rejects(host.runSource("logins", "x y", "password"), { message: "op bu kaydı okuyamadı." });
  });

  test("every key the code uses is in both locales", () => {
    const code = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const keys = new Set([...code.matchAll(/yab\.t\("([^"]+)"/g)].map((match) => match[1]));
    for (const { empty } of [{ empty: "noPassword" }, { empty: "noUsername" }]) keys.add(empty);
    for (const language of ["en", "tr"]) {
      const strings = JSON.parse(fs.readFileSync(new URL(`../locales/${language}.json`, import.meta.url), "utf8"));
      for (const key of keys) assert.equal(typeof strings[key], "string", `${language}: ${key}`);
      assert.deepEqual(Object.keys(strings).sort(), Object.keys(JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"))).sort(), language);
    }
  });

  test("the manifest keeps secrets in sensitive columns, runs only op and reaches no network", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.permissions, ["exec"]);
    assert.deepEqual(manifest.requires.tools, [{ name: "op", install: "brew install 1password-cli" }]);
    assert.equal(manifest.network, undefined);
    for (const source of manifest.contributes.sources) {
      assert.equal(source.sensitive, true, source.id);
      for (const action of source.actions.filter((candidate) => candidate.kind === "secret")) {
        assert.equal(action.copyTitle, undefined, action.id);
        assert.equal(action.copied, undefined, action.id);
      }
    }
  });
});
