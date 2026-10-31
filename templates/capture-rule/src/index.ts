import type { CaptureRules } from "@yabbistir/api";

/** Punctuation that ends a sentence rather than a link, when it hangs on the end of a copied URL. */
const trailing = /[.,;:!?'")\]]+$/;

/** The URL without the punctuation after it, or null when there is nothing to remove. */
export function tidy(url: string): string | null {
  const trimmed = url.trim();
  const cleaned = trimmed.replace(trailing, "");
  return cleaned === url || cleaned === "" ? null : cleaned;
}

// A rule decides about a copy before it is stored. It sees text and links only, and no tags (they come later), so
// the manifest filters on kinds and a pattern. Return nothing to keep the copy as it is.
export const captureRules: CaptureRules = {
  tidy: {
    run(item) {
      if (item.kind === "link") {
        const cleaned = tidy(item.url ?? "");
        return cleaned === null ? undefined : { replace: { url: cleaned } };
      }
      const cleaned = tidy(item.text ?? "");
      return cleaned === null ? undefined : { replace: { text: cleaned } };
    },
  },
};
