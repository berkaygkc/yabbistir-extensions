import type { Actions } from "@yabbistir/api";

/** The text turned around, letter by letter (a letter with its accents stays whole). */
export function reverse(text: string): string {
  return Array.from(new Intl.Segmenter().segment(text), (part) => part.segment).reverse().join("");
}

export const actions: Actions = {
  // `run` gets the item the person picked and returns what yabbistir should copy and paste.
  reverse: {
    run(item) {
      const text = item?.text ?? "";
      if (text === "") return { none: true, message: yab.t("empty") };
      return { text: reverse(text) };
    },
  },
};
