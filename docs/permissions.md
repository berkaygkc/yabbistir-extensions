# Permissions

An extension starts with no permissions. Most need none: everything below works without asking.

- Reading the item it is given, and returning a result.
- Strings, preferences, secrets (`yab.secrets.get`) and its own small store (`yab.storage`).
- Files in the call's work folder (`yab.files`), and reading a folder the person chose in a `folder` preference.
- Images and Vision (`yab.image`, `yab.vision`, `yab.qr`).
- On-device AI (`yab.ai.generate`) and translation (`yab.translate`): the data never leaves the Mac.
- Notices (`yab.notify`) and opening a web link in the browser (`yab.open`).

Four things need a permission, listed in the manifest's `permissions`. Before the extension is installed, the person sees each one in a plain sentence and decides. An update that asks for a new permission waits until the person approves it. The app checks every call: a call the manifest does not allow fails with [`permissionDenied`](errors.md#permissiondenied).

| Permission | What it allows | What the person reads |
|---|---|---|
| [`network`](#network) | Reaching the internet, from a run the person started | "Can reach: example.com, api.example.com" or "Can reach any website" |
| [`exec`](#exec) | Running the programs listed in `requires.tools` | "Can run these programs on your Mac: yt-dlp, ffmpeg. They can read and write your files and reach the internet." |
| [`capture`](#capture) | Seeing each new copy, to run capture rules | "Can see everything you copy" |
| [`history`](#history) | Reading earlier copies | "Can read your whole history" |

A source marked `sensitive` adds one more sentence, though it is not a permission: "Can read and paste secrets such as passwords. They’re never written to history or disk." An extension with a secret source action cannot ask for `network` at all; see [Sources](sources.md#secrets).

**Ask for as little as you can.** Every permission is a sentence the person has to accept and a reason a reviewer reads your code more closely. List the hosts you need rather than any host, run one program rather than a shell, and prefer `yab.ai` and `yab.translate` to a web service when they can do the job. Each permission you keep needs a reason in the pull request and in the README.

## network

```json
{
  "permissions": ["network"],
  "network": { "domains": ["api.example.com"] }
}
```

- `yab.http.fetch(url, init)` and the web `fetch` both work, held to the same rules.
- Only in a run the person started (an action or a job) and in a source's `list` and `run`. Hints, detectors, previews and capture rules get `permissionDenied`.
- Only to the listed hosts: a host matches a domain when it is the domain or ends with `.` and the domain, so `example.com` covers `www.example.com`. Redirects must stay inside the list. Leaving the list empty, or leaving `network` out, allows any host, and the consent sentence says "Can reach any website".
- `http` and `https` only. Response header names arrive lowercased. A text body over 10 MB fails unless it is streamed to a file with `toFile`.
- Failures reject with `networkError`, a host outside the list with `permissionDenied`, a cancelled job with `cancelled`.
- No cookies are kept between requests.

Network use must serve what the person asked for. Sending the item, or anything about the person, anywhere else is a data leak ([review checklist](review-checklist.md#data)).

See [Call an API with a key](recipes/call-an-api-with-a-key.md).

## exec

```json
{
  "permissions": ["exec"],
  "requires": {
    "tools": [{ "name": "yt-dlp", "install": "brew install yt-dlp" }]
  }
}
```

- `yab.exec(tool, args, options)` runs a program by name, and only one listed in `requires.tools`. Any other name is `permissionDenied`.
- The program is looked for in `/opt/homebrew/bin`, then `/usr/local/bin`, then the system's folders. If it is not installed, the call fails with `toolMissing` and a message that says how to install it, and Settings shows the `install` command for the person to copy.
- **No shell.** `args` is a list of strings, and each reaches the program as it is: quotes, `;`, `$(…)` and `*` mean nothing special. Never run a shell (`sh -c …`) to get around that.
- The program runs in the call's work folder (`yab.files.workDir`) with only `PATH`, `HOME`, `TMPDIR`, `USER` and `LANG` set. Its exit code comes back in `exitCode` and is not an error by itself: check it. `onLine` hears its output line by line; `input` is written to its standard input.
- Only in a run the person started and in a source's `list` and `run`. Cancelling the job, or aborting `signal`, stops the program and everything it started.

The program can do anything the person can, so a reviewer checks every argument. **Arguments are fixed or checked by the extension.** Put anything that comes from the item after `--`, so a link such as `--exec=…` can never be read as an option, and never pass options that make the program run other programs. See the [review checklist](review-checklist.md#exec) and [Download with yt-dlp](recipes/download-with-yt-dlp.md).

## capture

```json
{
  "permissions": ["capture"]
}
```

Needed by `contributes.captureRules`, and only for them. A rule sees each new copy's text or URL before it is stored. Rules never reach the network or run programs; see [Capture rules](capture-rules.md). The person can turn each rule off in Settings.

## history

```json
{
  "permissions": ["history"]
}
```

- `yab.history.recent(limit)` returns the newest items, newest first; `yab.history.search(query, limit)` returns those that match a search, the way the panel searches. `limit` is 1 to 50, and 20 when left out.
- Only in an action or a job. Detectors, previews and capture rules get `permissionDenied`.
- Items arrive trimmed: text and HTML are cut to 64 KB, and such an item has `truncated: true`. An image has only its `width` and `height`, never its pixels. Concealed copies, such as passwords, are never in history.

```ts
import type { Actions } from "@yabbistir/api";

export const actions: Actions = {
  joinRecent: {
    async run() {
      const items = await yab.history.recent(5);
      const texts = items.filter((item) => item.kind === "text" && !item.truncated).map((item) => item.text ?? "");
      if (texts.length === 0) return { none: true, message: yab.t("nothingRecent") };
      return { text: texts.join("\n") };
    },
  },
};
```

## Secrets and folders

Neither needs a permission, but both are preferences the person fills in Settings:

- A **`secret`** preference (an API key) is kept in the Keychain. Only `yab.secrets.get(id)` reads it, and it never appears in `yab.preferences`. Never log it or put it in a result.
- A **`folder`** preference holds an absolute path. `yab.files.read` and `yab.files.exists` may read inside it once the person has chosen it in Settings; a default alone grants nothing. Nothing can be written there: results are files in the work folder, and the app moves them.

## How the person sees it

- At install, from a file or a folder (and from the Store, coming in yabbistir 0.2.0), the permissions are listed and nothing happens until the person allows them. Extensions installed from a file or a folder are marked as not signed.
- Settings → Extensions shows each extension's permissions, preferences and source (Built-in, Local or Development, and Store from yabbistir 0.2.0), and has a switch that turns all third-party extensions off.
- A development extension linked with `npm run dev` asks for its permissions too: approve them in Settings → Extensions.
