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
- Logged in with an API key (`bw login --apikey`) or through single sign-on (`bw login --sso`)? That does not unlock the vault: run `bw unlock --raw` after it.
- A self-hosted server, or Bitwarden's EU cloud, is set in bw itself, before you log in: `bw config server https://vault.example.com` (or `https://vault.bitwarden.eu`). The extension uses whatever server bw uses.
- yabbistir runs bw with a small environment of its own (`PATH`, `HOME`, `TMPDIR`, `USER` and `LANG`), not your shell's. So bw must keep its data in its usual place: if you moved it with `BITWARDENCLI_APPDATA_DIR`, the column says to log in even though bw in Terminal is logged in.

Until a key is in Settings, the column shows one row that says what to do. Press ↵ or ⌘C on it to copy the command (`bw login --raw` or `bw unlock --raw`), and run it in Terminal.

## How long the session key lasts

The key does not expire. It keeps working after the Mac sleeps, locks or restarts, until you run `bw lock` or `bw logout`, or run `bw unlock` again, since every new key ends the ones before it. Unlike the Bitwarden app, the column has no vault timeout: run `bw lock` when you step away, and paste a new key when you come back.

Once the key has ended, the column says *Bitwarden is locked* and the rows go. Press ↵ or ⌘C on that row to copy `bw unlock --raw`, run it, and paste the new key in Settings. So if you also use bw in Terminal, unlocking it there ends the key in yabbistir too.

## New items

bw keeps a local copy of your vault and does not fetch changes on its own, and the extension never syncs. An item you add or change elsewhere shows up after bw syncs: run `bw sync` in Terminal. The column also reuses its list for up to five minutes.

## Master password re-prompt

Items you protect with Bitwarden's *Master password re-prompt* are listed in the *Bitwarden* column, and their username pastes, but their password never does, and they are left out of *Bitwarden codes*: yabbistir cannot ask for your master password, and pasting without it would skip the check you turned on. ↵ on such an item says *This item asks for your master password first* instead. Turn re-prompt off for an item to paste it from yabbistir.

## TOTP codes

bw makes TOTP codes for Bitwarden Premium accounts, and for organization items whose organization includes them; otherwise the column says *TOTP codes need Bitwarden Premium.* A code is made when you press ↵ and is valid until its window ends, usually within 30 seconds.

## Limits

- **Logins only.** Notes, cards, identities and SSH keys are not listed. A login that holds a passkey is listed, but the passkey itself cannot be pasted, and a login with only a passkey has no password to paste.
- **Hidden passwords.** An organization can let you use an item without seeing its password. bw gives the extension neither that password nor its code, so it says there is none to paste.
- **Speed.** bw takes a second or more to start. Each time the panel opens, `bw status` runs once, shared by both columns, to check the lock; when the list is older than five minutes, `bw list items` runs instead. A TOTP code takes two bw runs, one after the other: the item first, to check for a re-prompt, then the code. A bw that takes longer than nine seconds is stopped, and the extension says so.
- **A very large vault, or a slow Mac, may not list within nine seconds.**

## Permissions and privacy

- **exec**, limited to `bw`. The extension runs `bw status`, `bw list items`, `bw get item`, `bw get username` and `bw get totp`, always with `--nointeraction --response` (never ask, answer in JSON), and with `--session` and your key, except for one `bw status` without a key, which tells whether to log in or to unlock. The only other argument is an item's id, which must be a Bitwarden id before it reaches bw: bw would treat anything else as a search, which could find another item. It never runs `bw sync`, never uses bw's clipboard, never changes bw's server, and asks for no network permission.
- **bw can read your whole vault** once it has the key. `bw list items` prints every item in full, passwords included. The extension reads that output in memory and keeps, for each login, only its id, name, username, the host of its first web address (never the rest of the address), whether it is a favorite, whether it has an authenticator key and whether it asks for a re-prompt; everything else is dropped at once. For ↵ in either column it runs `bw get item`, which tells whether the item asks for a re-prompt right now.
- **The session key** is kept by yabbistir in your Keychain, and only bw gets it. Only text shaped like a key bw makes reaches bw: a master password typed there by mistake never does. yabbistir cannot hand a program an environment variable, so the key goes on bw's command line with its own `--session` option. Each time the panel opens, and each time you paste from a Bitwarden column, the key is on that command line for as long as bw runs (a second or more; longer for a large vault). Programs running as you can read it then, and security software that records program launches may keep it in its logs. With the key and bw's data, the vault can be read until the key ends: run `bw lock` to end it at any time. The key never appears in a row, a message or a log.
- **Passwords and codes are never stored or shown.** Not in yabbistir's history, not in the extension's storage or a file, not in a log and not in an error message. yabbistir pastes them as one item for this Mac only, marked so that clipboard managers (its own history included) skip it, and gives your clipboard back a moment later. When it cannot paste, without Accessibility access for example, it leaves the value on the clipboard for 30 seconds and says so.
- **An empty password is never pasted.** When an item has none, the extension says so instead.
- **The list stays in memory only.** The extension reuses its list for up to five minutes, keeps with it a short fingerprint of the key that read it (never the key), and forgets it when bw locks. yabbistir keeps the rows in memory until the Mac locks or sleeps, Bitwarden locks, or the app quits. They never reach yabbistir's history, its search index or the disk.

Because it can paste secrets, the extension is marked sensitive. Before you install it, yabbistir tells you it "Can read and paste secrets such as passwords. They’re never written to history or disk."
