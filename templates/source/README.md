# {{name}}

A source extension for yabbistir. A source is a list the app shows in a column of its own in the panel. This one lists the snippets kept in its settings: ↵ pastes the one you pick, and ⌘C copies it.

## Example

Write `Thank you! | Best regards` in the extension's settings. The panel gets a *Snippets* column with two rows; pick *Best regards* and press ↵ to paste it.

## Permissions

None. The source reads only its own settings.

## Develop

```sh
npm test -- {{id}}          # run the tests (they use the fake host, not the app)
npm run dev -- {{id}}       # build, link into yabbistir and rebuild on every change
npm run build -- {{id}}     # build, check and pack dist/{{id}}-1.0.0.yabext
```
