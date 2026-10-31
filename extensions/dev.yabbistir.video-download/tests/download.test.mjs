import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost, yabError } from "@yabbistir/api/fake-host";

import { actions } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const URL_ = "https://www.youtube.com/watch?v=fixture";
const item = { id: 1, kind: "link", text: URL_, url: URL_, tags: [], copiedAt: "2026-01-01T00:00:00Z" };

const PROGRESS = ["yab 10000000 40000000 NA 30", "yab 20000000 NA 40000000 12", "yab 40000000 40000000 NA 0"];

/**
 * A yt-dlp that prints what the real one prints with the extension's flags (progress-template lines, the
 * "[Merger]" or "[ExtractAudio]" line) and leaves the file the `-o` template names on the fake disk, with
 * its path, video codec and audio codec appended to the `--print-to-file` files.
 */
function ytDlp({ progress = PROGRESS, vcodec = "avc1.640028", acodec = "mp4a.40.2", seen = [] } = {}) {
  return (args, { host }) => {
    seen.push(args);
    const value = (flag) => args[args.indexOf(flag) + 1];
    const prints = {};
    args.forEach((arg, index) => { if (arg === "--print-to-file") prints[args[index + 1]] = args[index + 2]; });
    const audio = args.includes("-x");
    const file = value("-o").replace("%(title).120B", "Fixture Title").replace("%(ext)s", audio ? "m4a" : "mp4");
    host.files.set(file, new TextEncoder().encode("data"));
    const append = (path, line) => host.files.set(path, new TextEncoder().encode(line + "\n"));
    append(prints["after_move:filepath"], file);
    append(prints["after_move:vcodec"], vcodec);
    append(prints["after_move:acodec"], acodec);
    const stdout = ["[youtube] fixture: Downloading webpage", ...progress, audio ? "[ExtractAudio] Destination: x" : '[Merger] Merging formats into "x"'].join("\n");
    return { exitCode: 0, stdout, stderr: "" };
  };
}

const failing = (stderr, exitCode = 1) => () => ({ exitCode, stdout: "", stderr });

function hostWith(exec, { language = "en", preferences } = {}) {
  return createFakeHost({ folder, exec, context: { language }, preferences });
}
const execCalls = (host, tool) => host.calls.filter((call) => call.api === "exec" && call.args[0] === tool).map((call) => call.args[1]);
const after = (args, flag) => args[args.indexOf(flag) + 1];

