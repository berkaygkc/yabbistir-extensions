// Synthetic browsers for the tests: a stand-in for JavaScript for Automation's `Application`, so the extension's real
// script runs in Node against made-up windows and tabs, and a fake osascript that runs it. Every title, URL and id
// here is invented; example.com, example.org and example.net are reserved for examples (RFC 2606).

import vm from "node:vm";

import { ARGS, SCRIPT } from "../src/index.ts";

export const BUNDLE = {
  safari: "com.apple.Safari",
  chrome: "com.google.Chrome",
  arc: "company.thebrowser.Browser",
  brave: "com.brave.Browser",
  edge: "com.microsoft.edgemac",
  vivaldi: "com.vivaldi.Vivaldi",
};

const NAME = { safari: "Safari", chrome: "Google Chrome", arc: "Arc", brave: "Brave Browser", edge: "Microsoft Edge", vivaldi: "Vivaldi" };

/** An error as JXA throws it: a message and an Apple event error number. */
export function jxaError(number, message) {
  const error = new Error(message);
  error.errorNumber = number;
  return error;
}

/** What JXA throws when Automation is off for the app (errAEEventNotPermitted). */
export const notAuthorized = (browser) => jxaError(-1743, `Not authorized to send Apple events to ${NAME[browser]}.`);
const cantGet = () => jxaError(-1728, "Can’t get object.");

/**
 * The properties each dictionary has: on the window, on `active tab` / `current tab`, and on every tab, as JXA names
 * them. Safari's and Arc's are the ones their shipped dictionaries list (Safari 26.6, Arc 1.153.1); Arc's window also
 * has a `mode`, which the script must not read (see "Arc is asked only `incognito`").
 */
const DICTIONARY = {
  safari: { window: ["id"], current: ["index"], tab: ["url", "name", "visible"] },
  chromium: { window: ["id", "mode", "activeTabIndex"], active: [], tab: ["id", "title", "url"] },
  arc: { window: ["id", "incognito", "mode"], active: ["id"], tab: ["id", "title", "url"] },
};
/** A browser's dictionary, without the properties its test says it `lacks` (as an older or changed version might). */
function dictionaryOf(browser, lacks = []) {
  const own = DICTIONARY[browser === "safari" || browser === "arc" ? browser : "chromium"];
  const keep = (names) => names?.filter((name) => !lacks.includes(name));
  return { window: keep(own.window), current: keep(own.current), active: keep(own.active), tab: keep(own.tab) };
}

/**
 * A browser as a test describes it: `{ windows: [{ id, mode?, incognito?, active?, tabs: [{ id?, title, url }] }] }`,
 * plus `running` (default true), `frontmost`, `denied` (every Apple event is refused), `fail` (an error that
 * `windows()` throws), `missing` (not installed), `lacks` (property names its dictionary does not have), `hung` (it
 * never answers: see fakeOsascript). A window may say `broken: true` (its tabs cannot be read) or `racing: n` (its
 * first n readings disagree on the number of tabs, as when a tab opens between two events). `active` is the active
 * tab's place, from 0. Each Apple event the script sends is counted in `events`, and each window property it asks for
 * is written to `reads` as "browser.property".
 */
