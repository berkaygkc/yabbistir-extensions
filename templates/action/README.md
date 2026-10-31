# {{name}}

An action extension for yabbistir. It adds **Reverse text** to the actions of a text or code item and puts the reversed text on the clipboard.

## Example

Copy `hello`, open the actions and choose *Reverse text*: `olleh`.

## Permissions

None. The extension only works on the item it is given.

## Develop

```sh
npm test -- {{id}}          # run the tests (they use the fake host, not the app)
npm run dev -- {{id}}       # build, link into yabbistir and rebuild on every change
npm run build -- {{id}}     # build, check and pack dist/{{id}}-1.0.0.yabext
```
