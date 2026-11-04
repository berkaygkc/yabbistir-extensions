# Homebrew

[Homebrew](https://brew.sh), the Mac's package manager, from yabbistir's panel:

- **Install with Homebrew** on a copied `brew install …` command, such as the one in a project's README, or on a bare package name such as `wget`. It runs `brew install` in the background; the job card shows each step, and a short notice says what was installed.
- **Homebrew updates**, a column of its own that lists your outdated formulae and casks with their versions. ↵ pastes the command that upgrades the one you pick, ⇧↵ pastes its homepage, and ⌘C copies the command.
- **Upgrade all outdated packages**, which runs `brew upgrade` in the background, one step of the bar per package.

## Example

A README says:

```sh
brew install --cask firefox
```

Copy the line, select it in the panel and press ⇧: *Install with Homebrew* is in the list. Press ↵ and the panel closes; the job card under the menu bar icon shows *Downloading*, then *Installing firefox*, and the notice says *Installed firefox.* A `$ ` or `% ` prompt copied with the command is fine, and so is a command split over lines with `\`.

Later, open the panel and move to the *Homebrew updates* column: a row reads *node* with *22.11.0 → 23.3.0 · formula*. ↵ pastes `brew upgrade node` into Terminal; type `brew` in the panel and choose *Upgrade all outdated packages* to upgrade everything at once.

## Setup

Install Homebrew with the command from [brew.sh](https://brew.sh), in Terminal:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

brew cannot install itself, so this is the line yabbistir's Settings shows when brew is missing. Homebrew also has a `.pkg` installer on [its releases page](https://github.com/Homebrew/brew/releases/latest). Without brew, the jobs fail with *brew isn’t installed* and the column cannot list anything.

## Permissions and tools

- **exec**, limited to `brew`. The extension runs exactly these commands, with no shell:
  - `brew install -- <names>` or `brew install --cask -- <names>` for the install actions;
  - `brew outdated --json=v2` for the column, and before *Upgrade all* to know what it will upgrade;
  - `brew info --json=v2 --formula -- <name>` (or `--cask`) when you press ⇧↵ on a row, to read the homepage;
  - `brew upgrade`, with no arguments, for *Upgrade all*.
- **Only package names and `--cask` reach brew.** A copied command is read word by word: `brew install`, then names such as `wget`, `python@3.12` or `hashicorp/tap/terraform`, and `--cask` anywhere. Any other option (`--HEAD`, `--build-from-source`, `--formula`…), a path or a link (`./x.rb`, `https://…`), a file name (`x.rb`, a bottle's `.tar.gz`), quotes, `;`, `&&`, `|`, `$(…)` or a second command, and the action is not offered; if it runs anyway, it does nothing and says why. Names always go after `--`, so none can be read as an option. A row's id is the package's kind and name, checked the same way before it reaches `brew info`.
- **brew can do anything you can.** It downloads from Homebrew's servers and from wherever a formula or cask points, writes into Homebrew's folders and `/Applications`, and a name with a tap (`user/tap/name`) adds that tap from GitHub first, as it would in Terminal. That is why every argument is checked. The extension asks for no network permission of its own.
- **brew's output is read, never shown.** The job card and the notices use the extension's own words; a package's name is the only part of brew's output that reaches them, and only when it looks like a package name. Nothing is logged, and no error message repeats what brew printed.

## How brew runs here

- **It does not stop to ask.** In Terminal, `brew install` and `brew upgrade` show their plan and ask before they go ahead when dependencies are involved. brew skips that question when it is not running in a terminal, as here, so a job goes ahead as `--no-ask` would.
- **It updates itself first, sometimes.** `brew install`, `brew upgrade` and `brew outdated` run `brew update` before their work when the last one was more than a day ago (every five minutes if you set `HOMEBREW_NO_INSTALL_FROM_API`). That usually takes a few seconds; the job card says *Updating Homebrew* meanwhile. Jobs have no time limit and can be cancelled from their card, which stops brew and everything it started.
- **The column waits up to eight seconds.** A source's list gets ten seconds in all. When `brew outdated` is still updating Homebrew after eight, the column stops it and says *Homebrew is taking too long*, with `brew update` to run in Terminal (↵ or ⌘C copies it); the next panel opens quickly after that.
- **Your shell's `HOMEBREW_*` settings do not reach brew.** yabbistir runs a tool with only `PATH`, `HOME`, `TMPDIR`, `USER` and `LANG`. Put the settings you want in `~/.homebrew/brew.env` instead, one `NAME=value` per line, which brew reads itself (as it does `/etc/homebrew/brew.env` and `$(brew --prefix)/etc/homebrew/brew.env`). For example, `HOMEBREW_NO_AUTO_UPDATE=1` skips the update before every command.

## The column

- It lists what `brew outdated` lists: formulae, and casks except those that update themselves (`auto_updates`) or have no version (`latest`), which `brew outdated --greedy` would add. A pinned package shows *pinned*; *Upgrade all* leaves it as it is, as `brew upgrade` does.
- ↵ pastes the command for just that package, with `--cask` for a cask so that a formula of the same name (such as `docker`) is never meant. ⇧↵ pastes the homepage, for both formulae and casks: the place to read what changed before you upgrade. The second action is the same for every row, so its label on the panel's bar always says what it does.
- When nothing is outdated, the column shows one calm line, *Everything is up to date*.
- The list is kept in memory for five minutes and read again after that, and right after any install or upgrade the extension runs. It is never written to disk or yabbistir's history.

## Limits

- One `brew install` command at a time, with at most 50 package names. A package name with a dot outside its `@` version, or with capital letters, is not taken.
- *Install with Homebrew* on a bare name is offered on any single word that could be a package name, such as `wget` or `jq`, so it also shows on ordinary lowercase words. It runs `brew install <name>`, which installs the formula, or the cask when there is no formula of that name; copy `brew install --cask <name>` for a cask that shares a formula's name.
- A cask whose installer asks for your password (many `.pkg` installers do) cannot ask for it here; the job says so, and the command works in Terminal.
- A notice after an install names what was already installed when brew says so; otherwise every name counts as installed.
