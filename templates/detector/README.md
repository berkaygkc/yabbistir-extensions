# {{name}}

A detector extension for yabbistir. It puts a tag on copied text that is an issue key such as `ABC-123` and adds a preview block that splits the key into its project and number.

## Example

Copy `ABC-123`: the item gets the *ticket* tag, and its preview shows *Project: ABC* and *Number: 123*.

## Permissions

None. A detector reads only the item it is asked about.

## Develop

```sh
npm test -- {{id}}          # run the tests (they use the fake host, not the app)
npm run dev -- {{id}}       # build, link into yabbistir and rebuild on every change
npm run build -- {{id}}     # build, check and pack dist/{{id}}-1.0.0.yabext
```
