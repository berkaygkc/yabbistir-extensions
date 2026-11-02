# Sources

A **source** is a list the app shows in a column of its own in the panel, next to the history's categories: saved snippets, a team's canned replies, the entries of a password vault. The extension lists the rows; the app draws the column, searches it, and runs one of the source's actions on the row the person picks, which usually pastes a value.

- ↵ on a row runs the source's first action, and ⇧↵ its second.
- ⌘C runs the first `text` action that has a `copyTitle`: it copies the value and shows that action's `copied` notice. A source without one has no ⌘C.
- Search filters the rows by title and subtitle, the way it filters the history.
- Rows live in the app's memory only. They never enter the history, the search index or the disk. The app forgets them when the Mac locks or sleeps, when the source answers that it is locked, when the extension is removed or turned off, and when the app quits.
- A value the app pastes or copies never enters the history either.

`npm run new -- <id> --template source` makes a working source that lists snippets from its settings.

## The manifest

A source with a secret action and a text action, as a password vault would have:

```json
{
  "permissions": ["exec"],
  "requires": { "tools": [{ "name": "vault-cli", "install": "brew install vault-cli" }] },
  "contributes": {
    "sources": [
      {
        "id": "vault",
        "title": "vault.title",
        "sensitive": true,
        "actions": [
          { "id": "password", "kind": "secret", "title": "password.title", "label": "password.label" },
          { "id": "username", "kind": "text", "title": "username.title", "label": "username.label",
            "copyTitle": "username.copyTitle", "copied": "username.copied" }
        ]
      }
    ]
  }
}
```

```json
{
  "vault.title": "Vault",
  "password.title": "Paste password",
  "password.label": "Password",
  "username.title": "Paste username",
  "username.label": "Username",
  "username.copyTitle": "Copy username",
  "username.copied": "Username copied."
}
```

