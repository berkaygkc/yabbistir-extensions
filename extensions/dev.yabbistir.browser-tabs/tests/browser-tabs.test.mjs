import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { ARGS, SCRIPT, sources } from "../src/index.ts";
import { fakeOsascript, manyTabs, runScript } from "./fake-browsers.mjs";

const folder = new URL("..", import.meta.url);
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, folder), "utf8"));
const manifest = read("manifest.json");
const en = read("locales/en.json");
const tr = read("locales/tr.json");

function hostWith(osascript, { language = "en" } = {}) {
  return createFakeHost({ folder, sources, exec: { osascript }, context: { language } });
}
const list = (browsers, options) => hostWith(fakeOsascript(browsers), options).list("tabs");
const osascriptCalls = (host) => host.calls.filter((call) => call.api === "exec" && call.args[0] === "osascript");
const osascriptRuns = (host) => osascriptCalls(host).length;
const statusLines = (output) => output.trim().split("\n").map((line) => JSON.parse(line)).filter((line) => line.s !== undefined);

// A token-shaped value built at run time, so no file holds one.
const TOKEN = "gh" + "p_" + "a".repeat(36);

const CHROME = {
  frontmost: false,
  windows: [
    { id: "1203", active: 1, tabs: [
      { id: "1388", title: "Sürüm notları · Örnek Proje", url: "https://example.com/releases" },
      { id: "1391", title: "Pull request #42", url: "https://code.example.org/pull/42" },
    ] },
    { id: "1207", active: 0, tabs: [{ id: "1402", title: "Takvim", url: "https://calendar.example.net/week" }] },
  ],
};
const SAFARI = {
  windows: [{ id: 4711, active: 0, tabs: [
    { title: "Örnek Belgeler", url: "https://docs.example.com/guide" },
    { title: "Haberler", url: "https://www.example.org/news" },
  ] }],
};
// Arc names its active tab by id; here it is the second tab.
const ARC = {
  windows: [{ id: "A1", active: 1, tabs: [
    { id: "8B2C1F3A-0D4E-4F5A-9B6C-7D8E9F0A1B2C", title: "Tasarım taslağı", url: "https://design.example.com/file/1" },
    { id: "1C2D3E4F-5A6B-4C7D-8E9F-0A1B2C3D4E5F", title: "Arc'ta açık sekme", url: "https://example.net/arc" },
  ] }],
};

describe("the script", () => {
  test("osascript runs one fixed JXA script, whose only argument picks a browser", () => {
    assert.deepEqual(ARGS, ["-l", "JavaScript", "-e", SCRIPT]);
    assert.ok(!SCRIPT.includes("${"), "nothing is put into the script");
    assert.match(SCRIPT, /function run\(argv\)/);
    assert.match(SCRIPT, /^[\x00-\x7e]*$/, "the script is plain ASCII, its escaping range written as \\u escapes");
  });

  test("given a browser, the script asks that one only; given nothing, every one", () => {
    const browsers = { safari: SAFARI, chrome: CHROME, arc: ARC };
    const one = runScript(browsers, ["chrome"]);
    assert.deepEqual(one.jxa.lookups, ["com.google.Chrome"]);
    assert.deepEqual(one.jxa.events, { safari: 0, chrome: one.jxa.events.chrome, arc: 0, brave: 0, edge: 0, vivaldi: 0 });
    assert.deepEqual(statusLines(one.output), [{ b: "chrome", s: "ok", f: 0, x: 0, e: 0 }], "the front app is not asked about");
    const all = runScript(browsers);
    assert.deepEqual(statusLines(all.output).map((line) => line.b), ["safari", "chrome", "arc"]);
    const unknown = runScript(browsers, ["firefox"]);
    assert.equal(unknown.output, '{"v":1}\n', "a key it does not know reads nothing");
    assert.deepEqual(unknown.jxa.lookups, []);
  });

  test("browsers that are not running get no Apple event, so none is launched", () => {
    const { jxa } = runScript({ chrome: { running: false, windows: [] }, safari: { missing: true }, brave: { running: false } });
    assert.deepEqual(jxa.events, { safari: 0, chrome: 0, arc: 0, brave: 0, edge: 0, vivaldi: 0 });
    assert.deepEqual(jxa.lookups, ["com.apple.Safari", "com.google.Chrome", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac", "com.vivaldi.Vivaldi"]);
  });

  test("every character outside ASCII is written as \\u, and each line is one JSON object", () => {
    const { output } = runScript({ chrome: { windows: [{ id: "1", tabs: [{ id: "2", title: "Çay ☕ ve şiir 𝄞\nikinci satır", url: "https://example.com/ç" }] }] } });
    assert.match(output, /^[\x00-\x7f]*$/);
    const lines = output.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines, [
      { v: 1 },
      { b: "chrome", w: "1", t: "2", p: 0, a: 1, n: "Çay ☕ ve şiir 𝄞\nikinci satır", u: "https://example.com/ç" },
      { b: "chrome", s: "ok", f: 0, x: 0, e: 0 },
    ]);
  });

  test("each property is read once per window, not once per tab", () => {
    const { jxa } = runScript({ chrome: { windows: [{ id: "1", tabs: manyTabs(500) }] } });
    assert.ok(jxa.events.chrome <= 10, `${jxa.events.chrome} Apple events for 500 tabs`);
  });

  test("a denied browser reports itself and no tabs; the others are still read", () => {
    const { output } = runScript({ safari: { ...SAFARI, denied: true }, chrome: CHROME });
    const lines = output.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.filter((line) => line.s !== undefined), [
      { b: "safari", s: "denied", f: 0, x: 0, e: 0 },
      { b: "chrome", s: "ok", f: 0, x: 0, e: 0 },
    ]);
    assert.ok(lines.every((line) => line.b !== "safari" || line.s !== undefined));
  });

  test("a window that cannot be read is skipped, and a disagreement between readings is read again", () => {
    const { output } = runScript({ chrome: { windows: [
      { id: "1", broken: true, tabs: [{ id: "1", title: "Kırık", url: "https://example.com/kirik" }] },
      { id: "2", racing: 1, tabs: [{ id: "5", title: "Bir kez daha", url: "https://example.com/tekrar" }] },
      { id: "3", racing: 2, tabs: [{ id: "6", title: "Hep değişen", url: "https://example.com/degisen" }] },
    ] } });
    const tabs = output.trim().split("\n").map((line) => JSON.parse(line)).filter((line) => line.u !== undefined);
    assert.deepEqual(tabs.map((tab) => tab.n), ["Bir kez daha"]);
    assert.deepEqual(statusLines(output), [{ b: "chrome", s: "ok", f: 0, x: 0, e: 2 }], "the two windows left out are counted");
  });

  test("Safari without `visible`: the window's current tab says which tab is active", () => {
    const { output } = runScript({ safari: { lacks: ["visible"], windows: [{ id: 7, active: 1, tabs: SAFARI.windows[0].tabs }] } });
    const tabs = output.trim().split("\n").map((line) => JSON.parse(line)).filter((line) => line.u !== undefined);
    assert.deepEqual(tabs.map((tab) => [tab.n, tab.a]), [["Örnek Belgeler", 0], ["Haberler", 1]]);
  });
});

