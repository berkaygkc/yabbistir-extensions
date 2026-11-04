# Authenticator

Your two-factor codes as a column in yabbistir's panel, computed on your Mac. You export your accounts from your authenticator app once and paste the export into the extension's settings, where it is kept in the Keychain. Each row shows a service and the account name; ↵ pastes the current code into the field you are in.

It works with any authenticator that exports its accounts:

- **otpauth:// links**, one or many: Ente Auth, Aegis's text export and many other apps write lists of these.
- **LastPass Authenticator**: its file export.
- **Google Authenticator**: the `otpauth-migration://` links in its export QR codes.
- **Aegis**: its unencrypted JSON export.
- **2FAS**: its `.2fas` backup without a password.
- **Bitwarden Authenticator**: its JSON or CSV export (a Bitwarden Password Manager JSON export works too).
- **2FAuth**: its JSON migration file.

The format is recognized on its own, and several can go into the field together, such as a few otpauth links and a Google export.

## Example

You are signing in to *ornek.dev* and it asks for a code. Open the panel and move to the *Authenticator* column, type `ornek` to find *ornek.dev* (`deniz@ornek.dev`) and press ↵: the six digits are pasted. When fewer than three seconds of the code's 30 seconds are left, the next code is pasted instead, so it does not expire on its way.

## Setup

1. Export your accounts from your authenticator app, as below.
2. Open the export and copy all of it. In yabbistir, go to Settings › Extensions › Authenticator, paste it into **Accounts** and press Save.
3. Clean up: delete the copy from yabbistir's history (select it in the panel and press ⌘⌫) unless you have the Secret Guard extension, then delete the export file, empty the Trash, and delete the file on your phone too. See [Keeping the export safe](#keeping-the-export-safe).

To add accounts later, export again: press Clear next to Accounts, paste the new export and press Save.

## Exporting your accounts

### LastPass Authenticator

1. On your phone, open LastPass Authenticator and go to Settings › Transfer accounts › **Export accounts to file**.
2. Save the file and move it to your Mac, with AirDrop for example.
3. Open it with TextEdit, then select all and copy it (⌘A, ⌘C).

The QR codes of *Export accounts to QR code* are not read; use the file.

### Google Authenticator

1. In Google Authenticator, open the menu and go to Transfer accounts › **Export accounts**, choose the accounts and tap Next. It shows one QR code, or several when you export many accounts.
2. Read the text in each QR code: it starts with `otpauth-migration://offline?data=`. Any QR reader that shows the text instead of opening it works. On the Mac, take a screenshot or a photo of each code (Google Authenticator may block screenshots; a photo from another device works), then read them all in Terminal with [zbar](https://github.com/mchehab/zbar):

   ```sh
   brew install zbar
   zbarimg --raw -q code1.jpg code2.jpg
   ```

3. Copy every line it prints, all the codes together. They can be on separate lines or separated by spaces.
4. Delete the photos or screenshots afterwards, from your phone too.

### Aegis

1. In Aegis, go to Settings › Import & Export › **Export**.
2. Choose *Aegis (.JSON)* or *Text file (.TXT)*, and turn off *Encrypt the vault*.
3. Move the file to your Mac, open it with TextEdit and copy all of it.

### 2FAS

1. In 2FAS, go to Settings › 2FAS Backup › **Export**.
2. Turn off the password option and tap *Export to file*.
3. Move the `.2fas` file to your Mac, open it with TextEdit and copy all of it.

### Bitwarden Authenticator

1. In Bitwarden Authenticator, go to Settings › **Export** and choose `.json` (or `.csv`).
2. Move the file to your Mac, open it with TextEdit and copy all of it.

Only codes stored in the Authenticator app are in its export. Codes kept in your Bitwarden vault come with a vault export instead, which must be unencrypted (a *.json* export, not *.json (Encrypted)*).

### Ente Auth, 2FAuth and other apps

- **Ente Auth:** Settings › Data › Export, and choose the plain-text option rather than *Encrypted*.
- **2FAuth:** select the accounts in *Manage* mode and choose Export: the JSON file works as it is.
- **Any other app:** an export that holds `otpauth://totp/…` links works, one link per line or separated by spaces.

An encrypted export of any of these is recognized, and the column asks you to export again without a password.

## Keeping the export safe

- **An export holds every seed in plain text.** Anyone with the file can make your codes. Delete it as soon as it is in Settings, empty the Trash, and delete it on your phone and from any cloud folder or chat it passed through.
- **Copying it puts it on the clipboard, and so in yabbistir's history.** Delete that item right after you paste: select it in the panel and press ⌘⌫. With the **Secret Guard** extension installed, otpauth links and authenticator exports are kept out of the history in the first place.
- **In Settings, the export is kept in the Keychain** and never shown again: the field only says *Saved*.

### The trade-off

A second factor is worth most when it lives apart from your passwords: on a phone, while the passwords are on the Mac. Keeping the seeds on the same Mac as your passwords weakens that separation: someone who gets into your Mac while it is unlocked could get both. It trades some safety for convenience; make that trade knowingly, and keep your phone's authenticator as well.

## Limits

- **Time-based codes only (TOTP).** HOTP accounts are skipped: their counter has to be stored and moved forward on each use, and a pasted export cannot do that. Steam, mOTP and Yandex accounts are skipped too. When an export holds only accounts like these, the column says so.
- **SHA-1, SHA-256 and SHA-512**, 6 to 10 digits, any period from 1 second to an hour (most accounts use SHA-1, 6 digits and 30 seconds).
- **Codes come from your Mac's clock.** If they are refused, check that the date and time are set automatically.
- **New accounts need a new export.** The column shows what is in Settings, nothing more.
- **Rows are sorted alphabetically** by service, then by account name.

## Permissions and privacy

- **No permissions.** The extension does not reach the network, run programs, see your copies or read your history. It only reads its own *Accounts* setting.
- **Codes are never stored or shown.** A code is computed when you press ↵ and pasted, never written to yabbistir's history, the extension's storage, a file, a log or an error message. yabbistir pastes it as one item for this Mac only, marked so that clipboard managers (its own history included) skip it, and gives your clipboard back a moment later. When it cannot paste, without Accessibility access for example, it leaves the code on the clipboard for 30 seconds and says so.
- **Rows show only names.** A row has the service and the account name from your export; its id is the export's own id for the account, or a hash of those two names, never anything made from a seed.
- **The export is read, never kept.** yabbistir keeps it in the Keychain and hands it only to this extension, which reads it each time the panel opens or you press ↵ and keeps nothing from it between calls: no rows, no seeds, no codes.

Because it pastes secrets, the extension is marked sensitive. Before you install it, yabbistir tells you it "Can read and paste secrets such as passwords. They’re never written to history or disk."
