# Download Video

Downloads a YouTube, Instagram or X link as an MP4 video or an M4A audio file with [yt-dlp](https://github.com/yt-dlp/yt-dlp). Copy a link, open the actions and choose *Download video*. Progress shows on the job card, and the finished file is handed back to yabbistir.

Video is requested as H.264 with AAC, which QuickTime plays on every Mac. When a site only has VP9 or AV1, or HE-AAC audio, the file is converted with ffmpeg.

## Permissions

- **network**, with `youtube.com`, `youtu.be`, `instagram.com`, `x.com` and `twitter.com`: the sites the extension works with, shown before you install it. The list holds the extension's own requests. yt-dlp is a separate program, so the list does not limit it: it reaches these sites and the servers they deliver media from (content networks such as `googlevideo.com`), as any download of such a link does.
- **exec**, limited to the tools below. The extension runs only `yt-dlp` and `ffmpeg` (and yt-dlp may call `deno`). It passes a fixed list of arguments and puts the link after `--`, so the link can never be read as an option.

## Tools to install

```sh
brew install yt-dlp ffmpeg deno
```

yt-dlp needs a JavaScript runtime to solve some sites' challenges (YouTube in particular), so `deno` is listed as a required tool too. If a download fails with a message about updating, run `brew upgrade yt-dlp`.

## Browser cookies (optional)

Some posts ask you to sign in. In the extension's settings, *Browser cookies* can be set to Safari, Chrome or Firefox. It is off by default and asks you to confirm when you turn it on.

Privacy: the extension reads no cookies itself. It only tells yt-dlp which browser to use (`--cookies-from-browser`), and the cookies go to yt-dlp and nowhere else. Safari needs Full Disk Access.