describe("listing", () => {
  test("Chrome: window and tab ids, the active tab first, host in the subtitle", async () => {
    assert.deepEqual(await list({ chrome: CHROME }), { rows: [
      { id: "chrome:1203:1391", title: "Pull request #42", subtitle: "Chrome · code.example.org" },
      { id: "chrome:1207:1402", title: "Takvim", subtitle: "Chrome · calendar.example.net" },
      { id: "chrome:1203:1388", title: "Sürüm notları · Örnek Proje", subtitle: "Chrome · example.com" },
    ] });
  });

  test("Brave, Edge and Vivaldi share Chromium's dictionary", async () => {
    const one = (id) => ({ windows: [{ id: "9", tabs: [{ id, title: `Sekme ${id}`, url: `https://example.com/${id}` }] }] });
    const { rows } = await list({ brave: one("1"), edge: one("2"), vivaldi: one("3") });
    assert.deepEqual(rows, [
      { id: "brave:9:1", title: "Sekme 1", subtitle: "Brave · example.com" },
      { id: "edge:9:2", title: "Sekme 2", subtitle: "Edge · example.com" },
      { id: "vivaldi:9:3", title: "Sekme 3", subtitle: "Vivaldi · example.com" },
    ]);
  });

  test("Safari: tabs have no id, so a digest of the URL stands in; www. is left off the host", async () => {
    const { rows } = await list({ safari: SAFARI });
    assert.equal(rows.length, 2);
    assert.match(rows[0].id, /^safari:4711:u[0-9a-f]{16}$/);
    assert.deepEqual(rows.map(({ title, subtitle }) => ({ title, subtitle })), [
      { title: "Örnek Belgeler", subtitle: "Safari · docs.example.com" },
      { title: "Haberler", subtitle: "Safari · example.org" },
    ]);
  });

  test("Arc: UUID tab ids, the active tab found by its id", async () => {
    assert.deepEqual((await list({ arc: ARC })).rows, [
      { id: "arc:A1:1C2D3E4F-5A6B-4C7D-8E9F-0A1B2C3D4E5F", title: "Arc'ta açık sekme", subtitle: "Arc · example.net" },
      { id: "arc:A1:8B2C1F3A-0D4E-4F5A-9B6C-7D8E9F0A1B2C", title: "Tasarım taslağı", subtitle: "Arc · design.example.com" },
    ]);
  });

  test("several browsers: every window's active tab first, the frontmost browser leading", async () => {
    const { rows } = await list({ safari: SAFARI, chrome: { ...CHROME, frontmost: true }, arc: ARC });
    assert.deepEqual(rows.map((row) => row.title), [
      // active tabs: Chrome (frontmost), then Safari, then Arc
      "Pull request #42", "Takvim", "Örnek Belgeler", "Arc'ta açık sekme",
      // the rest, in the same order
      "Sürüm notları · Örnek Proje", "Haberler", "Tasarım taslağı",
    ]);
  });

  test("the same tabs listed twice keep their ids", async () => {
    const browsers = { safari: SAFARI, chrome: CHROME, arc: ARC };
    const first = await list(browsers);
    const second = await list(browsers);
    assert.deepEqual(second.rows.map((row) => row.id), first.rows.map((row) => row.id));
  });

  test("a Chrome tab keeps its id when tabs before it close; a Safari tab's id follows its URL and window", async () => {
    const before = (await list({ chrome: CHROME })).rows.find((row) => row.title === "Pull request #42").id;
    const closed = { windows: [{ id: "1203", active: 0, tabs: [CHROME.windows[0].tabs[1]] }] };
    assert.equal((await list({ chrome: closed })).rows[0].id, before);

    const safari = (await list({ safari: SAFARI })).rows.map((row) => row.id);
    const navigated = { windows: [{ id: 4711, tabs: [SAFARI.windows[0].tabs[0], { title: "Başka", url: "https://www.example.org/other" }] }] };
    const after = (await list({ safari: navigated })).rows.map((row) => row.id);
    assert.equal(after[0], safari[0], "the tab that stayed keeps its id");
    assert.notEqual(after[1], safari[1], "the tab that went elsewhere gets a new one");
    const otherWindow = { windows: [{ id: 4712, tabs: SAFARI.windows[0].tabs }] };
    assert.notEqual((await list({ safari: otherWindow })).rows[0].id, safari[0], "the window is part of the id");
    const moved = { windows: [{ id: 4711, active: 1, tabs: [...SAFARI.windows[0].tabs].reverse() }] };
    assert.deepEqual((await list({ safari: moved })).rows.map((row) => row.id), safari, "moving a tab keeps its id");
  });

  test("a Safari tab keeps its id and still pastes when a tab before it closes or a new one opens", async () => {
    const a = { title: "A", url: "https://example.com/a" };
    const b = { title: "B", url: "https://example.com/b" };
    const c = { title: "C", url: "https://example.com/c" };
    let tabs = [a, b, c];
    const host = hostWith(fakeOsascript(() => ({ safari: { windows: [{ id: 4711, active: 0, tabs }] } })));
    const listed = (await host.list("tabs")).rows;
    const idOf = (rows, title) => rows.find((row) => row.title === title).id;

    // The person closes A in Safari, then presses ↵ on C's row from the listing the panel still shows.
    tabs = [b, c];
    assert.deepEqual(await host.runSource("tabs", idOf(listed, "C"), "link"), { text: "https://example.com/c" });
    assert.equal(idOf((await host.list("tabs")).rows, "C"), idOf(listed, "C"));

    // A link opens a new tab next to the first one.
    tabs = [b, { title: "Yeni", url: "https://example.com/yeni" }, c];
    assert.deepEqual(await host.runSource("tabs", idOf(listed, "C"), "markdown"), { text: "[C](https://example.com/c)" });
  });

  test("Safari tabs with the same URL keep their ids whichever of them is active", async () => {
    const twin = { title: "Aynı sayfa", url: "https://example.com/ayni" };
    const other = { title: "Başka", url: "https://example.com/baska" };
    const at = (active) => ({ safari: { windows: [{ id: 1, active, tabs: [twin, other, twin] }] } });
    const ids = async (active) => Object.fromEntries((await list(at(active))).rows.map((row, index) => [row.id, index]));
    const first = await ids(0);
    const last = await ids(2);
    assert.deepEqual(Object.keys(first).sort(), Object.keys(last).sort());
    const base = Object.keys(first).find((id) => id.endsWith("~2")).slice(0, -2);
    assert.equal(first[base], 0, "the first of the two leads while it is active");
    assert.equal(last[`${base}~2`], 0, "the second keeps ~2 when it is the active one");
  });

  test("ids that would repeat get ~2, and odd or long browser ids are hashed into a short, plain id", async () => {
    const twice = { id: "7", title: "Aynı", url: "https://example.com/ayni" };
    const { rows } = await list({ chrome: { windows: [
      { id: "1", tabs: [twice, twice] },
      { id: "w:" + "9".repeat(300), tabs: [{ id: "id with spaces/and:colons", title: "Garip", url: "https://example.com/garip" }] },
    ] } });
    const ids = rows.map((row) => row.id);
    assert.deepEqual(ids.filter((id) => id.startsWith("chrome:1:")), ["chrome:1:7", "chrome:1:7~2"]);
    assert.match(rows.find((row) => row.title === "Garip").id, /^chrome:h[0-9a-f]{16}:h[0-9a-f]{16}$/);
    assert.ok(rows.every((row) => row.id.length <= 256));
  });

  test("private windows are left out where the browser says which they are", async () => {
    const { rows } = await list({
      chrome: { windows: [
        { id: "1", mode: "incognito", tabs: [{ id: "1", title: "Gizli", url: "https://example.com/gizli" }] },
        { id: "2", tabs: [{ id: "2", title: "Açık", url: "https://example.com/acik" }] },
      ] },
      edge: { windows: [{ id: "3", mode: "InPrivate", tabs: [{ id: "3", title: "Gizli Edge", url: "https://example.com/edge" }] }] },
      arc: { windows: [{ id: "4", incognito: true, tabs: [{ id: "4", title: "Gizli Arc", url: "https://example.com/arc" }] }] },
    });
    assert.deepEqual(rows.map((row) => row.title), ["Açık"]);
  });

  test("Arc is asked only `incognito`, the Chromium browsers only `mode`", () => {
    const { jxa } = runScript({ chrome: CHROME, arc: ARC, vivaldi: { windows: [{ id: "9", tabs: [{ id: "1", title: "V", url: "https://example.com/v" }] }] } });
    const privacy = jxa.reads.filter((read) => read.endsWith(".mode") || read.endsWith(".incognito"));
    assert.deepEqual([...new Set(privacy)], ["chrome.mode", "arc.incognito", "vivaldi.mode"]);
  });

  test("a window that doesn't say whether it is private stays hidden, and an empty column says the tabs couldn't be read", async () => {
    const arc = { ...ARC, lacks: ["incognito"] };
    const chrome = { ...CHROME, lacks: ["mode"] };
    await assert.rejects(list({ arc }), { message: "Couldn’t read the browsers’ tabs." });
    await assert.rejects(list({ chrome }, { language: "tr" }), { message: "Tarayıcıların sekmeleri okunamadı." });
    const { rows } = await list({ arc, safari: SAFARI });
    assert.deepEqual(rows.map((row) => row.title), ["Örnek Belgeler", "Haberler"], "the other browsers are still listed");
    const notBoolean = { windows: [{ ...ARC.windows[0], incognito: "false" }] };
    await assert.rejects(list({ arc: notBoolean }), { message: "Couldn’t read the browsers’ tabs." }, "only a real false counts as not private");
  });

  test("blank pages and tabs without an address are left out", async () => {
    const { rows } = await list({ chrome: { windows: [{ id: "1", tabs: [
      { id: "1", title: "Yeni Sekme", url: "chrome://newtab/" },
      { id: "2", title: "", url: "about:blank" },
      { id: "3", title: "Boş", url: null },
      { id: "4", title: "  ", url: "   " },
      { id: "5", title: "Favoriler", url: "favorites://" },
      { id: "6", title: "Ayarlar", url: "chrome://settings/" },
    ] }] } });
    assert.deepEqual(rows, [{ id: "chrome:1:6", title: "Ayarlar", subtitle: "Chrome · settings" }]);
  });

  test("Vivaldi's start page is left out in either form", async () => {
    const { rows } = await list({ vivaldi: { windows: [{ id: "1", tabs: [
      { id: "1", title: "Başlangıç Sayfası", url: "vivaldi://startpage/" },
      { id: "2", title: "Başlangıç Sayfası", url: "chrome://vivaldi-webui/startpage?section=Speed-dials&background-color=#2e2f37" },
      { id: "3", title: "Hızlı Erişim", url: "chrome://vivaldi-webui/startpage" },
      { id: "4", title: "Ayarlar", url: "vivaldi://settings/" },
    ] }] } });
    assert.deepEqual(rows.map((row) => row.id), ["vivaldi:1:4"]);
  });

  test("odd titles and URLs: blank titles, line breaks, files, ports, user names and long titles", async () => {
    const { rows } = await list({ chrome: { windows: [{ id: "1", active: 0, tabs: [
      { id: "1", title: "", url: "https://www.example.com/a" },
      { id: "2", title: " \n\t ", url: "http://localhost:3000/panel" },
      { id: "3", title: "İki\nsatırlı\tbaşlık  ", url: "https://example.com/b" },
      { id: "4", title: "rapor.pdf", url: "file:///Users/ornek/rapor.pdf" },
      { id: "5", title: "Giriş", url: `https://deniz:${TOKEN}@secure.example.com/oturum?token=${TOKEN}#${TOKEN}` },
      { id: "6", title: "ç".repeat(400), url: "https://example.com/uzun" },
      { id: "7", title: "IDN", url: "https://bücher.example/kitap" },
    ] }] } });
    assert.deepEqual(rows.slice(0, 6).map(({ title, subtitle }) => [title, subtitle]), [
      ["example.com", "Chrome · example.com"],
      ["localhost:3000", "Chrome · localhost:3000"],
      ["İki satırlı başlık", "Chrome · example.com"],
      ["rapor.pdf", "Chrome · File"],
      ["Giriş", "Chrome · secure.example.com"],
      ["ç".repeat(256), "Chrome · example.com"],
    ]);
    assert.equal(rows[6].subtitle, "Chrome · xn--bcher-kva.example");
    assert.ok(rows.every((row) => !row.title.includes(TOKEN) && !(row.subtitle ?? "").includes(TOKEN)), "no part of a URL but its host is shown");
  });

  test("more tabs than the app keeps: the first 10,000, active ones first, well within the time limit", async () => {
    const windows = Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), active: 999, tabs: manyTabs(1000, { prefix: `P${index}` }) }));
    const started = performance.now();
    const host = hostWith(fakeOsascript({ chrome: { windows } }));
    const { rows } = await host.list("tabs");
    const elapsed = performance.now() - started;
    assert.equal(rows.length, 10_000);
    assert.deepEqual(rows.slice(0, 3).map((row) => row.title), ["P0 999 · uzun bir örnek başlık", "P1 999 · uzun bir örnek başlık", "P2 999 · uzun bir örnek başlık"]);
    assert.equal(new Set(rows.map((row) => row.id)).size, 10_000);
    assert.deepEqual(host.logs, [], "the extension cuts the list itself, so the app has nothing to drop");
    assert.ok(elapsed < 5_000, `20,000 tabs took ${Math.round(elapsed)} ms`);
  });

  test("output beyond the 64 KB an exec result keeps is still read in full", async () => {
    const { rows } = await list({ safari: { windows: [{ id: 1, tabs: manyTabs(2000, { ids: false }) }] } });
    assert.equal(rows.length, 2000);
  });

  test("Safari's tabs are read again and again with the same ids, even with thousands of identical URLs", async () => {
    const same = Array.from({ length: 3000 }, () => ({ title: "Aynı sayfa", url: "https://example.com/ayni" }));
    const first = await list({ safari: { windows: [{ id: 1, tabs: same }] } });
    assert.equal(new Set(first.rows.map((row) => row.id)).size, 3000);
    const second = await list({ safari: { windows: [{ id: 1, tabs: same }] } });
    assert.deepEqual(second.rows.map((row) => row.id), first.rows.map((row) => row.id));
  });
});

