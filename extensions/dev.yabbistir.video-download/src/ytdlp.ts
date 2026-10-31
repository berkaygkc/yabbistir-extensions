/** What Download Video asks yt-dlp and ffmpeg for, and how it reads what yt-dlp prints. Pure functions, no `yab` calls. */

/**
 * yt-dlp's `--progress-template "download:yab %(progress.downloaded_bytes)s %(progress.total_bytes)s
 * %(progress.total_bytes_estimate)s %(progress.eta)s"`: one line per update, "NA" (the README's default
 * placeholder for unavailable fields) or "None" for a value yt-dlp does not know yet.
 */
export const progressTemplate =
  "download:yab %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.eta)s";

export interface DownloadProgress {
  downloaded: number;
  /** The exact total, else yt-dlp's estimate; undefined when neither is known. */
  total?: number;
  /** Seconds left, when yt-dlp knows and there is something left. */
  eta?: number;
}

function number(token: string | undefined): number | undefined {
  if (token === undefined || token === "NA" || token === "None") return undefined;
  const value = Number(token);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The numbers of a "yab …" line, or null for any other line or one with nothing downloaded known. */
export function parseProgress(line: string): DownloadProgress | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "yab" || parts.length !== 5) return null;
  const downloaded = number(parts[1]);
  if (downloaded === undefined) return null;
  const exact = number(parts[2]);
  const estimate = number(parts[3]);
  const total = exact !== undefined && exact > 0 ? exact : estimate !== undefined && estimate > 0 ? estimate : undefined;
  const eta = number(parts[4]);
  return { downloaded, total, eta: eta !== undefined && eta > 0 ? eta : undefined };
}

/** Downloaded share of the total, 0–1; null when the total is unknown. */
export function fraction(progress: DownloadProgress): number | null {
  return progress.total === undefined ? null : Math.min(1, progress.downloaded / progress.total);
}

/**
 * Which progress reports reach the card. yt-dlp prints a line for every update, many a second: a
 * number line goes through when its whole percent changes or half a second has passed since the last
 * report (the only rule when the total is unknown); a state word ("Birleştiriliyor") always does. A
 * repeat of the very same report never does.
 */
export class ProgressThrottle {
  static readonly interval = 500;
  private lastReport = "";
  /** The whole percent last reported; null for an unknown total, undefined after a state word. */
  private lastPercent: number | null | undefined = undefined;
  private lastTime = -Infinity;

  /** Whether to report now (`now` in milliseconds); `state`: a state word, not numbers. */
  admits(value: number | null, message: string, state: boolean, now: number): boolean {
    const report = `${value}|${message}`;
    if (report === this.lastReport) return false;
    const percent = value === null ? null : Math.floor(value * 100);
    if (!state && percent === this.lastPercent && now - this.lastTime < ProgressThrottle.interval) return false;
    this.lastReport = report;
    this.lastPercent = state ? undefined : percent;
    this.lastTime = now;
    return true;
  }
}

type Translate = (key: string, args?: Record<string, string | number>) => string;

/** Megabytes (10^6 bytes) with one decimal and the language's decimal mark. */
function megabytes(bytes: number, decimal: string): string {
  return (bytes / 1e6).toFixed(1).replace(".", decimal);
}

/** "18,4 / 43,7 MB · 1 dk kaldı", "18.4 MB" when the total is unknown, no time part when the eta is. */
export function describe(progress: DownloadProgress, t: Translate): string {
  const decimal = t("decimal");
  const done = megabytes(progress.downloaded, decimal);
  const size = progress.total === undefined
    ? t("sizeOnly", { done })
    : t("size", { done, total: megabytes(progress.total, decimal) });
  if (progress.eta === undefined) return size;
  const left = progress.eta < 60
    ? t("left.seconds", { n: Math.round(progress.eta) })
    : t("left.minutes", { n: Math.max(1, Math.round(progress.eta / 60)) });
  return `${size} · ${left}`;
}

/** Which phase a yt-dlp line announces: "[Merger] …" or "[ExtractAudio] …". */
export function phase(line: string): "merging" | "extracting" | null {
  if (line.startsWith("[Merger]")) return "merging";
  if (line.startsWith("[ExtractAudio]")) return "extracting";
  return null;
}

/** The message for a failed run: a known cause in the person's words, else yt-dlp's last line. */
export function failure(stderr: string, exitCode: number, t: Translate): string {
  const text = stderr.toLowerCase();
  if (text.includes("sign in to confirm") || text.includes("login required") || text.includes("cookies")) return t("loginRequired");
  if (text.includes("unsupported url") || text.includes("unable to extract") || text.includes("http error 403")) return t("update");
  const last = stderr.split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line !== "").pop();
  return last ?? t("failed", { code: exitCode });
}

