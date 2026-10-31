# Security

## Reporting a problem

Report a vulnerability privately, through GitHub's private vulnerability reporting: this repository's **Security** tab, then **Report a vulnerability**. Please don't open a public issue or pull request about it.

This covers the store: the catalog and its signature, the packages, the checks and workflows of this repository, and its extensions. For the yabbistir app itself, report it the same way in the app's repository.

## How the catalog is protected

- The catalog lists each package's SHA-256 and size, and is signed with an Ed25519 key. The app accepts a catalog only if the signature verifies with one of the public keys built into it, and installs a package only if its SHA-256 matches the catalog.
- The signing key lives only in the `publish` environment, for `main`. The job that signs checks out `tools/sign.mjs` and the public keys and nothing else, and runs no npm.
- Publishing runs on `main` after a pull request is reviewed and merged ([how](docs/publishing.md#how-publishing-runs)).
- Pull requests get checks that their own code cannot change ([the checks](docs/publishing.md#the-checks)). What those checks do not cover is [stated plainly](docs/publishing.md#what-these-checks-do-not-cover).
