import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, detectors } from "../src/index.ts";
import { cssNamed, tailwind } from "../src/palettes.ts";

const host = createFakeHost({ folder: new URL("..", import.meta.url) });

const color = (hex, a = 1) => {
  const n = parseInt(hex.slice(1), 16);
  return { id: 1, kind: "color", color: { hex, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a }, tags: [], copiedAt: "2026-01-01T00:00:00Z" };
};
const preview = async (item, language = "en") => host.preview(detectors.color, item, { language });
const rows = (sections, title) => sections.find((s) => s.title === title).rows;
const run = (action, item, variant = null) => host.run(actions[action], item, variant ? { variant } : undefined);

describe("detection", () => {
  test("aColorIsKept", async () => {
    assert.equal(await host.validate(detectors.color, color("#336699")), true);
    assert.equal(await host.validate(detectors.color, color("#336699", 0.5)), true);
  });

  test("anythingElseIsDropped", async () => {
    assert.equal(await host.validate(detectors.color, { id: 1, kind: "text", text: "#336699", tags: [], copiedAt: "2026-01-01T00:00:00Z" }), false);
    assert.equal(await host.validate(detectors.color, { id: 1, kind: "color", tags: [], copiedAt: "2026-01-01T00:00:00Z" }), false);
    const bad = color("#000000");
    bad.color.r = 300;
    assert.equal(await host.validate(detectors.color, bad), false);
    bad.color.r = Number.NaN;
    assert.equal(await host.validate(detectors.color, bad), false);
    assert.deepEqual(await preview(bad), []);
  });
});

describe("palettes", () => {
  test("theyHaveTheExpectedSize", () => {
    assert.equal(tailwind.length, 22 * 11 + 2);
    assert.equal(new Set(tailwind.map(([name]) => name)).size, tailwind.length);
    assert.equal(new Set(cssNamed.map(([name]) => name)).size, cssNamed.length);
    assert.equal(cssNamed.length, 141); // 148 CSS names minus the seven "grey" spellings
  });
});

describe("nearest names", () => {
  test("everyTailwindColorFindsItself", async () => {
    for (const [name, value] of tailwind) {
      const hex = "#" + value.toString(16).padStart(6, "0");
      const { text } = await run("tailwind", color(hex));
      // Two Tailwind names can share one value (fafafa is both zinc-50 and neutral-50); the answer must be one of them.
      const same = tailwind.filter(([, v]) => v === value).map(([n]) => n);
      assert.ok(same.includes(text), `${hex} gave ${text}, expected ${name}`);
    }
  });

  test("everyCssColorFindsItselfInThePreview", async () => {
    for (const [name, value] of cssNamed) {
      const hex = "#" + value.toString(16).padStart(6, "0");
      const [css] = rows(await preview(color(hex)), "Nearest");
      const same = cssNamed.filter(([, v]) => v === value).map(([n]) => n);
      assert.ok(same.some((n) => css[1] === `${n} · exact`), `${hex} (${name}): ${css[1]}`);
    }
  });

  test("anExactColorIsSaidToBeExact", async () => {
    const nearest = rows(await preview(color("#64748b")), "Nearest");
    assert.deepEqual(nearest[1], ["Tailwind", "slate-500 · exact"]);
    assert.deepEqual(rows(await preview(color("#ff0000")), "Nearest")[0], ["CSS name", "red · exact"]);
  });

  test("aColorInBetweenGetsTheNearestAndItsDistance", async () => {
    // One step off tomato (#ff6347) in each channel.
    const [css, tw] = rows(await preview(color("#fe6448")), "Nearest");
    assert.match(css[1], /^tomato · ΔE 0\.\d$/);
    assert.match(tw[1], /^[a-z]+-\d+ · ΔE \d+\.\d$/);
    // A mid blue-grey that is on no list.
    const [css2] = rows(await preview(color("#5a6a7b")), "Nearest");
    assert.match(css2[1], /^[a-z]+ · ΔE [1-9]\d*\.\d$/);
    assert.equal((await run("tailwind", color("#667788"))).text, "slate-500");
  });

  test("blackAndWhiteAreInTheTailwindList", async () => {
    assert.equal((await run("tailwind", color("#000000"))).text, "black");
    assert.equal((await run("tailwind", color("#ffffff"))).text, "white");
    assert.equal((await run("tailwind", color("#fefefe"))).text, "white");
  });

  test("grayIsGrayNotGrey", async () => {
    assert.deepEqual(rows(await preview(color("#808080")), "Nearest")[0], ["CSS name", "gray · exact"]);
  });
});

