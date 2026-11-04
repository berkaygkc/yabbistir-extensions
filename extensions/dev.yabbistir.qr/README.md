# QR Code

Two actions, both on this Mac:

- **Show as QR code** on text and links. The QR code is an image: ↵ pastes it, ⌘C copies it. Pick its size (256, 512 or 1024 pixels) in the extension's settings; the default is 512.
- **Read QR code** on images. The text of the code comes back; if the image holds several codes, one per line. If there is no code, you are told so.

Example: copy `https://example.com/menu`, pick Show as QR code, paste the image into a slide, scan it with a phone.

## Permissions

None. The code is drawn and read by the app itself (Vision on this Mac). Nothing is sent anywhere and no program is run, so there are no tools to install.

## Limits

- A QR code holds at most about 2,950 bytes of text (less for non-Latin letters, which take 2 to 4 bytes each). Longer text gets a message instead of an image.
- Wi-Fi codes (`WIFI:S:…;T:…;P:…;;`) are returned as the text they hold, with no special handling. They contain the password: treat the result like one.
- Barcodes that Vision reads are returned the same way as QR codes.

## A word on 2FA codes

A QR code that starts with `otpauth://` or `otpauth-migration://` holds a two-factor secret. Reading it works, but the text then passes through the clipboard and lands in the clipboard history. Install the Secret Guard extension to keep such items out of your history, and delete the item once you have imported it.
