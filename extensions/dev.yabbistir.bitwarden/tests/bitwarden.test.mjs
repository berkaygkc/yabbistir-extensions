import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

const folder = new URL("..", import.meta.url);
const START = Date.parse("2026-01-01T09:00:00Z");
const FIVE_MINUTES = 5 * 60_000;

let helpers = 0;
/**
 * The extension's `sources` as a newly started helper has them: a module of its own, so nothing is cached. The fake
 * host does not import the extension; it calls the export it is given.
 */
async function newHelper() {
  return (await import(`../src/index.ts?helper=${++helpers}`)).sources;
}

// Synthetic secrets, built at run time so no file holds anything shaped like a real one.
/** What `bw unlock --raw` prints: 64 bytes in Base64. */
const KEY = "S3ss" + "k".repeat(82) + "==";
const OTHER_KEY = "0ld" + "q".repeat(83) + "==";
/** A base32 authenticator key. */
const TOTP_KEY = ["ORNE", "KORN", "EKOR", "NEKO"].join("");
const PASSWORD = "s3cr3t-örnek";
const CODE = "4920" + "39";

const ID = (n) => `0b6c1a2e-5f3d-4c1a-9e7b-${String(n).padStart(12, "0")}`;
const login = (n, name, fields = {}, extra = {}) => ({
  object: "item", id: ID(n), organizationId: null, folderId: null, type: 1, reprompt: 0, name, notes: `${PASSWORD} notu`,
  favorite: false, login: { uris: [], username: null, password: PASSWORD, totp: null, passwordRevisionDate: null, ...fields },
  collectionIds: [], revisionDate: "2026-01-01T00:00:00.000Z", creationDate: "2026-01-01T00:00:00.000Z", deletedDate: null, ...extra,
});

/** A synthetic vault, as `bw list items` and `bw get item` describe it: every type, and odd logins among them. */
const ITEMS = [
  login(1, "ornek.dev", { username: "deniz.k", uris: [{ match: null, uri: "https://ornek.dev/giris" }], totp: TOTP_KEY }),
  login(2, "Posta", { username: "deniz.k@ornek.dev", uris: [{ match: null, uri: `https://deniz:${PASSWORD}@www.posta.ornek.dev:8443/gelen?token=${PASSWORD}` }], password: `  ${PASSWORD}\t\n` }, { favorite: true }),
  login(3, "Kasa", { username: "", password: "" }),
  login(4, "Sunucu", { uris: [{ match: null, uri: "androidapp://dev.ornek.app" }, { match: 0, uri: "sunucu.ornek.dev:22" }], totp: TOTP_KEY }, { reprompt: 1 }),
  { ...login(5, "Wi-Fi notu"), type: 2, login: undefined, secureNote: { type: 0 } },
  { ...login(6, "Kart"), type: 3, login: undefined, card: { number: "4111" + "1".repeat(12) } },
  { ...login(7, "Kimlik"), type: 4, login: undefined, identity: { firstName: "Deniz" } },
  { ...login(8, "Anahtar"), type: 5, login: undefined, sshKey: { privateKey: PASSWORD } },
  login(9, "  ", { username: "deniz.k" }),
  login(10, "İş\nportalı\tyeni", { username: "deniz.k", uris: [{ match: null, uri: "https://Is.Ornek.Dev/" }], totp: TOTP_KEY }),
  { ...login(11, "Bozuk", { username: "deniz.k" }), id: "x-11" },
  { ...login(12, "ornek.dev kopya", { username: "deniz.k" }), id: ID(1) },
  login(13, "Çöp", { username: "deniz.k" }, { deletedDate: "2026-01-02T00:00:00.000Z" }),
  login(14, "çarşı", { username: "deniz.k", totp: "  " }),
  // An organization's item whose password the person may not see: bw gives null for it and for its TOTP key.
  login(15, "Gizli", { username: "ekip", password: null }),
  login(16, "\u0085\u2028 \u3000", { username: "deniz.k" }),
];

const VAULT_ROWS = [
  { id: ID(2), title: "Posta", subtitle: "deniz.k@ornek.dev · posta.ornek.dev" },
  { id: ID(14), title: "çarşı", subtitle: "deniz.k" },
  { id: ID(15), title: "Gizli", subtitle: "ekip" },
  { id: ID(10), title: "İş portalı yeni", subtitle: "deniz.k · is.ornek.dev" },
  { id: ID(3), title: "Kasa" },
  { id: ID(1), title: "ornek.dev", subtitle: "deniz.k" },
  { id: ID(4), title: "Sunucu", subtitle: "sunucu.ornek.dev" },
];
/** Sunucu has a TOTP key too, but asks for the master password again: its code can never be pasted. */
const CODE_ROWS = [
  { id: ID(10), title: "İş portalı yeni", subtitle: "deniz.k · is.ornek.dev" },
  { id: ID(1), title: "ornek.dev", subtitle: "deniz.k" },
];

/** What `bw list items --response` prints for `items`, on one line. */
const listAnswer = (items = ITEMS) => ({ exitCode: 0, stdout: JSON.stringify({ success: true, data: { object: "list", data: items.filter((item) => item.deletedDate === null) } }), stderr: "" });

/**
 * A fake bw answering with --response as the real one does: `{ success, data }` or `{ success: false, message }` on
 * standard output, on one line (indented with --pretty), exit code 1 on a failure. Change `bw.state` to log out, lock
 * or make one command answer something else: `answers[command]` replaces the answer to `bw <command>` ("status",
 * "list", "get item", "get username", "get totp"), as an exec result or a function of the arguments.
 */
