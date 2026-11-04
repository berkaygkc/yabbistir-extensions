# Link Tools

Shows where a short link really goes before you open or paste it, and makes short links when you need one.

- **Expand short link**: on a link from a known shortener, returns the destination as text, so ↵ pastes the real address. It follows up to 5 hops while the next hop is still a shortener.
- **Shorten with is.gd**: on any web link, returns a short `https://is.gd/…` link.
- **Short link** tag: a small chip on links from a known shortener, so the expand action is easy to find. The detector makes no network request.

## Example

Copy `https://is.gd/Ab12`, choose *Expand short link*: `https://example.org/article?id=7` is what ↵ pastes.
Copy `https://example.org/a/very/long/address`, choose *Shorten with is.gd*: `https://is.gd/Q7xK2m`.

## Known shorteners

bit.ly, t.co, tinyurl.com, ow.ly, buff.ly, lnkd.in, is.gd, v.gd, rebrand.ly, cutt.ly, rb.gy, t.ly, tiny.cc, shorturl.at, s.id, amzn.to, fb.me, ift.tt, bit.do, wp.me (and their subdomains).

## Permission: network

Only these hosts, the list above, are reachable. Reasons:

- Expanding asks the short link's own service where it goes. The short link is the only thing sent.
- Shortening sends the link you chose to `is.gd`, which is what the action is for. Never run it on a link that contains a secret: is.gd keeps the link.
- Nothing else is sent, and nothing is stored or logged. Error messages never contain the link.

## Setup

None. No tools to install.

## Limits

- **Redirects.** yabbistir keeps requests inside the extension's hosts, and its request API has no option to stop at a redirect. So how well *Expand* works depends on the service:
  - **is.gd and v.gd** are expanded with their documented lookup API (`forward.php`), which always works.
  - **Other shorteners** are read by asking for the short link and reading the `Location` header of the answer. If yabbistir follows the redirect itself and the destination is outside the list (which it must refuse), the action says so instead of guessing; it never shows a destination it did not read. This path is tested with fixtures only: the docs do not say whether the app hands back the redirect answer, so try it with your own short link (see CHANGELOG for updates).
- Only `http` and `https` destinations are returned. A destination that is anything else is refused.
- More than 5 shortener hops, or a loop, ends with a message.
- Expanding does not check whether the destination is safe.
- is.gd limits how often it can be called; a busy answer says "try again in a minute".

## Sources

- is.gd create API: https://is.gd/apishorteningreference.php
- is.gd lookup API: https://is.gd/apilookupreference.php