- `id` is the key of `sources` in `src/index.ts`; `title` is the column's name.
- `actions` holds one or two: ↵ runs the first, ⇧↵ the second. An action's `title` is its label for ↵, ⇧↵ and ⌘K ("Paste password"); its `label` is the value's short name on the panel's bar and in the row's preview ("Password").
- `kind` says what `run` returns for the action: `{ text }` for `"text"`, `{ secret }` for `"secret"`. A secret is pasted and never kept; see [Secrets](#secrets).
- `copyTitle` and `copied` belong to `text` actions only: the ⌘C row's title and the notice after it.
- `"sensitive": true` marks a source whose values are secrets. A `secret` action needs it. Before install, the person reads: "Can read and paste secrets such as passwords. They’re never written to history or disk."

Every field is in the [manifest reference](manifest.md#contributessources).

## `list` and `run`

`src/index.ts` exports `sources`, keyed by each source's `id`, each with a `list` and a `run`:

```ts
import type { SourceRow, Sources } from "@yabbistir/api";

/** One row per line of `vault-cli list`: id, name and user name, separated by tabs. */
function rowsOf(output: string): SourceRow[] {
  return output.split("\n").filter((line) => line !== "").map((line) => {
    const [id = "", title = "", user = ""] = line.split("\t");
    return { id, title, subtitle: user || undefined };
  });
}

export const sources: Sources = {
  vault: {
    async list(ctx) {
      const result = await yab.exec("vault-cli", ["list", "--format=tsv"], { signal: ctx.signal });
      if (result.exitCode !== 0) throw new Error(yab.t("listFailed"));
      return { rows: rowsOf(result.stdout) };
    },
    async run(rowId, actionId, ctx) {
      const field = actionId === "password" ? "--password" : "--username";
      const result = await yab.exec("vault-cli", ["show", field, "--", rowId], { signal: ctx.signal });
      if (result.exitCode !== 0) throw new Error(yab.t("showFailed"));
      const value = result.stdout.replace(/\n$/, "");
      if (value.trim() === "") throw new Error(yab.t(actionId === "password" ? "noPassword" : "noUsername"));
      return actionId === "password" ? { secret: value } : { text: value };
    },
  },
};
```

**`list(ctx)`** returns `{ rows }`. The app calls it each time the panel opens. It shows the rows it already holds at once, or "Loading…" the first time, and swaps the new rows in quietly when they come, keeping the person's selection on the same row.

- `id`: a non-empty string of at most 256 characters, its own to each row, and the same each time the row is listed. It comes back to `run` exactly as listed: it is never cleaned or cut.
- `title`: the row's first line. `subtitle`, optional: a quieter second line, such as a user name.
- Tabs and line ends in `title` and `subtitle` become spaces, the ends are trimmed, and each is cut to 256 characters. A title that is empty after that fails the listing; an empty subtitle is none.
- A row that breaks a rule, or an id that an earlier row already has, fails the whole listing with `badResult`. When `list` fails, the app keeps the rows it had; with none, the column shows one calm line saying the list could not be read.

**`run(rowId, actionId, ctx)`** gets a row's `id` and the `id` of one of the source's actions, and returns `{ secret }` or `{ text }`, as the action's `kind` says.

- The string is used exactly as given: trim a tool's trailing newline yourself.
- An empty or whitespace-only value is a `badResult`, and nothing is pasted or copied. When a row has no value for an action, throw an error that says so, as above.
- A `run` that throws shows a notice with the extension's name and the error's message, so write the message for people, with `yab.t`.

**Both** get no item, and run as the person's own calls: `yab.exec` and `yab.http` work as far as the permissions allow, and so do `yab.notify`, `yab.open`, `yab.ai` and `yab.translate`. `yab.history` rejects with `permissionDenied`. `ctx.trigger` is `"source"`, `ctx.variant` and `ctx.target` are `null`, and `ctx.signal` aborts when the call is cancelled or runs out of time: pass it to `yab.exec` so the tool stops too.

## Locked sources

A source that needs the person to unlock it first, such as a vault behind a sign-in, answers `locked` instead of rows:

```ts
import type { SourceListing } from "@yabbistir/api";

export function lockedListing(): SourceListing {
  return { locked: true, message: yab.t("locked"), command: "vault-cli login" };
}
```

- The app drops the rows it held at once, and shows one calm row with `message`, which is required.
- `command`, optional, is a line the person runs in a terminal to unlock the source. ↵ or ⌘C on the locked row copies it.
- Both are cleaned like a title and cut to 200 characters. A line end becomes a space, so pasting the command never runs it; a blank command is none.
- `locked: true` wins over any `rows` sent with it.

## Secrets

A `secret` action returns something that must not be kept or seen: a password, a token, a recovery code. The rules, which `npm run validate` checks:

- A `secret` action belongs to a `sensitive` source ([`sourceSecretNeedsSensitive`](errors.md#sourcesecretneedssensitive)).
- An extension with a `secret` action cannot ask for `network` ([`sourceSecretWithNetwork`](errors.md#sourcesecretwithnetwork)): the extension itself has no way to send a secret anywhere.
- A `secret` action has no `copyTitle` or `copied` ([`sourceCopyNeedsText`](errors.md#sourcecopyneedstext)): ⌘C never copies a secret.

The app pastes a secret as one item for this Mac only, marked so that clipboard managers, its own history included, skip it, and gives the clipboard back a moment after the paste. When it cannot paste, without Accessibility access for example, it leaves the secret on the clipboard for 30 seconds and says so.

The rest is the extension's to keep:

- **Never log a row or a value.** `console.*` lines go to the Development log, which a person may share when asking for help.
- **Never put a value, a row or a tool's output in an error message.** Messages reach notices and the log. Say what failed in your own words, with `yab.t`, and leave `stdout` and `stderr` out.
- **Never keep a value.** Not in `yab.storage`, not in a file, not in a module variable: a value lives for its `run` call only.

## Caching

`list` runs each time the panel opens. When the tool behind it is slow, keep the last rows for a short while:

- Only in a module variable, with a lifetime of a few minutes. A module variable lives in the helper's memory until the app quits or the extension changes.
- Drop it when the source answers `locked`, so rows never outlive a lock.
- Never write rows to `yab.storage` or a file: both are kept on disk. Never cache values.

```ts
import type { SourceRow, Sources } from "@yabbistir/api";

const LIFETIME = 5 * 60_000;
let cached: { at: number; rows: SourceRow[] } | undefined;

async function readRows(signal: AbortSignal): Promise<SourceRow[]> {
  const result = await yab.exec("vault-cli", ["list", "--format=tsv"], { signal });
  if (result.exitCode !== 0) throw new Error(yab.t("listFailed"));
  return result.stdout.split("\n").filter((line) => line !== "").map((line) => {
    const [id = "", title = ""] = line.split("\t");
    return { id, title };
  });
}

export const sources: Sources = {
  vault: {
    async list(ctx) {
      const status = await yab.exec("vault-cli", ["status"], { signal: ctx.signal });
      if (status.exitCode !== 0) {
        cached = undefined;
        return { locked: true, message: yab.t("locked"), command: "vault-cli login" };
      }
      if (cached === undefined || Date.now() - cached.at > LIFETIME) cached = { at: Date.now(), rows: await readRows(ctx.signal) };
      return { rows: cached.rows };
    },
    async run(rowId, actionId, ctx) {
      const result = await yab.exec("vault-cli", ["show", "--password", "--", rowId], { signal: ctx.signal });
      if (result.exitCode !== 0) throw new Error(yab.t("showFailed"));
      const secret = result.stdout.replace(/\n$/, "");
      if (secret.trim() === "") throw new Error(yab.t("noPassword"));
      return { secret };
    },
  },
};
```

## Limits

| What | Limit |
|---|---|
| Rows in a listing | 10,000; the rest are dropped, with one line in the Development log |
| A row's `id` | 256 characters; a longer one fails the listing |
| A row's `title` and `subtitle` | cut to 256 characters, on one line |
| A locked listing's `message` and `command` | cut to 200 characters, on one line |
| `list` and `run` | 10 seconds each; then the call is cancelled and its `ctx.signal` aborts |

Characters are counted as a person sees them: an accented letter or an emoji is one. A source's failures never count toward [turning the extension off](errors.md#turned-off-after-repeated-errors), a timeout included.

## Testing

The fake host calls a source the way the app does and holds its answers to the same rules. Pass the extension's `sources` export to `createFakeHost`, then use `host.list(sourceId)` and `host.runSource(sourceId, rowId, actionId)`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";
import { sources } from "../src/index.ts";

const folder = new URL("..", import.meta.url);

test("pastesThePassword", async () => {
  const host = createFakeHost({ folder, sources, exec: { "vault-cli": (args) => ({ exitCode: 0, stdout: `s3cret-for-${args.at(-1)}\n`, stderr: "" }) } });
  assert.deepEqual(await host.runSource("vault", "42", "password"), { secret: "s3cret-for-42" });
  assert.deepEqual(host.logs, [], "no console line and no note: nothing a log would show");
});
```

`host.list` resolves to the rows as the app keeps them, cleaned and cut, or to the locked state; `host.runSource` to `{ secret }` or `{ text }`. Any other answer rejects with `badResult` and the app's reason. See [Testing](testing.md#sources).