export function fakeJXA(browsers) {
  const events = Object.fromEntries(Object.keys(BUNDLE).map((browser) => [browser, 0]));
  const lookups = [];
  const reads = [];

  function Application(bundleID) {
    lookups.push(bundleID);
    const browser = Object.keys(BUNDLE).find((name) => BUNDLE[name] === bundleID);
    const spec = browser === undefined ? undefined : browsers[browser];
    if (spec === undefined || spec.missing) throw jxaError(-2700, "Application can’t be found.");
    const dictionary = dictionaryOf(browser, spec.lacks);
    const send = () => {
      events[browser] += 1;
      if (spec.running === false) throw new Error("the script sent an Apple event to a browser that is not running, which launches it");
      if (spec.denied) throw notAuthorized(browser);
    };
    const property = (has, value) => () => {
      send();
      if (!has || value === undefined) throw cantGet();
      return value;
    };

    function windowSpecifier(window) {
      let readings = 0;
      const column = (name) => () => {
        send();
        if (!dictionary.tab.includes(name)) throw cantGet();
        if (window.broken) throw jxaError(-1728, "Can’t get every tab of window.");
        readings += 1;
        const racing = (window.racing ?? 0) * 3;
        const tabs = readings <= racing && readings % 3 === 0 ? [...window.tabs, { title: "Yeni", url: "https://example.com/yeni" }] : window.tabs;
        return tabs.map((tab, index) => {
          if (name === "visible") return index === (window.active ?? 0);
          const value = name === "name" ? tab.title : tab[name];
          return value === undefined ? null : value;
        });
      };
      const activeTab = window.tabs[window.active ?? 0];
      const own = (name, value) => {
        const get = property(dictionary.window.includes(name), value);
        return () => {
          reads.push(`${browser}.${name}`);
          return get();
        };
      };
      return {
        id: own("id", window.id),
        mode: own("mode", window.mode ?? (window.incognito === true ? "incognito" : "normal")),
        incognito: own("incognito", window.incognito ?? false),
        activeTabIndex: own("activeTabIndex", (window.active ?? 0) + 1),
        activeTab: { id: property(dictionary.active?.includes("id") ?? false, activeTab?.id) },
        currentTab: { index: property(dictionary.current?.includes("index") ?? false, (window.active ?? 0) + 1) },
        tabs: Object.fromEntries(["id", "title", "url", "name", "visible"].map((name) => [name, column(name)])),
      };
    }

    return {
      running: () => spec.running !== false,
      frontmost: property(true, spec.frontmost === true),
      windows: () => {
        send();
        if (spec.fail !== undefined) throw spec.fail;
        return (spec.windows ?? []).map(windowSpecifier);
      },
    };
  }

  return { Application, events, lookups, reads };
}

/**
 * Runs the extension's script against `browsers`, as osascript would, with `argv` as the arguments after the script,
 * and returns what osascript prints.
 */
export function runScript(browsers, argv = []) {
  const jxa = fakeJXA(browsers);
  const output = vm.runInNewContext(`${SCRIPT}\nrun(argv);`, { Application: jxa.Application, argv: [...argv] });
  return { output: `${output}\n`, jxa };
}

/**
 * A fake osascript for the fake host: checks that it gets the extension's fixed arguments, alone or followed by one
 * browser key, then runs the script against `browsers` (an object, or a function returning one so a test can change
 * the tabs between calls). When the script sent an Apple event to a browser marked `hung`, osascript never ends, as
 * it waits on that browser; the app would cancel it after its 10 seconds.
 */
export function fakeOsascript(browsers) {
  const runs = [];
  const osascript = (args) => {
    const fixed = JSON.stringify(args.slice(0, ARGS.length)) === JSON.stringify(ARGS);
    const extra = args.slice(ARGS.length);
    if (!fixed || extra.length > 1 || (extra.length === 1 && !Object.hasOwn(BUNDLE, extra[0]))) {
      throw new Error("osascript got other arguments than the fixed script and a browser key");
    }
    const current = typeof browsers === "function" ? browsers() : browsers;
    const { output, jxa } = runScript(current, extra);
    runs.push({ ...jxa, argv: extra });
    if (Object.keys(current).some((browser) => current[browser]?.hung && jxa.events[browser] > 0)) return new Promise(() => {});
    return { exitCode: 0, stdout: output, stderr: "" };
  };
  return Object.assign(osascript, { runs });
}

/** `count` synthetic tabs on example.com. */
export function manyTabs(count, { prefix = "Sekme", ids = true } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    ...(ids ? { id: String(10_000 + index) } : {}),
    title: `${prefix} ${index} · uzun bir örnek başlık`,
    url: `https://example.com/sayfa/${index}?q=${"x".repeat(index % 40)}`,
  }));
}
