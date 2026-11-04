import type { Actions, Detectors, Item, PreviewSection } from "@yabbistir/api";
import { cleanForTerminal } from "./clean.ts";
import {
  hasHidden,
  locator,
  removeHidden,
  scanHidden,
  scanLookalike,
  scanShell,
  shape,
  type HiddenHit,
  type ShellKind,
} from "./scan.ts";

/** The text of a copy; a link is read by its address. */
const textOf = (item: Item | null): string => item?.url ?? item?.text ?? "";

const WHERE_LIMIT = 5;
const BIDI = new Set(["202a", "202b", "202c", "202d", "202e", "2066", "2067", "2068", "2069"]);
/** Characters that share one row and one name, because they are many and alike. */
const GROUPED = new Set(["control", "deprecated", "annotation", "tag"]);
const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, "0");

/** "line 1, 3" for text with several lines, "position 7" for one line; cut after a few. */
function where(places: { line: number; column: number }[], lines: number): string {
  const numbers = [...new Set(places.map((p) => (lines > 1 ? p.line : p.column)))];
  const shown = numbers.slice(0, WHERE_LIMIT).join(", ") + (numbers.length > WHERE_LIMIT ? " …" : "");
  return yab.t(lines > 1 ? "where.line" : "where.position", { list: shown });
}

function hiddenLabel(hit: HiddenHit): string {
  const name = yab.t(`char.${hit.key}`);
  return GROUPED.has(hit.key) ? name : `${name} (U+${hex(hit.cp)})`;
}

function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join("") + "…" : text;
}

export const detectors: Detectors = {
  hidden: {
    validate: (item) => hasHidden(textOf(item)),
    preview(item): PreviewSection[] {
      const text = textOf(item);
      const hits: HiddenHit[] = [];
      scanHidden(text, (hit) => {
        hits.push(hit);
        return hits.length >= 2000;
      });
      if (hits.length === 0) return [];
      const split = text.split("\n");
      const lines = split.length;
      const locate = locator(text);
      // One row per kind of character: how many, and where.
      const groups = new Map<string, { hit: HiddenHit; count: number; places: { line: number; column: number }[] }>();
      for (const hit of hits) {
        const id = GROUPED.has(hit.key) ? hit.key : String(hit.cp);
        const entry = groups.get(id) ?? { hit, count: 0, places: [] };
        entry.count++;
        if (entry.places.length < 50) entry.places.push(locate(hit.index));
        groups.set(id, entry);
      }
      const rows: [string, string][] = [...groups.values()].map(({ hit, count, places }) => [
        hiddenLabel(hit),
        yab.t("hidden.value", { n: count, where: where(places, lines) }),
      ]);
      // The first lines that hold them, each character made visible.
      const wanted: number[] = [];
      const locateLine = locator(text);
      const hitLines = hits.map((hit) => locateLine(hit.index).line);
      for (const line of hitLines) if (!wanted.includes(line) && wanted.length < 3) wanted.push(line);
      const shown = wanted.map((line) => {
        const source = split[line - 1];
        let out = "";
        let last = 0;
        scanHidden(source, (hit) => {
          out += source.slice(last, hit.index) + `⟨U+${hex(hit.cp)}⟩`;
          last = hit.index + (hit.cp > 0xffff ? 2 : 1);
        });
        out += source.slice(last);
        return lines > 1 ? `${line}: ${cut(out, 200)}` : cut(out, 200);
      });
      const visible = shown.join("\n");
      const sections: PreviewSection[] = [
        { type: "keyValue", title: yab.t("preview.hidden"), rows },
        { type: "code", title: yab.t("preview.visible"), code: visible },
        { type: "text", title: yab.t("preview.why"), text: yab.t(hits.some((h) => BIDI.has(h.key)) ? "hidden.noteBidi" : "hidden.note") },
      ];
      return sections;
    },
  },
  lookalike: {
    validate: (item) => scanLookalike(textOf(item), 1).length > 0,
    preview(item): PreviewSection[] {
      const text = textOf(item);
      const hits = scanLookalike(text, 20);
      if (hits.length === 0) return [];
      const lines = text.split("\n").length;
      const locate = locator(text);
      const rows: [string, string][] = hits.slice(0, 8).map((hit) => {
        const letters = hit.letters.map((l) => `${l.ch} ${yab.t(`script.${l.script.toLowerCase()}`)} (U+${hex(l.cp)})`).join(", ");
        return [cut(hit.word, 40), `${letters} · ${where([locate(hit.index)], lines)}`];
      });
      return [
        { type: "keyValue", title: yab.t("preview.lookalike"), rows },
        { type: "text", title: yab.t("preview.why"), text: yab.t("lookalike.note") },
      ];
    },
  },
  risky: {
    validate: (item) => scanShell(textOf(item)).length > 0,
    preview(item): PreviewSection[] {
      const text = textOf(item);
      const hits = scanShell(text);
      if (hits.length === 0) return [];
      const lines = text.split("\n").length;
      const byKind = new Map<ShellKind, { line: number; column: number }[]>();
      for (const hit of hits) byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), { line: hit.line, column: 1 }]);
      const rows: [string, string][] = [...byKind].map(([kind, places]) => [
        yab.t(`shell.${kind}`),
        lines > 1 ? where(places, lines) : yab.t("shell.thisLine"),
      ]);
      const sections: PreviewSection[] = [{ type: "keyValue", title: yab.t("preview.risky"), rows }];
      const { trailingNewline, commandLines } = shape(text);
      const paste: [string, string][] = [];
      if (trailingNewline) paste.push([yab.t("paste.newline"), yab.t("paste.newline.value")]);
      if (commandLines > 1) paste.push([yab.t("paste.lines"), yab.t("paste.lines.value", { n: commandLines })]);
      if (paste.length > 0) sections.push({ type: "keyValue", title: yab.t("preview.paste"), rows: paste });
      sections.push({ type: "text", title: yab.t("preview.why"), text: yab.t("risky.note") });
      return sections;
    },
  },
};

export const actions: Actions = {
  paste: {
    run(item) {
      const text = textOf(item);
      if (text.trim() === "") return { none: true, message: yab.t("empty") };
      const cleaned = cleanForTerminal(text);
      if (cleaned === "") return { none: true, message: yab.t("empty") };
      if (cleaned === text) return { none: true, message: yab.t("paste.nothing") };
      return { text: cleaned };
    },
  },
  unhide: {
    run(item) {
      const text = textOf(item);
      if (text === "") return { none: true, message: yab.t("empty") };
      const cleaned = removeHidden(text);
      if (cleaned === text) return { none: true, message: yab.t("unhide.nothing") };
      return { text: cleaned };
    },
  },
};