describe("empty and locked", () => {
  test("no browser running: a calm row says so", async () => {
    assert.deepEqual(await list({ chrome: { running: false }, safari: { missing: true } }), { locked: true, message: "No supported browser is open." });
    assert.deepEqual(await list({}, { language: "tr" }), { locked: true, message: "Desteklenen bir tarayıcı açık değil." });
  });

  test("browsers open without a tab", async () => {
    assert.deepEqual(await list({ safari: { windows: [] }, chrome: { windows: [{ id: "1", tabs: [{ id: "1", title: "Yeni Sekme", url: "chrome://newtab/" }] }] } }),
      { locked: true, message: "No tabs are open." });
    assert.deepEqual(await list({ safari: { windows: [] } }, { language: "tr" }), { locked: true, message: "Açık sekme yok." });
  });

  test("only private windows", async () => {
    const browsers = { chrome: { windows: [{ id: "1", mode: "incognito", tabs: [{ id: "1", title: "Gizli", url: "https://example.com/gizli" }] }] } };
    assert.deepEqual(await list(browsers), { locked: true, message: "Only private windows are open, and their tabs stay hidden." });
    assert.deepEqual(await list(browsers, { language: "tr" }), { locked: true, message: "Yalnızca gizli pencereler açık; sekmeleri gösterilmez." });
  });

  test("Automation denied for the only browser: where to allow it", async () => {
    assert.deepEqual(await list({ safari: { ...SAFARI, denied: true } }), {
      locked: true,
      message: "Allow yabbistir to control Safari in System Settings › Privacy & Security › Automation.",
    });
    assert.deepEqual(await list({ chrome: { ...CHROME, denied: true } }, { language: "tr" }), {
      locked: true,
      message: "yabbistir’in Google Chrome uygulamasını denetlemesine izin ver: Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon.",
    });
  });

  test("Automation denied for several browsers names them all, within the app's 200 characters", async () => {
    const all = Object.fromEntries(["safari", "chrome", "arc", "brave", "edge", "vivaldi"].map((browser) => [browser, { denied: true }]));
    const english = await list(all);
    assert.equal(english.message, "Allow yabbistir to control Safari, Google Chrome, Arc, Brave Browser, Microsoft Edge, and Vivaldi in System Settings › Privacy & Security › Automation.");
    const turkish = await list(all, { language: "tr" });
    assert.equal(turkish.message, "yabbistir’in Safari, Google Chrome, Arc, Brave Browser, Microsoft Edge ve Vivaldi uygulamalarını denetlemesine izin ver: Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon.");
    assert.ok([...english.message].length <= 200 && [...turkish.message].length <= 200);
  });

  test("Automation denied for one browser among others: its tabs are missing, and a row at the end says why", async () => {
    const { rows } = await list({ safari: { ...SAFARI, denied: true }, chrome: CHROME });
    assert.deepEqual(rows.at(-1), { id: "denied:safari", title: "Allow access to Safari tabs", subtitle: "System Settings › Privacy & Security › Automation" });
    assert.equal(rows.length, 4);
    const host = hostWith(fakeOsascript({ safari: { denied: true }, chrome: CHROME }), { language: "tr" });
    const turkish = await host.list("tabs");
    assert.deepEqual(turkish.rows.at(-1), { id: "denied:safari", title: "Safari sekmelerine erişim izni ver", subtitle: "Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon" });
    await assert.rejects(host.runSource("tabs", "denied:safari", "link"), {
      message: "yabbistir’in Safari uygulamasını denetlemesine izin ver: Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon.",
    });
    assert.equal(osascriptRuns(host), 1, "the reminder row needs no second look at the browsers");
  });

  test("osascript itself refused Apple events (-1743): a calm row about Automation", async () => {
    const refused = () => ({ exitCode: 1, stdout: "", stderr: "0:42: execution error: Not authorized to send Apple events to Safari. (-1743)\n" });
    assert.deepEqual(await hostWith(refused).list("tabs"), { locked: true, message: "Allow yabbistir to control your browsers in System Settings › Privacy & Security › Automation." });
    assert.deepEqual(await hostWith(refused, { language: "tr" }).list("tabs"), { locked: true, message: "yabbistir’in tarayıcıları denetlemesine izin ver: Sistem Ayarları › Gizlilik ve Güvenlik › Otomasyon." });
    await assert.rejects(hostWith(refused).runSource("tabs", "chrome:1:2", "link"), { message: "Allow yabbistir to control Google Chrome in System Settings › Privacy & Security › Automation." },
      "pasting asks only the tab's browser, so it is the one named");
  });
});

