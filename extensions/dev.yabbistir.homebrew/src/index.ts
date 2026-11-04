import type { Actions, Context, Result, SourceListing, SourceRow, Sources, YabError } from "@yabbistir/api";
import {
  MAX_NAMES, failureOf, homepageOf, infoArguments, installArguments, isBareName, isCaveats, leftAlone, packageOfRow,
  parseInstallCommand, parseOutdated, phaseOf, rowID, shortName, upgradeCommand,
} from "./brew.ts";
import type { Failure, InstallCommand, Outdated, Phase } from "./brew.ts";

// Homebrew through brew itself: an install job on a copied `brew install …` command or package name, a column of what
// is outdated, and a job that upgrades it all. brew's output is read, never shown: no message, row or log line carries
// it, apart from the package names and versions a row is about.

/** How long the outdated list is reused before brew is asked again. */
const LIFETIME = 5 * 60_000;
/**
 * How long the column waits for `brew outdated`, inside the 10 seconds a source's `list` has. brew updates itself
 * first once a day, which usually takes a few seconds; when it takes longer, the column says so instead of failing.
 */
const LIST_BUDGET = 8_000;
/**
 * How long the column keeps saying brew is slow without starting it again. Each slow answer stops brew's own update
 * before it is done, and brew starts it afresh next time: asking on every panel open would stop it every time.
 */
const SLOW_PAUSE = 60_000;
/** The most "Warning: …" and "Error: …" lines kept from one install, to tell which packages brew left as they were. */
const MAX_NOTES = 1_000;
/** Up to this many names, the notice after an install with notes spells out the `brew info` command. */
const MAX_INFO_NAMES = 3;

// The helper's memory only, never yab.storage or a file: the last list of outdated packages, for a few minutes, and
// when brew was last too slow. The rows are built from the packages on each call, in the app's language of the moment.
// Both are dropped when the column answers locked, and after every install or upgrade, which change what is outdated
// and bring Homebrew up to date on the way.
let cached: { at: number; packages: Outdated[] } | undefined;
let slowAt: number | undefined;
const forget = () => {
  cached = undefined;
  slowAt = undefined;
};

const t = (key: string, args?: Record<string, string | number>) => yab.t(key, args);
const isCancel = (error: unknown) => (error as YabError | undefined)?.code === "cancelled";

