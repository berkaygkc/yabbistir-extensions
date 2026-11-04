// The one script the extension runs, with `osascript -l JavaScript -e <SCRIPT> [browser]`: JavaScript for Automation
// (JXA), fixed here and never built from data. Nothing from a row, an item or a browser ever becomes part of it. It
// takes at most one argument, which osascript hands to `run(argv)` (osascript(1): "Any arguments following the script
// will be passed as a list of strings to the direct parameter of the run handler"): one of the six keys in BROWSERS,
// and then it reads only that browser. `list` passes none and reads them all; `run` passes the row's browser, taken
// from the extension's own list, so a busy browser never holds up pasting from another one.
//
// Why JXA rather than AppleScript: an AppleScript `tell application "Vivaldi"` block needs Vivaldi's dictionary when the
// script is compiled, so one script that names six browsers fails to compile on a Mac without one of them. JXA looks a
// browser up only when the script runs: `Application(bundleID)` throws for one that is not installed, and `running()`
// asks whether it is running without launching it (JXA release notes, OS X 10.11).
//
// It prints one JSON object per line, every character outside ASCII written as \uXXXX so the output reads the same
// whatever LANG the tool gets:
//   {"v":1}                                       first, so an empty or foreign answer is never taken for "no browser"
//   {"b":"chrome","w":"12","t":"34","p":0,"a":1,"n":"Title","u":"https://…"}
//                                                 a tab: browser, window id, tab id (null in Safari), its place in the
//                                                 window from 0, 1 when it is the window's active tab, title and URL
//   {"b":"chrome","s":"ok","f":1,"x":2,"e":0}     after a running browser's tabs: "ok", "denied" (Automation is off for
//                                                 it) or "failed"; f is 1 when it is the frontmost app (always 0 when
//                                                 one browser is asked), x the number of private windows left out, e the
//                                                 number of windows left out because they could not be read
// Browsers that are not installed or not running print nothing. A browser that is denied or fails prints no tabs.
//
// The dictionaries it reads:
// - Chromium (Chrome, Brave, Edge, Vivaldi): window `id`, `mode` ("normal" or "incognito"), `active tab index` (from
//   1); tab `id`, `title`, `URL` (chromium/src chrome/browser/ui/cocoa/applescript/scripting.sdef).
// - Arc: window `id` (text), `incognito` (boolean), `active tab`; tab `id` (text, a UUID), `title`, `URL` (the
//   dictionary Arc 1.153.1 ships, Arc.sdef, as Script Editor's File › Open Dictionary shows it; it also has a window
//   `mode`, which is not read).
// - Safari: window `id` (the standard suite's); tab `name`, `URL`, `visible`, and window `current tab` as a fallback
//   (Safari.sdef in Safari 26.6). Safari does not say which windows are private.
// Private windows: Arc is asked only `incognito`, the Chromium four only `mode`. A private window (true, or a mode other
// than "normal") is left out and counted in x. A window that does not answer is left out too, counted in e, rather
// than risk listing a private window's tabs.
// Each property is read for all of a window's tabs in one Apple event (`win.tabs.url()`), not one event per tab, so
// hundreds of tabs take a handful of events per window.

