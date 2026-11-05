// Synthetic brew answers for the tests: no real account, machine or package list. The shapes follow Homebrew's own
// code: `brew outdated --json=v2` (Library/Homebrew/cmd/outdated.rb, cask/cask.rb#outdated_info), `brew info --json=v2`,
// and the "==> …" step lines brew prints without a terminal (auto-update lines on standard error).

import { createFakeHost } from "@yabbistir/api/fake-host";

export const folder = new URL("..", import.meta.url);

let helpers = 0;
/** The extension's exports as a newly started helper has them: a module of its own, so nothing is cached yet. */
export async function newHelper() {
  return import(`../src/index.ts?helper=${++helpers}`);
}

/** A token-shaped string, built at run time so no file holds one. */
export const TOKEN = "gh" + "p_" + "Z".repeat(36);

/** `brew outdated --json=v2` as brew prints it: JSON.pretty_generate, two-space indents. */
export function outdatedJSON({ formulae = [], casks = [] } = {}) {
  return JSON.stringify({ formulae, casks }, null, 2) + "\n";
}

export const formula = (name, installed, current, { pinned = false } = {}) =>
  ({ name, installed_versions: Array.isArray(installed) ? installed : [installed], current_version: current, pinned, pinned_version: pinned ? (Array.isArray(installed) ? installed.at(-1) : installed) : null });
export const cask = (name, installed, current, { pinned = false } = {}) =>
  ({ name, installed_versions: [installed], current_version: current, pinned, pinned_version: pinned ? installed : null });

/** A list with a bit of everything: formulae, a pinned one, a third-party tap with two kegs, casks, and a formula and a cask sharing a name. */
export const OUTDATED = {
  formulae: [
    formula("node", "22.11.0", "23.3.0"),
    formula("python@3.12", "3.12.7", "3.12.8", { pinned: true }),
    formula("ornek/tap/aracim", ["0.9.0", "0.9.1"], "1.0.0"),
    formula("docker", "27.3.1", "27.4.0"),
  ],
  casks: [
    cask("firefox", "133.0", "133.0.3"),
    cask("docker", "4.36.0", "4.37.0"),
  ],
};

export const ROWS = [
  { id: "formula:docker", title: "docker", subtitle: "27.3.1 → 27.4.0 · formula" },
  { id: "cask:docker", title: "docker", subtitle: "4.36.0 → 4.37.0 · cask" },
  { id: "cask:firefox", title: "firefox", subtitle: "133.0 → 133.0.3 · cask" },
  { id: "formula:node", title: "node", subtitle: "22.11.0 → 23.3.0 · formula" },
  { id: "formula:ornek/tap/aracim", title: "ornek/tap/aracim", subtitle: "0.9.0, 0.9.1 → 1.0.0 · formula" },
  { id: "pinned-formula:python@3.12", title: "python@3.12", subtitle: "3.12.7 → 3.12.8 · formula · pinned" },
];

/** What brew prints on standard error when it updates itself first (Library/Homebrew/cmd/update.sh). */
export const AUTO_UPDATE = [
  "==> Auto-updating Homebrew...",
  "Adjust how often this is run with `$HOMEBREW_AUTO_UPDATE_SECS` or disable with",
  "`$HOMEBREW_NO_AUTO_UPDATE=1`. Hide these hints with `$HOMEBREW_NO_ENV_HINTS=1` (see `man brew`).",
  "==> Auto-updated Homebrew!",
].join("\n") + "\n";