function fakeBw(changes = {}) {
  const state = { loggedIn: true, key: KEY, items: ITEMS, premium: true, answers: {}, ...changes };
  const blank = (value) => value === null || value === undefined || value.trim() === "";
  const bw = (args) => {
    const respond = (body, exitCode = 0) => ({ exitCode, stdout: JSON.stringify(body, null, args.includes("--pretty") ? "  " : undefined), stderr: "" });
    const ok = (data) => respond({ success: true, data });
    const fail = (message) => respond({ success: false, message }, 1);
    const at = args.indexOf("--session");
    const unlocked = state.loggedIn && at !== -1 && args[at + 1] === state.key;
    const [command, what, id] = args;
    const name = command === "get" ? `get ${what}` : command;
    const answer = state.answers[name];
    if (answer !== undefined) return typeof answer === "function" ? answer(args) : answer;
    if (command === "status") {
      return ok({ object: "template", template: {
        serverUrl: null, lastSync: state.loggedIn ? "2026-01-01T08:00:00.000Z" : null, userEmail: state.loggedIn ? "deniz.k@ornek.dev" : null,
        userId: state.loggedIn ? "5a1d0c3e-7b2f-4e6a-9c1d-000000000abc" : null, status: !state.loggedIn ? "unauthenticated" : unlocked ? "unlocked" : "locked",
      } });
    }
    if (!state.loggedIn) return fail("You are not logged in.");
    if (!unlocked) return fail("Vault is locked.");
    if (command === "list" && what === "items") return ok({ object: "list", data: state.items.filter((item) => item.deletedDate === null) });
    if (command === "get") {
      const item = state.items.find((candidate) => candidate.id === id);
      if (item === undefined) return fail("Not found.");
      if (what === "item") return ok(item);
      if (item.type !== 1) return fail("Not a login.");
      if (what === "username") return blank(item.login.username) ? fail("No username available for this login.") : ok({ object: "string", data: item.login.username });
      if (what === "totp") {
        if (blank(item.login.totp)) return fail("No TOTP available for this login.");
        if (!state.premium) return fail("Premium status is required to use this feature.");
        return ok({ object: "string", data: CODE });
      }
    }
    return fail("Invalid command.");
  };
  return Object.assign(bw, { state });
}

/** A host for `sources` with `bw` installed; `key: null` is no session key in Settings. */
function hostWith(sources, bw, { key = KEY, now = START, language = "en" } = {}) {
  return createFakeHost({ folder, sources, exec: { bw }, secrets: key === null ? {} : { session: key }, now, context: { language } });
}
/** The arguments of each bw run, in order. */
const runs = (host) => host.calls.filter((call) => call.api === "exec" && call.args[0] === "bw").map((call) => call.args[1]);
/** Each bw run's command, without its options: "status", "list items", "get item". */
const commands = (host) => runs(host).map((args) => args.slice(0, args[0] === "status" ? 1 : 2).join(" "));
const listings = (host) => commands(host).filter((command) => command === "list items").length;
const settled = (promise) => promise.then(() => undefined, () => undefined);
const OPTIONS = ["--session", KEY, "--nointeraction", "--response"];
/** The one run without a key: `bw status`, to say whether to log in or to unlock. */
const NO_KEY = ["--nointeraction", "--response"];
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

const NEEDS_KEY = { locked: true, message: "Unlock Bitwarden, then paste the session key in Settings", command: "bw unlock --raw" };
const NOT_LOGGED_IN = { locked: true, message: "Log in to Bitwarden, then paste the session key in Settings", command: "bw login --raw" };
const EXPIRED = { locked: true, message: "Bitwarden is locked: unlock it and paste the new session key in Settings", command: "bw unlock --raw" };
const BAD_KEY = { locked: true, message: "The session key in Settings isn’t valid: unlock Bitwarden and paste it again", command: "bw unlock --raw" };
const SHOW_FAILED = "bw couldn’t read this item.";
const LIST_FAILED = "bw couldn’t list the vault.";

