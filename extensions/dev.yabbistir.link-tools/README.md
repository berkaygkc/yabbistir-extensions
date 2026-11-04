# Link Tools

Shows where an is.gd or v.gd short link really goes before you open or paste it, and makes short links when you need one.

- **Expand short link**: on an is.gd or v.gd link, returns the destination as text, so ↵ pastes the real address. It follows up to 5 hops while the next hop is still an is.gd or v.gd link.
- **Shorten with is.gd**: on any web link, returns a short `https://is.gd/…` link. Links that are already short, or that contain a username or password, are not sent.
- **Short link** tag: a small chip on is.gd and v.gd links, so the expand action is easy to find. The detector makes no network request.

## Example

Copy `https://is.gd/Ab12`, choose *Expand short link*: `https://example.org/article?id=7` is what ↵ pastes.
Copy `https://example.org/a/very/long/address`, choose *Shorten with is.gd*: `https://is.gd/Q7xK2m`.

## Permission: network

Only `is.gd` and `v.gd` are reachable. Reasons:

- Expanding asks is.gd or v.gd's documented lookup API where the short link goes. The short link is the only thing sent.
- Shortening sends the link you chose to `is.gd`, which is what the action is for. Never run it on a link that contains a secret: is.gd keeps the link.
- Nothing else is sent, and nothing is stored or logged. Error messages never contain the link.

## Setup

None. No tools to install.

## Limits

- **Only is.gd and v.gd.** yabbistir holds every request, redirects included, to the extension's `network.domains` and rejects a redirect that leaves the list. A shortener such as bit.ly answers with a redirect to an outside destination, so it cannot be read this way. Instead of an action that nearly always fails, Link Tools expands only the two services with a documented lookup API (`forward.php`).
- If the destination is another shortener (for example bit.ly), that address is returned as is.
- Only `http` and `https` destinations are returned. A destination that is anything else is refused.
- More than 5 hops, or a loop, ends with a message.
- Expanding does not check whether the destination is safe.
- is.gd limits how often it can be called; a busy answer says "try again in a minute".

## Sources

- is.gd create API: https://is.gd/apishorteningreference.php
- is.gd lookup API: https://is.gd/apilookupreference.php