/** Where yt-dlp writes what it downloaded: the path, then the video and audio codec of each finished file. */
export interface PrintFiles {
  result: string;
  vcodec: string;
  acodec: string;
}

/** The files `--print-to-file` writes in the work folder. */
export function printFiles(workDir: string): PrintFiles {
  return { result: `${workDir}/yab-result.txt`, vcodec: `${workDir}/yab-vcodec.txt`, acodec: `${workDir}/yab-acodec.txt` };
}

/**
 * yt-dlp's arguments. `workDir` and `url` go through as they are; no shell reads them. yt-dlp downloads
 * into `<workDir>/src/`, so a converted file can take the plain name in `<workDir>/` itself.
 */
export function arguments_(options: { url: string; workDir: string; prints: PrintFiles; variant: "video" | "audio"; cookies: string }): string[] {
  const common = [
    "--newline",
    "--no-playlist",
    "--no-mtime",
    "--progress-template", progressTemplate,
    "-o", `${options.workDir}/src/%(title).120B.%(ext)s`,
    // Unlike --print, --print-to-file does not imply --quiet, so progress and phase lines still come.
    "--print-to-file", "after_move:filepath", options.prints.result,
    "--print-to-file", "after_move:vcodec", options.prints.vcodec,
    "--print-to-file", "after_move:acodec", options.prints.acodec,
  ];
  // Audio: AAC-LC, else any AAC, else the best audio stream, else (a site with only combined streams) the
  // audio of the best one. Video: yt-dlp's `-t mp4` preset spelled out (older yt-dlp has no presets):
  // H.264 and AAC first, by codec rather than container, merged or remuxed into MP4.
  const kind = options.variant === "audio"
    ? ["-f", "ba[acodec^=mp4a.40.2]/ba[acodec^=mp4a]/ba/b", "-x", "--audio-format", "m4a"]
    : ["--merge-output-format", "mp4", "--remux-video", "mp4", "-S", "vcodec:h264,lang,quality,res,fps,hdr:12,acodec:aac"];
  const cookies = options.cookies === "off" || options.cookies === "" ? [] : ["--cookies-from-browser", options.cookies];
  return [...common, ...kind, ...cookies, "--", options.url];
}

/**
 * Whether QuickTime plays this video codec on every Mac: H.264 and HEVC do; VP9 and AV1 do not (AV1
 * only on M3 and later), and an unknown one ("NA", nothing printed) is not taken on trust.
 */
export function playsEverywhere(vcodec: string | undefined): boolean {
  return /^(avc|h264|hvc|hev|h265)/i.test(vcodec ?? "");
}

/** Whether the audio is HE-AAC (v1 or v2), Instagram's odd one out that Music would not open; it is made AAC-LC. */
export function isHEAAC(acodec: string | undefined): boolean {
  const codec = (acodec ?? "").toLowerCase();
  return codec.startsWith("mp4a.40.5") || codec.startsWith("mp4a.40.29");
}

/** The converted file's path: the downloaded file's name with `ext`, in the work folder itself. */
export function convertedPath(workDir: string, source: string, ext: string): string {
  const name = source.slice(source.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return `${workDir}/${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/**
 * ffmpeg's arguments for an H.264 copy of `source` with AAC audio (copied when it already is AAC).
 * `encoder`: the Mac's hardware encoder first, libx264 when that one fails. Always 8-bit 4:2:0: a
 * 10-bit (HDR) or 4:4:4 source would otherwise become High 10 or High 4:4:4, which older Macs and
 * QuickTime builds do not play.
 */
export function videoConversion(source: string, output: string, acodec: string | undefined, encoder: "videotoolbox" | "x264"): string[] {
  const video = encoder === "videotoolbox"
    ? ["-c:v", "h264_videotoolbox", "-q:v", "65"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
  const audio = (acodec ?? "").toLowerCase().startsWith("mp4a") ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"];
  return ["-hide_banner", "-nostdin", "-y", "-i", source, "-map", "0:v:0", "-map", "0:a:0?",
    ...video, "-pix_fmt", "yuv420p", "-tag:v", "avc1", ...audio, "-movflags", "+faststart", output];
}

/** ffmpeg's arguments for an AAC-LC copy of `source`'s audio. */
export function audioConversion(source: string, output: string): string[] {
  return ["-hide_banner", "-nostdin", "-y", "-i", source, "-vn", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", output];
}