describe("failures", () => {
  test("a failed osascript says so in plain words, without its output", async () => {
    const failing = () => ({ exitCode: 1, stdout: `https://example.com/?token=${TOKEN}\n`, stderr: `0:10: execution error: ${TOKEN} (-2700)\n` });
    const host = hostWith(failing);
    await assert.rejects(host.list("tabs"), (error) => {
      assert.equal(error.message, "Couldn’t read the browsers’ tabs.");
      assert.ok(!String(error.stack).includes(TOKEN));
      return true;
    });
    await assert.rejects(hostWith(failing, { language: "tr" }).list("tabs"), { message: "Tarayıcıların sekmeleri okunamadı." });
    assert.deepEqual(host.logs, []);
  });

  test("an answer that is not the script's is never taken for an empty column", async () => {
    for (const stdout of ["", "\n", "missing value\n", "[]\n", '{"b":"chrome","s":"ok"}\n']) {
      await assert.rejects(hostWith(() => ({ exitCode: 0, stdout, stderr: "" })).list("tabs"), { message: "Couldn’t read the browsers’ tabs." }, JSON.stringify(stdout));
    }
  });

  test("lines that are not the script's are skipped", async () => {
    const lines = [
      '{"v":1}',
      "not json",
      "[1,2,3]",
      '{"b":"firefox","w":"1","t":"1","p":0,"a":1,"n":"x","u":"https://example.com/x"}',
      '{"b":"chrome","w":1,"t":"1","p":0,"a":1,"n":"wrong window type","u":"https://example.com/1"}',
      '{"b":"chrome","w":"1","t":"2","p":-1,"a":1,"n":"bad place","u":"https://example.com/2"}',
      '{"b":"chrome","w":"1","t":"3","p":0,"a":1,"n":"no url"}',
      '{"b":"chrome","w":"1","t":"4","p":1,"a":0,"n":"Doğru","u":"https://example.com/4"}',
      '{"b":"chrome","w":"1","t":"5","p":2,"a":0,"n":"Doğru \\u00e7","u":"https://example.com/5"',
      '{"b":"chrome","s":"maybe"}',
      '{"b":"chrome","s":"ok","f":0,"x":0}',
      '{"b":"chrome","s":"denied","f":0,"x":0}',
    ];
    const host = hostWith(() => ({ exitCode: 0, stdout: lines.join("\r\n"), stderr: "" }));
    assert.deepEqual(await host.list("tabs"), { rows: [{ id: "chrome:1:4", title: "Doğru", subtitle: "Chrome · example.com" }] });
  });

  test("a browser that fails is left out; with no other tab the column says the list couldn't be read", async () => {
    const timedOut = { fail: Object.assign(new Error("AppleEvent timed out."), { errorNumber: -1712 }) };
    assert.deepEqual((await list({ safari: timedOut, chrome: CHROME })).rows.length, 3);
    await assert.rejects(list({ safari: timedOut }), { message: "Couldn’t read the browsers’ tabs." });
  });

  test("osascript missing: the app's toolMissing error", async () => {
    const host = createFakeHost({ folder, sources, exec: {} });
    await assert.rejects(host.list("tabs"), { code: "toolMissing" });
  });

  test("cancelling stops osascript", async () => {
    const host = hostWith(() => new Promise(() => {}));
    const listing = host.list("tabs");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(listing, { code: "cancelled" });
    const running = host.runSource("tabs", "chrome:1:2", "link");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
  });
});