describe("list", () => {
  test("lists the logins, favorites first, then by name, with one bw run", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    assert.deepEqual(await host.list("vault"), { rows: VAULT_ROWS });
    assert.deepEqual(runs(host), [["list", "items", ...OPTIONS]], "the listing answers for the lock itself");
  });

  test("the codes column lists the logins with a TOTP code to paste", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    assert.deepEqual(await host.list("codes"), { rows: CODE_ROWS });
  });

  test("a row keeps no password, TOTP key, note or part of a URI but its host", async () => {
    const sources = await newHelper();
    const host = hostWith(sources, fakeBw());
    const rows = JSON.stringify([await host.list("vault"), await host.list("codes")]);
    for (const secret of [PASSWORD, TOTP_KEY, "giris", "gelen", "token", "8443", "androidapp", "4111"]) assert.ok(!rows.includes(secret), secret);
  });

  test("a URI gives its host only: no user, password, port, path or www", async () => {
    const uris = [
      ["https://www.ornek.dev/giris?x=1#y", "ornek.dev"],
      ["http://localhost:8080", "localhost"],
      ["ornek.dev/giris", "ornek.dev"],
      [`deniz:${PASSWORD}@ornek.dev`, "ornek.dev"],
      ["https://www.dev", "www.dev"],
      ["https://örnek.dev/", "örnek.dev"],
      ["HTTPS://Posta.Ornek.Dev.", "posta.ornek.dev"],
      ["https://[::1]:8080/", undefined],
      ["ftp://ornek.dev", undefined],
      ["iosapp://dev.ornek.app", undefined],
      ["bir not", undefined],
      ["", undefined],
      // Text without a scheme is a host only when it looks like one; a PIN or a note is not.
      ["4821", undefined],
      ["pin:1234", undefined],
      ["kapikodu", undefined],
      ["Ev-alarmi-9921", undefined],
      ["3.14", undefined],
      ["192.168.1.10:8080", "192.168.1.10"],
      ["localhost:3000", "localhost"],
      ["http://intranet/", "intranet"],
    ];
    const items = uris.map(([uri], index) => login(100 + index, `Site ${index}`, { uris: [{ match: null, uri }] }));
    const host = hostWith(await newHelper(), fakeBw({ items }));
    const { rows } = await host.list("vault");
    const subtitles = Object.fromEntries(rows.map((row) => [row.id, row.subtitle]));
    uris.forEach(([uri, expected], index) => assert.equal(subtitles[ID(100 + index)], expected, uri));
  });

  test("a login named after its site shows the site once", async () => {
    const items = [
      login(50, "Ornek.dev", { username: "deniz.k", uris: [{ match: null, uri: "https://www.ornek.dev/" }] }),
      login(51, "ornek.dev", { uris: [{ match: null, uri: "https://ornek.dev" }] }),
      login(52, "Ornek", { uris: [{ match: null, uri: "https://ornek.dev" }] }),
    ];
    const host = hostWith(await newHelper(), fakeBw({ items }));
    assert.deepEqual(await host.list("vault"), { rows: [
      { id: ID(52), title: "Ornek", subtitle: "ornek.dev" },
      { id: ID(50), title: "Ornek.dev", subtitle: "deniz.k" },
      { id: ID(51), title: "ornek.dev" },
    ] });
  });

  test("two logins with the same name are both listed, by id", async () => {
    const items = [login(61, "Posta", { username: "deniz.k" }), login(60, "Posta", { username: "deniz.k@ornek.dev" })];
    const host = hostWith(await newHelper(), fakeBw({ items }));
    assert.deepEqual(await host.list("vault"), { rows: [
      { id: ID(60), title: "Posta", subtitle: "deniz.k@ornek.dev" },
      { id: ID(61), title: "Posta", subtitle: "deniz.k" },
    ] });
  });

  test("a vault larger than the 64 KB an exec result keeps still lists every login", async () => {
    const items = Array.from({ length: 2000 }, (_, index) => login(1000 + index, `Site ${index}`, { username: "deniz.k", uris: [{ match: null, uri: `https://site-${index}.ornek.dev/` }] }));
    const host = hostWith(await newHelper(), fakeBw({ items }));
    const { rows } = await host.list("vault");
    assert.equal(rows.length, 2000);
    assert.deepEqual(rows[0], { id: ID(1000), title: "Site 0", subtitle: "deniz.k · site-0.ornek.dev" });
    assert.equal(rows.at(-1).title, "Site 1999", "numbers sort as numbers");
  });

  test("an empty vault has no rows", async () => {
    const host = hostWith(await newHelper(), fakeBw({ items: [] }));
    assert.deepEqual(await host.list("vault"), { rows: [] });
    assert.deepEqual(await host.list("codes"), { rows: [] });
  });

  test("the list is reused for five minutes, by both columns; the lock is checked each time", async () => {
    const sources = await newHelper();
    const bw = fakeBw();
    const first = hostWith(sources, bw, { now: START });
    assert.deepEqual(await first.list("vault"), { rows: VAULT_ROWS });
    assert.equal(listings(first), 1);

    bw.state.items = [login(20, "Yeni", { username: "deniz.k", totp: TOTP_KEY })];
    const second = hostWith(sources, bw, { now: START + FIVE_MINUTES });
    assert.deepEqual(await second.list("vault"), { rows: VAULT_ROWS });
    assert.deepEqual(await second.list("codes"), { rows: CODE_ROWS });
    assert.deepEqual(commands(second), ["status", "status"], "bw list is not run");

    const third = hostWith(sources, bw, { now: START + FIVE_MINUTES + 1 });
    assert.deepEqual(await third.list("codes"), { rows: [{ id: ID(20), title: "Yeni", subtitle: "deniz.k" }] });
    assert.equal(listings(third), 1);
  });

  test("a new session key (another login, another account) reads the vault again at once", async () => {
    const sources = await newHelper();
    const bw = fakeBw();
    await hostWith(sources, bw).list("vault");
    Object.assign(bw.state, { key: OTHER_KEY, items: [login(30, "Başka", {})] });
    const host = hostWith(sources, bw, { key: OTHER_KEY, now: START + 1_000 });
    assert.deepEqual(await host.list("vault"), { rows: [{ id: ID(30), title: "Başka" }] });
    assert.deepEqual(commands(host), ["list items"]);
  });

  test("no session key: unlock first, or log in first, as bw's status says", async () => {
    const locked = hostWith(await newHelper(), fakeBw(), { key: null });
    assert.deepEqual(await locked.list("vault"), NEEDS_KEY);
    assert.deepEqual(runs(locked), [["status", ...NO_KEY]], "status only, without a key");

    const loggedOut = hostWith(await newHelper(), fakeBw({ loggedIn: false }), { key: null });
    assert.deepEqual(await loggedOut.list("codes"), NOT_LOGGED_IN);

    const blank = hostWith(await newHelper(), fakeBw(), { key: "  \n" });
    assert.deepEqual(await blank.list("vault"), NEEDS_KEY);

    const unreadable = hostWith(await newHelper(), fakeBw({ answers: { status: { exitCode: 1, stdout: "", stderr: "" } } }), { key: null });
    assert.deepEqual(await unreadable.list("vault"), NEEDS_KEY);
  });

  test("a session key that is not one bw makes never reaches bw", async () => {
    const masterPasswords = ["CorrectHorseBatteryStaple", "MasterPassword2026", "Korkusuz2024Parola", "a".repeat(87) + "=", "a".repeat(88)];
    const others = ["not a key", "--help", "-k" + "k".repeat(85) + "==", "abc", KEY.slice(0, -2), `${KEY}=`, `${KEY} --raw`, `${KEY}\n--quiet`, "k".repeat(2000)];
    for (const key of [...masterPasswords, ...others]) {
      const host = hostWith(await newHelper(), fakeBw(), { key });
      assert.deepEqual(await host.list("vault"), BAD_KEY, JSON.stringify(key));
      assert.deepEqual(runs(host), [], "bw never runs");
    }
  });

  test("the key may be pasted with spaces around it, or as the export line bw unlock prints", async () => {
    for (const key of [`  ${KEY}\n`, `$ export BW_SESSION="${KEY}"`, `> $env:BW_SESSION="${KEY}"`]) {
      const host = hostWith(await newHelper(), fakeBw(), { key });
      assert.deepEqual(await host.list("codes"), { rows: CODE_ROWS }, key);
      assert.deepEqual(runs(host), [["list", "items", ...OPTIONS]]);
    }
  });

  test("not logged in", async () => {
    const host = hostWith(await newHelper(), fakeBw({ loggedIn: false }));
    assert.deepEqual(await host.list("vault"), NOT_LOGGED_IN);
    assert.deepEqual(commands(host), ["list items"], "one run, which bw refuses");
  });

  test("an ended session key (bw lock, bw logout or a newer bw unlock) drops the rows", async () => {
    const sources = await newHelper();
    const bw = fakeBw();
    await hostWith(sources, bw).list("vault");

    bw.state.key = OTHER_KEY;
    const locked = hostWith(sources, bw, { now: START + 1_000 });
    assert.deepEqual(await locked.list("vault"), EXPIRED);
    assert.deepEqual(commands(locked), ["status"]);

    bw.state.key = KEY;
    const after = hostWith(sources, bw, { now: START + 2_000 });
    assert.deepEqual(await after.list("vault"), { rows: VAULT_ROWS });
    assert.equal(listings(after), 1, "the rows are read again, well within five minutes");
  });

  test("bw's own lock answers to the listing give the locked row", async () => {
    for (const [message, expected] of [["Vault is locked.", EXPIRED], ["You are not logged in.", NOT_LOGGED_IN]]) {
      const answers = { list: { exitCode: 1, stdout: JSON.stringify({ success: false, message }), stderr: "" } };
      const host = hostWith(await newHelper(), fakeBw({ answers }));
      assert.deepEqual(await host.list("vault"), expected, message);
    }
  });

  test("a failed listing says so without bw's output, and is not cached", async () => {
    const sources = await newHelper();
    const failing = { exitCode: 1, stdout: JSON.stringify({ success: false, message: `Decrypt error: ${PASSWORD}` }), stderr: `${PASSWORD} ${KEY}\n` };
    const bw = fakeBw({ answers: { list: failing } });
    await assert.rejects(hostWith(sources, bw).list("vault"), (error) => {
      assert.equal(error.message, LIST_FAILED);
      assert.ok(!error.stack.includes(PASSWORD) && !error.stack.includes(KEY));
      return true;
    });

    bw.state.answers = {};
    const host = hostWith(sources, bw);
    assert.deepEqual(await host.list("vault"), { rows: VAULT_ROWS });
    assert.equal(listings(host), 1);
  });

  test("an answer that is not bw's JSON fails the listing", async () => {
    const broken = [
      { exitCode: 0, stdout: `[{"id": "${ID(1)}", "name": "ornek.dev", "login": {"password": "${PASSWORD}"`, stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "null", stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ success: true, data: { object: "list", data: "hepsi" } }), stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ data: [] }), stderr: "" },
      { exitCode: 0, stdout: "Node.js uyarısı\n" + JSON.stringify({ success: true, data: { object: "list", data: [] } }), stderr: "" },
      // A whole success, but bw did not exit cleanly: not trusted.
      { ...listAnswer(), exitCode: 1 },
    ];
    for (const list of broken) {
      await assert.rejects(hostWith(await newHelper(), fakeBw({ answers: { list } })).list("vault"), { message: LIST_FAILED }, list.stdout.slice(0, 60));
    }
    const statuses = [
      { exitCode: 0, stdout: "{", stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ success: true, data: { object: "template", template: { status: "uyuyor" } } }), stderr: "" },
      { exitCode: 1, stdout: JSON.stringify({ success: true, data: { object: "template", template: { status: "unlocked" } } }), stderr: "" },
    ];
    for (const status of statuses) {
      const sources = await newHelper();
      const bw = fakeBw();
      await hostWith(sources, bw).list("vault");
      bw.state.answers = { status };
      const host = hostWith(sources, bw, { now: START + 1_000 });
      await assert.rejects(host.list("vault"), { message: LIST_FAILED }, status.stdout);
      assert.deepEqual(commands(host), ["status"], "nothing is listed without a status");
    }
  });

  test("a bare data array, and a status without its template, still read", async () => {
    const sources = await newHelper();
    const answers = {
      status: { exitCode: 0, stdout: JSON.stringify({ success: true, data: { status: "unlocked" } }), stderr: "" },
      list: { exitCode: 0, stdout: JSON.stringify({ success: true, data: ITEMS.filter((item) => item.deletedDate === null) }), stderr: "" },
    };
    const bw = fakeBw({ answers });
    assert.deepEqual(await hostWith(sources, bw).list("vault"), { rows: VAULT_ROWS });
    const warm = hostWith(sources, bw, { now: START + 1_000 });
    assert.deepEqual(await warm.list("codes"), { rows: CODE_ROWS });
    assert.deepEqual(commands(warm), ["status"]);
  });
});

