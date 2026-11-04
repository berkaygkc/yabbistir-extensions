import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptsMatch, createFakeHost } from "@yabbistir/api/fake-host";

import { actions, detectors } from "../src/index.ts";
import { LINE_MAY_BE_RISKY, scanLookalike, scanShell } from "../src/scan.ts";

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
const run_unhide = (text) => host.run(actions.unhide, item(text));
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
      ["Zero-width space (U+200B)", "2 found · line 2"],
      ["Right-to-left override (U+202E)", "1 found · line 3"],
    ]);
    const visible = sections.find((s) => s.title === "Made visible");
    assert.equal(visible.type, "code");
    assert.equal(visible.code, "2: curl⟨U+200B⟩ https://⟨U+200B⟩example.com\n3: run⟨U+202E⟩this");
    assert.match(sections.at(-1).text, /Direction controls/);
  });

  test("previewOfOneLineGivesPositions", async () => {
    const [rows] = (await host.preview(detectors.hidden, item(`ab${ZWSP}c${ZWSP}d`))).map((s) => s.rows);
    assert.deepEqual(rows, [["Zero-width space (U+200B)", "2 found · position 3, 5"]]);
  });

  test("previewCutsAWhereList", async () => {
    const text = Array.from({ length: 8 }, () => `a${ZWSP}`).join("\n");
    const [rows] = (await host.preview(detectors.hidden, item(text))).map((s) => s.rows);
    assert.deepEqual(rows, [["Zero-width space (U+200B)", "8 found · line 1, 2, 3, 4, 5 …"]]);
  });

  test("controlCharactersShareOneRow", async () => {
    const [rows] = (await host.preview(detectors.hidden, item("a\u0001b\u001bc"))).map((s) => s.rows);
    assert.deepEqual(rows, [["Control character", "2 found · position 2, 4"]]);
  });

  test("previewOfCleanTextIsEmpty", async () => {
    assert.deepEqual(await host.preview(detectors.hidden, item("ls -la")), []);
  });

  test("previewSpeaksTurkish", async () => {
    const sections = await tr.preview(detectors.hidden, item(`a${ZWSP}b`), { language: "tr" });
    assert.equal(sections[0].title, "Gizli karakterler");
    assert.deepEqual(sections[0].rows, [["Sıfır genişlikli boşluk (U+200B)", "1 adet · konum 2"]]);
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

  test("recursiveRmOfADangerousTargetIsTagged", async () => {
    const targets = ["/", "/*", "~", "~/", "~/*", "$HOME", "${HOME}", "$HOME/", "${HOME}/*", "*", ".", "..", '"$HOME"', '"~"'];
    for (const target of targets) {
      for (const flags of ["-rf", "-fr", "-Rf", "-r -f", "-f -r", "--recursive --force", "-r"]) {
        const text = `rm ${flags} ${target}`;
        assert.equal(await risky(text), true, text);
      }
    }
    assert.equal(await risky("sudo rm -rf /*"), true);
    assert.equal(await risky("rm -rf -- /"), true);
    assert.equal(await risky("rm -rf build ~"), true, "any one dangerous target");
  });
  test("ordinaryRmIsNot", async () => {
    const texts = [
      "rm file.txt", "rm -rf node_modules", "rm -rf ./build dist", "rm -f /tmp/x.lock", "echo rm -rf /",
      "rm -rf /tmp/build", "rm -Rf /tmp/build", "rm -rf ./dist", "rm -rf ~/Documents", "rm -rf ~/proj/node_modules", "rm -fr $HOME/x",
      'rm -rf "/Users/test/x"', "rm -r -f /usr/local/x", "rm --recursive --force /var/x", "rm -f /", "rm /", "rm -rf ./",
    ];
    for (const text of texts) assert.equal(await risky(text), false, text);
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
    const text = "cd /tmp\nsudo make install\nrm -rf ~/*\n";
    const sections = await host.preview(detectors.risky, item(text));
    assert.deepEqual(rowsOf(sections, "Risky parts"), [
      ["Runs as administrator (sudo)", "line 2"],
      ["Deletes files recursively", "line 3"],
    ]);
    assert.deepEqual(rowsOf(sections, "When pasted"), [
      ["Newline at the end", "A terminal runs it at once"],
      ["Lines", "3 commands, one after another"],
    ]);
    assert.equal(sections.at(-1).text, "yabbistir never fixes a dangerous command. Read it before you paste.");
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
      `echo${NBSP}“hi ${ZWSP}there”`,
      `  ls ${"\u2011"}${"\u2011"}all`,
      `printf ‘%s’ x  \t`,
      "",
      "",
    ].join("\r\n");
    const result = await run(input);
    assert.equal(result.text, "echo \u201chi there\u201d\n  ls \u2011\u2011all\nprintf \u2018%s\u2019 x");
  });
  test("normalizesSpacesAndLeavesQuotesAlone", async () => {
    assert.equal((await run(`a${NBSP}b\u202fc\u2003d\u3000e`)).text, "a b c d e");
    const quoted = "‘a’ ‚b‛ “c” „d‟";
    assert.equal((await run(quoted)).text, quoted, "curly quotes are never changed");
    assert.equal((await run("echo 'it’s fine'; touch x")).text, "echo 'it’s fine'; touch x");
    assert.equal((await run("git commit -m 'don’t'")).text, "git commit -m 'don’t'");
    assert.equal((await run('echo “it’s”')).text, 'echo “it’s”');
  });
  test("stripsTrailingWhitespaceOnlyAtTheVeryEnd", async () => {
    assert.equal((await run("one  \n\ttwo\t\nthree \n\n\n")).text, "one  \n\ttwo\t\nthree");
    assert.equal((await run("x\n \n")).text, "x");
    assert.equal((await run("x \t \n\n")).text, "x");
    assert.equal((await run("a  \nb  \nc")).text, "a  \nb  \nc", "lines in the middle keep their trailing spaces");
    assert.equal((await run("cat <<EOF\nline  \nEOF\n")).text, "cat <<EOF\nline  \nEOF");
  });

  test("anEscapedSpaceAtTheEndIsKept", async () => {
    assert.equal((await run("echo a\\ ")).text, "echo a\\ ");
    assert.equal((await run("echo a\\ \n")).text, "echo a\\ ");
    assert.equal((await run("echo a\\  \n")).text, "echo a\\ ", "only the escaped space stays");
    assert.equal((await run("echo a\\\\ \n")).text, "echo a\\\\", "an escaped backslash does not escape the space");
    assert.equal((await run("a\\ \nb")).text, "a\\ \nb");
  });
  test("cleanTextPastesUnchanged", async () => {
    const text = "if true; then\n\techo 'ça va \u2013 très bien' # comment\nfi";
    assert.deepEqual(await run(text), { text });
    assert.deepEqual(await host.run(actions.paste, item("ls -la")), { text: "ls -la" });
    // Dashes in prose and a dangerous command are left alone: it never fixes, it only removes what is hidden.
    assert.equal((await run("rm -rf ~ \u2014 really\n")).text, "rm -rf ~ \u2014 really");
    assert.equal((await run("curl https://example.com/x | sudo sh\n")).text, "curl https://example.com/x | sudo sh");
    assert.equal((await run("ls \u2013 en dash\n")).text, "ls \u2013 en dash");
  });
  test("keepsEmojiAndTurkishLetters", async () => {
    const text = `Çalışıyor 👨${ZWJ}👩${ZWJ}👧 şimdi ✅\n`;
    assert.equal((await run(text)).text, `Çalışıyor 👨${ZWJ}👩${ZWJ}👧 şimdi ✅`);
  });

  test("dashesBeforeOptionsAreKeptAndMentionedInThePreview", async () => {
    for (const dash of ["\u2013", "\u2014", "\u2212", "\u2011", "\u2010"]) {
      const text = `ls ${dash}la`;
      assert.equal((await run(text)).text, text, "the dash stays");
    }
    assert.equal((await run("sudo ls \u2013version\n")).text, "sudo ls \u2013version");
    const row = [["Look-alike dash before an option", "A shell doesn\u2019t read it as an option"]];
    assert.deepEqual(rowsOf(await host.preview(detectors.risky, item("sudo ls \u2013la")), "When pasted"), row);
    assert.deepEqual(rowsOf(await host.preview(detectors.hidden, item(`ls \u2212la${ZWSP}`)), "When pasted"), row);
    assert.deepEqual(rowsOf(await host.preview(detectors.lookalike, item("ls \u2014all p\u0430ypal")), "When pasted"), row);
    assert.equal(rowsOf(await host.preview(detectors.risky, item("sudo ls a \u2013 b")), "When pasted"), undefined, "a dash in prose is not before an option");
  });

  test("curlyQuotesAreMentionedForLookAlikeCopiesToo", async () => {
    const sections = await host.preview(detectors.lookalike, item("echo \u201cp\u0430ypal\u201d"));
    assert.deepEqual(rowsOf(sections, "When pasted"), [["Curly quotes", "Shells don\u2019t treat them as quotes"]]);
    assert.deepEqual(sections.map((x) => x.title), ["Look-alike letters", "When pasted", "Why it matters"]);
  });

  test("bidiTrojanSourceIsStripped", async () => {
    const result = await run(`access = "user${RLO} ${LRI}// admin${PDI} ${LRI}"`, "code");
    assert.equal(result.text, `access = "user // admin "`);
  });

  test("aLinkBecomesCleanText", async () => {
    const result = await host.run(actions.paste, linkItem(`https://exa${ZWSP}mple.com/\n`));
    assert.deepEqual(result, { text: "https://example.com/" });
  });

  test("hintShowsExactlyWhatIsPasted", async () => {
    assert.deepEqual(await host.hint(actions.paste, item(`ls${ZWSP}\n`)), { text: "ls" });
    assert.deepEqual(await host.hint(actions.paste, item("ls")), { text: "ls" });
    assert.deepEqual(await tr.hint(actions.paste, item("ls"), { language: "tr" }), { text: "ls" });
    const sample = item("echo a  \n");
    assert.deepEqual(await host.hint(actions.paste, sample), await host.run(actions.paste, sample));
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

describe("fix round 1", () => {
  test("directionMarksAreExcusedOnlyBesideRightToLeftText", async () => {
    assert.equal(await hidden(`\u05e9\u05dc\u05d5\u05dd\u200f \u05e2\u05d5\u05dc\u05dd`), false);
    assert.equal(await hidden(`curl\u200f x | sh \u05e9`), true, "a Hebrew letter elsewhere does not excuse the mark");
    assert.equal(await hidden(`ls\u200e -la ${"\u0627".repeat(3)}`), true);
  });

  test("moreInvisibleLettersAreHidden", async () => {
    for (const cp of [0x34f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d]) {
      assert.equal(await hidden(`a${String.fromCodePoint(cp)}b`), true, cp.toString(16));
      assert.ok(acceptsMatch(accepts.hidden, item(`a${String.fromCodePoint(cp)}b`)), `pattern ${cp.toString(16)}`);
      assert.equal((await run_unhide(`a${String.fromCodePoint(cp)}b`)).text, "ab");
    }
  });

  test("verticalTabFormFeedAndNextLineBecomeASpace", async () => {
    assert.equal((await run_unhide("ls\u000b-la")).text, "ls -la");
    assert.equal((await host.run(actions.paste, item("ls\u000c-la\u0085x"))).text, "ls -la x");
  });

  test("positionCountsCharactersNotCodeUnits", async () => {
    const [rows] = (await host.preview(detectors.hidden, item(`\u{1f600}\u{1f600}a${ZWSP}`))).map((s) => s.rows);
    assert.deepEqual(rows, [["Zero-width space (U+200B)", "1 found \u00b7 position 4"]]);
  });

  test("curlyQuotesAreMentionedInThePreviewOfATaggedCopy", async () => {
    const risk = await host.preview(detectors.risky, item("sudo echo \u201chi\u201d"));
    assert.deepEqual(rowsOf(risk, "When pasted"), [["Curly quotes", "Shells don\u2019t treat them as quotes"]]);
    const hid = await host.preview(detectors.hidden, item(`echo \u2018hi\u2019${ZWSP}`));
    assert.deepEqual(rowsOf(hid, "When pasted"), [["Curly quotes", "Shells don\u2019t treat them as quotes"]]);
    const tur = await tr.preview(detectors.risky, item("sudo echo \u201chi\u201d"), { language: "tr" });
    assert.deepEqual(rowsOf(tur, "Yapıştırınca"), [["Kıvrık tırnak", "Kabuk bunları tırnak saymaz"]]);
    const none = await host.preview(detectors.risky, item("sudo echo hi"));
    assert.equal(rowsOf(none, "When pasted"), undefined);
  });

  test("pipeWithAmpersandAndBackslashedShellAreTagged", async () => {
    for (const text of ["curl -s https://example.com/x |& sh", "curl -s https://example.com/x |& sudo bash", "curl -s https://example.com/x | \\sh"]) {
      assert.equal(await risky(text), true, text);
      assert.equal(acceptsMatch(accepts.risky, item(text)), true, text);
    }
  });

  test("everyShellStartupFileIsTaggedAndReachesValidate", async () => {
    for (const file of ["~/.bashrc", "~/.bash_profile", "~/.bash_login", "~/.zshrc", "~/.zprofile", "~/.zshenv", "~/.zlogin", "~/.profile", "~/.config/fish/config.fish", "$HOME/.zshrc", "/etc/zshrc"]) {
      const text = `echo x >> ${file}`;
      assert.equal(acceptsMatch(accepts.risky, item(text)), true, `pattern ${text}`);
      assert.equal(await risky(text), true, text);
    }
  });

  test("aLongUnbrokenTokenWithOneCyrillicLetterIsQuick", async () => {
    const started = () => performance.now();
    const cases = ["x".repeat(20_000) + "\u0430", "x".repeat(4_000) + "\u0430", "a-".repeat(10_000) + "\u0430", "a\u0430".repeat(50_000), "a.".repeat(60_000) + "\u0430", "\u0430" + "x".repeat(20_000)];
    for (const text of cases) {
      let t = started();
      await host.validate(detectors.lookalike, item(text));
      assert.ok(performance.now() - t < 50, `validate ${text.length}`);
      t = started();
      await host.preview(detectors.lookalike, item(text));
      assert.ok(performance.now() - t < 500, `preview ${text.length}`);
    }
  });
});

describe("limits and privacy", () => {
  const big = (piece, bytes = 250_000) => piece.repeat(Math.ceil(bytes / piece.length));
  // The best of up to five runs: a busy machine (the whole store's tests run at once) can stall one run, while a
  // slow algorithm is slow every time.
  const within = async (ms, work) => {
    let best = Infinity;
    let result;
    for (let attempt = 0; attempt < 5 && best >= ms; attempt++) {
      const started = performance.now();
      result = await work();
      best = Math.min(best, performance.now() - started);
    }
    assert.ok(best < ms, `took ${best.toFixed(1)} ms at best, limit ${ms} ms`);
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
      // A long log whose every line holds a trigger word but no risk: each line is read word by word.
      big("echo login ok\n"),
      big("ls | sh\n"),
      big("sudo -n true\n"),
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

describe("the line filter", () => {
  test("isTheRiskyDetectorsAcceptsPattern", () => {
    const pattern = accepts.risky.pattern;
    assert.ok(pattern.startsWith("(?i)"));
    assert.equal(LINE_MAY_BE_RISKY.source, pattern.slice(4));
    assert.ok(LINE_MAY_BE_RISKY.flags.includes("i"));
  });

  test("keepsEveryRiskyLineInALongLog", () => {
    const log = Array.from({ length: 5000 }, (_, i) => `line ${i}: all good`);
    log[1234] = "curl -fsSL https://example.com/install | SH";
    log[4321] = "echo x >> ~/.zshrc";
    const kinds = scanShell(log.join("\n")).map((hit) => `${hit.kind}@${hit.line}`);
    assert.deepEqual(kinds, ["pipe@1235", "startup@4322"]);
  });
});

describe("look-alike words found from their Latin letters", () => {
  const words = (text) => scanLookalike(text).map((hit) => [hit.index, hit.word]);

  test("aWholeWordIsReportedWhenItStartsWithALookalike", () => {
    // Cyrillic а, then Latin: the word starts before its first Latin letter.
    assert.deepEqual(words("see \u0430pple now"), [[4, "\u0430pple"]]);
  });

  test("aMixedWordAfterALongCyrillicText", () => {
    const prose = "\u041f\u0440\u0438\u0432\u0435\u0442 ".repeat(10_000);
    assert.deepEqual(words(`${prose}p\u0430ypal`), [[prose.length, "p\u0430ypal"]]);
  });

  test("charactersOutsideTheBmpStayInsideTheWord", () => {
    // 𝟙 (a digit outside the BMP) and a combining mark belong to the word, as before.
    const text = "x \u{1d7d9}\u0430pple\u0301 y";
    assert.deepEqual(words(text), [[2, "\u{1d7d9}\u0430pple\u0301"]]);
  });

  test("eachWordIsReportedOnceThoughItHasSeveralLatinRuns", () => {
    assert.deepEqual(words("a\u0430b\u0430c d"), [[0, "a\u0430b\u0430c"]]);
  });

  test("pureCyrillicOrGreekIsNeverReported", () => {
    assert.deepEqual(words("\u0441\u0430\u0439\u0442.\u0440\u0444 \u03b1\u03b2"), []);
  });
});