/** A formula install with dependencies, as brew prints it to a pipe. */
export const INSTALL_WGET = [
  "==> Fetching downloads for: wget",
  "==> Fetching dependencies for wget: libunistring, libidn2",
  "==> Fetching libunistring",
  "==> Downloading https://ghcr.io/v2/homebrew/core/libunistring/manifests/1.3",
  "==> Fetching wget",
  "==> Downloading https://ghcr.io/v2/homebrew/core/wget/manifests/1.25.0",
  "==> Installing dependencies for wget: libunistring, libidn2",
  "==> Installing wget dependency: libunistring",
  "==> Pouring libunistring--1.3.arm64_sequoia.bottle.tar.gz",
  "🍺  /opt/homebrew/Cellar/libunistring/1.3: 59 files, 5.4MB",
  "==> Installing wget dependency: libidn2",
  "==> Pouring libidn2--2.3.7.arm64_sequoia.bottle.tar.gz",
  "==> Installing wget",
  "==> Pouring wget--1.25.0.arm64_sequoia.bottle.tar.gz",
  "🍺  /opt/homebrew/Cellar/wget/1.25.0: 92 files, 4.6MB",
  "==> Running `brew cleanup wget`...",
].join("\n") + "\n";

/** A cask install. */
export const INSTALL_FIREFOX = [
  "==> Downloading https://download-installer.cdn.mozilla.net/pub/firefox/releases/133.0.3/mac/en-US/Firefox%20133.0.3.dmg",
  "==> Installing Cask firefox",
  "==> Moving App 'Firefox.app' to '/Applications/Firefox.app'",
  "🍺  firefox was successfully installed!",
].join("\n") + "\n";

/** `brew upgrade` for the unpinned packages of OUTDATED. */
export const UPGRADE_ALL = [
  "==> Upgrading 3 outdated packages:",
  "node 22.11.0 -> 23.3.0",
  "ornek/tap/aracim 0.9.1 -> 1.0.0",
  "docker 27.3.1 -> 27.4.0",
  "==> Fetching downloads for: node, aracim, docker",
  "==> Upgrading node",
  "  22.11.0 -> 23.3.0",
  "==> Pouring node--23.3.0.arm64_sequoia.bottle.tar.gz",
  "==> Upgrading ornek/tap/aracim",
  "  0.9.1 -> 1.0.0",
  "==> Upgrading docker",
  "  27.3.1 -> 27.4.0",
  "==> Checking for dependents of upgraded formulae...",
  "==> No broken dependents found!",
  "==> Upgrading 2 outdated packages:",
  "firefox 133.0 -> 133.0.3",
  "docker 4.36.0 -> 4.37.0",
  "==> Upgrading firefox",
  "==> Upgrading docker",
  "==> Running `brew cleanup`...",
].join("\n") + "\n";

/** The line brew prints as it starts upgrading each package (`oh1` in upgrade.rb and cask/upgrade.rb). */
export function upgrading(...names) {
  return names.map((name) => `==> Upgrading ${name}\n  1.0 -> 2.0`).join("\n") + "\n";
}

/** `brew info --json=v2` for one package: the fields the extension reads, among others it ignores. */
export function infoJSON({ formulae = [], casks = [] } = {}) {
  return JSON.stringify({ formulae, casks }, null, 2) + "\n";
}

/**
 * A fake brew answering by subcommand. `answers.outdated`, `.install`, `.upgrade` and `.info` are results or
 * functions of the arguments; a missing one fails as brew does for an unknown command. Every call's arguments are kept.
 */
export function fakeBrew(answers = {}) {
  const runs = [];
  const brew = (args, context) => {
    runs.push(args);
    const answer = answers[args[0]];
    if (answer === undefined) return { exitCode: 1, stdout: "", stderr: `Error: Unknown command: brew ${args[0]}\n` };
    return typeof answer === "function" ? answer(args, context) : answer;
  };
  return Object.assign(brew, { runs });
}

export const ok = (stdout = "", stderr = "") => ({ exitCode: 0, stdout, stderr });

export function hostWith(exports, brew, { now, language = "en" } = {}) {
  return createFakeHost({ folder, sources: exports.sources, exec: { brew }, now, context: { language } });
}

/** Every text the person or a log could see from a host: results' messages, progress, notices and logs. */
export function visibleTexts(host) {
  return [
    ...host.results.map((result) => result.message ?? ""),
    ...host.progress.map((entry) => entry.message ?? ""),
    ...host.notifications,
    ...host.logs,
  ];
}
