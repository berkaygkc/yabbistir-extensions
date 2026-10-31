# Recipe: download video and audio with yt-dlp

A job that runs a command-line program, reports its progress, and hands back the file it made. Copy a YouTube link, open the transforms with ⇧, and pick *Download as video* or *Download audio*. With Finder in front, the file lands in the open folder.

This is a small version of [Download Video](../../extensions/dev.yabbistir.video-download), which adds Instagram and X, conversions for video and audio formats that not every Mac app plays, clearer failure messages, and optional browser cookies for posts that need a sign-in.

It shows: the `exec` permission and `requires.tools`, arguments that are safe to pass, a job with progress, variants, and a file result aimed at Finder.

```sh
npm run new -- dev.yourname.download --template job
```

Replace the template's files with these, and delete `locales/tr.json` (or translate the keys).

## manifest.json

```json file=manifest.json
{
  "id": "dev.yourname.download",
  "version": "1.0.0",
  "apiVersion": 1,
  "defaultLocale": "en",
  "name": "name",
  "description": "description",
  "icon": "sf:arrow.down.circle",
  "author": "your-github-name",
  "license": "MIT",
  "categories": ["media"],
  "permissions": ["network", "exec"],
  "network": { "domains": ["youtube.com", "youtu.be"] },
  "requires": {
    "tools": [
      { "name": "yt-dlp", "install": "brew install yt-dlp" },
      { "name": "ffmpeg", "install": "brew install ffmpeg" },
      { "name": "deno", "install": "brew install deno" }
    ]
  },
  "contributes": {
    "actions": [
      { "id": "download", "title": "download.title", "keywords": "download.keywords", "input": "item",
        "accepts": { "kinds": ["link"], "pattern": "^https?://([a-z0-9-]+\\.)*(youtube\\.com|youtu\\.be)/" },
        "targets": ["finder"], "job": true, "output": "file", "verb": "verb",
        "variants": [
          { "id": "video", "title": "video.title", "subtitle": "video.subtitle", "failTitle": "video.fail" },
          { "id": "audio", "title": "audio.title", "subtitle": "audio.subtitle", "failTitle": "audio.fail" }
        ] }
    ]
  }
}
```

- `exec` runs only the tools listed. yt-dlp downloads; it calls ffmpeg to merge video and audio or to extract the audio, and deno to solve YouTube's challenges. The extension itself runs only `yt-dlp`.
- `network` with its domains is what the person reads before install: "Can reach: youtube.com, youtu.be". yt-dlp reaches the sites itself; the permission makes that plain, and holds the extension's own requests to those hosts.
- `"targets": ["finder"]` puts the action first when Finder is in front, where the file is dropped into the open folder.
- Each variant is its own row and gets its own failure title.

## locales/en.json

```json file=locales/en.json
{
  "name": "Download",
  "description": "Downloads YouTube links as MP4 video or M4A audio with yt-dlp.",
  "download.title": "Download video",
  "download.keywords": ["download", "video", "audio", "youtube", "mp4", "m4a"],
  "video.title": "Download as video",
  "video.subtitle": "MP4",
  "video.fail": "Couldn’t download the video",
  "audio.title": "Download audio",
  "audio.subtitle": "M4A · audio only",
  "audio.fail": "Couldn’t download the audio",
  "verb": "Download",
  "connecting": "Connecting",
  "progress": "{done} / {total} MB",
  "update": "Couldn’t download. yt-dlp may need an update: brew upgrade yt-dlp",
  "noFile": "The downloaded file could not be found."
}
```

## src/index.ts

```ts file=src/index.ts
import type { Actions } from "@yabbistir/api";

/** One line per update, "yab <bytes done> <bytes in all>", with "NA" for a number yt-dlp does not know yet. */
const progressTemplate = "download:yab %(progress.downloaded_bytes)s %(progress.total_bytes)s";

/**
 * yt-dlp's arguments: fixed flags, then the link after "--", so a link that looks like an option
 * ("--exec=…") is still only a link. No shell reads them.
 */
export function ytDlpArguments(url: string, variant: string, workDir: string): string[] {
  const kind = variant === "audio"
    ? ["-f", "ba/b", "-x", "--audio-format", "m4a"]
    : ["-S", "vcodec:h264,res,acodec:aac", "--merge-output-format", "mp4"];
  return [
    "--newline", "--no-playlist", "--no-mtime",
    "--progress-template", progressTemplate,
    "-o", `${workDir}/%(title).120B.%(ext)s`,
    // Writes the finished file's path to a file. Unlike --print, it keeps the progress lines coming.
    "--print-to-file", "after_move:filepath", `${workDir}/result.txt`,
    ...kind,
    "--", url,
  ];
}

/** Bytes done and in all from a progress line; undefined for any other line, or while the size is unknown. */
export function progressOf(line: string): { done: number; total: number } | undefined {
  const [tag, done, total] = line.trim().split(/\s+/);
  if (tag !== "yab" || !(Number(done) >= 0) || !(Number(total) > 0)) return undefined;
  return { done: Number(done), total: Number(total) };
}

const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1);

export const actions: Actions = {
  download: {
    async run(item, ctx) {
      const url = item?.url ?? item?.text ?? "";
      const workDir = yab.files.workDir;
      yab.job.progress(null, yab.t("connecting"));
      let lastPercent = -1;
      // A missing tool, a cancel or a refused permission rejects from here with its own code: let it through.
      const result = await yab.exec("yt-dlp", ytDlpArguments(url, ctx.variant ?? "video", workDir), {
        signal: ctx.signal,
        onLine(line, stream) {
          const progress = stream === "stdout" ? progressOf(line) : undefined;
          if (!progress) return;
          const percent = Math.floor((progress.done / progress.total) * 100);
          if (percent === lastPercent) return; // once per whole percent, so the card redraws calmly
          lastPercent = percent;
          yab.job.progress(progress.done / progress.total,
            yab.t("progress", { done: megabytes(progress.done), total: megabytes(progress.total) }));
        },
      });
      if (result.exitCode !== 0) throw new Error(yab.t("update"));

      const printed = `${workDir}/result.txt`;
      const path = yab.files.exists(printed) ? new TextDecoder().decode(yab.files.read(printed)).trim().split("\n").pop() ?? "" : "";
      if (path === "" || !yab.files.exists(path)) throw new Error(yab.t("noFile"));
      return { file: path };
    },
  },
};
```