describe("contrast", () => {
  test("#777OnWhiteIsAbout4.48", async () => {
    const sections = await preview(color("#777777"));
    const contrast = rows(sections, "Contrast");
    assert.deepEqual(contrast[0], ["On white", "4.48:1"]);
    // 4.48 is short of 4.5: normal text fails AA, large text passes AA but not AAA (4.5).
    assert.deepEqual(contrast[1], ["", "Normal text fails · Large text AA"]);
  });

  test("blackAndWhiteHaveThePublishedExtremes", async () => {
    const onBlack = rows(await preview(color("#000000")), "Contrast");
    assert.deepEqual(onBlack[0], ["On white", "21.00:1"]);
    assert.deepEqual(onBlack[1], ["", "Normal text AAA · Large text AAA"]);
    assert.deepEqual(onBlack[2], ["On black", "1.00:1"]);
    assert.deepEqual(onBlack[3], ["", "Normal text fails · Large text fails"]);
    assert.deepEqual(onBlack[4], ["Luminance", "0.000"]);
    const onWhite = rows(await preview(color("#ffffff")), "Contrast");
    assert.deepEqual(onWhite[0], ["On white", "1.00:1"]);
    assert.deepEqual(onWhite[2], ["On black", "21.00:1"]);
    assert.deepEqual(onWhite[4], ["Luminance", "1.000"]);
  });

  test("thePassMarks", async () => {
    // #767676 is the lightest gray that passes AA (4.54:1) on white; #595959 passes AAA (7.0:1).
    const aa = rows(await preview(color("#767676")), "Contrast");
    assert.deepEqual(aa[0], ["On white", "4.54:1"]);
    assert.equal(aa[1][1], "Normal text AA · Large text AAA");
    const aaa = rows(await preview(color("#595959")), "Contrast");
    assert.deepEqual(aaa[0], ["On white", "7.00:1"]);
    assert.equal(aaa[1][1], "Normal text AAA · Large text AAA");
    // #949494 is about 3.03:1: large text AA only.
    const large = rows(await preview(color("#949494")), "Contrast");
    assert.equal(large[0][1], "3.03:1");
    assert.equal(large[1][1], "Normal text fails · Large text AA");
  });

  test("aRatioIsNeverRoundedUpAcrossAPassMark", async () => {
    // Search for a gray whose ratio on white is just under 4.5; its text must not read 4.50.
    for (let v = 100; v < 140; v++) {
      const hex = "#" + v.toString(16).repeat(3);
      const [row, levels] = rows(await preview(color(hex)), "Contrast");
      const ratio = Number.parseFloat(row[1]);
      if (levels[1].startsWith("Normal text fails")) assert.ok(ratio < 4.5, `${hex} ${row[1]}`);
      else assert.ok(ratio >= 4.5, `${hex} ${row[1]}`);
    }
  });
});