describe("pasting", () => {
  test("↵ pastes the tab's URL, ⇧↵ a Markdown link", async () => {
    const host = hostWith(fakeOsascript({ chrome: CHROME }));
    assert.deepEqual(await host.runSource("tabs", "chrome:1203:1391", "link"), { text: "https://code.example.org/pull/42" });
    assert.deepEqual(await host.runSource("tabs", "chrome:1203:1391", "markdown"), { text: "[Pull request #42](https://code.example.org/pull/42)" });
  });

  test("listing asks every browser, pasting only the tab's own, by its key", async () => {
    const osascript = fakeOsascript({ safari: SAFARI, chrome: CHROME, arc: ARC });
    const host = hostWith(osascript);
    await host.list("tabs");
    await host.runSource("tabs", "chrome:1203:1391", "link");
    await host.runSource("tabs", "arc:A1:8B2C1F3A-0D4E-4F5A-9B6C-7D8E9F0A1B2C", "link");
    assert.deepEqual(osascriptCalls(host).map((call) => call.args[1]), [[...ARGS], [...ARGS, "chrome"], [...ARGS, "arc"]]);
    assert.deepEqual(osascript.runs.map((run) => run.lookups.length), [6, 1, 1]);
  });

  test("a hung Arc holds up neither a Chrome nor a Safari paste", async () => {
    const osascript = fakeOsascript({ safari: SAFARI, chrome: CHROME, arc: { ...ARC, hung: true } });
    const host = hostWith(osascript);
    const within = (promise) => {
      let timer;
      const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("still waiting after 2 s")), 2_000); });
      return Promise.race([promise, late]).finally(() => clearTimeout(timer));
    };
    assert.deepEqual(await within(host.runSource("tabs", "chrome:1203:1391", "link")), { text: "https://code.example.org/pull/42" });
    const safariID = (await hostWith(fakeOsascript({ safari: SAFARI })).list("tabs")).rows.find((row) => row.title === "Haberler").id;
    assert.deepEqual(await within(host.runSource("tabs", safariID, "link")), { text: "https://www.example.org/news" });
    assert.ok(osascript.runs.every((run) => run.events.arc === 0), "Arc got no Apple event");

    // The listing does wait on Arc, as the README says, until the app's time limit cancels it.
    const listing = host.list("tabs");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(listing, { code: "cancelled" });
  });

  test("Safari and Arc rows paste too", async () => {
    const host = hostWith(fakeOsascript({ safari: SAFARI, arc: ARC }));
    const { rows } = await host.list("tabs");
    const safari = rows.find((row) => row.title === "Haberler");
    assert.deepEqual(await host.runSource("tabs", safari.id, "link"), { text: "https://www.example.org/news" });
    assert.deepEqual(await host.runSource("tabs", "arc:A1:8B2C1F3A-0D4E-4F5A-9B6C-7D8E9F0A1B2C", "markdown"), { text: "[Tasarım taslağı](https://design.example.com/file/1)" });
  });

  test("the Markdown link escapes the title's Markdown characters and encodes what would end the URL", async () => {
    const tab = { id: "9", title: "a [b] <c> *d* _e_ \\f `g`", url: "https://en.example.org/wiki/Foo_(bar) baz<1>" };
    const host = hostWith(fakeOsascript({ chrome: { windows: [{ id: "1", tabs: [tab] }] } }));
    assert.deepEqual(await host.runSource("tabs", "chrome:1:9", "markdown"), {
      text: "[a \\[b\\] \\<c\\> \\*d\\* \\_e\\_ \\\\f \\`g\\`](https://en.example.org/wiki/Foo_%28bar%29%20baz%3C1%3E)",
    });
  });

  test("a tab without a title links with its host", async () => {
    const host = hostWith(fakeOsascript({ chrome: { windows: [{ id: "1", tabs: [{ id: "2", title: "", url: "https://www.example.com/a_b" }] }] } }));
    assert.deepEqual(await host.runSource("tabs", "chrome:1:2", "markdown"), { text: "[example.com](https://www.example.com/a_b)" });
  });

  test("the URL pasted is the one the tab has now", async () => {
    let url = "https://example.com/before";
    const host = hostWith(fakeOsascript(() => ({ chrome: { windows: [{ id: "1", tabs: [{ id: "2", title: "Sayfa", url }] }] } })));
    await host.list("tabs");
    url = "https://example.com/after";
    assert.deepEqual(await host.runSource("tabs", "chrome:1:2", "link"), { text: "https://example.com/after" });
  });

  test("a tab closed since the listing says so", async () => {
    let tabs = CHROME.windows[0].tabs;
    const host = hostWith(fakeOsascript(() => ({ chrome: { windows: [{ id: "1203", tabs }] } })));
    await host.list("tabs");
    tabs = [];
    await assert.rejects(host.runSource("tabs", "chrome:1203:1391", "link"), { message: "That tab is no longer open." });
    await assert.rejects(hostWith(fakeOsascript({ chrome: { windows: [] } }), { language: "tr" }).runSource("tabs", "chrome:1203:1391", "link"), { message: "Bu sekme artık açık değil." });
  });

  test("a browser denied since the listing names it", async () => {
    const host = hostWith(fakeOsascript({ edge: { denied: true }, chrome: CHROME }));
    await assert.rejects(host.runSource("tabs", "edge:9:1", "link"), { message: "Allow yabbistir to control Microsoft Edge in System Settings › Privacy & Security › Automation." });
  });

  test("an id the listing could not have made never reaches osascript", async () => {
    const host = hostWith(fakeOsascript({ chrome: CHROME }));
    for (const id of ["", "1391", "firefox:1:2", "chrome:1:2:3", "chrome::2", "chrome:1:2; rm -rf ~", "denied:firefox", "chrome:1:" + "9".repeat(300)]) {
      await assert.rejects(host.runSource("tabs", id, "link"), { message: "That tab is no longer open." }, id);
    }
    assert.equal(osascriptRuns(host), 0);
  });

  test("nothing about a tab reaches the log, and errors carry no URL", async () => {
    const secret = { chrome: { windows: [{ id: "1", tabs: [{ id: "2", title: "Gizli belge", url: `https://example.com/?token=${TOKEN}` }] }] } };
    const host = hostWith(fakeOsascript(secret));
    const { rows } = await host.list("tabs");
    assert.ok(!JSON.stringify(rows).includes(TOKEN));
    assert.deepEqual(await host.runSource("tabs", "chrome:1:2", "link"), { text: `https://example.com/?token=${TOKEN}` });
    await assert.rejects(host.runSource("tabs", "chrome:1:3", "link"), (error) => !String(error.stack).includes(TOKEN));
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.notifications, []);
  });
});

