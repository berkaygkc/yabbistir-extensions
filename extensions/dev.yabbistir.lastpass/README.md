# LastPass

Your LastPass entries as a column in yabbistir's panel, through [lpass](https://github.com/lastpass/lastpass-cli), LastPass's command-line tool. Each row shows a site's name and its username; folders and secure notes are left out. ↵ pastes the password, ⇧↵ pastes the username, and ⌘C copies the username.

## Example

Click into a login form's password field, open the panel and move to the *LastPass* column. Type `ornek` to find *ornek.dev* (`deniz.k`) and press ↵: the password is pasted, and your clipboard comes back a moment later.

## Setup

Install lpass, then log in once in Terminal:

```sh
brew install lastpass-cli
lpass login --trust <email>
```

Logging in always happens in Terminal: lpass asks for your master password there, and for a second factor if your account has one. The extension never asks for either.

lpass 1.6.2 or later is needed, since older versions can no longer connect to LastPass. When the column says *lpass needs an update*, press ↵ or ⌘C on that row to copy `brew upgrade lastpass-cli`, and run it in Terminal.

## Staying unlocked

After you log in, lpass keeps your vault unlocked in a background agent for a while. When the agent stops, the column shows *LastPass is locked* with the login command: press ↵ or ⌘C to copy it, and run it in Terminal.

To stay unlocked longer, set the agent's timeout, in seconds, in `~/.lpass/env`. For eight hours, add this line:

```sh
LPASS_AGENT_TIMEOUT=28800
```

## New entries

The extension runs lpass with `--sync=no`: it lists and reads lpass's local copy of your vault and does not sync on the way, which keeps the panel quick. The one exception is right after you log in again: `lpass logout` deletes that copy and `lpass login` does not fetch it, so when the local copy is missing the extension asks lpass to fetch it once. An entry you add or change elsewhere shows up after lpass syncs; run `lpass sync` in Terminal to get it now. The column also reuses its list for up to five minutes.

## Not supported

Accounts that log in with a FIDO2 security key, or through single sign-on (SSO): lpass cannot log in to them, so this extension cannot list them.

## Permissions and privacy

- **exec**, limited to `lpass`. The extension runs `lpass --version`, `lpass status -q`, `lpass ls` and `lpass show`, always with fixed options. The only other argument is an entry's id, which must be a number before it reaches lpass. It never uses lpass's own clipboard option, and it asks for no network permission.
- **lpass can read your whole vault** once you are logged in. For the list, the extension reads each entry's name, username and URL; the URL only to leave out folders and secure notes, and it is never kept or shown. It reads one entry's password or username when you press ↵, ⇧↵ or ⌘C on its row.
- **Passwords are never stored or shown.** Not in yabbistir's history, not in the extension's storage or a file, not in a log and not in an error message. yabbistir pastes a password as one item for this Mac only, marked so that clipboard managers (its own history included) skip it, and gives your clipboard back a moment later. When it cannot paste, without Accessibility access for example, it leaves the password on the clipboard for 30 seconds and says so.
- **An empty password is never pasted.** When lpass cannot decrypt an entry, it prints an empty field; the extension says so instead.
- **The list stays in memory only.** The extension reuses its list for up to five minutes, and yabbistir keeps the rows in memory until the Mac locks or sleeps, LastPass locks, or the app quits. They never reach yabbistir's history, its search index or the disk.

Because it can paste secrets, the extension is marked sensitive. Before you install it, yabbistir tells you it "Can read and paste secrets such as passwords. They’re never written to history or disk."
