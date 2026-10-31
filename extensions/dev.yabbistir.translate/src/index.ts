import type { Actions } from "@yabbistir/api";

/** The on-device model's whole context is about 4096 tokens, shared by instructions, input and answer. */
export const maxSummaryCharacters = 6000;

/** The first `limit` characters (grapheme clusters, never half of one). */
export function cut(text: string, limit: number): string {
  const characters = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return characters.length <= limit ? text : characters.slice(0, limit).join("");
}

/** "en-GB" is "en". */
function baseLanguage(code: string): string {
  return code.split(/[-_]/)[0].toLowerCase();
}

// yab errors (an unavailable model, a missing language pack, a cancel) are never caught: they reach the
// card and the notice unchanged, with the app's own code and text.
export const actions: Actions = {
  translate: {
    async run(item, ctx) {
      const text = item?.text ?? "";
      if (text.trim() === "") return { none: true, message: yab.t("empty.translate") };
      const target = ctx.variant === "en" ? "en" : "tr";
      const result = await yab.translate(text, { to: target });
      if (baseLanguage(result.from) === target) return { none: true, message: yab.t(`sameLanguage.${target}`) };
      return { text: result.text };
    },
  },
  summarize: {
    async run(item) {
      const text = item?.text ?? "";
      if (text.trim() === "") return { none: true, message: yab.t("empty.summarize") };
      yab.job.progress(null, yab.t("summarizing"));
      const summary = await yab.ai.generate(cut(text, maxSummaryCharacters), {
        instructions: yab.t("instructions"),
        temperature: 0.3,
        maxTokens: 400,
      });
      return { text: summary };
    },
  },
};
