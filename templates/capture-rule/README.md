# {{name}}

A capture rule extension for yabbistir. A capture rule looks at every new copy before it is stored. This one removes the full stop, comma or bracket that sticks to a link copied out of a sentence.

## Example

Copy `https://example.com/a).` from a message: `https://example.com/a` is stored.

## Permissions

- **capture**: a rule must be allowed to read and change new copies. It sees text and links only, and it can never reach the network.

## Develop

```sh
npm test -- {{id}}          # run the tests (they use the fake host, not the app)
npm run dev -- {{id}}       # build, link into yabbistir and rebuild on every change
npm run build -- {{id}}     # build, check and pack dist/{{id}}-1.0.0.yabext
```