export const SCRIPT = String.raw`
var BROWSERS = [
  ["safari", "com.apple.Safari"],
  ["chrome", "com.google.Chrome"],
  ["arc", "company.thebrowser.Browser"],
  ["brave", "com.brave.Browser"],
  ["edge", "com.microsoft.edgemac"],
  ["vivaldi", "com.vivaldi.Vivaldi"]
];

function line(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (c) {
    return "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function denied(error) {
  var number = error === null || error === undefined ? undefined : error.errorNumber;
  if (number === -1743 || number === -1744) return true;
  var message = error === null || error === undefined ? "" : String(error.message);
  return /\(-174[34]\)|Not authori[sz]ed to send Apple events/i.test(message);
}

function attempt(get) {
  try {
    var value = get();
    return value === undefined ? null : value;
  } catch (error) {
    if (denied(error)) throw error;
    return null;
  }
}

function text(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && isFinite(value)) return String(value);
  return null;
}

function columns(read) {
  for (var round = 0; round < 2; round++) {
    var lists = read();
    var size = Array.isArray(lists[0]) ? lists[0].length : -1;
    var even = size >= 0;
    for (var index = 1; index < lists.length; index++) {
      if (lists[index] !== null && (!Array.isArray(lists[index]) || lists[index].length !== size)) even = false;
    }
    if (even) return lists;
  }
  return null;
}

function readSafari(win, status, tabs) {
  var windowID = text(attempt(function () { return win.id(); }));
  var lists = columns(function () {
    return [win.tabs.url(), win.tabs.name(), attempt(function () { return win.tabs.visible(); })];
  });
  if (lists === null) {
    status.e += 1;
    return;
  }
  var current = lists[2] === null ? attempt(function () { return win.currentTab.index(); }) : null;
  for (var index = 0; index < lists[0].length; index++) {
    var active = lists[2] === null ? current === index + 1 : lists[2][index] === true;
    tabs.push(line({ b: "safari", w: windowID, t: null, p: index, a: active ? 1 : 0, n: text(lists[1][index]), u: text(lists[0][index]) }));
  }
}

// Whether a window is private: true, false, or null when it does not say. Arc is asked only "incognito", the Chromium
// four only "mode", so a property one browser happens to have with other values can never hide another's windows.
function privacy(key, win) {
  if (key === "arc") {
    var incognito = attempt(function () { return win.incognito(); });
    return typeof incognito === "boolean" ? incognito : null;
  }
  var mode = attempt(function () { return win.mode(); });
  return typeof mode === "string" ? mode.toLowerCase() !== "normal" : null;
}

function readChromium(key, win, status, tabs) {
  var hidden = privacy(key, win);
  if (hidden !== false) {
    if (hidden === true) status.x += 1;
    else status.e += 1;
    return;
  }
  var windowID = text(attempt(function () { return win.id(); }));
  var activeIndex = key === "arc" ? null : attempt(function () { return win.activeTabIndex(); });
  var activeID = key === "arc" ? text(attempt(function () { return win.activeTab.id(); })) : null;
  var lists = columns(function () {
    return [win.tabs.url(), win.tabs.title(), attempt(function () { return win.tabs.id(); })];
  });
  if (lists === null) {
    status.e += 1;
    return;
  }
  for (var index = 0; index < lists[0].length; index++) {
    var tabID = lists[2] === null ? null : text(lists[2][index]);
    var active = key === "arc" ? tabID !== null && tabID === activeID : activeIndex === index + 1;
    tabs.push(line({ b: key, w: windowID, t: tabID, p: index, a: active ? 1 : 0, n: text(lists[1][index]), u: text(lists[0][index]) }));
  }
}

function run(argv) {
  var only = argv !== null && argv !== undefined && argv.length > 0 ? String(argv[0]) : null;
  var out = [line({ v: 1 })];
  for (var index = 0; index < BROWSERS.length; index++) {
    var key = BROWSERS[index][0];
    if (only !== null && key !== only) continue;
    var app = null;
    try {
      app = Application(BROWSERS[index][1]);
      if (app.running() !== true) app = null;
    } catch (error) {
      app = null;
    }
    if (app === null) continue;
    var status = { b: key, s: "ok", f: 0, x: 0, e: 0 };
    var tabs = [];
    try {
      if (only === null) status.f = attempt(function () { return app.frontmost(); }) === true ? 1 : 0;
      var windows = app.windows();
      for (var w = 0; w < windows.length; w++) {
        try {
          if (key === "safari") readSafari(windows[w], status, tabs);
          else readChromium(key, windows[w], status, tabs);
        } catch (error) {
          if (denied(error)) throw error;
          status.e += 1;
        }
      }
    } catch (error) {
      status.s = denied(error) ? "denied" : "failed";
      status.x = 0;
      status.e = 0;
      tabs = [];
    }
    out = out.concat(tabs);
    out.push(line(status));
  }
  return out.join("\n");
}
`;

/** The arguments of the osascript run that lists every browser: the script's language and the script, nothing else. */
export const ARGS: readonly string[] = ["-l", "JavaScript", "-e", SCRIPT];
