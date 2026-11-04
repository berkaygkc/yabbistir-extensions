import type { Actions, Detectors, Item, PreviewSection } from "@yabbistir/api";

import { complement, contrast, grayscale, hex, invert, levels, luminance, mix, nearest, overWhite, ratioText } from "./color.ts";
import type { Rgb } from "./color.ts";
import { cssNamed, tailwind } from "./palettes.ts";

interface Parsed {
  rgb: Rgb;
  alpha: number;
}

/** The color of an item, or null when it has none that can be read. */
function parse(item: Item | null): Parsed | null {
  const c = item?.color;
  if (!item || item.kind !== "color" || !c) return null;
  const ok = (v: unknown, low: number, high: number) => typeof v === "number" && Number.isFinite(v) && v >= low && v <= high;
  if (!ok(c.r, 0, 255) || !ok(c.g, 0, 255) || !ok(c.b, 0, 255)) return null;
  return { rgb: [c.r, c.g, c.b], alpha: ok(c.a, 0, 1) ? c.a : 1 };
}

/** Names and contrast look at the color as it would appear on white, so alpha is composited first. */
const seen = ({ rgb, alpha }: Parsed): Rgb => (alpha < 1 ? overWhite(rgb, alpha) : rgb);

const white: Rgb = [255, 255, 255];
const black: Rgb = [0, 0, 0];

function distance(value: number): string {
  return value < 0.05 ? yab.t("exact") : yab.t("delta", { n: Math.max(0.1, value).toFixed(1) });
}

function levelText(level: string): string {
  return level === "fail" ? yab.t("fail") : level;
}

function contrastRow(label: string, ratio: number): [string, string][] {
  const { normal, large } = levels(ratio);
  return [
    [label, `${ratioText(ratio)}:1`],
    ["", yab.t("levels", { normal: levelText(normal), large: levelText(large) })],
  ];
}

export const detectors: Detectors = {
  color: {
    validate: (item) => parse(item) !== null,
    preview(item): PreviewSection[] {
      const parsed = parse(item);
      if (!parsed) return [];
      const rgb = seen(parsed);
      const css = nearest(rgb, cssNamed);
      const tw = nearest(rgb, tailwind);
      const nearestRows: [string, string][] = [
        [yab.t("css"), `${css.name} · ${distance(css.distance)}`],
        ["Tailwind", `${tw.name} · ${distance(tw.distance)}`],
      ];
      if (parsed.alpha < 1) nearestRows.push(["", yab.t("onWhite", { percent: Math.round(parsed.alpha * 100) })]);
      return [
        { type: "keyValue", title: yab.t("nearest"), rows: nearestRows },
        {
          type: "keyValue",
          title: yab.t("contrast"),
          rows: [
            ...contrastRow(yab.t("white"), contrast(rgb, white)),
            ...contrastRow(yab.t("black"), contrast(rgb, black)),
            [yab.t("luminance"), luminance(rgb).toFixed(3)],
          ],
        },
      ];
    },
  },
};

/** A transform's output keeps the color's alpha; only the three channels change. */
function transform(item: Item | null, change: (rgb: Rgb) => Rgb) {
  const parsed = parse(item);
  if (!parsed) return { none: true as const, message: yab.t("empty") };
  return { text: hex(change(parsed.rgb), parsed.alpha) };
}

const step = (target: "white" | "black") => (item: Item | null, ctx: { variant: string | null }) => {
  const percent = Number(ctx.variant);
  if (![10, 20, 30].includes(percent)) return { none: true as const, message: yab.t("empty") };
  return transform(item, (rgb) => mix(rgb, target, percent / 100));
};

export const actions: Actions = {
  lighter: { run: step("white") },
  darker: { run: step("black") },
  complementary: { run: (item) => transform(item, complement) },
  inverted: { run: (item) => transform(item, invert) },
  grayscale: { run: (item) => transform(item, grayscale) },
  tailwind: {
    run(item) {
      const parsed = parse(item);
      if (!parsed) return { none: true, message: yab.t("empty") };
      return { text: nearest(seen(parsed), tailwind).name };
    },
  },
};
