import type { CaptureResult, CaptureRules } from "@yabbistir/api";

/** Dropped on every host. `utm_*` is a prefix, the rest match exactly. */
const everywhere = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "igsh", "igshid", "ref_src", "ref_url",
]);

/** Dropped on these hosts (and their subdomains) only; `exact` hosts do not cover subdomains. */
const perHost: { host: string; exact?: boolean; names: string[] }[] = [
  { host: "youtube.com", names: ["si", "feature", "pp"] },
  { host: "youtu.be", exact: true, names: ["si", "feature", "pp"] },
  { host: "x.com", names: ["s", "t"] },
  { host: "twitter.com", names: ["s", "t"] },
  { host: "open.spotify.com", exact: true, names: ["si"] },
  { host: "tiktok.com", names: ["_r", "_t", "is_from_webapp", "sender_device"] },
];

const urlPattern = /^(https?:\/\/)([^/?#]*)([^?#]*)(?:\?([^#]*))?(#[\s\S]*)?$/i;

function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** The cleaned URL, or null when nothing was dropped (or it is not an http(s) URL). */
export function clean(url: string): string | null {
  const match = urlPattern.exec(url);
  if (!match || match[4] === undefined) return null;
  const [, scheme, authority, path, query, fragment = ""] = match;
  const host = authority.replace(/^.*@/, "").replace(/:\d*$/, "").toLowerCase();
  const hostNames = new Set<string>();
  for (const rule of perHost) {
    if (host === rule.host || (!rule.exact && host.endsWith("." + rule.host))) rule.names.forEach((name) => hostNames.add(name));
  }
  const parts = query.split("&");
  const kept = parts.filter((part) => {
    if (part === "") return true;
    const name = decoded(part.split("=")[0]);
    return !(name.startsWith("utm_") || everywhere.has(name) || hostNames.has(name));
  });
  if (kept.length === parts.length) return null;
  return scheme + authority + path + (kept.length > 0 ? "?" + kept.join("&") : "") + fragment;
}

export const captureRules: CaptureRules = {
  clean: {
    run(item): CaptureResult {
      if (item.kind === "link" && item.url) {
        const cleaned = clean(item.url);
        return cleaned === null ? { keep: true } : { replace: { url: cleaned } };
      }
      if (item.kind === "text" && item.text !== undefined) {
        const text = item.text.trim();
        if (/^https?:\/\/\S+$/i.test(text)) {
          const cleaned = clean(text);
          if (cleaned !== null) return { replace: { text: cleaned } };
        }
      }
      return { keep: true };
    },
  },
};