/** "wget", "wget and jq", "wget, jq and fd" in the app's language; "5 packages" past three. */
function namesText(names: string[], language: string): string {
  if (names.length > 3) return t("packages", { n: names.length });
  try {
    return new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

/** Reports to the job card only when the report changes: brew repeats a step's line for every file it fetches. */
function reporter(): (fraction: number | null, message: string) => void {
  let last = "";
  return (fraction, message) => {
    const report = `${fraction}|${message}`;
    if (report === last) return;
    last = report;
    yab.job.progress(fraction, message);
  };
}

function phaseText(phase: Phase): string {
  switch (phase.step) {
    case "updating": return t("updating");
    case "downloading": return t("downloading");
    case "installing": return phase.name === undefined ? t("installing") : t("installingName", { name: phase.name });
    case "upgrading": return t("upgradingName", { name: phase.name });
    case "cleaning": return t("cleaning");
  }
}

/** A failed run in the person's words, from why it failed; brew's own output stays out of it. */
function failureMessage(failure: Failure, otherwise: string, notFound = otherwise): string {
  switch (failure) {
    case "busy": return t("busy");
    case "needsPassword": return t("needsPassword");
    case "notFound": return notFound;
    case "offline": return t("offline");
    case "other": return otherwise;
  }
}

/** Runs `brew install` for a checked command, with its steps on the job card. */
async function install(command: InstallCommand, ctx: Context): Promise<Result> {
  if ("problem" in command) {
    const message = command.problem === "tooMany" ? t("tooMany", { max: MAX_NAMES }) : t(command.problem);
    return { none: true, message };
  }
  const report = reporter();
  report(null, t("starting"));
  const notes: string[] = [];
  let caveats = false;
  try {
    // yab errors (toolMissing, cancelled…) reject out of here untouched.
    const result = await yab.exec("brew", installArguments(command), {
      signal: ctx.signal,
      onLine(line) {
        if ((line.startsWith("Warning:") || line.startsWith("Error:")) && notes.length < MAX_NOTES) notes.push(line);
        if (isCaveats(line)) caveats = true;
        const phase = phaseOf(line);
        if (phase !== null) report(null, phaseText(phase));
      },
    });
    if (result.exitCode !== 0) {
      const notFound = t(command.names.length === 1 ? "notFound.one" : "notFound.some");
      throw new Error(failureMessage(failureOf(result.stderr), t("installFailed", { code: result.exitCode }), notFound));
    }
  } finally {
    // An install can upgrade an outdated package, and a cancelled one may have finished some.
    forget();
  }
  const { already, held } = leftAlone(notes, command.names);
  const installed = command.names.filter((name) => !already.has(name) && !held.has(name));
  const parts: string[] = [];
  if (installed.length > 0) parts.push(t("installed", { names: namesText(installed, ctx.language) }));
  if (already.size > 0) parts.push(t("already", { names: namesText(command.names.filter((name) => already.has(name)), ctx.language) }));
  if (held.size > 0) parts.push(t("held", { names: namesText(command.names.filter((name) => held.has(name)), ctx.language) }));
  if (caveats) {
    // Only that brew printed notes is said, never what they say: `brew info` shows them in Terminal.
    const about = installed.length > 0 ? installed : command.names;
    const info = ["brew", "info", ...(command.cask ? ["--cask"] : []), ...about].join(" ");
    parts.push(about.length <= MAX_INFO_NAMES ? t("caveats", { command: info }) : t("caveatsMany"));
  }
  return { none: true, message: parts.join(" ") };
}

/**
 * Every outdated package, from `brew outdated --json=v2`. Its standard output through onLine: an exec result keeps
 * only the last 64 KB. `hear` gets its standard error, where brew's auto-update reports.
 */
async function readOutdated(signal: AbortSignal, hear?: (line: string) => void): Promise<Outdated[]> {
  const lines: string[] = [];
  const result = await yab.exec("brew", ["outdated", "--json=v2"], {
    signal,
    onLine(line, stream) {
      if (stream === "stdout") lines.push(line);
      else hear?.(line);
    },
  });
  const packages = result.exitCode === 0 ? parseOutdated(lines.join("\n")) : undefined;
  if (packages === undefined) throw new Error(t("listFailed"));
  return packages;
}

/** "1.2.3 → 1.3.0 · formula", with " · pinned" for a package brew upgrade leaves alone. */
function subtitleOf(pkg: Outdated): string {
  const parts = [t("versions", { from: pkg.installed.join(", ") || "?", to: pkg.current || "?" }), t(`kind.${pkg.kind}`)];
  if (pkg.pinned) parts.push(t("pinned"));
  return parts.join(" · ");
}

/**
 * One row per package, by name; a formula and a cask of the same name each keep their own. Nothing outdated is no
 * rows: the app then says the column is empty, in its own words.
 */
function listingOf(packages: Outdated[]): SourceListing {
  const sorted = [...packages].sort((a, b) => (a.name === b.name ? (a.kind < b.kind ? 1 : -1) : a.name < b.name ? -1 : 1));
  const seen = new Set<string>();
  const rows: SourceRow[] = [];
  for (const pkg of sorted) {
    const key = `${pkg.kind}:${pkg.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: rowID(pkg), title: pkg.name, subtitle: subtitleOf(pkg) });
  }
  return { rows };
}

/** brew was too slow: a line that says so, with the command that brings Homebrew up to date in Terminal. */
const slowListing = (): SourceListing => ({ locked: true, message: t("slow"), command: "brew update" });

/** How long ago `at` was; Infinity when it never was or the clock went back. */
function since(at: number | undefined): number {
  const age = at === undefined ? Infinity : Date.now() - at;
  return age >= 0 ? age : Infinity;
}

export const actions: Actions = {
  install: {
    run(item, ctx) {
      return install(parseInstallCommand(item?.text ?? ""), ctx);
    },
  },

  installName: {
    run(item, ctx) {
      const name = (item?.text ?? "").trim();
      return install(isBareName(name) ? { cask: false, names: [name] } : { problem: "unsupported" }, ctx);
    },
  },

  upgradeAll: {
    async run(_item, ctx) {
      const report = reporter();
      report(null, t("checking"));
      try {
        const packages = await readOutdated(ctx.signal, (line) => {
          if (phaseOf(line)?.step === "updating") report(null, t("updating"));
        });
        if (packages.length === 0) return { none: true, message: t("nothingOutdated") };
        // brew upgrade leaves pinned packages alone.
        const waiting = packages.filter((pkg) => !pkg.pinned);
        if (waiting.length === 0) return { none: true, message: t("onlyPinned") };

        // brew prints "==> Upgrading <name>" as it starts each one: the bar moves a step for each package of the list,
        // once per package (a formula and a cask may share a name), never for a dependent brew adds.
        const total = waiting.length;
        const spellings = new Map<string, string>();
        const left = new Map<string, number>();
        for (const pkg of waiting) spellings.set(shortName(pkg.name), pkg.name);
        for (const pkg of waiting) {
          spellings.set(pkg.name, pkg.name);
          left.set(pkg.name, (left.get(pkg.name) ?? 0) + 1);
        }
        const upgraded: string[] = [];
        const result = await yab.exec("brew", ["upgrade"], {
          signal: ctx.signal,
          onLine(line) {
            const phase = phaseOf(line);
            if (phase === null) return;
            if (phase.step === "upgrading") {
              const name = spellings.get(phase.name);
              const count = name === undefined ? 0 : left.get(name) ?? 0;
              if (name === undefined || count === 0) return;
              left.set(name, count - 1);
              upgraded.push(name);
              report((upgraded.length - 1) / total, t("step", { done: upgraded.length, total, name }));
            } else if (upgraded.length === 0) {
              // State words only until the first package starts, so the bar never jumps back.
              report(null, phaseText(phase));
            }
          },
        });
        if (result.exitCode !== 0) throw new Error(failureMessage(failureOf(result.stderr), t("upgradeFailed", { code: result.exitCode })));
        // The notice says what brew started, not what was outdated: brew can leave a package out without failing (a
        // cask it skips, one upgraded meanwhile).
        const skipped = [...left].flatMap(([name, count]) => Array.from({ length: count }, () => name));
        if (skipped.length === 0) report(1, t("stepsDone", { done: total, total }));
        const parts: string[] = [];
        if (upgraded.length > 0) parts.push(t("upgraded", { names: namesText(upgraded, ctx.language) }));
        if (skipped.length > 0) parts.push(t("notUpgraded", { names: namesText(skipped, ctx.language) }));
        return { none: true, message: parts.join(" ") };
      } finally {
        forget();
      }
    },
  },
};

export const sources: Sources = {
  outdated: {
    async list(ctx) {
      if (since(slowAt) < SLOW_PAUSE) return slowListing();
      if (cached !== undefined && since(cached.at) <= LIFETIME) return listingOf(cached.packages);

      // A deadline of its own, a little inside the call's, so a slow auto-update gets a useful line instead of a failure.
      const budget = new AbortController();
      const follow = () => budget.abort(ctx.signal.reason);
      if (ctx.signal.aborted) follow();
      ctx.signal.addEventListener("abort", follow);
      const timer = setTimeout(() => budget.abort(), LIST_BUDGET);
      let packages: Outdated[];
      try {
        packages = await readOutdated(budget.signal);
      } catch (error) {
        if (isCancel(error) && budget.signal.aborted && !ctx.signal.aborted) {
          forget();
          slowAt = Date.now();
          return slowListing();
        }
        throw error;
      } finally {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", follow);
      }
      cached = { at: Date.now(), packages };
      return listingOf(packages);
    },

    async run(rowId, actionId, ctx) {
      // Ids are this extension's own ("formula:wget", "pinned-cask:firefox"): anything else never reaches brew.
      const pkg = packageOfRow(rowId);
      if (pkg === undefined || (actionId !== "upgrade" && actionId !== "homepage")) throw new Error(t("badRow"));
      if (actionId === "upgrade") return { text: upgradeCommand(pkg) };

      const lines: string[] = [];
      const result = await yab.exec("brew", infoArguments(pkg), {
        signal: ctx.signal,
        onLine(line, stream) {
          if (stream === "stdout") lines.push(line);
        },
      });
      const homepage = result.exitCode === 0 ? homepageOf(lines.join("\n"), pkg) : undefined;
      if (homepage === undefined) throw new Error(t("infoFailed"));
      if (homepage === null) throw new Error(t("noHomepage"));
      return { text: homepage };
    },
  },
};
