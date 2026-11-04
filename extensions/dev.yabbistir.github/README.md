# GitHub

The pull requests and issues that wait on you, as a column in yabbistir's panel, and a way to share copied code as a gist. It works through [`gh`](https://cli.github.com), GitHub's official command-line tool, with your own `gh` login.

## The column

Each row is one open item, with a subtitle that says which group it is in and where it lives:

- `Review requested · owner/repo #123`: pull requests waiting for your review (review requested from you directly, not through a team).
- `Your pull request · owner/repo #124` (or `Your draft pull request`): your open pull requests.
- `Assigned to you · owner/repo #125`: open issues assigned to you.

The groups come in that order, each with its most recently updated item first and at most 25 items. Search filters by title and by the subtitle, so typing a repository name or `review` narrows the list.

- ↵ pastes the link: `https://github.com/owner/repo/pull/123`
- ⇧↵ pastes a Markdown link: `[owner/repo#123: Title](https://github.com/owner/repo/pull/123)`
- ⌘C copies the link.

A row can have two actions, so the short reference `owner/repo#123` is not on the row. It is an action on a link instead: copy a GitHub pull request or issue link (from the address bar, say), open the panel on it and choose *Paste short reference*.

## Share as gist

Choose *Share as gist* on copied text or code and pick *Share as secret gist* (the default: only people with the link can see it) or *Share as public gist* (listed on your GitHub profile). The extension writes the text into a file in its work folder, named `clipboard.txt` or, for code it recognizes (JSON, shell, Python, JavaScript, TypeScript, Swift, HTML, XML), `clipboard.json`, `clipboard.py` and so on, runs `gh gist create`, and returns the gist's link. ↵ pastes it, ⌘C copies it. The gist has no description, so nothing about yabbistir is published with it.

## Setup

```sh
brew install gh
gh auth login
```

Signing in always happens in Terminal. Sign in with `gh auth login`: yabbistir starts `gh` with a minimal environment, so a login that exists only as a `GH_TOKEN` or `GITHUB_TOKEN` variable in your shell is not seen, and the column says you are not signed in. When you are not signed in, the column shows *Not signed in to GitHub*; press ↵ or ⌘C on that row to copy `gh auth login`, and run it in Terminal.

## Permissions and privacy

- **exec**, limited to `gh`. The extension runs `gh search prs`, `gh search issues` and `gh gist create`, always with fixed options. The only other argument is the path of the file it just wrote in its work folder.
- **No network permission.** `gh` talks to GitHub with your own `gh` login; the extension never sees or stores a token, and it cannot reach the network itself.
- **What GitHub is asked.** Opening the panel searches GitHub for open items that name you (`@me`) as reviewer, author or assignee. Rows stay in memory for a minute, then are listed again, and are never written to disk. For that minute the last list is served without asking `gh`, even after `gh auth logout`; the column locks at the next listing. GitHub allows 30 searches a minute, three per listing.
- **A gist leaves your Mac** only when you choose the action, with exactly the text of the item you chose it on. A secret gist is not listed anywhere, but anyone with its link can read it.
- Nothing from `gh`'s output, errors included, is written to a log or shown in a message.

## Limits

- github.com only. GitHub Enterprise hosts are not listed.
- Team review requests are not included; only reviews requested from you. GitHub drops a pull request from "review requested" once you have posted a review, until you are requested again, so it can seem to go missing.
- If one or two of the three searches fail (a rate limit, say), the groups that worked are shown and the next opening asks again.
- In a Markdown link, `\ [ ] < > & * _` in the title are escaped so the link pastes as written; backticks are kept, so a `code` span in a title stays one.
- Written against `gh` 2.67; it needs `gh search` with `--json`, so keep `gh` up to date (`brew upgrade gh`).