describe("yt-dlp arguments", () => {
  test("theLinkComesAfterTheOptionTerminatorAndIsNeverAnOption", async () => {
    // A link that looks like an option still goes through as the one argument after `--`.
    const evil = { ...item, url: "--exec=touch /tmp/x", text: "--exec=touch /tmp/x" };
    const seen = [];
    const host = hostWith({ "yt-dlp": ytDlp({ seen }) });
    await host.run(actions.download, evil, { variant: "video" });
    const args = seen[0];
    assert.equal(args.at(-1), "--exec=touch /tmp/x");
    assert.equal(args.at(-2), "--");
    assert.equal(args.filter((arg) => arg === "--").length, 1);
    assert.equal(args.indexOf("--exec=touch /tmp/x"), args.length - 1);
  });

  test("theFixedFlagsAreAlwaysThere", async () => {
    const seen = [];
    await hostWith({ "yt-dlp": ytDlp({ seen }) }).run(actions.download, item, { variant: "video" });
    const args = seen[0];
    for (const flag of ["--newline", "--no-playlist", "--no-mtime", "--print-to-file"]) assert.ok(args.includes(flag), flag);
    assert.ok(!args.includes("--print"), "--print would imply --quiet");
    assert.equal(args.at(-1), URL_);
    // Nothing that runs other programs or reads other files can be switched on.
    for (const forbidden of ["--exec", "--exec-before-download", "--config-locations", "--batch-file", "--netrc"]) assert.ok(!args.includes(forbidden), forbidden);
  });

  test("videoIsAskedForAsH264AndAacInAnMp4", async () => {
    const seen = [];
    const host = hostWith({ "yt-dlp": ytDlp({ seen }) });
    const result = await host.run(actions.download, item, { variant: "video" });
    const args = seen[0];
    assert.ok(!args.includes("-f") && !args.includes("-x"));
    assert.equal(after(args, "-S"), "vcodec:h264,lang,quality,res,fps,hdr:12,acodec:aac");
    assert.equal(after(args, "--merge-output-format"), "mp4");
    assert.equal(after(args, "--remux-video"), "mp4");
    // yt-dlp writes into the work folder's src subfolder, and its codecs are printed next to the path.
    const template = after(args, "-o");
    assert.ok(template.endsWith("/src/%(title).120B.%(ext)s"));
    const workDir = template.slice(0, -"/src/%(title).120B.%(ext)s".length);
    const prints = {};
    args.forEach((arg, index) => { if (arg === "--print-to-file") prints[args[index + 1]] = args[index + 2]; });
    assert.equal(prints["after_move:filepath"], `${workDir}/yab-result.txt`);
    assert.equal(prints["after_move:vcodec"], `${workDir}/yab-vcodec.txt`);
    assert.equal(prints["after_move:acodec"], `${workDir}/yab-acodec.txt`);
    assert.equal(result.file, `${workDir}/src/Fixture Title.mp4`);
  });

  test("audioPrefersAacLcThenAnyAacThenAnyAudio", async () => {
    const seen = [];
    const host = hostWith({ "yt-dlp": ytDlp({ seen }) });
    const result = await host.run(actions.download, item, { variant: "audio" });
    const args = seen[0];
    assert.ok(args.includes("-x"));
    assert.equal(after(args, "-f"), "ba[acodec^=mp4a.40.2]/ba[acodec^=mp4a]/ba/b");
    assert.equal(after(args, "--audio-format"), "m4a");
    assert.ok(!args.includes("-S") && !args.includes("--remux-video"));
    assert.ok(result.file.endsWith(".m4a"));
    assert.equal(host.progress.at(-1).message, "Extracting audio");
  });

  test("cookiesArePassedOnlyWhenTurnedOn", async () => {
    const off = [];
    await hostWith({ "yt-dlp": ytDlp({ seen: off }) }).run(actions.download, item, { variant: "video" });
    assert.ok(!off[0].includes("--cookies-from-browser"));
    const safari = [];
    await hostWith({ "yt-dlp": ytDlp({ seen: safari }) }, { preferences: { browserCookies: "safari" } }).run(actions.download, item, { variant: "video" });
    assert.equal(after(safari[0], "--cookies-from-browser"), "safari");
    assert.equal(safari[0].at(-1), URL_);
  });

  test("anUnknownCookieChoiceIsTreatedAsOff", async () => {
    const seen = [];
    const host = hostWith({ "yt-dlp": ytDlp({ seen }) }, { preferences: { browserCookies: "../../etc" } });
    await host.run(actions.download, item, { variant: "video" });
    assert.ok(!seen[0].includes("--cookies-from-browser"));
    assert.ok(!seen[0].includes("../../etc"));
  });
});

describe("progress", () => {
  test("isReportedAsTheCardShowsIt", async () => {
    const host = hostWith({ "yt-dlp": ytDlp() });
    await host.run(actions.download, item, { variant: "video" });
    assert.deepEqual(host.progress, [
      { fraction: null, message: "Connecting" },
      { fraction: 0.25, message: "10.0 / 40.0 MB · 30 s left" },
      { fraction: 0.5, message: "20.0 / 40.0 MB · 12 s left" },
      { fraction: 1, message: "40.0 / 40.0 MB" },
      { fraction: null, message: "Merging" },
    ]);
  });

  test("numbersFollowTheLanguage", async () => {
    const progress = ["yab 18400000 43700000 NA 90", "yab 5000000 NA NA NA", "yab 20000000 40000000 NA NA", "yab NA NA NA NA", "yab 1000 None None None"];
    const english = hostWith({ "yt-dlp": ytDlp({ progress }) });
    await english.run(actions.download, item, { variant: "video" });
    // An unknown total shows the amount alone, an unknown eta has no time part, and nothing known reports nothing.
    assert.deepEqual(english.progress.map((entry) => entry.message), ["Connecting", "18.4 / 43.7 MB · 2 min left", "5.0 MB", "20.0 / 40.0 MB", "0.0 MB", "Merging"]);
    const turkish = hostWith({ "yt-dlp": ytDlp({ progress: ["yab 18400000 43700000 NA 60"] }) }, { language: "tr" });
    await turkish.run(actions.download, item, { variant: "video" });
    assert.ok(turkish.progress[1].message.endsWith("18,4 / 43,7 MB · 1 dk kaldı"), turkish.progress[1].message);
  });

  test("isReportedOncePerWholePercent", async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `yab ${100_000_000 + index * 10_000} 1000000000 NA 30`);
    const host = hostWith({ "yt-dlp": ytDlp({ progress: lines }) });
    await host.run(actions.download, item, { variant: "video" });
    assert.deepEqual(host.progress.map((entry) => entry.message), ["Connecting", "100.0 / 1000.0 MB · 30 s left", "Merging"]);
  });
});