describe("raw output", () => {
  // What osascript prints for each browser, written by hand as the script writes it: one JSON object per line, ASCII
  // only. Window and tab ids are text in Chromium's dictionary, a number for Safari's windows, UUIDs for Arc's tabs.
  const RAW = [
    '{"v":1}',
    '{"b":"safari","w":"8812","t":null,"p":0,"a":0,"n":"\\u00d6rnek ba\\u015fl\\u0131k","u":"https://example.com/s/0"}',
    '{"b":"safari","w":"8812","t":null,"p":1,"a":1,"n":"Bo\\u015f de\\u011fil","u":"https://example.com/s/1"}',
    '{"b":"safari","s":"ok","f":0,"x":0}',
    '{"b":"chrome","w":"5021","t":"5022","p":0,"a":1,"n":"Grafik \\ud83d\\udcc8","u":"https://example.org/c"}',
    '{"b":"chrome","s":"ok","f":1,"x":1}',
    '{"b":"arc","w":"1","t":"0F0E0D0C-0B0A-4908-8706-050403020100","p":0,"a":1,"n":"Arc","u":"https://example.net/a"}',
    '{"b":"arc","s":"ok","f":0,"x":0}',
    '{"b":"brave","w":"77","t":"78","p":0,"a":1,"n":"Brave","u":"https://example.com/b"}',
    '{"b":"brave","s":"ok","f":0,"x":0}',
    '{"b":"edge","w":"90","t":"91","p":0,"a":1,"n":"Edge","u":"https://example.com/e"}',
    '{"b":"edge","s":"ok","f":0,"x":0}',
    '{"b":"vivaldi","w":"3","t":"4","p":0,"a":1,"n":"Vivaldi","u":"https://example.com/v"}',
    '{"b":"vivaldi","s":"ok","f":0,"x":0}',
  ];

  test("each browser's lines become rows, in the column's order", async () => {
    const host = hostWith(() => ({ exitCode: 0, stdout: RAW.join("\n") + "\n", stderr: "" }));
    const { rows } = await host.list("tabs");
    assert.deepEqual(rows.map((row) => [row.id.replace(/:u[0-9a-f]{16}$/, ":u…"), row.title, row.subtitle]), [
      ["chrome:5021:5022", "Grafik 📈", "Chrome · example.org"],
      ["safari:8812:u…", "Boş değil", "Safari · example.com"],
      ["arc:1:0F0E0D0C-0B0A-4908-8706-050403020100", "Arc", "Arc · example.net"],
      ["brave:77:78", "Brave", "Brave · example.com"],
      ["edge:90:91", "Edge", "Edge · example.com"],
      ["vivaldi:3:4", "Vivaldi", "Vivaldi · example.com"],
      ["safari:8812:u…", "Örnek başlık", "Safari · example.com"],
    ]);
  });

  test("the error number for consent that cannot be asked (-1744) counts as denied too", async () => {
    const browsers = { safari: { fail: Object.assign(new Error("Not authorized to send Apple events to Safari."), { errorNumber: -1744 }) } };
    assert.deepEqual(await list(browsers), { locked: true, message: "Allow yabbistir to control Safari in System Settings › Privacy & Security › Automation." });
  });
});

