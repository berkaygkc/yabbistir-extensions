// Color math, with no host calls, so tests can reach it directly.

export type Rgb = readonly [number, number, number]; // 0–255 (may be fractional)
export type Lab = readonly [number, number, number]; // OKLab: L 0–1, a and b about −0.4–0.4

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const fromLinear = (linear: number): number => {
  const l = clamp(linear, 0, 1);
  return 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
};

/** sRGB to OKLab (Björn Ottosson, 2020). */
export function toOklab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to sRGB, clipped into the gamut. */
export function fromOklab([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Distance in OKLab, times 100 (so near-identical colors are below 1 and black to white is 100). */
export function deltaE(x: Lab, y: Lab): number {
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** WCAG 2.x relative luminance. */
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrast(x: Rgb, y: Rgb): number {
  const a = luminance(x), b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export type Level = "AAA" | "AA" | "fail";

export const levels = (ratio: number): { normal: Level; large: Level } => ({
  normal: ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "fail",
  large: ratio >= 4.5 ? "AAA" : ratio >= 3 ? "AA" : "fail",
});

/** The ratio to two decimals, never rounded up across a pass mark it does not reach. */
export function ratioText(ratio: number): string {
  let shown = Math.round(ratio * 100) / 100;
  for (const mark of [3, 4.5, 7]) if (shown >= mark && ratio < mark) shown = Math.floor(ratio * 100) / 100;
  return shown.toFixed(2);
}

export const byte = (channel: number): number => Math.round(clamp(channel, 0, 255));

export function hex([r, g, b]: Rgb, alpha = 1): string {
  const part = (v: number) => byte(v).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}${alpha < 1 ? part(alpha * 255) : ""}`;
}

/** Puts a color over white, which is how contrast and names treat a color with alpha. */
export const overWhite = ([r, g, b]: Rgb, alpha: number): Rgb => [r * alpha + 255 * (1 - alpha), g * alpha + 255 * (1 - alpha), b * alpha + 255 * (1 - alpha)];

/** Moves toward white or black by `amount` (0–1) in OKLab, which keeps the hue steady and the steps even. */
export function mix(rgb: Rgb, target: "white" | "black", amount: number): Rgb {
  const [L, a, b] = toOklab(rgb);
  const t = clamp(amount, 0, 1);
  const goal = target === "white" ? 1 : 0;
  return fromOklab([L + (goal - L) * t, a * (1 - t), b * (1 - t)]);
}

export function toHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function fromHsl([h, s, l]: readonly [number, number, number]): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** The opposite hue in HSL, with saturation and lightness kept (the usual color-wheel complement). */
export function complement(rgb: Rgb): Rgb {
  const [h, s, l] = toHsl(rgb);
  return fromHsl([(h + 180) % 360, s, l]);
}

export const invert = ([r, g, b]: Rgb): Rgb => [255 - r, 255 - g, 255 - b];

/** Gray with the same perceived lightness (OKLab L, no hue). */
export function grayscale(rgb: Rgb): Rgb {
  return fromOklab([toOklab(rgb)[0], 0, 0]);
}

export interface Match {
  name: string;
  hex: string;
  distance: number;
}

const labs = new WeakMap<object, Lab[]>();

/** The nearest entry of a palette; the first one wins a tie. */
export function nearest(rgb: Rgb, palette: readonly (readonly [string, number])[]): Match {
  let entries = labs.get(palette);
  if (!entries) {
    entries = palette.map(([, value]) => toOklab([(value >> 16) & 255, (value >> 8) & 255, value & 255]));
    labs.set(palette, entries);
  }
  const target = toOklab(rgb);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < entries.length; i++) {
    const d = deltaE(target, entries[i]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  const [name, value] = palette[best];
  return { name, hex: `#${value.toString(16).padStart(6, "0")}`, distance: bestDistance };
}
