# Jira

Your open Jira issues as a column in yabbistir's panel, and two actions for copied text: paste an issue key as a link, or turn a copied error into a new issue. Jira Cloud only, signed in with your email and an API token.

- **The *Jira* column** lists the issues assigned to you that are not done, the most recently updated first: up to 50, each as *ENG-42 Fix the login button*, with its status and project beneath. ↵ pastes the issue's link, ⇧↵ a Markdown link (`[ENG-42: Fix the login button](https://yourteam.atlassian.net/browse/ENG-42)`), and ⌘C copies the link.
- **Paste as Jira link**, on a copied issue key such as `ENG-42`, pastes `https://yourteam.atlassian.net/browse/ENG-42`. The row shows the link before you pick it.
- **Create Jira issue from this**, on copied text, makes a new issue in your project and pastes its link.

## Example

A teammate posts a stack trace in a chat. Copy it, open the panel, press ⇧ and pick *Create Jira issue from this*. Jira gets a new Task in your project:

- **Summary:** the first line with words in it, here `TypeError: Cannot read properties of undefined (reading 'id')`.
- **Description:** the whole trace in a code block.

The new issue's link, such as `https://yourteam.atlassian.net/browse/ENG-101`, is pasted back into the chat.

Copied prose (a bug report, meeting notes) becomes paragraphs instead, with its line breaks kept. A single line that fits in the summary makes an issue with no description.

## Setup

1. Make an API token at [id.atlassian.com › Security › API tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Choose **Create API token**, not *Create API token with scopes*: a scoped token works only through Atlassian's API gateway, which this extension does not reach. Tokens expire after 1 to 365 days; you pick when.
2. In yabbistir, open Settings → Extensions → Jira and fill in:
   - **Site:** your Jira Cloud address, such as `yourteam.atlassian.net`. `https://` and a link into the site, such as one copied from the browser, work too.
   - **Email:** the email you sign in to Jira with.
   - **API token:** the token from step 1. It is kept in the Keychain.
   - **Project key for new issues:** the key at the start of your project's issue keys, such as `ENG`. Jira now calls projects *spaces*; the key is the same.
   - **Issue type for new issues:** `Task` unless you change it, such as to `Bug`. It must be a type your project has, spelled as Jira shows it (Jira now calls these *work types*).

The column and the actions say what is missing until each part is set. Pasting an issue key as a link needs only the site.

## Permissions and privacy

- **network**, limited to `atlassian.net`. Every Jira Cloud site is `<name>.atlassian.net`, and the manifest cannot name your own, so the extension checks the Site setting itself: it must be exactly one name followed by `.atlassian.net`, without a user name or a port, and every request goes to that site over https, nowhere else. Redirects must stay inside `atlassian.net` too.
- **What is sent, and when.** Opening the panel searches your site for your open issues, at most once a minute. When Jira answers with an error, the column waits a minute before it asks again, or as long as Jira says when it limits requests. When Jira refuses your sign-in, the column does not send it again for 15 minutes, because several failed sign-ins in a row make Jira ask for a CAPTCHA; a changed site, email or token is tried at once. ⇧↵ on a row may ask your site for that issue's summary, when the column's list is more than five minutes old. *Create Jira issue from this* sends the copied text, as the new issue's summary and description, to your site when you pick it. *Paste as Jira link* sends nothing. Every request carries your email and API token, to your site only.
- **The token and the email are never written down or shown.** The token is read from the Keychain each time the column is listed, and when ⇧↵ or *Create Jira issue from this* sends a request. The email is kept in memory only, to tell one account's list from another's. Neither is written to the extension's storage, a file or a log, or put in a message. After Jira refuses a sign-in, the column keeps a short fingerprint of it in memory, which cannot be turned back into the email or the token, to know it when it comes again. Messages name your site, your project key and your issue type at most, never the copied text or Jira's own answers.
- **The column keeps nothing on disk.** Its list is reused for a minute and its summaries for five, in memory only; both are dropped when the column locks. yabbistir keeps the rows in memory until the Mac locks or sleeps, the column locks, or the app quits; they never reach yabbistir's history or the disk.

## When something goes wrong

- **Jira didn’t accept your email and API token:** check both in Settings. A token that has expired, or one made *with scopes*, is refused. Jira Cloud sometimes answers rejected credentials as if no one had asked, with an empty list; the extension reads Jira's sign-in header too, so such an answer locks the column instead of showing it empty.
- **Jira wants you to sign in on the web first:** after several failed sign-ins Jira asks for a CAPTCHA, and refuses API tokens until you sign in once in the browser. The column then tries again within 15 minutes, or at once when you change the site, email or token, or make an issue with *Create Jira issue from this*.
- **Jira is limiting requests:** the column waits as long as Jira asks (its `Retry-After`, at least a minute and at most a day) before asking again, and keeps the rows it has meanwhile.
- **Jira refused some fields for new issues:** your project requires a field this extension does not fill in (a component, a priority, a custom field), or does not take a description. Create that issue in Jira.
- **The text is too long for a Jira issue:** Jira found the description over its limit, although the extension cuts it to fit. Copy a shorter part, or create that issue in Jira.
- **A create that timed out or lost its connection** may still have made the issue in Jira. It is never sent twice by itself; look in Jira before you try again.

## Limits

- Jira Cloud only. Jira Data Center and Server sites are not on `atlassian.net`, and sign in differently.
- One page of the search: the 50 most recently updated issues. Jira's search may take a moment to show an issue you just changed.
- A summary is cut at 254 characters (Jira takes fewer than 255). A description is cut so that its document stays within 30,000 characters, under the 32,767 Jira takes. Jira counts the whole document, not the text alone: each line of prose adds a few dozen characters, and each quote or line end in a code block one more, so many short lines hold less text. When a description is cut, its end shows `…` and a notice says how many characters it holds.
- Whether copied text is code or a log is a guess from its lines: stack frames from JavaScript, Java, Python, Go, Rust, gdb, lldb and macOS crash reports, timestamped or leveled log lines, JSON, and lines that read as code. Indented lines count only beside lines that read as code, so a note with an indented or nested list stays prose. Copies yabbistir already marks as code always go into a code block.
- Terminal color codes and other control characters are left out of a new issue.
- The issue key action is offered on keys alone (`ENG-42`), not on keys inside a sentence or on links. It is also offered on look-alikes such as `UTF-8` or `SHA-256`; the row's hint shows the link it would paste.

## Sources

- Search: [Search for issues using JQL enhanced search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get) (`GET /rest/api/3/search/jql`), which replaced the removed `/rest/api/3/search` ([CHANGE-2046](https://developer.atlassian.com/changelog/#CHANGE-2046)). It returns only issue ids unless `fields` names more.
- Create: [Create issue](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post) (`POST /rest/api/3/issue`), and the [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) for the description. A description over 32,767 characters is refused with `CONTENT_LIMIT_EXCEEDED` ([JRACLOUD-78553](https://jira.atlassian.com/browse/JRACLOUD-78553)), counted on the whole document ([JRACLOUD-98152](https://jira.atlassian.com/browse/JRACLOUD-98152)).
- Sign-in: [Basic auth for REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) and [Manage API tokens](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/); rejected credentials answered with a 200: [JRACLOUD-82932](https://jira.atlassian.com/browse/JRACLOUD-82932).
- Limits: [Rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/).

The extension embeds no data from these pages.
