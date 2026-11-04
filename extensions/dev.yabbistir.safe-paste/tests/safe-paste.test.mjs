import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { actions, detectors } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const accepts = Object.fromEntries(manifest.contributes.detectors.map((d) => [d.id, d.accepts]));
const host = createFakeHost({ folder });
const tr = createFakeHost({ folder, context: { language: "tr" } });

// Every odd character is written as an escape, so the files hold only plain text.
const ZWSP = "\u200b";
const ZWNJ = "\u200c";
const ZWJ = "\u200d";
const BOM = "\ufeff";
const RLO = "\u202e";
const LRI = "\u2066";
const PDI = "\u2069";
const NBSP = "\u00a0";
const item = (text, kind = "text") => ({ id: 1, kind, text, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const linkItem = (url) => ({ id: 1, kind: "link", url, text: url, tags: [], copiedAt: "2026-01-01T00:00:00Z" });
const hidden = (text, kind) => host.validate(detectors.hidden, item(text, kind));
const lookalike = (text) => host.validate(detectors.lookalike, item(text));
const risky = (text) => host.validate(detectors.risky, item(text));
const tagsOf = async (text) => {
  const tags = [];
  for (const id of ["hidden", "lookalike", "risky"]) {
    // The same two steps the app takes: the manifest pattern narrows, then validate decides.
    if (acceptsMatch(accepts[id], item(text)) && (await host.validate(detectors[id], item(text)))) tags.push(id);
  }
  return tags;
};
const rowsOf = (sections, title) => sections.find((s) => s.title === title)?.rows;

describe("hidden characters", () => {
  test("zeroWidthCharactersAreTagged", async () => {
    for (const ch of [ZWSP, "\u2060", BOM, "\u00ad", "\u180e", "\u2063"]) {
      assert.equal(await hidden(`curl${ch} https://example.com`), true, `U+${ch.codePointAt(0).toString(16)}`);
    }
    // A joiner between ASCII has no use; the same joiner in the middle of a word is flagged too.
    assert.equal(await hidden(`gi${ZWJ}thub`), true);
    assert.equal(await hidden(`gi${ZWNJ}thub`), true);
  });

  test("trojanSourceBidiControlsAreTagged", async () => {
    const trojan = `if (accessLevel != "user${RLO} ${LRI}// Check if admin${PDI} ${LRI}") {`;
    assert.equal(await hidden(trojan, "code"), true);
    assert.deepEqual(await tagsOf(trojan), ["hidden"]);
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      assert.equal(await hidden(`a${String.fromCodePoint(cp)}b`), true);
    }
  });

  test("controlCharactersAndBlankLookingLettersAreTagged", async () => {
    assert.equal(await hidden("echo hi\u001b[2K"), true, "escape");
    assert.equal(await hidden("echo hi\u0008\u0008"), true, "backspace");
    assert.equal(await hidden("echo\u3164x"), true, "Hangul filler");
    assert.equal(await hidden("a\u{e0041}b"), true, "tag character outside a flag");
  });

  test("aLinkWithAHiddenCharacterIsTagged", async () => {
    assert.equal(await host.validate(detectors.hidden, linkItem(`https://exa${ZWSP}mple.com/`)), true);
    assert.equal(await host.validate(detectors.hidden, linkItem("https://example.com/")), false);
  });

  test("ordinaryTextIsNotTagged", async () => {
    for (const text of [
      "ls -la",
      "git commit -m 'fix'\n",
      "Çalışkan öğrenci şimdi güneşte ığdır. ÇĞİÖŞÜ çğıöşü",
      "\tif (x) {\n\t\treturn 1;\n\t}\n",
      "你好，世界。こんにちは 안녕하세요",
      "plain 😀 emoji and 👍🏽 with a skin tone and ❤️ with a selector",
      "Windows line\r\nendings stay",
      "",
    ]) {
      assert.equal(await hidden(text), false, JSON.stringify(text));
    }
  });

  test("legitimateJoinersAndMarksAreKept", async () => {
    assert.equal(await hidden(`family \u{1f468}${ZWJ}\u{1f469}${ZWJ}\u{1f467} here`), false, "emoji sequence");
    assert.equal(await hidden("\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}"), false, "flag of England");
    assert.equal(await hidden(`می${ZWNJ}خواهم`), false, "Persian half-space");
    assert.equal(await hidden(`नी${ZWJ}क`), false, "joiner between non-ASCII letters");
    assert.equal(await hidden(`שלום\u200f עולם`), false, "right-to-left mark in Hebrew");
    // But the mark outside right-to-left text is hidden, and so is a direction override inside it.
    assert.equal(await hidden(`abc\u200fdef`), true);
    assert.equal(await hidden(`שלום${RLO}x`), true);
  });

  test("previewNamesEachCharacterWithItsCountAndPlace", async () => {
    const text = `ok\ncurl${ZWSP} https://${ZWSP}example.com\nrun${RLO}this`;
    const sections = await host.preview(detectors.hidden, item(text));
    assert.deepEqual(rowsOf(sections, "Hidden characters"), [
      ["Zero-width space (U+200B)", "2 × · line 2"],
      ["Right-to-left override (U+202E)", "1 × · line 3"],
    ]);
    const visible = sections.find((s) => s.title === "Made visible");
    assert.equal(visible.type, "code");
    assert.equal(visible.code, "2: curl⟨U+200B⟩ https://⟨U+200B⟩example.com\n3: run⟨U+202E⟩this");
    assert.match(sections.at(-1).text, /Direction controls/);
  });

  test("previewOfOneLineGivesPositions", async () => {
    const [rows] = (await host.preview(detectors.hidden, item(`ab${ZWSP}c${ZWSP}d`))).map((s) => s.rows);
    assert.deepEqual(rows, [["Zero-width space (U+200B)", "2 × · position 3, 5"]]);
  });

  test("previewCutsAWhereList", async () => {
    const text = Array.from({ length: 8 }, () => `a${ZWSP}`).join("\n");
    const [rows] = (await host.preview(detectors.hidden, item(text))).map((s) => s.rows);
    assert.deepEqual(rows, [["Zero-width space (U+200B)", "8 × · line 1, 2, 3, 4, 5 …"]]);
  });

  test("controlCharactersShareOneRow", async () => {
    const [rows] = (await host.preview(detectors.hidden, item("a\u0001b\u001bc"))).map((s) => s.rows);
    assert.deepEqual(rows, [["Control character", "2 × · position 2, 4"]]);
  });

  test("previewOfCleanTextIsEmpty", async () => {
    assert.deepEqual(await host.preview(detectors.hidden, item("ls -la")), []);
  });

  test("previewSpeaksTurkish", async () => {
    const sections = await tr.preview(detectors.hidden, item(`a${ZWSP}b`), { language: "tr" });
    assert.equal(sections[0].title, "Gizli karakterler");
    assert.deepEqual(sections[0].rows, [["Sıfır genişlikli boşluk (U+200B)", "1 × · konum 2"]]);
  });
});

describe("look-alike letters", () => {
  test("aCyrillicLetterInsideALatinWordIsTagged", async () => {
    assert.equal(await lookalike("p\u0430ypal"), true);
    assert.equal(await lookalike("git\u04bbub"), true, "Cyrillic h");
    assert.equal(await lookalike("g\u03bfogle"), true, "Greek omicron");
    assert.equal(await lookalike("\u0391dmin"), true, "Greek capital alpha");
  });

  test("aCyrillicDomainIsTagged", async () => {
    const text = "curl -O https://\u0430pple.com/install.sh";
    assert.equal(await lookalike(text), true);
    assert.deepEqual(await tagsOf(text), ["lookalike"]);
  });

  test("aDomainPartMadeOnlyOfLookalikesNextToLatinIsTagged", async () => {
    // "co" written with Cyrillic \u0441 and \u043e has no Latin letter in it, so only the dotted name gives it away.
    assert.equal(await lookalike("https://paypal.\u0441\u043e/"), true);
    assert.equal(await lookalike("https://\u0430\u0440\u0440\u0435.com"), true);
  });

  test("honestTextInOtherAlphabetsIsNot", async () => {
    for (const text of [
      "\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440! \u042d\u0442\u043e \u0442\u0435\u0441\u0442.",
      "\u03b1\u03b2\u03b3 \u03b4\u03b5\u03b6 \u0395\u03bb\u03bb\u03ac\u03b4\u03b1",
      "\u0394t = 5 \u03bcs and \u03a9 resistors",
      "Cafe au lait çğışöü and 你好",
      "\u044f\u043d\u0434\u0435\u043a\u0441.\u0440\u0444",
      "\u041f\u0440\u0438\u0432\u0435\u0442 from Berlin",
      "",
    ]) {
      assert.equal(await lookalike(text), false, JSON.stringify(text));
    }
  });

  test("previewNamesTheLettersAndWhere", async () => {
    const sections = await host.preview(detectors.lookalike, item("ok\nvisit p\u0430ypal.com now"));
    assert.deepEqual(rowsOf(sections, "Look-alike letters"), [["p\u0430ypal", "\u0430 Cyrillic (U+0430) · line 2"]]);
    assert.equal(sections.at(-1).title, "Why it matters");
  });

  test("previewOfPlainTextIsEmpty", async () => {
    assert.deepEqual(await host.preview(detectors.lookalike, item("paypal.com")), []);
  });
});

describe("risky commands", () => {
  test("aDownloadPipedIntoAShellIsTagged", async () => {
    for (const text of [
      "curl -fsSL https://example.com/install.sh | sh",
      "curl -fsSL https://example.com/install.sh | bash",
      "wget -qO- https://example.com/x | zsh",
      "curl -s https://example.com/x | sudo bash",
      "curl -s https://example.com/x | sudo -E /bin/bash -s -- --yes",
      "$ curl https://example.com/x | sh",
      'bash -c "$(curl -fsSL https://example.com/x)"',
      "bash <(curl -s https://example.com/x)",
      'eval "$(wget -qO- https://example.com/x)"',
    ]) {
      assert.equal(await risky(text), true, text);
    }
  });

  test("decodingIntoAShellIsTagged", async () => {
    for (const text of ["echo ZWNobyBoaQ== | base64 -d | sh", "echo aGk= | base64 --decode | bash", "xxd -r -p payload.hex | sh", 'eval "$(echo aGk= | base64 -d)"']) {
      assert.equal(await risky(text), true, text);
    }
    const sections = await host.preview(detectors.risky, item("echo aGk= | base64 -d | sh"));
    assert.deepEqual(rowsOf(sections, "Risky parts"), [["Decodes text and runs it", "this line"]]);
  });

  test("sudoIsTagged", async () => {
    assert.equal(await risky("sudo apt update"), true);
    assert.equal(await risky("brew update && sudo brew services start nginx"), true);
    assert.equal(await risky("cat key | sudo tee /etc/x"), true);
  });

  test("recursiveRmOfAHomeOrRootPathIsTagged", async () => {
    for (const text of ["rm -rf /", "rm -rf ~", "rm -rf ~/Documents", "rm -fr $HOME/x", "rm -r -f /usr/local/x", "rm -Rf /tmp/build", 'rm -rf "/Users/test/x"', "rm --recursive --force /var/x", "sudo rm -rf /*"]) {
      assert.equal(await risky(text), true, text);
    }
  });

  test("localRmIsNot", async () => {
    for (const text of ["rm file.txt", "rm -rf node_modules", "rm -rf ./build dist", "rm -f /tmp/x.lock", "echo rm -rf /"]) {
      assert.equal(await risky(text), false, text);
    }
  });

  test("forkBombsAreTagged", async () => {
    assert.equal(await risky(":(){ :|:& };:"), true);
    assert.equal(await risky(":() { : | : & } ; :"), true);
    assert.equal(await risky("bomb(){ bomb|bomb& };bomb"), true);
    assert.equal(await risky("f() { echo hi; }"), false);
  });

  test("recursiveChmod777IsTagged", async () => {
    assert.equal(await risky("chmod -R 777 /var/www"), true);
    assert.equal(await risky("chmod 777 -R ."), true);
    assert.equal(await risky("chmod --recursive 0777 dir"), true);
    assert.equal(await risky("chmod 755 script.sh"), false);
    assert.equal(await risky("chmod -R 755 dir"), false);
    assert.equal(await risky("chmod 777 file"), false);
  });

  test("writesToShellStartupFilesAreTagged", async () => {
    for (const text of [
      'echo "alias ll=ls" >> ~/.zshrc',
      "echo 'export X=1' >> $HOME/.bash_profile",
      'echo "x" | tee -a ~/.zprofile',
      "cat extra > /Users/test/.bashrc",
      "echo x >> /etc/zshrc",
      "echo 'set -x' >> ~/.config/fish/config.fish",
    ]) {
      assert.equal(await risky(text), true, text);
    }
    assert.equal(await risky("cat ~/.zshrc"), false, "reading is fine");
    assert.equal(await risky("echo hi > notes.txt"), false);
  });

  test("ordinaryCommandsAreNotTagged", async () => {
    for (const text of [
      "ls -la",
      "git commit -m 'sudo is a word here'",
      "cd ~/projects && npm install && npm test",
      "curl -s https://example.com/data.json | jq .name",
      "curl -O https://example.com/file.zip",
      "echo hello | base64",
      "echo aGk= | base64 -d",
      "docker run --rm -it ubuntu bash",
      "ssh user@host",
      "git push origin main\n",
      "cat notes.txt | grep todo | sort | uniq",
      "Meeting at 3pm; bring the laptop & the charger.",
      "cp a b ; mv b c",
      "",
    ]) {
      assert.equal(await risky(text), false, JSON.stringify(text));
    }
  });

  test("severalLinesPointToTheRightLine", async () => {
    const text = "cd /tmp\nsudo make install\nrm -rf ~/old\n";
    const sections = await host.preview(detectors.risky, item(text));
    assert.deepEqual(rowsOf(sections, "Risky parts"), [
      ["Runs as administrator (sudo)", "line 2"],
      ["Deletes files recursively", "line 3"],
    ]);
    assert.deepEqual(rowsOf(sections, "When pasted"), [
      ["Newline at the end", "A terminal runs it at once"],
      ["Lines", "3 commands, one after another"],
    ]);
    assert.equal(sections.at(-1).text, "yabbistir never changes a command. Read it before you paste.");
  });

  test("aSingleLineHasNoPasteSection", async () => {
    const sections = await host.preview(detectors.risky, item("curl https://example.com/x | sh"));
    assert.deepEqual(sections.map((s) => s.title), ["Risky parts", "Why it matters"]);
  });

  test("aFinalNewlineAloneIsNotRisky", async () => {
    assert.equal(await risky("ls -la\n"), false);
    assert.equal(await risky("cd a\nls\npwd\n"), false);
  });

  test("previewOfASafeCommandIsEmpty", async () => {
    assert.deepEqual(await host.preview(detectors.risky, item("ls")), []);
  });

  test("previewSpeaksTurkish", async () => {
    const sections = await tr.preview(detectors.risky, item("sudo ls"), { language: "tr" });
    assert.equal(sections[0].title, "Riskli kısımlar");
    assert.deepEqual(sections[0].rows, [["Yönetici olarak çalışır (sudo)", "bu satır"]]);
  });
});

describe("the manifest patterns", () => {
  test("theyNarrowWithoutDroppingARealCase", () => {
    assert.equal(acceptsMatch(accepts.hidden, item(`a${ZWSP}b`)), true);
    assert.equal(acceptsMatch(accepts.hidden, item(`a${RLO}b`)), true);
    assert.equal(acceptsMatch(accepts.hidden, item("a\u001bb")), true);
    assert.equal(acceptsMatch(accepts.hidden, item("a\u3164b")), true);
    assert.equal(acceptsMatch(accepts.hidden, item("plain\ttext\nwith lines")), false);
    assert.equal(acceptsMatch(accepts.lookalike, item("p\u0430ypal")), true);
    assert.equal(acceptsMatch(accepts.lookalike, item("p\u03bfpcorn")), true);
    assert.equal(acceptsMatch(accepts.lookalike, item("popcorn")), false);
    for (const text of ["curl x | sh", "sudo ls", "rm -rf ~", "chmod -R 777 .", ":(){ :|:& };:", "echo x >> ~/.zshrc", "echo aGk= | base64 -d | bash", 'eval "$(curl x)"']) {
      assert.equal(acceptsMatch(accepts.risky, item(text)), true, text);
    }
    assert.equal(acceptsMatch(accepts.risky, item("hello there")), false);
  });

  test("everyRiskKindPassesItsOwnPattern", async () => {
    const samples = ["curl x | sh", "echo a | base64 -d | sh", "sudo ls", "rm -rf /", ":(){ :|:& };:", "chmod -R 777 .", "echo x >> ~/.zshrc"];
    for (const text of samples) {
      assert.equal(await risky(text), true, text);
      assert.equal(acceptsMatch(accepts.risky, item(text)), true, text);
    }
  });
});

describe("Paste safely", () => {
  const run = (text, kind, context) => host.run(actions.paste, item(text, kind), context);

  test("removesHiddenCharactersAndTheFinalNewline", async () => {
    assert.deepEqual(await run(`curl${ZWSP} https://example.com/x${RLO}\n`), { text: "curl https://example.com/x" });
  });

  test("outputIsByteForByte", async () => {
    const input = [
      `  echo${NBSP}“hi ${ZWSP}there”  `,
      `  ls ${"\u2011"}${"\u2011"}all   `,
      `printf ‘%s’ x\t`,
      "",
      "",
    ].join("\r\n");
    const result = await run(input);
    assert.equal(result.text, ['  echo "hi there"', "  ls --all", "printf '%s' x"].join("\n"));
  });

  test("normalizesSpacesAndQuotes", async () => {
    assert.equal((await run(`a${NBSP}b\u202fc\u2003d\u3000e`)).text, "a b c d e");
    assert.equal((await run("‘a’ ‚b‛ “c” „d‟")).text, `'a' 'b' "c" "d"`);
  });

  test("stripsTrailingWhitespaceOnEveryLineAndTheEnd", async () => {
    assert.equal((await run("one  \n\ttwo\t\nthree \n\n\n")).text, "one\n\ttwo\nthree");
    assert.equal((await run("x\n \n")).text, "x");
  });

  test("keepsEverythingElse", async () => {
    const text = "if true; then\n\techo 'ça va \u2013 très bien' # comment\nfi";
    assert.deepEqual(await run(text), { none: true, message: "Nothing hidden here. It pastes as it is." });
    // Dashes in prose and a dangerous command are left alone: it never fixes, it only removes what is hidden.
    assert.equal((await run("rm -rf ~ \u2014 really\n")).text, "rm -rf ~ \u2014 really");
    assert.equal((await run("curl https://example.com/x | sudo sh\n")).text, "curl https://example.com/x | sudo sh");
    assert.equal((await run("ls \u2013 en dash\n")).text, "ls \u2013 en dash");
  });

  test("keepsEmojiAndTurkishLetters", async () => {
    const text = `Çalışıyor 👨${ZWJ}👩${ZWJ}👧 şimdi ✅\n`;
    assert.equal((await run(text)).text, `Çalışıyor 👨${ZWJ}👩${ZWJ}👧 şimdi ✅`);
  });

  test("optionDashesOnlyChangeWhereAnOptionStarts", async () => {
    assert.equal((await run("ls \u2212la a\u2212b")).text, "ls -la a\u2212b");
  });

  test("bidiTrojanSourceIsStripped", async () => {
    const result = await run(`access = "user${RLO} ${LRI}// admin${PDI} ${LRI}"`, "code");
    assert.equal(result.text, `access = "user // admin "`);
  });

  test("aLinkBecomesCleanText", async () => {
    const result = await host.run(actions.paste, linkItem(`https://exa${ZWSP}mple.com/\n`));
    assert.deepEqual(result, { text: "https://example.com/" });
  });

  test("hintShowsTheCleanedTextOrSaysNothingToDo", async () => {
    assert.deepEqual(await host.hint(actions.paste, item(`ls${ZWSP}\n`)), { text: "ls" });
    assert.deepEqual(await host.hint(actions.paste, item("ls")), { none: true, message: "Nothing hidden here. It pastes as it is." });
    assert.deepEqual(await tr.hint(actions.paste, item("ls"), { language: "tr" }), { none: true, message: "Gizli bir şey yok. Olduğu gibi yapışır." });
  });

  test("emptyOrOnlyHiddenTextHasNothingToPaste", async () => {
    const empty = { none: true, message: "There is no text to clean." };
    assert.deepEqual(await run(""), empty);
    assert.deepEqual(await run("  \n \n"), empty);
    assert.deepEqual(await run(`${ZWSP}${BOM}\n`), empty);
  });

  test("isOfferedEverywhereAndLeadsInTerminals", () => {
    assert.deepEqual(manifest.contributes.actions[0].targets, ["terminal"]);
    assert.equal(manifest.contributes.actions[0].targetsOnly, undefined);
    const terminal = { bundleID: "com.apple.Terminal", name: "Terminal", kind: "terminal" };
    const editor = { bundleID: "com.apple.dt.Xcode", name: "Xcode", kind: "editor" };
    assert.deepEqual(host.offers(item("ls"), { target: terminal }), ["paste"]);
    assert.deepEqual(host.offers(item("ls"), { target: editor }), ["paste"]);
    assert.deepEqual(host.offers(linkItem("https://example.com"), { target: terminal }), ["paste"]);
    assert.deepEqual(host.offers({ kind: "image", image: { id: "x" } }, { target: terminal }), []);
  });

  test("withATaggedItemTheTerminalActionComesFirst", () => {
    const tagged = { ...item(`a${ZWSP}b`), tags: ["dev.yabbistir.safe-paste:hidden"] };
    const terminal = { bundleID: "com.apple.Terminal", name: "Terminal", kind: "terminal" };
    const editor = { bundleID: "com.apple.dt.Xcode", name: "Xcode", kind: "editor" };
    assert.deepEqual(host.offers(tagged, { target: terminal }), ["paste", "unhide"]);
    assert.deepEqual(host.offers(tagged, { target: editor }).sort(), ["paste", "unhide"]);
  });
});

describe("Remove hidden characters", () => {
  const run = (text, kind) => host.run(actions.unhide, item(text, kind));

  test("removesOnlyWhatIsHidden", async () => {
    const text = `  “quoted”${NBSP}text${ZWSP}  \nsecond line${RLO}\n\n`;
    assert.deepEqual(await run(text), { text: `  “quoted”${NBSP}text  \nsecond line\n\n` });
  });

  test("keepsTheNewlineRuleOfThePasteActionOut", async () => {
    assert.equal((await run(`ls${ZWSP}\n`)).text, "ls\n");
  });

  test("keepsEmojiJoinersAndPersianHalfSpaces", async () => {
    const text = `\u{1f468}${ZWJ}\u{1f469} می${ZWNJ}خواهم x${BOM}`;
    assert.equal((await run(text)).text, `\u{1f468}${ZWJ}\u{1f469} می${ZWNJ}خواهم x`);
  });

  test("removesAstralTagCharactersOutsideAFlag", async () => {
    assert.equal((await run("a\u{e0041}\u{e0042}b")).text, "ab");
    assert.equal((await run("\u{1f3f4}\u{e0067}\u{e007f} x\u{e0041}")).text, "\u{1f3f4}\u{e0067}\u{e007f} x");
  });

  test("hintSaysWhenThereIsNothing", async () => {
    assert.deepEqual(await host.hint(actions.unhide, item("plain")), { none: true, message: "No hidden characters found." });
    assert.deepEqual(await host.hint(actions.unhide, item(`a${ZWSP}b`)), { text: "ab" });
    assert.deepEqual(await host.hint(actions.unhide, item("")), { none: true, message: "There is no text to clean." });
  });

  test("aLinkKeepsItsAddress", async () => {
    assert.deepEqual(await host.run(actions.unhide, linkItem(`https://exa${ZWSP}mple.com/a`)), { text: "https://example.com/a" });
  });

  test("isOfferedOnlyOnTaggedItems", () => {
    const tagged = { ...item(`a${ZWSP}b`), tags: ["dev.yabbistir.safe-paste:hidden"] };
    assert.deepEqual(host.offers(item("plain"), {}), ["paste"]);
    assert.deepEqual(host.offers(tagged, {}).sort(), ["paste", "unhide"]);
  });
});

describe("limits and privacy", () => {
  const big = (piece, bytes = 250_000) => piece.repeat(Math.ceil(bytes / piece.length));
  const within = async (ms, work) => {
    const started = performance.now();
    const result = await work();
    const took = performance.now() - started;
    assert.ok(took < ms, `took ${took.toFixed(1)} ms, limit ${ms} ms`);
    return result;
  };

  test("validateStaysWithin50msOnALargeInput", async () => {
    const inputs = [
      big("curl https://example.com/x | sh\n"),
      big("a"),
      big("curl "),
      big("sudo "),
      big("rm -rf "),
      big(" "),
      big("$("),
      big("(){ "),
      big(`word${ZWSP} `),
      big("p\u0430ypal.com "),
      big("\u041f\u0440\u0438\u0432\u0435\u0442 "),
      big("\u03b1 "),
      big("a.b.c.d "),
      big(">> "),
      big("|"),
      big(";"),
      big("x\n"),
      `a${" ".repeat(250_000)}b`,
      big(`\u{e0041}`),
    ];
    for (const text of inputs) {
      for (const id of ["hidden", "lookalike", "risky"]) {
        await within(50, () => host.validate(detectors[id], item(text)));
      }
    }
  });

  test("previewStaysWithin500msOnALargeInput", async () => {
    const inputs = [big(`curl https://example.com/x | sudo sh${ZWSP}\n`), big(`word${ZWSP} `), big("p\u0430ypal.com "), big("a\u001b")];
    for (const text of inputs) {
      for (const id of ["hidden", "lookalike", "risky"]) {
        await within(500, () => host.preview(detectors[id], item(text)));
      }
    }
  });

  test("cleaningALargeInputIsQuick", async () => {
    const text = big(`echo “hi”${ZWSP}${NBSP}x   \n`);
    const result = await within(500, () => host.run(actions.paste, item(text)));
    assert.ok(!result.text.includes(ZWSP) && !result.text.endsWith("\n"));
    await within(500, () => host.run(actions.unhide, item(text)));
    await within(500, () => host.run(actions.paste, item(`a${" ".repeat(250_000)}b `)));
  });

  test("aHugePreviewIsStillShortAndBounded", async () => {
    const sections = await host.preview(detectors.hidden, item(big(`word${ZWSP}\n`)));
    assert.ok(sections[1].code.split("\n").length <= 3);
    assert.ok(sections[0].rows.length <= 1);
    const risk = await host.preview(detectors.risky, item(big("sudo ls\n")));
    assert.ok(risk[0].rows.length <= 1);
  });

  test("nothingIsLoggedOrNotifiedAndNoEffectsAreUsed", async () => {
    const quiet = createFakeHost({ folder });
    const secret = "gh" + "p_" + "a".repeat(36);
    const text = `export TOKEN=${secret}${ZWSP}\ncurl -H "Authorization: ${secret}" https://example.com | sudo sh\n`;
    for (const id of ["hidden", "lookalike", "risky"]) {
      await quiet.validate(detectors[id], item(text));
      await quiet.preview(detectors[id], item(text));
    }
    await quiet.hint(actions.paste, item(text));
    await quiet.run(actions.paste, item(text));
    await quiet.run(actions.unhide, item(text));
    assert.deepEqual(quiet.logs, []);
    assert.deepEqual(quiet.notifications, []);
    assert.deepEqual(quiet.calls, []);
    assert.deepEqual(manifest.permissions ?? [], []);
  });

  test("noMessageCarriesTheCopiedText", async () => {
    const secret = "gh" + "p_" + "b".repeat(36);
    const messages = [
      (await host.hint(actions.paste, item(secret))).message,
      (await host.hint(actions.unhide, item(secret))).message,
      (await host.run(actions.paste, item(""))).message,
    ];
    for (const message of messages) assert.ok(message && !message.includes(secret));
    const rows = (await host.preview(detectors.risky, item(`sudo ${secret}`)))[0].rows;
    assert.ok(!JSON.stringify(rows).includes(secret), "rows name the kind of risk, never the command");
  });

  test("everyStringExistsInEnglishAndTurkish", () => {
    const en = JSON.parse(fs.readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const trl = JSON.parse(fs.readFileSync(new URL("../locales/tr.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(trl).sort(), Object.keys(en).sort());
    for (const [key, value] of Object.entries(trl)) {
      const placeholders = (text) => (typeof text === "string" ? text.match(/\{\w+\}/g)?.sort() ?? [] : []);
      assert.deepEqual(placeholders(value), placeholders(en[key]), key);
    }
  });
});
