import type { Actions, Detectors, Item } from "@yabbistir/api";

/** Hosts of link shorteners; also the manifest's network.domains. */
export const SHORTENERS = [
  "bit.ly", "t.co", "tinyurl.com", "ow.ly", "buff.ly", "lnkd.in", "is.gd", "v.gd", "rebrand.ly", "cutt.ly",
  "rb.gy", "t.ly", "tiny.cc", "shorturl.at", "s.id", "amzn.to", "fb.me", "ift.tt", "bit.do", "wp.me",
];
const MAX_HOPS = 5;
const MAX_LENGTH = 4096;

/** The web link in an item, or null. */
export function linkOf(item: Item | null): URL | null {
  const raw = (item?.url ?? item?.text ?? "").trim();
  if (raw === "" || raw.length > MAX_LENGTH || /\s/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Whether the host is a listed shortener (or a subdomain of one). */
export function isShortHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.+$/, "");
  return SHORTENERS.some((domain) => name === domain || name.endsWith("." + domain));
}

export const isShortLink = (url: URL | null): boolean => url !== null && isShortHost(url.hostname);

const isCancelled = (error: unknown) => (error as { code?: string } | null)?.code === "cancelled";

/** is.gd and v.gd answer a lookup with the destination. */
async function lookup(url: URL, signal: AbortSignal | undefined): Promise<string> {
  const host = url.hostname.toLowerCase().endsWith("v.gd") ? "v.gd" : "is.gd";
  let response;
  try {
    response = await yab.http.fetch(`https://${host}/forward.php?format=simple&shorturl=${encodeURIComponent(url.href)}`, { signal });
  } catch (error) {
    if (isCancelled(error)) throw error;
    throw new Error(yab.t("lookupFailed"));
  }
  const text = (response.text ?? "").trim();
  if (response.status === 502) throw new Error(yab.t("rateLimit"));
  if (response.status !== 200 || text === "" || text.startsWith("Error:")) throw new Error(yab.t("lookupFailed"));
  return text;
}

/** Any other shortener: read the Location header of the answer without any body. */
async function nextHop(url: URL, signal: AbortSignal | undefined): Promise<string> {
  let response;
  try {
    response = await yab.http.fetch(url.href, { method: "GET", signal });
  } catch (error) {
    if (isCancelled(error)) throw error;
    throw new Error(yab.t("blocked"));
  }
  const location = response.headers["location"];
  if (response.status < 300 || response.status > 399 || !location) throw new Error(yab.t("noRedirect"));
  return location;
}

/** Follows a short link by hand, hop by hop, while the next hop is still a shortener. */
export async function expand(start: URL, signal?: AbortSignal): Promise<string> {
  let current = start;
  const seen = new Set<string>([start.href]);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const host = current.hostname.toLowerCase();
    const location = host === "is.gd" || host === "v.gd" ? await lookup(current, signal) : await nextHop(current, signal);
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new Error(yab.t("badLocation"));
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error(yab.t("badLocation"));
    if (!isShortLink(next)) return next.href;
    if (seen.has(next.href)) throw new Error(yab.t("loop"));
    seen.add(next.href);
    current = next;
  }
  throw new Error(yab.t("tooMany"));
}

export const actions: Actions = {
  expand: {
    async run(item, ctx) {
      const url = linkOf(item);
      if (!isShortLink(url)) return { none: true, message: yab.t("notShort") };
      return { text: await expand(url as URL, ctx.signal) };
    },
  },
  shorten: {
    async run(item, ctx) {
      const url = linkOf(item);
      if (url === null) return { none: true, message: yab.t("noLink") };
      let response;
      try {
        response = await yab.http.fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url.href)}`, { signal: ctx.signal });
      } catch (error) {
        if (isCancelled(error)) throw error;
        throw new Error(yab.t("shortenFailed"));
      }
      const text = (response.text ?? "").trim();
      if (response.status === 502) throw new Error(yab.t("rateLimit"));
      if (response.status !== 200 || !/^https:\/\/is\.gd\/[A-Za-z0-9_]+$/.test(text)) throw new Error(yab.t("shortenFailed"));
      return { text };
    },
  },
};

export const detectors: Detectors = {
  shortlink: {
    validate: (item) => isShortLink(linkOf(item)),
  },
};