describe("alpha", () => {
  test("namesAndContrastLookAtTheColorOnWhite", async () => {
    // Black at 50% over white is #808080 (rounded): about 3.98:1 on white, and named gray.
    const sections = await preview(color("#000000", 0.5));
    const nearest = rows(sections, "Nearest");
    assert.match(nearest[0][1], /^(gray|darkgray) · /);
    assert.deepEqual(nearest[2], ["", "50% opaque, compared on white"]);
    assert.equal(rows(sections, "Contrast")[0][1], "3.98:1");
    assert.equal((await run("tailwind", color("#000000", 0.5))).text, "neutral-500");
  });

  test("anOpaqueColorHasNoNote", async () => {
    assert.equal(rows(await preview(color("#000000")), "Nearest").length, 2);
  });

  test("transformsKeepTheAlphaInTheHex", async () => {
    assert.deepEqual(await run("inverted", color("#336699", 0.5)), { text: "#cc996680" });
    assert.deepEqual(await run("inverted", color("#336699", 1)), { text: "#cc9966" });
    assert.match((await run("grayscale", color("#ff0000", 0))).text, /^#([0-9a-f]{2})\1\1[0]{2}$/);
  });
});

describe("variants", () => {
  test("lighterMovesTowardWhiteInSteps", async () => {
    const l = [];
    for (const v of ["10", "20", "30"]) l.push((await run("lighter", color("#336699"), v)).text);
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)); };
    assert.ok(lum(l[0]) > lum("#336699") && lum(l[1]) > lum(l[0]) && lum(l[2]) > lum(l[1]));
    for (const hex of l) assert.match(hex, /^#[0-9a-f]{6}$/);
  });

  test("darkerMovesTowardBlackInSteps", async () => {
    const d = [];
    for (const v of ["10", "20", "30"]) d.push((await run("darker", color("#336699"), v)).text);
    const sum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
    assert.ok(sum(d[0]) < sum("#336699") && sum(d[1]) < sum(d[0]) && sum(d[2]) < sum(d[1]));
  });

  test("variantsMatchKnownValues", async () => {
    assert.deepEqual(await run("darker", color("#777777"), "20"), { text: "#575757" });
    assert.deepEqual(await run("lighter", color("#ff0000"), "30"), { text: "#ff7765" });
    assert.deepEqual(await run("darker", color("#ff0000"), "30"), { text: "#9e0000" });
  });

  test("whiteAndBlackAreFixedPoints", async () => {
    assert.deepEqual(await run("lighter", color("#ffffff"), "30"), { text: "#ffffff" });
    assert.deepEqual(await run("darker", color("#000000"), "30"), { text: "#000000" });
    // Mid gray lightened by 20% lands between gray and white.
    const g = (await run("lighter", color("#808080"), "20")).text;
    assert.ok(g > "#808080" && g < "#ffffff", g);
  });

  test("anUnknownVariantDoesNothing", async () => {
    const result = await run("lighter", color("#336699"), "99");
    assert.equal(result.none, true);
    assert.equal(result.message, "There is no color to change.");
  });

  test("everyVariantOfTheManifestIsHandled", async () => {
    const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    for (const action of manifest.contributes.actions) {
      for (const variant of action.variants ?? [null]) {
        const result = await run(action.id, color("#336699"), variant?.id ?? null);
        assert.ok(result.text, `${action.id}/${variant?.id}`);
      }
    }
  });
});

describe("complementary, inverted, gray", () => {
  test("complementaryRotatesTheHueByHalfATurn", async () => {
    assert.deepEqual(await run("complementary", color("#ff0000")), { text: "#00ffff" });
    assert.deepEqual(await run("complementary", color("#00ff00")), { text: "#ff00ff" });
    assert.deepEqual(await run("complementary", color("#0000ff")), { text: "#ffff00" });
    assert.deepEqual(await run("complementary", color("#808080")), { text: "#808080" });
    assert.deepEqual(await run("complementary", color("#ff8000")), { text: "#007fff" });
  });

  test("invertedFlipsEveryChannel", async () => {
    assert.deepEqual(await run("inverted", color("#000000")), { text: "#ffffff" });
    assert.deepEqual(await run("inverted", color("#ffffff")), { text: "#000000" });
    assert.deepEqual(await run("inverted", color("#102030")), { text: "#efdfcf" });
  });

  test("grayscaleKeepsPerceivedLightness", async () => {
    assert.deepEqual(await run("grayscale", color("#000000")), { text: "#000000" });
    assert.deepEqual(await run("grayscale", color("#ffffff")), { text: "#ffffff" });
    assert.deepEqual(await run("grayscale", color("#808080")), { text: "#808080" });
    const red = (await run("grayscale", color("#ff0000"))).text;
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(red);
    assert.ok(r === g && g === b, red);
    // Green looks lighter than blue at full strength.
    assert.ok((await run("grayscale", color("#00ff00"))).text > (await run("grayscale", color("#0000ff"))).text);
  });
});

