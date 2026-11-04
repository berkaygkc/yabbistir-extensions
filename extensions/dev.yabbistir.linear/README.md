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

1. In Linear, open **Settings › Security & access** and create a key under **Personal API keys**. The column and the links need it to read issues, and new issues need it to write them: give it full access, or read and write access if you pick its permissions. A key limited to some teams sees, and creates, issues in those teams only.
2. In yabbistir, open **Settings → Extensions → Linear** and paste the key into **API key**.
3. Optionally, fill in **Team key for new issues** with the key your team's issues start with, such as `ENG`. Left empty, new issues go to your team when you are in only one; when you are in several, the action asks you to choose.

Until there is a key, the column shows one row that says where to make one. ↵ or ⌘C on it copies `open https://linear.app/settings/account/security`, which opens that page when you run it in Terminal.

## How a copy becomes an issue

- **Title:** the first line that has a letter or a digit. Code fences are skipped, and a Markdown heading's `#` and a log line's time stamp are left out. Runs of spaces become one, and a title over 100 characters is cut at a word, with "…".
- **Description:** the whole copy, without blank lines at its ends. It goes in a code block when yabbistir took the copy for code, or when it reads as code, a log or a stack trace: a single line such as `TypeError: …` or `2026-11-04 08:12:03 ERROR …`, or a copy at least half of whose lines look like code, log lines or stack frames. Anything else is kept as it is, and Linear reads it as Markdown. A copy over 50,000 characters is cut at a line, with a note under it saying so.
- **Everything else** is the team's default: the issue has no assignee, labels, project or priority, and starts in the team's default state.

## Permissions and privacy

- **network**, limited to `api.linear.app`, Linear's API. It is reached only when you open the panel or choose an action, and only for this:
  - Opening the panel, when the column's list is over a minute old: one request for your open issues.
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
- Linear allows a personal API key 2,500 requests an hour. The column asks at most once a minute; when Linear limits the key anyway, the message says when to try again.
- Telling code from prose is a guess from the copy's first 300 lines. A message with one stack frame in a paragraph stays prose.
- The 50,000-character limit on a description is the extension's own, to keep requests small; Linear documents none.

## Sources

- Linear's GraphQL API: [authentication, queries and errors](https://linear.app/developers/graphql), [rate limiting](https://linear.app/developers/rate-limiting), [pagination](https://linear.app/developers/pagination) and [filtering](https://linear.app/developers/filtering).
- Field names, filters and the workflow state types (`completed`, `canceled`, `duplicate`): Linear's public [GraphQL schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql).
