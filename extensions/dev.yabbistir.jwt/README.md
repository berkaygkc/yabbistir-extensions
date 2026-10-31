# JWT

Recognizes copied JSON Web Tokens and shows what is inside: the header, the payload and a short summary (algorithm, type, subject, issued and expiry time). An expired token is marked as such.

The token is decoded on this Mac and nothing more. **The signature is not checked**, and the preview says so. Text that is not a well-formed token (wrong shape, bad encoding, no `alg` in the header, a payload that is not an object, or longer than 16 KB) is not tagged.

## Permissions

None. The extension reads only the item it is asked about.