describe("run", () => {
  test("the password is a secret, exactly as bw holds it", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    assert.deepEqual(await host.runSource("vault", ID(1), "password"), { secret: PASSWORD });
    assert.deepEqual(await host.runSource("vault", ID(2), "password"), { secret: `  ${PASSWORD}\t\n` }, "spaces and line ends are kept");
    assert.deepEqual(runs(host), [["get", "item", ID(1), ...OPTIONS], ["get", "item", ID(2), ...OPTIONS]]);
  });

  test("the username is text", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    assert.deepEqual(await host.runSource("vault", ID(2), "username"), { text: "deniz.k@ornek.dev" });
    assert.deepEqual(runs(host), [["get", "username", ID(2), ...OPTIONS]]);
  });

  test("the TOTP code is a secret", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    assert.deepEqual(await host.runSource("codes", ID(1), "code"), { secret: CODE });
    assert.deepEqual(runs(host), [["get", "item", ID(1), ...OPTIONS], ["get", "totp", ID(1), ...OPTIONS]]);
  });

  test("an item without a TOTP key says so, and bw is not asked for a code", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    for (const id of [ID(2), ID(14), ID(15)]) {
      await assert.rejects(host.runSource("codes", id, "code"), { message: "This item has no authenticator key (TOTP)." }, id);
    }
    assert.ok(!commands(host).includes("get totp"));
  });

  test("bw's own no-TOTP answer says the same", async () => {
    const answers = { "get totp": { exitCode: 1, stdout: JSON.stringify({ success: false, message: "No TOTP available for this login." }), stderr: "" } };
    const host = hostWith(await newHelper(), fakeBw({ answers }));
    await assert.rejects(host.runSource("codes", ID(1), "code"), { message: "This item has no authenticator key (TOTP)." });
  });

  test("an account without Premium cannot make TOTP codes", async () => {
    const host = hostWith(await newHelper(), fakeBw({ premium: false }));
    await assert.rejects(host.runSource("codes", ID(1), "code"), { message: "TOTP codes need Bitwarden Premium." });
  });

  test("a code bw could not make is refused", async () => {
    for (const totp of [
      { exitCode: 1, stdout: JSON.stringify({ success: false, message: "Couldn't generate TOTP code." }), stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ success: true, data: { object: "string", data: " " } }), stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ success: true, data: { object: "string", data: null } }), stderr: "" },
    ]) {
      const host = hostWith(await newHelper(), fakeBw({ answers: { "get totp": totp } }));
      await assert.rejects(host.runSource("codes", ID(1), "code"), { message: "bw couldn’t make this item’s TOTP code." }, totp.stdout);
    }
  });

  test("an empty, blank or hidden password is refused", async () => {
    const host = hostWith(await newHelper(), fakeBw({ items: [...ITEMS, login(40, "Boşluk", { password: " \t " })] }));
    for (const id of [ID(3), ID(15), ID(40)]) {
      await assert.rejects(host.runSource("vault", id, "password"), { message: "This item has no password to paste." }, id);
    }
  });

  test("an empty username is refused", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    for (const id of [ID(3), ID(4)]) await assert.rejects(host.runSource("vault", id, "username"), { message: "This item has no username." }, id);
    const blank = { exitCode: 0, stdout: JSON.stringify({ success: true, data: { object: "string", data: "  " } }), stderr: "" };
    await assert.rejects(hostWith(await newHelper(), fakeBw({ answers: { "get username": blank } })).runSource("vault", ID(1), "username"), { message: "This item has no username." });
  });

  test("an item that asks for the master password again never has its password or code pasted", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    const message = "This item asks for your master password first. Open it in Bitwarden.";
    await assert.rejects(host.runSource("vault", ID(4), "password"), { message });
    await assert.rejects(host.runSource("codes", ID(4), "code"), { message });
    assert.ok(!commands(host).includes("get totp"));
    const named = hostWith(await newHelper(), fakeBw({ items: [login(41, "Korumalı", { username: "deniz.k" }, { reprompt: 1 })] }));
    assert.deepEqual(await named.runSource("vault", ID(41), "username"), { text: "deniz.k" }, "the username is not protected");
  });

  test("an item whose re-prompt setting is missing or unexpected counts as one that asks", async () => {
    const { reprompt: _, ...absent } = login(42, "Alan yok", { username: "deniz.k", totp: TOTP_KEY });
    const items = [absent, login(43, "İki", { username: "deniz.k", totp: TOTP_KEY }, { reprompt: 2 }),
      login(44, "Metin", { username: "deniz.k", totp: TOTP_KEY }, { reprompt: "1" }), login(45, "Hiç", { username: "deniz.k", totp: TOTP_KEY }, { reprompt: null })];
    const sources = await newHelper();
    const host = hostWith(sources, fakeBw({ items }));
    assert.equal((await host.list("vault")).rows.length, 4, "listed, for their usernames");
    assert.deepEqual(await host.list("codes"), { rows: [] }, "no code to paste");
    const message = "This item asks for your master password first. Open it in Bitwarden.";
    for (const n of [42, 43, 44, 45]) {
      await assert.rejects(host.runSource("vault", ID(n), "password"), { message }, String(n));
      await assert.rejects(host.runSource("codes", ID(n), "code"), { message }, String(n));
      assert.deepEqual(await host.runSource("vault", ID(n), "username"), { text: "deniz.k" });
    }
    assert.ok(!commands(host).includes("get totp"));
  });

  test("an item gone from the vault, or in the trash, says so", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    const message = "This item is no longer in your vault.";
    await assert.rejects(host.runSource("vault", ID(99), "password"), { message });
    await assert.rejects(host.runSource("vault", ID(99), "username"), { message });
    await assert.rejects(host.runSource("codes", ID(99), "code"), { message });
    await assert.rejects(host.runSource("vault", ID(13), "password"), { message }, "in the trash");
  });

  test("an item that is not a login, or not the one asked for, is refused", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    await assert.rejects(host.runSource("vault", ID(5), "password"), { message: SHOW_FAILED });
    const other = { exitCode: 0, stdout: JSON.stringify({ success: true, data: ITEMS[1] }), stderr: "" };
    await assert.rejects(hostWith(await newHelper(), fakeBw({ answers: { "get item": other } })).runSource("vault", ID(1), "password"), { message: SHOW_FAILED });
  });

  test("an ended session key says so, and the rows are read again", async () => {
    const sources = await newHelper();
    const bw = fakeBw();
    await hostWith(sources, bw).list("vault");
    bw.state.key = OTHER_KEY;
    const host = hostWith(sources, bw, { now: START + 1_000 });
    for (const [source, action] of [["vault", "password"], ["vault", "username"], ["codes", "code"]]) {
      await assert.rejects(host.runSource(source, ID(1), action), { message: EXPIRED.message }, action);
    }
    bw.state.key = KEY;
    const after = hostWith(sources, bw, { now: START + 2_000 });
    assert.deepEqual(await after.list("vault"), { rows: VAULT_ROWS });
    assert.equal(listings(after), 1, "the rows went with the lock");
  });

  test("logged out since the list", async () => {
    const host = hostWith(await newHelper(), fakeBw({ loggedIn: false }));
    await assert.rejects(host.runSource("vault", ID(1), "password"), { message: NOT_LOGGED_IN.message });
  });

  test("without a valid session key nothing runs", async () => {
    const none = hostWith(await newHelper(), fakeBw(), { key: null });
    await assert.rejects(none.runSource("vault", ID(1), "password"), { message: NEEDS_KEY.message });
    const bad = hostWith(await newHelper(), fakeBw(), { key: "--help" });
    await assert.rejects(bad.runSource("codes", ID(1), "code"), { message: BAD_KEY.message });
    assert.deepEqual([...runs(none), ...runs(bad)], []);
  });

  test("row ids must be Bitwarden's own", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    for (const rowId of ["ornek.dev", "--help", "-1", "", `${ID(1)} `, `${ID(1)}\n`, `${ID(1)}--raw`, "x-11", "0b6c1a2e5f3d4c1a9e7b000000000001"]) {
      await assert.rejects(host.runSource("vault", rowId, "password"), { message: SHOW_FAILED }, JSON.stringify(rowId));
    }
    assert.deepEqual(runs(host), [], "bw never runs");
  });

  test("each column runs only its own actions", async () => {
    const sources = await newHelper();
    const host = hostWith(sources, fakeBw());
    const ctx = host.context({ trigger: "source" });
    const restore = host.install();
    try {
      await assert.rejects(sources.vault.run(ID(1), "code", ctx), { message: SHOW_FAILED });
      await assert.rejects(sources.codes.run(ID(1), "password", ctx), { message: SHOW_FAILED });
    } finally {
      restore();
    }
    assert.deepEqual(runs(host), []);
  });

  test("a failed bw never echoes its output", async () => {
    const leaky = { exitCode: 1, stdout: JSON.stringify({ success: false, message: `${PASSWORD} could not be decrypted with ${KEY}` }), stderr: `${PASSWORD}\n` };
    const answers = { "get item": leaky, "get username": leaky, "get totp": leaky };
    const host = hostWith(await newHelper(), fakeBw({ answers }));
    for (const [source, action] of [["vault", "password"], ["vault", "username"], ["codes", "code"]]) {
      await assert.rejects(host.runSource(source, ID(1), action), (error) => {
        assert.ok([SHOW_FAILED, "bw couldn’t make this item’s TOTP code."].includes(error.message), error.message);
        for (const secret of [PASSWORD, KEY]) assert.ok(!error.stack.includes(secret));
        return true;
      });
    }
  });

  test("an answer that is not bw's JSON, or a success from a bw that failed, is refused", async () => {
    const crashed = { exitCode: 1, stdout: JSON.stringify({ success: true, data: { ...ITEMS[0], object: "item", data: PASSWORD } }), stderr: "" };
    for (const broken of [{ exitCode: 0, stdout: PASSWORD, stderr: "" }, { exitCode: 0, stdout: "", stderr: "" }, { exitCode: 0, stdout: "[]", stderr: "" }, crashed]) {
      const host = hostWith(await newHelper(), fakeBw({ answers: { "get item": broken, "get username": broken } }));
      await assert.rejects(host.runSource("vault", ID(1), "password"), { message: SHOW_FAILED });
      await assert.rejects(host.runSource("vault", ID(1), "username"), { message: SHOW_FAILED });
    }
  });
});

