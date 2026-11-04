# Bitwarden

Your Bitwarden logins in yabbistir's panel, through [bw](https://bitwarden.com/help/cli/), Bitwarden's official command-line tool. It adds two columns:

- **Bitwarden**: every login, with its name, and its username and site below. ↵ pastes the password, ⇧↵ pastes the username, and ⌘C copies the username.
- **Bitwarden codes**: the logins that have an authenticator key. ↵ pastes the current TOTP code.

A column has room for two actions, ↵ and ⇧↵, so the codes get a column of their own. Favorites come first, then the rest by name. Secure notes, cards, identities and SSH keys are left out.

## Example

Click into a login form's password field, open the panel and move to the *Bitwarden* column. Type `posta` to find *Posta* (`deniz.k · posta.ornek.dev`) and press ↵: the password is pasted, and your clipboard comes back a moment later. When the site then asks for a code, open the panel again, move to *Bitwarden codes* and press ↵ on *Posta*.

The site in a row is the host of the login's first web address, and it is left out when the login is named after it: *ornek.dev* shows only `deniz.k`.

## Setup

Install bw, then log in once in Terminal:

```sh
brew install bitwarden-cli
bw login --raw
```

bw asks for your email, your master password and, if your account has one, a second factor, then prints a **session key**. Copy it, open Settings → Extensions → Bitwarden and paste it into *Session key*. The extension never asks for your master password.

- Already logged in? Run `bw unlock --raw` instead; it prints a new key.
- You can also paste the whole `export BW_SESSION="…"` line that `bw unlock` prints without `--raw`.
- Logged in with an API key (`bw login --apikey`)? That does not unlock the vault: run `bw unlock --raw` after it.
- A self-hosted server, or Bitwarden's EU cloud, is set in bw itself, before you log in: `bw config server https://vault.example.com` (or `https://vault.bitwarden.eu`). The extension uses whatever server bw uses.

Until a key is in Settings, the column shows one row that says what to do. Press ↵ or ⌘C on it to copy the command (`bw login --raw` or `bw unlock --raw`), and run it in Terminal.

## When the session key ends

A session key works until bw locks: when you run `bw lock` or `bw logout`, and when you run `bw unlock` again, since every new key ends the ones before it. The column then says *Bitwarden is locked* and the rows go. Press ↵ or ⌘C on that row to copy `bw unlock --raw`, run it, and paste the new key in Settings.

So if you also use bw in Terminal, unlocking it there ends the key in yabbistir. Reuse yabbistir's key instead (`export BW_SESSION="<key>"`), or paste the new one in Settings.

## New items

bw keeps a local copy of your vault and does not fetch changes on its own, and the extension never syncs. An item you add or change elsewhere shows up after bw syncs: run `bw sync` in Terminal. The column also reuses its list for up to five minutes.

## Master password re-prompt

Items you protect with Bitwarden's *Master password re-prompt* are listed, and their username pastes, but their password and TOTP code never do: yabbistir cannot ask for your master password, and pasting without it would skip the check you turned on. The extension says *This item asks for your master password first* instead. Turn re-prompt off for an item to paste it from yabbistir.

## TOTP codes

bw makes TOTP codes for Bitwarden Premium accounts, and for organization items whose organization includes them; otherwise the column says *TOTP codes need Bitwarden Premium.* A code is made when you press ↵ and is valid until its window ends, usually within 30 seconds.

## Limits

- **Logins only.** Passkeys, notes, cards, identities and SSH keys are not listed.
- **Hidden passwords.** An organization can let you use an item without seeing its password. bw gives the extension neither that password nor its code, so it says there is none to paste.
- **Speed.** bw takes about a second to start. Each time the panel opens, every column runs `bw status` once to check the lock; the list itself is read again only after five minutes. A bw that takes longer than nine seconds is stopped, and the extension says so.

## Permissions and privacy

- **exec**, limited to `bw`. The extension runs `bw status`, `bw list items`, `bw get item`, `bw get username` and `bw get totp`, always with `--nointeraction --response --pretty` (never ask, answer in JSON) and `--session` with your key. The only other argument is an item's id, which must be a Bitwarden id before it reaches bw: bw would treat anything else as a search, which could find another item. It never runs `bw sync`, never uses bw's clipboard, never changes bw's server, and asks for no network permission.
- **bw can read your whole vault** once it has the key. `bw list items` prints every item in full, passwords included. The extension reads that output in memory and keeps, for each login, only its id, name, username, the host of its first web address (never the rest of the address), whether it is a favorite and whether it has an authenticator key; everything else is dropped at once. For ↵ it runs `bw get item`, which also tells whether the item asks for a re-prompt.
- **The session key** is kept by yabbistir in your Keychain, and only bw gets it. yabbistir starts programs without your shell's environment, so the key goes on bw's command line with its own `--session` option, and other programs running as you could see that line while bw runs, about a second. With the key and bw's data, the vault can be read until bw locks: run `bw lock` to end the key at any time. The key never appears in a row, a message or a log.
- **Passwords and codes are never stored or shown.** Not in yabbistir's history, not in the extension's storage or a file, not in a log and not in an error message. yabbistir pastes them as one item for this Mac only, marked so that clipboard managers (its own history included) skip it, and gives your clipboard back a moment later. When it cannot paste, without Accessibility access for example, it leaves the value on the clipboard for 30 seconds and says so.
- **An empty password is never pasted.** When an item has none, the extension says so instead.
- **The list stays in memory only.** The extension reuses its list for up to five minutes and forgets it when bw locks. yabbistir keeps the rows in memory until the Mac locks or sleeps, Bitwarden locks, or the app quits. They never reach yabbistir's history, its search index or the disk.

Because it can paste secrets, the extension is marked sensitive. Before you install it, yabbistir tells you it "Can read and paste secrets such as passwords. They’re never written to history or disk."
