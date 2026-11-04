import type { Actions } from "@yabbistir/api";

/**
 * The most a QR code holds in byte mode (version 40, lowest error correction). The real encoder may
 * use a higher correction level and give up sooner (about 2,300 bytes); the catch below covers that.
 */
export const maxBytes = 2953;

const sizes = [256, 512, 1024];

/** The chosen size, 512 when the preference is missing or odd. */
export function sizeFrom(value: unknown): number {
  const size = Number(value);
  return sizes.includes(size) ? size : 512;
}

/** UTF-8 length of the text, without allocating a copy. */
export function byteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > maxBytes * 2) break; // far past the limit; no need to count on
  }
  return bytes;
}

export const actions: Actions = {
  show: {
    run(item, ctx) {
      // A copied link often carries a trailing newline or space; a scanner would show or open it.
      const raw = item?.url ?? item?.text ?? "";
      const text = item?.url !== undefined ? raw.trim() : raw.trimEnd();
      if (text.trim() === "") return { none: true, message: yab.t("empty") };
      if (byteLength(text) > maxBytes) return { none: true, message: yab.t("tooLong") };
      try {
        return { image: yab.qr.generate(text, { size: sizeFrom(ctx.preferences.size) }) };
      } catch (error) {
        // A text the encoder refuses (near the limit) gets a plain message; any other failure passes through.
        if ((error as { code?: string }).code !== "badResult") throw error;
        return { none: true, message: yab.t("tooLong") };
      }
    },
  },
  read: {
    async run(item) {
      if (!item?.image) return { none: true, message: yab.t("noCode") };
      const codes = (await yab.vision.readCodes(item.image)).filter((code) => code.trim() !== "");
      if (codes.length === 0) return { none: true, message: yab.t("noCode") };
      return { text: codes.join("\n") };
    },
  },
};
