import type { Actions } from "@yabbistir/api";

import { htmlToMarkdown } from "./markdown.ts";

export { htmlToMarkdown };

export const actions: Actions = {
  // Runs as a hint too: the Markdown on the row is the Markdown that is pasted.
  markdown: {
    run(item) {
      const html = typeof item?.richText?.html === "string" ? item.richText.html : "";
      if (html.trim() === "") return { none: true, message: yab.t("noRichText") };
      let markdown: string;
      try {
        markdown = htmlToMarkdown(html);
      } catch (error) {
        // Only the kind of failure is logged, never the copy.
        console.error(`Couldn’t convert: ${error instanceof Error ? error.name : "unknown error"}`);
        return { none: true, message: yab.t("unreadable") };
      }
      if (markdown === "") return { none: true, message: yab.t("empty") };
      return { text: markdown };
    },
  },
};
