import type { Detectors, Item, PreviewSection } from "@yabbistir/api";

const maxLength = 16 * 1024;
const shape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

function decodePart(part: string): unknown {
  if (part.length % 4 === 1) return undefined;
  let standard = part.replace(/-/g, "+").replace(/_/g, "/");
  while (standard.length % 4 !== 0) standard += "=";
  try {
    const binary = atob(standard);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The decoded header and payload, or null unless the text is a JWT. */
export function parse(input: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const text = input.trim();
  if (text.length > maxLength || !shape.test(text)) return null;
  const [head, body] = text.split(".");
  const header = decodePart(head);
  const payload = decodePart(body);
  if (!isObject(header) || typeof header.alg !== "string" || !isObject(payload)) return null;
  return { header, payload };
}

const pad = (n: number) => String(n).padStart(2, "0");

function format(seconds: number, language: string): string {
  const date = new Date(seconds * 1000);
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}

const textOf = (item: Item) => item.text ?? "";

export const detectors: Detectors = {
  jwt: {
    validate: (item) => parse(textOf(item)) !== null,
    preview(item, ctx): PreviewSection[] {
      const token = parse(textOf(item));
      if (token === null) return [];
      const { header, payload } = token;
      const rows: [string, string][] = [["alg", String(header.alg)]];
      if (typeof header.typ === "string") rows.push(["typ", header.typ]);
      if (typeof payload.sub === "string") rows.push(["sub", payload.sub]);
      if (typeof payload.iat === "number") rows.push(["iat", format(payload.iat, ctx.language)]);
      if (typeof payload.exp === "number") {
        const expired = payload.exp * 1000 < Date.now();
        rows.push(["exp", format(payload.exp, ctx.language) + (expired ? " · " + yab.t("expired") : "")]);
      }
      rows.push(["", yab.t("unchecked")]);
      return [
        { type: "code", title: yab.t("header"), code: JSON.stringify(header, null, 2), language: "json" },
        { type: "code", title: yab.t("payload"), code: JSON.stringify(payload, null, 2), language: "json" },
        { type: "keyValue", title: yab.t("info"), rows },
      ];
    },
  },
};
