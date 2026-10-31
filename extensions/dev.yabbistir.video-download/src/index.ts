import type { Actions } from "@yabbistir/api";
import {
  ProgressThrottle, arguments_, audioConversion, convertedPath, describe, failure, fraction, isHEAAC, parseProgress, phase,
  playsEverywhere, printFiles, videoConversion,
} from "./ytdlp.ts";

const cookieBrowsers = new Set(["off", "safari", "chrome", "firefox"]);

/** The last line of a file yt-dlp's --print-to-file appended to (one line per finished file); undefined when there is none. */
function lastLine(file: string): string | undefined {
  if (!yab.files.exists(file)) return undefined;
  return new TextDecoder().decode(yab.files.read(file)).split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line !== "").pop();
}

export const actions: Actions = {
  download: {
    async run(item, ctx) {
      const t = (key: string, args?: Record<string, string | number>) => yab.t(key, args);
      const url = item?.url ?? item?.text ?? "";
      const workDir = yab.files.workDir;
      const prints = printFiles(workDir);
      const variant = ctx.variant === "audio" ? "audio" : "video";
      const cookies = String(ctx.preferences.browserCookies ?? "off");
      // Numbers once per whole percent (or half a second), state words always: the card redraws calmly.
      const throttle = new ProgressThrottle();
      const report = (value: number | null, message: string, state = false) => {
        if (throttle.admits(value, message, state, Date.now())) yab.job.progress(value, message);
      };

      report(null, t("connecting"), true);
      // yab errors (toolMissing, cancelled, permissionDenied…) reject out of here untouched.
      const result = await yab.exec("yt-dlp", arguments_({
        url,
        workDir,
        prints,
        variant,
        cookies: cookieBrowsers.has(cookies) ? cookies : "off",
      }), {
        signal: ctx.signal,
        onLine(line, stream) {
          if (stream !== "stdout") return;
          const progress = parseProgress(line);
          if (progress) return report(fraction(progress), describe(progress, t));
          const next = phase(line);
          if (next) report(null, t(next), true);
        },
      });
      if (result.exitCode !== 0) throw new Error(failure(result.stderr, result.exitCode, t));

      const path = lastLine(prints.result);
      if (!path || !yab.files.exists(path)) throw new Error(t("noFile"));
      const acodec = lastLine(prints.acodec);

      // QuickTime and Music play H.264/HEVC with AAC on every Mac; a VP9 or AV1 video (yt-dlp's pick when a
      // site has no H.264) and HE-AAC audio are converted with ffmpeg. Cancelling stops ffmpeg too.
      if (variant === "video" && !playsEverywhere(lastLine(prints.vcodec))) {
        report(null, t("converting"), true);
        const output = convertedPath(workDir, path, "mp4");
        for (const encoder of ["videotoolbox", "x264"] as const) {
          const run = await yab.exec("ffmpeg", videoConversion(path, output, acodec, encoder), { signal: ctx.signal });
          if (run.exitCode === 0 && yab.files.exists(output)) return { file: output };
        }
        throw new Error(t("convertFailed.video"));
      }
      if (variant === "audio" && isHEAAC(acodec)) {
        report(null, t("converting"), true);
        const output = convertedPath(workDir, path, "m4a");
        const run = await yab.exec("ffmpeg", audioConversion(path, output), { signal: ctx.signal });
        if (run.exitCode === 0 && yab.files.exists(output)) return { file: output };
        throw new Error(t("convertFailed.audio"));
      }
      return { file: path };
    },
  },
};
