# Docker

Your Docker containers as a column in yabbistir's panel, through the `docker` command-line tool. Each row shows a container's name, and under it the image, the status and the published ports. ↵ pastes the name, ⇧↵ pastes `docker exec -it <name> sh`, and ⌘C copies the name.

It works with Docker Desktop, OrbStack and Colima, since each of them provides the `docker` command.

## Example

You are in a terminal and want a shell in your database. Open the panel, move to the *Containers* column, type `db` to find *ornek-db* (`postgres:16 · Up 2 hours · 5432→5432/tcp`) and press ⇧↵: `docker exec -it ornek-db sh` is pasted, ready to run. Press ↵ instead to paste just the name, for `docker logs -f` or any other command.

## Settings

- **Include stopped containers**: off by default, so the column lists running containers only. Turn it on to list stopped ones too (`docker ps --all`); their status says, for example, *Exited (0) 3 days ago*.

## Permissions and tools

- **`exec`**, to run `docker ps`. That is the only command the extension runs; it never starts, stops, removes or enters a container. The commands it pastes are for you to run.
- **`docker`**: `brew install --cask docker` installs Docker Desktop; OrbStack (`brew install --cask orbstack`) and Colima (`brew install colima docker`) provide the command too.

There is no network permission, and nothing is written to disk. The extension keeps no rows between listings.

## When Docker is not running

The column shows *Docker isn’t running* when `docker` cannot reach its engine (the app is closed, or Colima is stopped). Start it and open the panel again. The messages `docker` prints when it cannot reach the engine (*Cannot connect to the Docker daemon*, *error during connect*, a missing `docker.sock`) are what the extension recognizes; any other failure is reported as a plain error without docker's text. When the engine answers *permission denied* (your user may not use the socket, for example outside the `docker` group), the column says *Docker refused access* instead. If `docker` itself is missing, yabbistir tells you which tool to install.

## Limits

- Listing has a time limit of 10 seconds. While Docker Desktop is still starting, `docker ps` can take longer, and the list is cancelled without a row; open the panel again once Docker is up.
- A container name is limited to 128 characters; a longer one is not listed.
- The pasted exec command opens `sh`. A container without `sh` (a distroless image) needs another command.
- A container's name is its row's identity, so renaming a container shows it as a new row.
- Link aliases (`webapp/db`) are not shown; the container's own name is.
- Ports are shown without the host address, and the IPv4 and IPv6 twins are merged: `0.0.0.0:8080->80/tcp, :::8080->80/tcp` reads `8080→80/tcp`. After three ports, the rest is counted (`+2`).
- Docker's `--format '{{json .}}'` output is documented at <https://docs.docker.com/reference/cli/docker/container/ls/>.

## Develop

```sh
npm test -- dev.yabbistir.docker
npm run build -- dev.yabbistir.docker
```
