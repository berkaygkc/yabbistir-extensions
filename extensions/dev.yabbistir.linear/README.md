# Linear

Your open Linear issues as a column in yabbistir's panel, a copied issue key turned into a link, and a copied error turned into a new issue.

- **The Linear column** lists the issues assigned to you that are not done, canceled or a duplicate, most recently updated first, up to 50. A row reads *ENG-123 Login button does nothing on Safari*, with *In Progress · Engineering · High* under it. ↵ pastes the issue's link, ⇧↵ pastes a Markdown link, `[ENG-123: Login button does nothing on Safari](https://linear.app/…)`, and ⌘C copies the link.
- **Paste as Linear link** is offered on a copied issue key such as `ENG-123`, and on a link to an issue in Linear. It looks the issue up and pastes the Markdown link with its title.
- **Create Linear issue from this** is offered on copied text. It makes a new issue from it in your team, pastes the new issue's link, and says *ENG-124 created in Linear.*

## Example

A test fails in Terminal. Copy what it printed:

```text
TypeError: Cannot read properties of undefined (reading 'map')
    at renderList (app.js:12:9)
    at main (app.js:40:3)
```

Click into your chat with the team, open the panel, type `linear` and pick *Create Linear issue from this*. Linear gets an issue titled *TypeError: Cannot read properties of undefined (reading 'map')*, with the whole trace in a code block as its description, and its link is pasted into the chat.

Later, someone writes "is ENG-124 fixed?". Copy `ENG-124`, open the panel, press ⇧ on the copy and pick *Paste as Linear link*: `[ENG-124: TypeError: Cannot read properties of undefined (reading 'map')](https://linear.app/…)` is pasted.

## Setup

1. In Linear, open **Settings › Account › Security & access** and create a key under **Personal API keys**. The least it needs is two permissions: **Read**, for the column, the links and finding your team, and **Create issues**, for new issues. Full access works too, but gives the key more than the extension uses. A key limited to some teams sees, and creates, issues in those teams only. If you are a member rather than an admin and can't make a key, a workspace admin has to allow it first, under **Settings › Administration › API › Member API keys**.
2. In yabbistir, open **Settings → Extensions → Linear** and paste the key into **API key**.
3. Optionally, fill in **Team key for new issues** with the key your team's issues start with, such as `ENG`. Left empty, new issues go to your team when you are in only one; when you are in several, the action asks you to choose.

Until there is a key, the column shows one row asking for it. ↵ or ⌘C on it copies `open https://linear.app/settings/account/security`, which opens Linear's API-key page when you run it in Terminal.

## How a copy becomes an issue

- **Title:** the first line that has a letter or a digit. Code fences are skipped, and a Markdown heading's `#` and a log line's time stamp are left out. When only a fence line has words, as in ```` ```Error in prod ````, the title is those words. Runs of spaces become one, and a title over 100 characters is cut at a word, with "…".
- **Description:** the whole copy, without blank lines at its ends. It goes in a code block when yabbistir took the copy for code, or when it reads as code, a log or a stack trace:
  - a single line such as `TypeError: …` or `2026-11-04 08:12:03 ERROR …`;
  - two lines that both look like code, or one of them a stack frame, a log line, a prompt such as `$ npm test`, or an indented line;
  - three lines or more, at least half of which look like code, log lines, stack frames or indented code.

  Indented list items, such as `  1. Open the panel` or `  - Press return`, count as prose. Anything else is kept as it is, and Linear reads it as Markdown. A description over 50,000 characters, its code block's fences included, is cut at a line, with a note under it saying so.
- **Everything else** is the team's default: the issue has no assignee, labels, project or priority, and starts in the team's default state.

## Permissions and privacy

- **network**, limited to `api.linear.app`, Linear's API. It is reached only when you open the panel or choose an action, and only for this:
  - Opening the panel, when the column's list is over a minute old: one request for your open issues. After a failed request the column waits a minute before asking again, or, after a rate limit, as long as Linear asks.
  - ↵, ⇧↵ or ⌘C on a row: the issue's id, to get its current link and title.
  - *Paste as Linear link*: the issue key you copied.
  - *Create Linear issue from this*: the team key from Settings (or a request for your teams, when it is empty), then the new issue's title and description, made from the copy you chose.
- **The API key** is kept in the macOS Keychain by yabbistir. The extension reads it only to make a request, sends it only to `api.linear.app`, as the request's Authorization header, and never logs it, keeps it or puts it in a message. Messages are the extension's own words; Linear's error texts are never shown.
- **Rows stay in memory.** The extension reuses its list for up to a minute, remembering only a fingerprint of the key it was made with, so a new key never shows the old key's issues. yabbistir keeps the rows in memory until the Mac locks or sleeps or the app quits; they never reach yabbistir's history, its search index or the disk. A row's link is fetched when you pick it and not kept.
- **Nothing runs on its own.** Neither action runs as a hint, so nothing is sent until you choose one.

## Limits

- The column shows at most 50 issues, and only those assigned to you.
- *Paste as Linear link* takes the whole copy as a key: two to ten capital letters and digits starting with a letter, a dash and up to six digits (`ENG-123`), or a `https://linear.app/<workspace>/issue/ENG-123/…` link. A lowercase key, or one inside a sentence, is not offered.
- New issues go to one team: the one in Settings, or your only one.
- Linear allows each Linear user 2,500 requests an hour, shared by all their API keys and the other tools that use them. The column asks at most once a minute, after a failure too; when Linear limits you anyway, it waits until Linear takes requests again (three minutes when Linear doesn't say), and its message says when to try again.
- If creating an issue times out or is cancelled, Linear may have made it all the same: check Linear before trying again, or there will be two.
- Telling code from prose is a guess from the copy's first 300 lines. A message with one stack frame in a paragraph stays prose.
- The 50,000-character limit on a description is the extension's own, to keep requests small; Linear documents none.
- A code block's fence is longer than any run of backticks in the copy, up to 32 of them, so only a copy with 32 or more backticks in a row can end its code block early.

## Sources

- Linear's GraphQL API: [authentication, queries and errors](https://linear.app/developers/graphql), [rate limiting](https://linear.app/developers/rate-limiting), [pagination](https://linear.app/developers/pagination) and [filtering](https://linear.app/developers/filtering).
- Personal API keys, their permissions and the admin setting for member keys: Linear's [API and webhooks](https://linear.app/docs/api-and-webhooks) page.
- The error types for a plan's limits (`usage limit exceeded`, `feature not accessible`): Linear's SDK, [`error.ts`](https://github.com/linear/linear/blob/master/packages/sdk/src/error.ts).
- Field names, filters and the workflow state types (`completed`, `canceled`, `duplicate`): Linear's public [GraphQL schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql).