describe("failures", () => {
  const message = async (stderr, language = "en") => {
    const host = hostWith({ "yt-dlp": failing(stderr) }, { language });
    return host.run(actions.download, item, { variant: "video" }).then(() => assert.fail("should have failed"), (error) => error.message);
  };

  test("aLoginWallBecomesAHelpfulMessage", async () => {
    assert.equal(await message("ERROR: [youtube] fixture: Sign in to confirm you're not a bot"),
      "This post asks you to sign in. You can turn on browser cookies for Download Video in Settings.");
  });

  test("anOutdatedYtDlpAsksForAnUpdate", async () => {
    for (const stderr of ["ERROR: Unsupported URL: x", "ERROR: Unable to extract uploader id", "ERROR: unable to download video data: HTTP Error 403: Forbidden"]) {
      assert.equal(await message(stderr), "Couldn’t download. yt-dlp may need an update: brew upgrade yt-dlp");
    }
    assert.equal(await message("ERROR: Unsupported URL: x", "tr"), "İndirilemedi. yt-dlp güncellenmeli olabilir: brew upgrade yt-dlp");
  });

  test("anyOtherFailureShowsTheLastLineOfStderr", async () => {
    assert.equal(await message("warning one\nERROR: Video unavailable\n"), "ERROR: Video unavailable");
  });

  test("aFailureWithNoOutputStillFails", async () => {
    assert.equal(await message("", "en"), "yt-dlp exited with code 1.");
  });

  test("aMissingToolKeepsItsCodeAndSaysHowToInstallIt", async () => {
    const host = createFakeHost({ folder });
    await assert.rejects(host.run(actions.download, item, { variant: "video" }), (error) => {
      assert.equal(error.code, "toolMissing");
      assert.match(error.message, /yt-dlp/);
      assert.match(error.message, /brew install yt-dlp/);
      return true;
    });
    const noFfmpeg = hostWith({ "yt-dlp": ytDlp({ vcodec: "vp9" }) });
    await assert.rejects(noFfmpeg.run(actions.download, item, { variant: "video" }), (error) => error.code === "toolMissing" && /brew install ffmpeg/.test(error.message));
  });

  test("successWithoutAFileIsNotSuccess", async () => {
    // Exit 0 but nothing was written: no result.
    const empty = hostWith({ "yt-dlp": () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    await assert.rejects(empty.run(actions.download, item, { variant: "video" }), { message: "The downloaded file could not be found." });
    // The path file names a file that is not there.
    const ghost = hostWith({
      "yt-dlp": (args, { host }) => {
        const path = args[args.indexOf("after_move:filepath") + 1];
        host.files.set(path, new TextEncoder().encode("/nowhere/file.mp4\n"));
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    await assert.rejects(ghost.run(actions.download, item, { variant: "video" }), { message: "The downloaded file could not be found." });
  });

  test("cancellingStopsTheDownload", async () => {
    const host = hostWith({ "yt-dlp": () => new Promise(() => {}) });
    const run = host.run(actions.download, item, { variant: "video" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    host.cancel();
    await assert.rejects(run, { code: "cancelled" });
  });
});

describe("conversion", () => {
  const ffmpeg = ({ failing: failIf = () => false, seen = [] } = {}) => (args, { host }) => {
    seen.push(args);
    if (failIf(args)) return { exitCode: 1, stdout: "", stderr: "boom" };
    host.files.set(args.at(-1), new TextEncoder().encode("converted"));
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const run = async (variant, ytdlpOptions, ffmpegOptions) => {
    const seen = [];
    const host = hostWith({ "yt-dlp": ytDlp(ytdlpOptions), ffmpeg: ffmpeg({ ...ffmpegOptions, seen }) });
    const result = await host.run(actions.download, item, { variant }).catch((error) => error);
    return { host, result, seen };
  };

  test("anH264VideoIsNotConverted", async () => {
    const { host, result, seen } = await run("video", { vcodec: "avc1.640028" });
    assert.equal(seen.length, 0);
    assert.ok(result.file.includes("/src/"));
    assert.equal(execCalls(host, "ffmpeg").length, 0);
  });

  test("aVp9VideoIsConvertedToH264", async () => {
    const { host, result, seen } = await run("video", { vcodec: "vp09.00.40.08", acodec: "opus" });
    assert.equal(seen.length, 1);
    const args = seen[0];
    assert.equal(after(args, "-c:v"), "h264_videotoolbox");
    assert.equal(after(args, "-pix_fmt"), "yuv420p");
    assert.equal(after(args, "-tag:v"), "avc1");
    // Opus becomes AAC; the output is in the work folder itself, not in src.
    assert.equal(after(args, "-c:a"), "aac");
    assert.ok(result.file.endsWith("/Fixture Title.mp4") && !result.file.includes("/src/"));
    assert.equal(args.at(-1), result.file);
    assert.equal(host.progress.some((entry) => entry.message === "Converting"), true);
  });

  test("anUnknownVideoCodecIsConverted", async () => {
    const { seen } = await run("video", { vcodec: "NA" });
    assert.equal(seen.length, 1);
  });

  test("aacAudioIsCopiedWhenConverting", async () => {
    const { seen } = await run("video", { vcodec: "av01.0.08M.08", acodec: "mp4a.40.2" });
    assert.equal(after(seen[0], "-c:a"), "copy");
  });

  test("videotoolboxFailureFallsBackToX264", async () => {
    const { seen, result } = await run("video", { vcodec: "vp9" }, { failing: (args) => args.includes("h264_videotoolbox") });
    assert.deepEqual(seen.map((args) => after(args, "-c:v")), ["h264_videotoolbox", "libx264"]);
    assert.ok(result.file.endsWith(".mp4"));
  });

  test("aConversionFailureSaysSo", async () => {
    const { result } = await run("video", { vcodec: "vp9" }, { failing: () => true });
    assert.equal(result.message, "Couldn’t convert the video.");
  });

  test("heAacAudioIsReencoded", async () => {
    for (const acodec of ["mp4a.40.5", "mp4a.40.29"]) {
      const { seen, result } = await run("audio", { acodec });
      assert.equal(seen.length, 1);
      assert.equal(after(seen[0], "-c:a"), "aac");
      assert.ok(seen[0].includes("-vn"));
      assert.ok(result.file.endsWith("/Fixture Title.m4a") && !result.file.includes("/src/"));
    }
  });

  test("aacLcAudioIsKept", async () => {
    const { seen, result } = await run("audio", { acodec: "mp4a.40.2" });
    assert.equal(seen.length, 0);
    assert.ok(result.file.includes("/src/"));
  });

  test("anAudioConversionFailureSaysSo", async () => {
    const { result } = await run("audio", { acodec: "mp4a.40.5" }, { failing: () => true });
    assert.equal(result.message, "Couldn’t convert the audio.");
  });

  test("anFfmpegThatExitsNonzeroWithoutOutputIsAFailure", async () => {
    const seen = [];
    const host = hostWith({ "yt-dlp": ytDlp({ vcodec: "vp9" }), ffmpeg: (args) => { seen.push(args); return { exitCode: 0, stdout: "", stderr: "" }; } });
    await assert.rejects(host.run(actions.download, item, { variant: "video" }), { message: "Couldn’t convert the video." });
    assert.equal(seen.length, 2, "both encoders were tried");
  });
});
