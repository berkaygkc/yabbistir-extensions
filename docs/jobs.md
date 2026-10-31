# Jobs

A **job** is an action that takes a while: a download, a conversion, a summary of a long text. Add `"job": true` to the action in the manifest. The panel closes as soon as the person picks it, and a card under the menu bar icon shows the job's progress, with a button to cancel it. A job has no time limit; an action without `job` has 10 seconds.

```json
{ "id": "compress", "title": "compress.title", "keywords": "compress.keywords", "input": "item",
  "accepts": { "kinds": ["text", "code"] }, "output": "file", "job": true, "verb": "compress.verb", "failTitle": "compress.failed" }
```

- `verb` is the label in the ⇧ panel: "↵ Compress · ⌘C Compress and copy". Without it, a job says "Start".
- `failTitle` titles the card when the job fails: "Couldn't compress". A variant can have its own.
- At most three jobs run at once; more wait on the card as "Queued". Quitting the app cancels them.

## Progress

`yab.job.progress(fraction, message)` updates the card:

- With a `fraction` from 0 to 1, the card shows a bar and the message as numbers: `"18.4 / 43.7 MB · 1 min left"`.
- With `null`, the card shows an indeterminate bar and the message as a state word: `"Connecting"`, `"Merging"`.

Report when something changes, not on every line a program prints: once per whole percent, or twice a second at most, and state words when the phase changes. The card redraws calmly that way. Any other value for `fraction` throws `badResult`.

## Cancelling

When the person cancels, `ctx.signal` aborts, and every pending `yab` promise rejects with the code `cancelled`. Pass `ctx.signal` on to `yab.exec` and `yab.http.fetch` so the program or the download stops too, and let the `cancelled` error through: do not catch it and carry on. Whatever `run` returns after a cancel is dropped.

```ts
import type { Actions } from "@yabbistir/api";

export const actions: Actions = {
  compress: {
    async run(item, ctx) {
      const text = item?.text ?? "";
      if (text === "") return { none: true, message: yab.t("empty") };
      yab.job.progress(null, yab.t("compressing"));
      const input = yab.files.write("text.txt", text);
      // gzip -k writes text.txt.gz next to text.txt, in the work folder.
      const result = await yab.exec("gzip", ["-k", "-9", "--", input], { signal: ctx.signal });
      if (result.exitCode !== 0) throw new Error(yab.t("failed"));
      yab.job.progress(1, yab.t("done"));
      return { file: `${input}.gz` };
    },
  },
};
```

That job needs `"permissions": ["exec"]` and `"requires": { "tools": [{ "name": "gzip", "install": "It comes with macOS." }] }`.

A long loop of your own checks the signal now and then:

```ts snippet
for (const [index, line] of lines.entries()) {
  ctx.signal.throwIfAborted();
  out.push(convert(line));
  if (index % 1000 === 0) yab.job.progress(index / lines.length, yab.t("lines", { done: index, total: lines.length }));
}
```

## When it ends

- **Done:** if the app the job started for is still in front, the result is pasted. Otherwise it goes to the clipboard and the card says "Ready, ⌘V to paste". A file for Finder lands in the open folder ("Saved to Finder"). With the Stack open, the result joins the Stack. Every result joins history. If the person started it with ⌘C, the result goes to the clipboard.
- **Failed:** the card shows `failTitle` (or the action's title) and why. An `Error` you throw yourself shows its message, so write it for people, with `yab.t`. An error with a `yab` code shows the app's own wording: `networkError` "Couldn't connect", `toolMissing` "<tool> isn't installed", `permissionDenied` "Not allowed", `unavailable` "The extension isn't available right now", and the rest "Couldn't finish". To say something more specific, catch the error, and throw your own message, but never for `cancelled`:

```ts snippet
try {
  response = await yab.http.fetch(url, { signal: ctx.signal });
} catch (error) {
  if ((error as YabError).code === "cancelled") throw error;
  throw new Error(yab.t("serviceDown"));
}
```

A thrown error does not count against the extension in a job; only a broken result does (see [errors](errors.md#turned-off-after-repeated-errors)).

## Testing a job

The fake host records each progress report in `host.progress`, answers `yab.exec` from a table, and `host.cancel()` cancels like the card's button. See [Testing](testing.md#jobs-and-programs).

```js
const host = createFakeHost({ folder, exec: { gzip: (args, { host, workDir }) => {
  host.files.set(`${workDir}/text.txt.gz`, new Uint8Array([0x1f, 0x8b]));
  return { exitCode: 0, stdout: "", stderr: "" };
} } });
const result = await host.run(actions.compress, { text: "hello" });
assert.match(result.file, /text\.txt\.gz$/);
assert.deepEqual(host.progress.map((entry) => entry.fraction), [null, 1]);
```

The [job template](../templates/job) (`npm run new -- <id> --template job`) and [Download with yt-dlp](recipes/download-with-yt-dlp.md) are complete jobs.