describe("both columns at once", () => {
  /** An answer to `bw list items` that waits until `release()`. */
  function held() {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    return { answer: () => gate.then(() => listAnswer()), release: () => release() };
  }
  /** The signals bw got, run by run. */
  function signalsOf(host) {
    const signals = [];
    const exec = host.yab.exec;
    host.yab.exec = (tool, args, options) => {
      signals.push(options?.signal);
      return exec(tool, args, options);
    };
    return signals;
  }

  test("a panel opening with no rows in hand lists once for both columns", async () => {
    const host = hostWith(await newHelper(), fakeBw());
    assert.deepEqual(await Promise.all([host.list("vault"), host.list("codes")]), [{ rows: VAULT_ROWS }, { rows: CODE_ROWS }]);
    assert.deepEqual(commands(host), ["list items"]);
  });

  test("a panel opening with rows in hand checks the lock once for both columns", async () => {
    const sources = await newHelper();
    const bw = fakeBw();
    await hostWith(sources, bw).list("vault");
    const host = hostWith(sources, bw, { now: START + 1_000 });
    assert.deepEqual(await Promise.all([host.list("vault"), host.list("codes")]), [{ rows: VAULT_ROWS }, { rows: CODE_ROWS }]);
    assert.deepEqual(commands(host), ["status"]);
  });

  test("both columns see the same lock", async () => {
    const host = hostWith(await newHelper(), fakeBw({ key: OTHER_KEY }));
    assert.deepEqual(await Promise.all([host.list("vault"), host.list("codes")]), [EXPIRED, EXPIRED]);
    assert.deepEqual(commands(host), ["list items"]);
  });

  test("one column's cancel leaves bw running for the other", async () => {
    const sources = await newHelper();
    const list = held();
    const bw = fakeBw({ answers: { list: list.answer } });
    const first = hostWith(sources, bw);
    const second = hostWith(sources, bw);
    const signals = signalsOf(first);
    const vault = first.list("vault");
    await nextTurn();
    const codes = second.list("codes");
    await nextTurn();
    second.cancel();
    await assert.rejects(codes, { code: "cancelled" });
    assert.equal(signals[0].aborted, false, "bw is not stopped while the other column waits");
    list.release();
    assert.deepEqual(await vault, { rows: VAULT_ROWS });
    assert.equal(listings(first), 1);
    assert.equal(listings(second), 0, "the second column ran no bw of its own");
  });

  test("when the column that started bw is cancelled, the other runs it again", async () => {
    const sources = await newHelper();
    let started = 0;
    const bw = fakeBw({ answers: { list: () => (++started === 1 ? new Promise(() => {}) : listAnswer()) } });
    const first = hostWith(sources, bw);
    const second = hostWith(sources, bw);
    const vault = first.list("vault");
    await nextTurn();
    const codes = second.list("codes");
    await nextTurn();
    first.cancel();
    await assert.rejects(vault, { code: "cancelled" });
    assert.deepEqual(await codes, { rows: CODE_ROWS });
    assert.equal(listings(second), 1);
  });

  test("when every column has gone, bw is stopped, and the next opening starts afresh", async () => {
    const sources = await newHelper();
    const bw = fakeBw({ answers: { list: () => new Promise(() => {}) } });
    const host = hostWith(sources, bw);
    const signals = signalsOf(host);
    const both = [host.list("vault"), host.list("codes")];
    await nextTurn();
    host.cancel();
    for (const listing of both) await assert.rejects(listing, { code: "cancelled" });
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, true);
    bw.state.answers = {};
    const after = hostWith(sources, bw);
    assert.deepEqual(await after.list("codes"), { rows: CODE_ROWS });
    assert.equal(listings(after), 1);
  });
});

