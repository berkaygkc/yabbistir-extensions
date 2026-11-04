# 1Password

Your 1Password logins as columns in yabbistir's panel, through [op](https://developer.1password.com/docs/cli/), 1Password's command-line tool, signed in by the 1Password app. The *1Password* column lists your Login items: each row shows the item's name, with its username and website below. ↵ pastes the password, ⇧↵ pastes the username, and ⌘C copies the username. The *1Password codes* column lists the same logins: ↵ pastes the item's current one-time code.

## Example

Click into a login form's password field, open the panel and move to the *1Password* column. Type `posta` to find *Posta* (`deniz.k@ornek.dev · posta.ornek.dev`) and press ↵: the password is pasted, and your clipboard comes back a moment later. When the site then asks for a code, open the panel again, move to *1Password codes*, find *Posta* and press ↵.

## Setup

1. Install op:

   ```sh
   brew install 1password-cli
   ```

2. Open and unlock the 1Password app, and turn on **Settings › Developer › Integrate with 1Password CLI**. Turning on Touch ID in 1Password lets you approve with your fingerprint.
3. On macOS 27, also open **System Settings › Privacy & Security › Files & Folders**, find yabbistir, and turn on the setting that starts with *Data shared by 1Password*. Without it, op answers as if the integration were off.
4. Open the *1Password* column. 1Password asks you to allow access: approve it.

op 2.30.0 or later is needed. When the column says *op needs an update*, press ↵ or ⌘C on that row to copy `brew upgrade 1password-cli`, and run it in Terminal.

The extension only works through the 1Password app: it never asks for, sees or keeps your account password, and it does not use `op signin` sessions or service account tokens.

## Approving and locking

1Password decides when to ask, not the extension. For Terminal, 1Password documents that an approval lasts until 1Password locks, through 10 minutes without use, and for 12 hours at most. Expect something like it for yabbistir: 1Password usually doesn't ask again for about 10 minutes of use, and asks again after it locks, the next time a column lists or you pick a row.

When 1Password is locked or you dismiss its prompt, the column shows *1Password is locked or didn’t allow access* and its rows go. Unlock 1Password, then open the column again. When op cannot reach the app at all (the integration is off, 1Password is not running, or macOS 27 has not allowed yabbistir), the column says where to turn the integration on. When the Mac is offline, it says so.

The extension stops op after about eight seconds, inside yabbistir's 10-second limit. If 1Password's prompt is still waiting by then, the column says that 1Password didn't answer in time: approve the prompt, then open the column again. If you unlock 1Password by typing your account password, unlock it first, then open the column: typing can take longer than the column waits.

## Settings

- **Account**: for people with more than one 1Password account. Its sign-in address, such as `my.1password.com`, or its ID, as `op account list` shows them. Leave it empty to use the account op used last.
- **Vault**: to list one vault only, by its name or ID. Leave it empty to list every vault.

## What is listed

Login items from every vault the 1Password app has for the account, or only the chosen vault; archived items are left out. Favorites come first, then the rest by name. A row's second line is the item's username and its website's host; a user name or password written into the website's link is never shown.

The extension may reuse its list for up to five minutes. Before it does, it runs `op whoami`, which never shows a prompt. When that fails (1Password has locked since, or op has not been approved for yabbistir), the rows go and the list is read again. An item you add or change in 1Password shows up within five minutes at most.

## One-time codes

A column offers the same actions on every row, and op's list does not say which items have a one-time code. So the codes are a column of their own, listing every login: ↵ on an item without a one-time password says *This item has no one-time code*.

Like every column an extension adds, both columns show when you pick them, and list as they open. In Settings › Categories you can set either to show always; then it lists each time the panel opens, and 1Password may ask for approval then. Two columns that open together share one `op item list`, and so one prompt.

## Permissions and privacy

- **exec**, limited to `op`. The extension runs `op --version`, `op whoami`, `op item list --categories Login --format json` and `op item get` with fixed options. The only other arguments are an item's id, which must be letters and digits before it reaches op, and the account and vault from Settings, each passed as one `--account=…` or `--vault=…` argument so they can never be read as another option. It never uses op's options that share, edit or copy items, and it asks for no network permission.
- **op can read every vault the 1Password app opens for it.** For the list, the extension reads each Login item's id, name, category, favorite mark, username and website, never its fields. It reads one field (`op item get --fields label=password` or `label=username`), or the current code (`op item get --otp`), only when you press ↵, ⇧↵ or ⌘C on a row. The code is the one op works out; the secret behind it never reaches the extension.
- **Passwords and codes are never stored or shown.** Not in yabbistir's history, not in the extension's storage or a file, not in a log and not in an error message. yabbistir pastes them as one item for this Mac only, marked so that clipboard managers (its own history included) skip it, and gives your clipboard back a moment later. When it cannot paste, without Accessibility access for example, it leaves the value on the clipboard for 30 seconds and says so.
- **An empty password, username or code is never pasted.** The extension says the item has none instead.
- **op's own messages never reach yours.** The extension reads op's errors only to choose one of its own messages, and never shows, logs or keeps them.
- **The list stays in memory only.** The extension reuses its list for up to five minutes, and yabbistir keeps the rows in memory until the Mac locks or sleeps, the column next finds 1Password locked, or the app quits. They never reach yabbistir's history, its search index or the disk.

Because it can paste secrets, the extension is marked sensitive. Before you install it, yabbistir tells you it "Can read and paste secrets such as passwords. They’re never written to history or disk."

## Limits

- Login items only: passwords kept as *Password*, *API Credential* or other categories are not listed.
- One account at a time: the one in Settings, or the one op used last.
- Very large vaults may not list within yabbistir's 10 seconds. Then the column says that 1Password took too long: choose one vault in Settings to list fewer.
- op's messages are in English and may change between versions. The extension recognizes a locked app, a dismissed prompt, a missing integration, the Mac being offline, an unknown vault or account, and an item without a password, username or one-time code from op's own words, never from the names op quotes in them. Any other failure says that op could not list or read, without op's own text.

## Troubleshooting

- *Open 1Password and turn on “Integrate with 1Password CLI”* although it is on: on macOS 27, allow yabbistir under System Settings › Privacy & Security › Files & Folders (*Data shared by 1Password*). Otherwise, keep 1Password running, or restart it.
- *1Password took too long to list your logins*: choose one vault in Settings.
- *1Password didn’t answer in time*: approve 1Password's prompt, or unlock 1Password first, then open the column again.