describe("long and hostile input", () => {
  const LIMIT = 1_000;
  const timed = async (call) => {
    const started = performance.now();
    const value = await call();
    return { value, elapsed: performance.now() - started };
  };

  test("a title of tens of thousands of spaces, line breaks and brackets stays fast", async () => {
    const titles = [
      " ".repeat(60_000) + "x" + " ".repeat(60_000),
      "　\n\t".repeat(30_000) + "y",
      "[".repeat(50_000) + "]".repeat(50_000),
      "_*`\\<>".repeat(20_000),
    ];
    const tabs = titles.map((title, index) => ({ id: String(index + 1), title, url: `https://example.com/${index}` }));
    const host = hostWith(fakeOsascript({ chrome: { windows: [{ id: "1", tabs }] } }));
    const listed = await timed(() => host.list("tabs"));
    assert.ok(listed.elapsed < LIMIT, `${Math.round(listed.elapsed)} ms`);
    assert.equal(listed.value.rows.find((row) => row.id === "chrome:1:1").title, "x");
    assert.equal(listed.value.rows.find((row) => row.id === "chrome:1:2").title, "y");
    const pasted = await timed(() => host.runSource("tabs", "chrome:1:3", "markdown"));
    assert.ok(pasted.elapsed < LIMIT, `${Math.round(pasted.elapsed)} ms`);
    assert.ok(pasted.value.text.startsWith("[\\[\\[\\["));
  });

  test("a very long URL full of separators stays fast", async () => {
    const url = "a" + ":".repeat(40_000) + "/".repeat(40_000) + "(".repeat(20_000) + " ".repeat(20_000) + "b";
    const urls = [url, "https://example.com/" + "(a)".repeat(30_000), "x".repeat(100_000) + "://newtab/"];
    const tabs = urls.map((value, index) => ({ id: String(index + 1), title: `Uzun ${index}`, url: value }));
    const host = hostWith(fakeOsascript({ chrome: { windows: [{ id: "1", tabs }] } }));
    const listed = await timed(() => host.list("tabs"));
    assert.ok(listed.elapsed < LIMIT, `${Math.round(listed.elapsed)} ms`);
    assert.deepEqual(listed.value.rows.map((row) => row.title), ["Uzun 0", "Uzun 1"], "the long new tab page is still a new tab page");
    const pasted = await timed(() => host.runSource("tabs", "chrome:1:2", "markdown"));
    assert.ok(pasted.elapsed < LIMIT, `${Math.round(pasted.elapsed)} ms`);
    const destination = pasted.value.text.slice(pasted.value.text.indexOf("](") + 2, -1);
    assert.ok(!/[()]/.test(destination), "every parenthesis in the URL is encoded");
    assert.ok(destination.startsWith("https://example.com/%28a%29%28a%29"));
  });
});

