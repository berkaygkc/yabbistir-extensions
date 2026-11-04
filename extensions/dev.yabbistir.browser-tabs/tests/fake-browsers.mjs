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

/** The properties each dictionary has: on the window, on `active tab` / `current tab`, and on every tab. */
const DICTIONARY = {
  safari: { window: ["id"], current: ["index"], tab: ["url", "name", "visible"] },
  chromium: { window: ["id", "mode", "activeTabIndex"], active: [], tab: ["id", "title", "url"] },
  arc: { window: ["id", "incognito"], active: ["id"], tab: ["id", "title", "url"] },
};
const dictionaryOf = (browser) => DICTIONARY[browser === "safari" || browser === "arc" ? browser : "chromium"];

/**
 * A browser as a test describes it: `{ windows: [{ id, mode?, incognito?, active?, tabs: [{ id?, title, url }] }] }`,
 * plus `running` (default true), `frontmost`, `denied` (every Apple event is refused), `fail` (an error that
 * `windows()` throws), `missing` (not installed). A window may say `broken: true` (its tabs cannot be read) or
 * `racing: n` (its first n readings disagree on the number of tabs, as when a tab opens between two events).
 * `active` is the active tab's place, from 0. Each Apple event the script sends is counted in `events`.
 */
export function fakeJXA(browsers) {
  const events = Object.fromEntries(Object.keys(BUNDLE).map((browser) => [browser, 0]));
  const lookups = [];

  function Application(bundleID) {
    lookups.push(bundleID);
    const browser = Object.keys(BUNDLE).find((name) => BUNDLE[name] === bundleID);
    const spec = browser === undefined ? undefined : browsers[browser];
    if (spec === undefined || spec.missing) throw jxaError(-2700, "Application can’t be found.");
    const dictionary = dictionaryOf(browser);
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
      return {
        id: property(dictionary.window.includes("id"), window.id),
        mode: property(dictionary.window.includes("mode"), window.mode ?? "normal"),
        incognito: property(dictionary.window.includes("incognito"), window.incognito ?? false),
        activeTabIndex: property(dictionary.window.includes("activeTabIndex"), (window.active ?? 0) + 1),
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

  return { Application, events, lookups };
}

/** Runs the extension's script against `browsers`, as osascript would, and returns what osascript prints. */
export function runScript(browsers) {
  const jxa = fakeJXA(browsers);
  const output = vm.runInNewContext(`${SCRIPT}\nrun();`, { Application: jxa.Application });
  return { output: `${output}\n`, jxa };
}

/**
 * A fake osascript for the fake host: checks that it gets the extension's fixed arguments, then runs the script
 * against `browsers` (an object, or a function returning one so a test can change the tabs between calls).
 */
export function fakeOsascript(browsers) {
  const runs = [];
  const osascript = (args) => {
    if (JSON.stringify(args) !== JSON.stringify(ARGS)) throw new Error("osascript got other arguments than the fixed script");
    const current = typeof browsers === "function" ? browsers() : browsers;
    const { output, jxa } = runScript(current);
    runs.push(jxa);
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