describe("time", () => {
  /** A bw whose `command` answers only once cancelled. */
  const slowAt = (command) => fakeBw({ answers: { [command]: () => new Promise(() => {}) } });

  test("a bw that takes too long is stopped before the app's limit, and says so", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const slow = "Bitwarden took too long to answer. Try again.";
    for (const [command, call, warm] of [
      ["get item", (host) => host.runSource("vault", ID(1), "password")],
      ["get totp", (host) => host.runSource("codes", ID(1), "code")],
      ["list", (host) => host.list("vault")],
      ["status", (host) => host.list("codes"), true],
    ]) {
      const sources = await newHelper();
      // `bw status` runs only with rows in hand.
      if (warm) await hostWith(sources, fakeBw()).list("vault");
      const host = hostWith(sources, slowAt(command), { now: START + 1_000 });
      const running = call(host);
      for (let turn = 0; turn < 5; turn++) await nextTurn();
      t.mock.timers.tick(8_999);
      await nextTurn();
      let done = false;
      running.then(() => (done = true), () => (done = true));
      await nextTurn();
      assert.equal(done, false, `${command}: still waiting at 8.999 s`);
      t.mock.timers.tick(1);
      for (let turn = 0; turn < 5; turn++) await nextTurn();
      // Without the deadline the call would wait for the app's cut-off: end it here instead of hanging the test.
      if (!done) host.cancel();
      await assert.rejects(running, { message: slow }, command);
    }
  });

  test("cancelling stops bw and is let through", async () => {
    const host = hostWith(await newHelper(), slowAt("list"));
    const running = host.list("vault");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });

  test("a slow list is not cached", async () => {
    const sources = await newHelper();
    const bw = slowAt("list");
    const host = hostWith(sources, bw);
    const running = host.list("vault");
    setTimeout(() => host.cancel(), 10);
    await settled(running);
    bw.state.answers = {};
    const after = hostWith(sources, bw);
    assert.deepEqual(await after.list("vault"), { rows: VAULT_ROWS });
    assert.equal(listings(after), 1);
  });
});

