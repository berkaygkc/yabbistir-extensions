# Color Tools

Tells you what a copied color is close to, whether text is readable on it, and gives you lighter, darker and opposite versions. It adds what the built-in Convert does not: Convert changes a color's format (RGB, HSL, OKLCH, SwiftUI, NSColor); Color Tools works with the color itself.

## What it does

**Preview.** Every color item is tagged *color*, and its preview shows:

- **Nearest:** the closest CSS named color and the closest Tailwind CSS color (`slate-500` style), each with its distance, or *exact* when it is the same color. The distance is ΔE in OKLab, times 100: below 1 is hard to tell apart, around 2 to 3 is a small difference.
- **Contrast:** the WCAG 2.x contrast ratio on white and on black, with the level reached for normal text and for large text (AA needs 4.5:1 and 3:1, AAA needs 7:1 and 4.5:1), and the relative luminance.

**Actions** on a color, each returning text you can paste (a hint shows the value on the row):

| Action | Result |
|---|---|
| Make 10, 20 or 30% lighter | Hex, moved toward white |
| Make 10, 20 or 30% darker | Hex, moved toward black |
| Complementary color | Hex, hue turned half a circle |
| Invert color | Hex, every channel flipped |
| Make gray | Hex, same lightness with no hue |
| Paste as Tailwind name | The nearest Tailwind name, such as `slate-500` |

## Example

Copy `#777777` from a design tool. The preview says: nearest CSS name *gray* (ΔE 3.1), nearest Tailwind *neutral-500* (ΔE 1.4); on white `4.48:1`, *Normal text fails · Large text AA*. *Make 20% darker* pastes `#575757`; *Paste as Tailwind name* pastes `neutral-500`.

## How the numbers are made

- **Lighter and darker** mix in OKLab: the lightness moves the given share of the way to white or black and the color's chroma shrinks by the same share. Steps look even and the hue stays put.
- **Complementary** turns the hue by 180 degrees in HSL, keeping saturation and lightness (the usual color wheel).
- **Gray** keeps OKLab lightness, so a red and a blue of equal brightness give the same gray.
- **Contrast** follows WCAG 2.x: luminance from linear sRGB with the 0.2126, 0.7152, 0.0722 weights, ratio `(L1 + 0.05) / (L2 + 0.05)`. It is shown to two decimals but never rounded up across a pass mark, so `4.499` is not shown as `4.50`.
- **Nearest** is the smallest OKLab distance. The first palette entry wins a tie, and Tailwind lists `zinc-50` before `neutral-50`.
- **Alpha.** A color with transparency is compared as it looks on white: names, distances and contrast all use the color composited on white, and the preview says so. The actions keep the original alpha and write it into the result (`#rrggbbaa`) when it is below 100%; *Paste as Tailwind name* is based on the composited color.

## Permissions

None. The extension only reads the color of the item it is asked about and computes on this Mac. No network, no programs, nothing stored.

## Limits

- Only the Tailwind CSS v3 default palette is known, not custom or v4 colors.
- Results are hex text. The format is up to you; use the built-in Convert for other formats.
- The CSS names are the 141 distinct names of CSS Color Module Level 4 (the `grey` spellings are left out, `gray` is kept).
- Lighter, darker and complementary colors are clipped into the sRGB range, so very saturated colors can shift a little.

## Data and licenses

- CSS named colors: values from the [color-name](https://github.com/colorjs/color-name) package 1.1.4, MIT license, copyright (c) 2015 Dmitry Ivanov.
- Tailwind CSS v3 default colors: from [tailwindcss](https://github.com/tailwindlabs/tailwindcss) 3.4.17 (`src/public/colors.js`), MIT license, copyright (c) Tailwind Labs, Inc. Tailwind CSS is a trademark of Tailwind Labs; this extension is not affiliated with it.
- OKLab: Björn Ottosson, "A perceptual color space for image processing" (2020), public domain. WCAG: W3C, Web Content Accessibility Guidelines 2.x, relative luminance and contrast ratio definitions.
