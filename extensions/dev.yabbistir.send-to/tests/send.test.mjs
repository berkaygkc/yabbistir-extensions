import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";
import { MAX_URL, NOTES_SCRIPT, REMINDERS_SCRIPT, buildUrl, cleanFolder, enc, noteHtml } from "../src/destinations.ts";

const folder = new URL("..", import.meta.url);
const item = (text, kind = "text") => ({ id: 1, kind, text, ...(kind === "link" ? { url: text } : {}), tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const ok = () => ({ exitCode: 0, stdout: "", stderr: "" });

function make({ open = ok, osascript = ok, language = "en", preferences = {} } = {}) {
  const calls = [];
  const wrap = (tool, fn) => (args, env) => { calls.push({ tool, args }); return fn(args, env); };
  const host = createFakeHost({
    folder, context: { language }, preferences: { reminders: true, notes: true, ...preferences },
    exec: { open: wrap("open", open), osascript: wrap("osascript", osascript) },
  });
  return { host, calls };
}
const send = (host, text, variant, kind) => host.run(actions.send, item(text, kind), { variant });
const urlOf = (calls) => calls[0].args.at(-1);

describe("URL construction", () => {
  test("thingsEncodesTitleAndNotes", async () => {
    const { host, calls } = make();
    const result = await send(host, "Süt al\nİki litre, yağsız & taze", "things");
    assert.deepEqual(result, { none: true, message: "Sent to Things" });
    assert.equal(calls[0].args[0], "-g");
    assert.equal(urlOf(calls), "things:///add?title=S%C3%BCt%20al&notes=%C4%B0ki%20litre%2C%20ya%C4%9Fs%C4%B1z%20%26%20taze");
  });

  test("thingsLinkIsTheTitleWithNoNotes", async () => {
    const { host, calls } = make();
    await send(host, "https://example.com/a?b=1&c=2", "things", "link");
    assert.equal(urlOf(calls), "things:///add?title=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2");
  });

  test("obsidianUsesNameFromFirstLineAndKeepsNewlinesAndEmoji", async () => {
    const { host, calls } = make();
    await send(host, "Plan: günlük/haftalık #1\nsatır 2 🎉", "obsidian");
    const url = new URL(urlOf(calls));
    assert.equal(url.protocol, "obsidian:");
    assert.equal(url.searchParams.get("name"), "Plan günlük haftalık 1");
    assert.equal(url.searchParams.get("content"), "Plan: günlük/haftalık #1\nsatır 2 🎉");
    assert.equal(url.searchParams.get("vault"), null);
    assert.match(urlOf(calls), /%0A/);
    assert.match(urlOf(calls), /%F0%9F%8E%89/);
  });

  test("obsidianVaultAndFolderPreferences", async () => {
    const { host, calls } = make({ preferences: { obsidianVault: "Work Notes", obsidianFolder: "/Inbox/Clips/" } });
    await send(host, "Hello\nworld", "obsidian");
    const url = new URL(urlOf(calls));
    assert.equal(url.searchParams.get("vault"), "Work Notes");
    assert.equal(url.searchParams.get("file"), "Inbox/Clips/Hello");
    assert.equal(url.searchParams.get("name"), null);
  });

  test("obsidianRejectsAFolderThatLeavesTheVault", async () => {
    const { host, calls } = make({ preferences: { obsidianFolder: "../outside" } });
    const result = await send(host, "x", "obsidian");
    assert.equal(result.none, true);
    assert.match(result.message, /valid folder/);
    assert.equal(calls.length, 0);
    assert.equal(cleanFolder("a/./b"), null);
    assert.equal(cleanFolder("a//b/"), "a/b");
  });

  test("obsidianNameFallsBackWhenTheFirstLineHasNoUsableCharacters", async () => {
    const { host, calls } = make();
    await send(host, "???", "obsidian");
    assert.match(new URL(urlOf(calls)).searchParams.get("name"), /^Clipboard \d{4}-\d{2}-\d{2} \d{2}\.\d{2}$/);
  });

  test("obsidianNameFromALinkDropsTheSchemeAndForbiddenCharacters", async () => {
    const { host, calls } = make();
    await send(host, "https://example.com/a?b=1", "obsidian", "link");
    assert.equal(new URL(urlOf(calls)).searchParams.get("name"), "example.com a b=1");
  });

  test("bearAndDraftsTakeTheWholeText", async () => {
    const { host, calls } = make();
    await send(host, "Başlık\nİçerik (x) *y* !z 'q'", "bear");
    await send(host, "Başlık\nİçerik", "drafts");
    const bear = urlOf([calls[0]]);
    assert.ok(bear.startsWith("bear://x-callback-url/create?text="));
    assert.ok(bear.endsWith("&open_note=no&show_window=no"));
    assert.equal(new URL(bear).searchParams.get("text"), "Başlık\nİçerik (x) *y* !z 'q'");
    assert.ok(!/[()*!']/.test(bear.split("?")[1]));
    assert.equal(urlOf([calls[1]]), "drafts://create?text=Ba%C5%9Fl%C4%B1k%0A%C4%B0%C3%A7erik");
  });

  test("omnifocusSplitsNameAndNoteAndSaves", async () => {
    const { host, calls } = make();
    await send(host, "Rapor\nPazartesi\nkontrol et", "omnifocus");
    const url = new URL(urlOf(calls));
    assert.equal(url.protocol, "omnifocus:");
    assert.equal(url.searchParams.get("name"), "Rapor");
    assert.equal(url.searchParams.get("note"), "Pazartesi\nkontrol et");
    assert.equal(url.searchParams.get("autosave"), "true");
  });

  test("encodingNeverLeavesReservedCharacters", () => {
    assert.equal(enc("a b&c=d#e?f/g+h%i\n"), "a%20b%26c%3Dd%23e%3Ff%2Fg%2Bh%25i%0A");
  });

  test("loneSurrogatesAndNulDoNotThrow", async () => {
    const { host, calls } = make();
    await send(host, "bad \ud800 text\u0000 end", "drafts");
    assert.equal(urlOf(calls), "drafts://create?text=bad%20%EF%BF%BD%20text%20end");
  });

  test("crLfBecomesLf", async () => {
    const { host, calls } = make();
    await send(host, "a\r\nb", "drafts");
    assert.equal(urlOf(calls), "drafts://create?text=a%0Ab");
  });
});

describe("truncation", () => {
  test("aLongTextIsCutToFitAndSaysSo", async () => {
    const { host, calls } = make();
    const result = await send(host, "ğ".repeat(50000), "drafts");
    const url = urlOf(calls);
    assert.ok(url.length <= MAX_URL, String(url.length));
    assert.ok(url.length > MAX_URL - 20);
    assert.equal(result.message, "Sent to Drafts · cut to fit");
    assert.ok(decodeURIComponent(url.split("text=")[1]).endsWith("…"));
  });

  test("cuttingNeverSplitsAnEmoji", async () => {
    const { host, calls } = make();
    await send(host, "🎉".repeat(20000), "bear");
    const text = new URL(urlOf(calls)).searchParams.get("text");
    assert.ok(!/�/.test(text));
    assert.ok(urlOf(calls).length <= MAX_URL);
  });

  test("thingsNotesStopAtTenThousandCharacters", async () => {
    const { host, calls } = make();
    const result = await send(host, "Başlık\n" + "a".repeat(15000), "things");
    const notes = new URL(urlOf(calls)).searchParams.get("notes");
    assert.equal([...notes].length, 10000);
    assert.equal(result.message, "Sent to Things · cut to fit");
  });

  test("aLongFirstLineGetsAShortTitleAndTheWholeTextInNotes", () => {
    const text = "x".repeat(400) + "\nmore";
    const url = new URL(buildUrl("things", text, { vault: "", folder: "", fallbackName: "n" }));
    assert.equal([...url.searchParams.get("title")].length, 250);
    assert.equal(url.searchParams.get("notes"), text);
  });

  test("aShortTextIsNotCut", async () => {
    const { host } = make();
    assert.equal((await send(host, "short", "bear")).message, "Sent to Bear");
  });
});

describe("AppleScript destinations", () => {
  test("remindersPassesTheTextAsArgumentsNeverInTheScript", async () => {
    const { host, calls } = make();
    const result = await send(host, "Buy milk\nsecond line", "reminders");
    assert.deepEqual(result, { none: true, message: "Sent to Reminders" });
    assert.deepEqual(calls[0].args, ["-e", REMINDERS_SCRIPT, "xBuy milk", "xsecond line"]);
  });

  test("injectionAttemptsStayInsideArguments", async () => {
    const nasty = 'quote " backslash \\ end tell\ndo shell script "touch /tmp/x"\n-e tell application "Finder" to quit';
    for (const variant of ["reminders", "notes"]) {
      const { host, calls } = make();
      await send(host, nasty, variant);
      const args = calls[0].args;
      assert.equal(args[0], "-e");
      assert.equal(args[1], variant === "reminders" ? REMINDERS_SCRIPT : NOTES_SCRIPT);
      assert.equal(args.filter((a) => a === "-e").length, 1);
      assert.ok(!args[1].includes("touch"));
      assert.ok(!args[1].includes("backslash"));
      assert.ok(args.slice(2).every((a) => a.startsWith("x")));
      assert.ok(args.slice(2).join("").includes("do shell script"));
    }
  });

  test("anOptionLikeTextIsStillOneArgument", async () => {
    const { host, calls } = make();
    await send(host, "-e tell", "reminders");
    assert.deepEqual(calls[0].args.slice(2), ["x-e tell", "x"]);
  });

  test("notesGetsEscapedHtml", async () => {
    const { host, calls } = make();
    await send(host, 'Title <b>\n\n a & "b" </div>', "notes");
    assert.equal(calls[0].args.at(-1), 'x<div><h1>Title &lt;b&gt;</h1></div><div><br></div><div> a &amp; &quot;b&quot; &lt;/div&gt;</div>');
    assert.equal(noteHtml("one"), "<div><h1>one</h1></div>");
  });

  test("automationDeniedHasItsOwnMessage", async () => {
    const { host } = make({ osascript: () => ({ exitCode: 1, stdout: "", stderr: "execution error: Not authorized to send Apple events to Reminders. (-1743)" }) });
    const result = await send(host, "x", "reminders");
    assert.equal(result.none, true);
    assert.match(result.message, /Automation/);
    assert.ok(!result.message.includes("Not authorized"));
  });

  test("appMissingIsAClearMessage", async () => {
    const { host } = make({ osascript: () => ({ exitCode: 1, stdout: "", stderr: "Application isn't running. (-600)" }) });
    assert.equal((await send(host, "x", "notes")).message, "Couldn’t reach Notes. Is it installed?");
  });

  test("anUnknownFailureThrowsWithoutToolOutput", async () => {
    const { host } = make({ osascript: () => ({ exitCode: 1, stdout: "", stderr: "detail from SECRET text" }) });
    await assert.rejects(send(host, "SECRET text", "reminders"), (error) => {
      assert.equal(error.message, "Couldn’t send to Reminders.");
      return true;
    });
  });
});

describe("preferences", () => {
  test("remindersAndNotesAreOffByDefault", async () => {
    const host = createFakeHost({ folder, exec: { open: ok, osascript: ok } });
    const result = await host.run(actions.send, item("x"), { variant: "reminders" });
    assert.equal(result.none, true);
    assert.match(result.message, /Reminders is turned off/);
    assert.equal(host.calls.filter((c) => c.api === "exec").length, 0);
    assert.equal((await host.run(actions.send, item("x"), { variant: "things" })).message, "Sent to Things");
  });

  test("aTurnedOffDestinationNeverRuns", async () => {
    const { host, calls } = make({ preferences: { bear: false } });
    const result = await send(host, "x", "bear");
    assert.match(result.message, /Bear is turned off/);
    assert.equal(calls.length, 0);
  });

  // yabbistir 0.5.1 lists a variant only while the toggle its "preference" names is on.
  test("eachDestinationIsShownByItsOwnToggle", () => {
    const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", folder), "utf8"));
    const toggles = manifest.preferences.filter((preference) => preference.type === "toggle").map((preference) => preference.id);
    const variants = manifest.contributes.actions.find((action) => action.id === "send").variants;
    assert.deepEqual(variants.map((variant) => variant.preference), variants.map((variant) => variant.id));
    assert.deepEqual([...toggles].sort(), variants.map((variant) => variant.id).sort());
    assert.equal(manifest.minAppVersion, "0.5.1");
  });
});

describe("failures", () => {
  test("aMissingAppIsAClearMessageNotAnError", async () => {
    const { host } = make({ open: () => ({ exitCode: 1, stdout: "", stderr: "LSOpenURLsWithRole() failed with error -10814 for the URL things:///add?title=SECRET" }) });
    const result = await send(host, "SECRET", "things");
    assert.deepEqual(result, { none: true, message: "Couldn’t reach Things. Is it installed?" });
  });

  test("emptyAndBlankTextSendsNothing", async () => {
    const { host, calls } = make();
    assert.equal((await send(host, "  \n ", "things")).message, "There is nothing to send.");
    assert.equal(calls.length, 0);
  });

  test("anUnknownVariantAsksForADestination", async () => {
    const { host } = make();
    assert.equal((await host.run(actions.send, item("x"), { variant: "nope" })).message, "Choose a destination.");
  });

  test("openToolMissing", async () => {
    const host = createFakeHost({ folder, exec: {} });
    await assert.rejects(host.run(actions.send, item("x"), { variant: "things" }), { code: "toolMissing" });
  });
});

describe("secrecy", () => {
  test("theTextNeverReachesLogsNoticesOrMessages", async () => {
    const secret = "gh" + "p_" + "a".repeat(36);
    const { host } = make({ open: () => ({ exitCode: 1, stdout: secret, stderr: secret }), osascript: () => ({ exitCode: 1, stdout: secret, stderr: secret }) });
    const result = await send(host, secret, "drafts");
    assert.ok(!JSON.stringify(result).includes(secret));
    const error = await send(host, secret, "reminders").catch((e) => e);
    assert.ok(!String(error.message).includes(secret));
    assert.ok(!host.logs.join("\n").includes(secret));
    assert.deepEqual(host.notifications, []);
  });
});

describe("offers and language", () => {
  test("isOfferedOnTextCodeAndLinksOnly", () => {
    const { host } = make();
    assert.deepEqual(host.offers({ kind: "text", text: "a" }), ["send"]);
    assert.deepEqual(host.offers({ kind: "code", text: "a" }), ["send"]);
    assert.deepEqual(host.offers({ kind: "link", url: "https://example.com", text: "https://example.com" }), ["send"]);
    assert.deepEqual(host.offers({ kind: "image" }), []);
  });

  test("answersInTurkish", async () => {
    const { host } = make({ language: "tr" });
    assert.equal((await send(host, "x", "things")).message, "Things uygulamasına gönderildi");
    assert.equal((await send(host, "  ", "things")).message, "Gönderilecek bir şey yok.");
  });
});

describe("speed", () => {
  test("aHugeTextIsCutWellInsideTheTimeLimit", async () => {
    const { host } = make();
    const started = Date.now();
    for (const variant of ["obsidian", "things", "bear", "drafts", "omnifocus", "reminders", "notes"]) {
      await send(host, "🎉é\n".repeat(60000), variant);
    }
    assert.ok(Date.now() - started < 5000, String(Date.now() - started));
  });

  test("onlyAnchoredCodesCountAsAppMissing", async () => {
    const { host } = make({ osascript: () => ({ exitCode: 1, stdout: "", stderr: "odd (-6000) and Can't get object. (-1728)" }) });
    await assert.rejects(send(host, "x", "notes"), /Couldn’t send to Notes\./);
  });

  test("turkishUsesLocalizedNamesForRemindersAndNotes", async () => {
    const { host } = make({ language: "tr" });
    assert.equal((await send(host, "x", "reminders")).message, "Hatırlatıcılar uygulamasına gönderildi");
    assert.equal((await send(host, "x", "notes")).message, "Notlar uygulamasına gönderildi");
  });
});
