import type { Actions } from "@yabbistir/api";
import {
  APP_NAMES, NOTES_SCRIPT, REMINDERS_SCRIPT, SCRIPT_TEXT_MAX, URL_DESTINATIONS, clean, cleanFolder, codePoints, fit, noteArgs, reminderArgs,
  type Destination,
} from "./destinations.ts";

const isDestination = (id: string | null): id is Destination => id !== null && id in APP_NAMES;

function pad(n: number): string { return String(n).padStart(2, "0"); }

function fallbackName(): string {
  const d = new Date();
  return `Clipboard ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export const actions: Actions = {
  send: {
    async run(item, ctx) {
      const t = (key: string, args?: Record<string, string | number>) => yab.t(key, args);
      const id = ctx.variant;
      if (!isDestination(id)) return { none: true, message: t("unknown") };
      const app = APP_NAMES[id];
      if (ctx.preferences[id] !== true) return { none: true, message: t("off", { app }) };

      const text = clean(item?.url ?? item?.text ?? "").trim();
      if (text === "") return { none: true, message: t("empty") };

      const sent = (cut: boolean) => ({ none: true as const, message: t(cut ? "sentCut" : "sent", { app }) });

      if (id === "reminders" || id === "notes") {
        const cut = codePoints(text) > SCRIPT_TEXT_MAX;
        const script = id === "reminders" ? REMINDERS_SCRIPT : NOTES_SCRIPT;
        const args = id === "reminders" ? reminderArgs(text) : noteArgs(text);
        const result = await yab.exec("osascript", ["-e", script, ...args], { signal: ctx.signal });
        if (result.exitCode === 0) return sent(cut);
        // -1743: the person (or macOS) denied Automation access; -600 / -10814: the app cannot be reached.
        if (/-1743/.test(result.stderr)) return { none: true, message: t("denied", { app }) };
        if (/-600|-10814|-1728/.test(result.stderr)) return { none: true, message: t("notInstalled", { app }) };
        throw new Error(t("failed", { app }));
      }

      const folder = cleanFolder(String(ctx.preferences.obsidianFolder ?? ""));
      if (folder === null) return { none: true, message: t("badFolder") };
      const { url, cut } = fit(id as (typeof URL_DESTINATIONS)[number], text, {
        vault: String(ctx.preferences.obsidianVault ?? "").trim(),
        folder,
        fallbackName: fallbackName(),
      });
      // yab.open opens only http and https, so the app's own scheme goes through macOS's `open`. The URL starts
      // with a fixed scheme that this extension wrote, so it can never be read as an option. -g keeps the person
      // where they are.
      const result = await yab.exec("open", ["-g", url], { signal: ctx.signal });
      if (result.exitCode === 0) return sent(cut);
      return { none: true, message: t("notInstalled", { app }) };
    },
  },
};