describe("everywhere", () => {
  /** Every path through list and run, each on a host of its own; resolves to the hosts and what each call ended with. */
  async function everyPath() {
    const hosts = [];
    const outcomes = [];
    const on = async (changes, work, { sources, key } = {}) => {
      const host = hostWith(sources ?? await newHelper(), fakeBw(changes), { key });
      hosts.push(host);
      try {
        outcomes.push(await work(host));
      } catch (error) {
        outcomes.push({ message: error.message, stack: error.stack });
      }
    };
    const sources = await newHelper();
    const leaky = { exitCode: 1, stdout: JSON.stringify({ success: false, message: `${PASSWORD} ${KEY}` }), stderr: `${KEY}\n` };
    await on({}, (host) => host.list("vault"), { sources });
    await on({}, (host) => host.list("codes"), { sources });
    await on({}, (host) => host.list("vault"), { key: null });
    await on({ loggedIn: false }, (host) => host.list("vault"));
    await on({ key: OTHER_KEY }, (host) => host.list("vault"));
    await on({}, (host) => host.list("vault"), { key: `${KEY} --raw` });
    await on({ answers: { list: leaky } }, (host) => host.list("vault"));
    await on({ answers: { status: leaky } }, (host) => host.list("codes"), { sources });
    await on({}, async (host) => [
      await host.runSource("vault", ID(1), "password"),
      await host.runSource("vault", ID(1), "username"),
      await host.runSource("codes", ID(1), "code"),
    ]);
    await on({}, (host) => host.runSource("vault", ID(3), "password"));
    await on({}, (host) => host.runSource("vault", ID(4), "password"));
    await on({}, (host) => host.runSource("codes", ID(2), "code"));
    await on({ premium: false }, (host) => host.runSource("codes", ID(1), "code"));
    await on({ key: OTHER_KEY }, (host) => host.runSource("vault", ID(1), "password"));
    await on({ answers: { "get item": leaky, "get username": leaky } }, (host) => host.runSource("vault", ID(1), "password"));
    await on({}, (host) => host.runSource("vault", "--help", "password"));
    return { hosts, outcomes };
  }

  test("nothing is logged", async () => {
    for (const host of (await everyPath()).hosts) assert.deepEqual(host.logs, []);
  });

  test("nothing is stored, and bw is the only thing called besides the session key", async () => {
    for (const host of (await everyPath()).hosts) {
      assert.deepEqual(host.storage, {});
      const others = host.calls.filter((call) => call.api !== "exec");
      assert.ok(others.every((call) => call.api === "secrets.get" && call.args[0] === "session"), JSON.stringify(others.map((call) => call.api)));
      assert.ok(host.calls.filter((call) => call.api === "exec").every((call) => call.args[0] === "bw"));
    }
  });

  test("the session key never reaches a row, a locked row, a message or a value; only bw's --session option", async () => {
    const { hosts, outcomes } = await everyPath();
    assert.ok(!JSON.stringify(outcomes).includes(KEY));
    let keyed = 0;
    for (const host of hosts) {
      for (const args of runs(host)) {
        const label = JSON.stringify(args.slice(0, 3));
        if (!args.includes("--session")) {
          assert.deepEqual(args, ["status", ...NO_KEY], "only the status without a key runs without one");
          continue;
        }
        keyed++;
        assert.equal(args.filter((arg) => arg.includes(KEY)).length, 1, label);
        assert.equal(args[args.indexOf("--session") + 1], KEY, label);
      }
    }
    assert.ok(keyed > 10);
  });

  test("passwords and codes are answers only: never in a row or a message", async () => {
    const { outcomes } = await everyPath();
    const shown = JSON.stringify(outcomes.filter((outcome) => !Array.isArray(outcome)));
    for (const secret of [PASSWORD, CODE, TOTP_KEY]) assert.ok(!shown.includes(secret), secret);
    assert.deepEqual(outcomes.find(Array.isArray), [{ secret: PASSWORD }, { text: "deniz.k" }, { secret: CODE }]);
  });

  test("every bw run carries a signal", async () => {
    const bw = fakeBw();
    const host = hostWith(await newHelper(), bw);
    const signals = [];
    const exec = host.yab.exec;
    host.yab.exec = (tool, args, options) => {
      signals.push(options?.signal);
      return exec(tool, args, options);
    };
    await host.list("vault");
    await host.runSource("vault", ID(1), "password");
    await host.runSource("codes", ID(1), "code");
    await host.runSource("vault", ID(1), "username");
    assert.equal(signals.length, 5, "one for the list, two for the code, one each for the password and username");
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  });

  test("answers in Turkish", async () => {
    const tr = { language: "tr" };
    assert.deepEqual(await hostWith(await newHelper(), fakeBw(), { ...tr, key: null }).list("vault"),
      { locked: true, message: "Bitwarden’ın kilidini aç, sonra oturum anahtarını Ayarlar’a yapıştır", command: "bw unlock --raw" });
    assert.deepEqual(await hostWith(await newHelper(), fakeBw({ loggedIn: false }), tr).list("vault"),
      { locked: true, message: "Bitwarden’a giriş yap, sonra oturum anahtarını Ayarlar’a yapıştır", command: "bw login --raw" });
    assert.deepEqual(await hostWith(await newHelper(), fakeBw({ key: OTHER_KEY }), tr).list("codes"),
      { locked: true, message: "Bitwarden kilitli: kilidi aç ve yeni oturum anahtarını Ayarlar’a yapıştır", command: "bw unlock --raw" });
    assert.deepEqual(await hostWith(await newHelper(), fakeBw(), { ...tr, key: "x" }).list("vault"),
      { locked: true, message: "Ayarlar’daki oturum anahtarı geçersiz: Bitwarden’ın kilidini aç ve anahtarı yeniden yapıştır", command: "bw unlock --raw" });
    const host = hostWith(await newHelper(), fakeBw({ premium: false }), tr);
    await assert.rejects(host.runSource("vault", ID(3), "password"), { message: "Bu kayıtta yapıştırılacak bir şifre yok." });
    await assert.rejects(host.runSource("vault", ID(3), "username"), { message: "Bu kayıtta kullanıcı adı yok." });
    await assert.rejects(host.runSource("codes", ID(2), "code"), { message: "Bu kayıtta kimlik doğrulama anahtarı (TOTP) yok." });
    await assert.rejects(host.runSource("codes", ID(1), "code"), { message: "TOTP kodları için Bitwarden Premium gerekiyor." });
    await assert.rejects(host.runSource("vault", ID(4), "password"), { message: "Bu kayıt önce ana şifreni istiyor. Bitwarden’da aç." });
    await assert.rejects(host.runSource("vault", ID(99), "password"), { message: "Bu kayıt artık kasanda yok." });
    await assert.rejects(host.runSource("vault", "x", "password"), { message: "bw bu kaydı okuyamadı." });
    await assert.rejects(hostWith(await newHelper(), fakeBw({ answers: { list: { exitCode: 1, stdout: "", stderr: "" } } }), tr).list("vault"), { message: "bw kasayı listeleyemedi." });
  });

  test("every string has a Turkish one", async () => {
    const { readFile } = await import("node:fs/promises");
    const en = JSON.parse(await readFile(new URL("../locales/en.json", import.meta.url), "utf8"));
    const tr = JSON.parse(await readFile(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  });

  test("without bw every call fails as toolMissing, with the manifest's install command", async () => {
    const host = createFakeHost({ folder, sources: await newHelper(), secrets: { session: KEY } });
    await assert.rejects(host.list("vault"), { code: "toolMissing", message: /brew install bitwarden-cli/ });
    await assert.rejects(host.runSource("codes", ID(1), "code"), { code: "toolMissing", message: /brew install bitwarden-cli/ });
  });
});
