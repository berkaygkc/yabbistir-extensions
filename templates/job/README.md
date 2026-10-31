# {{name}}

A job extension for yabbistir. A job is an action that takes a while, so yabbistir shows it as a card with progress and a cancel button. This one works out the SHA-256 checksum of a text or code item with `shasum`.

## Example

Copy `hello`, open the actions and choose *SHA-256 checksum*: `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.

## Permissions

- **exec**: to run `shasum`, the one tool listed in the manifest. It comes with macOS, and no shell is involved.

## Develop

```sh
npm test -- {{id}}          # run the tests (the fake host answers for shasum; nothing is run)
npm run dev -- {{id}}       # build, link into yabbistir and rebuild on every change
npm run build -- {{id}}     # build, check and pack dist/{{id}}-1.0.0.yabext
```