describe("bad input", () => {
  test("everyActionSaysThereIsNoColor", async () => {
    const text = { id: 1, kind: "text", text: "red", tags: [], copiedAt: "2026-01-01T00:00:00Z" };
    for (const id of Object.keys(actions)) {
      const result = await run(id, text, id === "lighter" || id === "darker" ? "10" : null);
      assert.deepEqual(result, { none: true, message: "There is no color to change." }, id);
    }
  });

  test("whatIsReturnedIsAlwaysCleanText", async () => {
    const item = color("#123456");
    for (const id of Object.keys(actions)) {
      const out = await run(id, item, id === "lighter" || id === "darker" ? "20" : null);
      assert.ok(!/\s/.test(out.text) && !/NaN|undefined/.test(out.text), `${id}: ${out.text}`);
    }
  });
});

describe("hints", () => {
  test("theHintIsTheValueThatIsPasted", async () => {
    for (const [id, variant] of [["lighter", "20"], ["darker", "10"], ["complementary", null], ["inverted", null], ["grayscale", null], ["tailwind", null]]) {
      const overrides = variant ? { variant } : undefined;
      assert.deepEqual(await host.hint(actions[id], color("#336699"), overrides), await host.run(actions[id], color("#336699"), overrides));
    }
  });
});

describe("offers", () => {
  test("theActionsAppearOnColorsOnly", () => {
    const offered = host.offers(color("#336699")).map((o) => o.id ?? o.action ?? o);
    assert.ok(offered.length >= 6, JSON.stringify(offered));
    assert.equal(host.offers({ id: 1, kind: "text", text: "red", tags: [], copiedAt: "2026-01-01T00:00:00Z" }).length, 0);
  });
});

describe("readme claims", () => {
  test("theExampleNumbersAreChecked", async () => {
    const sections = await preview(color("#777777"));
    const near = rows(sections, "Nearest");
    assert.ok(near[0][1].endsWith("ΔE 3.1"), near[0][1]);
    assert.ok(near[1][1].includes("neutral-500") && near[1][1].endsWith("ΔE 1.4"), near[1][1]);
    assert.deepEqual(await run("darker", color("#777777"), "20"), { text: "#575757" });
  });

  test("aTinyDistanceIsNeverShownAsZero", async () => {
    const near = rows(await preview(color("#010101")), "Nearest");
    assert.ok(!/ΔE 0\.0/.test(near[0][1] + near[1][1]));
  });
});

describe("timing and locale", () => {
  // No regular expression reads untrusted text here: the input is numeric channels, so there is nothing to time against adversarial strings.
  test("aPreviewIsFarInsideItsLimit", async () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) await preview(color("#" + (i * 5000000 % 0xffffff).toString(16).padStart(6, "0")));
    assert.ok((performance.now() - start) / 50 < 50, "a preview takes well under 500 ms");
  });

  test("turkishStringsAreUsed", async () => {
    const sections = await preview(color("#000000", 0.5), "tr");
    assert.equal(sections[0].title, "En yakın");
    assert.ok(rows(sections, "En yakın")[2][1].startsWith("%50 opak"));
    assert.ok(rows(sections, "Kontrast")[1][1].startsWith("Normal metin"));
  });
});