describe("package", () => {
  test("the manifest asks only for exec, to run osascript, and the source is not sensitive", () => {
    assert.deepEqual(manifest.permissions, ["exec"]);
    assert.deepEqual(manifest.requires.tools.map((tool) => tool.name), ["osascript"]);
    assert.equal(manifest.network, undefined);
    const [source] = manifest.contributes.sources;
    assert.equal(source.sensitive, undefined);
    assert.deepEqual(source.actions.map((action) => [action.id, action.kind]), [["link", "text"], ["markdown", "text"]]);
  });

  test("Turkish has every string but the browsers' names, which fall back to English", () => {
    const missing = Object.keys(en).filter((key) => !(key in tr));
    assert.ok(missing.every((key) => key.startsWith("browser.") || key.startsWith("app.")), missing.join(", "));
    for (const key of Object.keys(tr)) assert.ok(key in en, `${key} is not in en.json`);
  });

  test("every string the code uses is in en.json", () => {
    const code = ["src/index.ts", "src/tabs.ts"].map((file) => fs.readFileSync(new URL(file, folder), "utf8")).join("\n");
    const keys = [...code.matchAll(/yab\.t\("([^"]+)"/g)].map((match) => match[1]);
    for (const key of keys) assert.ok(key in en, key);
    for (const browser of ["safari", "chrome", "arc", "brave", "edge", "vivaldi"]) assert.ok(`browser.${browser}` in en && `app.${browser}` in en, browser);
  });
});
