<!--
One extension folder per pull request. The checks run validate, typecheck, build and the tests, and the
review follows docs/review-checklist.md. Delete the hints in comments as you fill this in.
-->

## Extension

<!-- The id, and whether this is a new extension or a change to one. -->
`dev.yourname.tool`, new / version x.y.z

## What it does

<!-- One or two sentences: what the person copies, what they choose, what they get. -->

## Example or screenshot

<!-- An input and its result, or a screenshot of the panel, the preview or the job card. -->

## Permissions

<!-- Every permission the manifest asks for, each with why the extension cannot work without it. Write "None" if it asks for none.
     network: list the domains and what is sent to each.
     exec: list the tools, and say how the arguments are fixed or checked (item content after "--").
     capture / history: what is read, and why. -->

- None

## Tools to install

<!-- Programs from requires.tools, with their install commands. Write "None" if there are none. -->

- None

## Checklist

- [ ] `npm test -- <id>`, `npm run validate -- <id>`, `npm run build -- <id>` and `npm run typecheck` pass.
- [ ] I tried it in yabbistir with `npm run dev -- <id>`.
- [ ] Only `extensions/<id>/` changed, and its `version` is raised for a change.
- [ ] README.md explains what it does and every permission; CHANGELOG.md has this version.
- [ ] I went through [the review checklist](https://github.com/berkaygkc/yabbistir-extensions/blob/main/docs/review-checklist.md).
