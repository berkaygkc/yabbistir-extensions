# Link Cleaner

Strips tracking parameters from the links you copy, as they are captured. A link such as `https://example.com/p?id=7&utm_source=mail&fbclid=1` is stored as `https://example.com/p?id=7`.

- Removes `utm_*` and well-known click and campaign identifiers on every site.
- Removes a few share tokens on the sites that add them (for example `si` and `feature` on video links).
- Keeps every other parameter, the fragment and the rest of the address. A link with nothing to remove is left alone.
- Works on a copied link, or on text that is one address and nothing else. Other text never reaches the extension.

## Permissions

- **capture**: to rewrite an item before it enters your history. The extension does not read the clipboard at any other time and has no network access.