- **Arguments are fixed, and the link comes last, after `--`.** The review checks this for every extension with `exec` ([checklist](../review-checklist.md#exec)). Never add options that run other programs, such as `--exec`.
- yt-dlp writes into the call's work folder, so the file is a valid result; the app moves it into its own output folder afterwards.
- A non-zero exit code is not an error by itself: the code checks it and fails with a message the person can act on.

## tests/index.test.mjs

The fake host never runs yt-dlp: the test gives a stand-in that prints progress lines and leaves a file on the fake disk, as the real one would.

```js file=tests/index.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";

import { actions, ytDlpArguments } from "../src/index.ts";

const folder = new URL("..", import.meta.url);
const link = { kind: "link", url: "https://www.youtube.com/watch?v=abc" };

/** Prints two progress lines and leaves the file where -o says, with its path in result.txt. */
function fakeYtDlp(seen = []) {
  return (args, { host, workDir }) => {
    seen.push(args);
    const file = `${workDir}/Clip.${args.includes("-x") ? "m4a" : "mp4"}`;
    host.files.set(file, new Uint8Array([0]));
    host.files.set(`${workDir}/result.txt`, new TextEncoder().encode(`${file}\n`));
    return { exitCode: 0, stdout: "yab 1000000 4000000\nyab 4000000 4000000\n", stderr: "" };
  };
}

describe("download", () => {
  test("theLinkComesLastAfterTheOptionTerminator", () => {
    const args = ytDlpArguments("--exec=touch /tmp/x", "video", "/work");
    assert.deepEqual(args.slice(-2), ["--", "--exec=touch /tmp/x"]);
    assert.ok(!args.includes("--exec"));
  });

  test("downloadsAVideoAndReportsProgress", async () => {
    const seen = [];
    const host = createFakeHost({ folder, exec: { "yt-dlp": fakeYtDlp(seen) } });
    const result = await host.run(actions.download, link, { variant: "video" });
    assert.match(result.file, /Clip\.mp4$/);
    assert.ok(seen[0].includes("--merge-output-format"));
    assert.deepEqual(host.progress.map((entry) => entry.fraction), [null, 0.25, 1]);
    assert.equal(host.progress[1].message, "1.0 / 4.0 MB");
  });

  test("audioAsksForM4a", async () => {
    const seen = [];
    const host = createFakeHost({ folder, exec: { "yt-dlp": fakeYtDlp(seen) } });
    const result = await host.run(actions.download, link, { variant: "audio" });
    assert.match(result.file, /Clip\.m4a$/);
    assert.ok(seen[0].includes("-x"));
  });

  test("aFailedRunSaysToUpdate", async () => {
    const host = createFakeHost({ folder, exec: { "yt-dlp": () => ({ exitCode: 1, stdout: "", stderr: "ERROR: Unsupported URL" }) } });
    await assert.rejects(host.run(actions.download, link, { variant: "video" }), /brew upgrade yt-dlp/);
  });

  test("aMissingToolSaysHowToInstallIt", async () => {
    const host = createFakeHost({ folder });
    await assert.rejects(host.run(actions.download, link, { variant: "video" }), { code: "toolMissing", message: /brew install yt-dlp/ });
  });
});
```

## Try it

```sh
brew install yt-dlp ffmpeg deno
npm test -- dev.yourname.download
npm run validate -- dev.yourname.download
npm run dev -- dev.yourname.download
```

In yabbistir, approve the permissions in Settings → Extensions, copy a YouTube link, press ⇧⌘V, select the link and press ⇧. The README must list the three tools and say why each permission is needed.
