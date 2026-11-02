import type { Sources } from "@yabbistir/api";

/** The snippets in the preference's text: split at "|", trimmed, empty ones left out. */
export function snippetsIn(text: unknown): string[] {
  if (typeof text !== "string") return [];
  return text.split("|").map((part) => part.trim()).filter((part) => part !== "");
}

export const sources: Sources = {
  // The app shows the rows in a column of their own. ↵ on a row runs the source's first action, here "paste": the
  // app pastes the text `run` returns, and ⌘C copies it instead.
  snippets: {
    list(ctx) {
      // A row's id comes back to `run` exactly as listed: here, the snippet's place in the list.
      return { rows: snippetsIn(ctx.preferences.snippets).map((text, index) => ({ id: String(index), title: text })) };
    },
    run(rowId, actionId, ctx) {
      const text = /^\d+$/.test(rowId) ? snippetsIn(ctx.preferences.snippets)[Number(rowId)] : undefined;
      // An id is the snippet's place in the list, so it shifts when a snippet before it is removed in Settings, and
      // only one past the end is caught here. Fine for a sample; real data needs ids that stay with their row.
      if (text === undefined) throw new Error(yab.t("gone"));
      return { text };
    },
  },
};
