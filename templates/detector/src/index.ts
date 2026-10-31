import type { Detectors, Item } from "@yabbistir/api";

const ticket = /^([A-Z][A-Z0-9]{1,9})-([0-9]{1,6})$/;

const textOf = (item: Item) => (item.text ?? "").trim();

export const detectors: Detectors = {
  // The manifest's `pattern` already narrowed the candidates; `validate` has the last word (it must be quick, with no promises).
  ticket: {
    validate: (item) => ticket.test(textOf(item)),
    // `preview` adds blocks to the preview of an item that carries this detector's tag.
    preview(item) {
      const match = ticket.exec(textOf(item));
      if (!match) return [];
      return [{ type: "keyValue", title: yab.t("preview"), rows: [[yab.t("project"), match[1]], [yab.t("number"), match[2]]] }];
    },
  },
};
