// A fake yabbistir host for testing an extension in Node, without the app.
//
//   import { createFakeHost, yabError } from "@yabbistir/api/fake-host";
//   import { actions } from "../src/index.ts"; // the extension's own exports
//
//   const host = createFakeHost({ folder: new URL("..", import.meta.url), http: { "https://api.example.com/v1": { json: { ok: true } } } });
//   const result = await host.run(actions.check, { text: "hello" });
//
// It holds an extension to the app's rules: permissions come from the manifest, `yab.http.fetch` and `fetch` reach only
// the manifest's domains and answer from `http`, `yab.exec` runs only the manifest's tools and answers from `exec`, and
// hints, detectors, previews and capture rules get no network, programs, notices, AI or translation. What the app
// would refuse is refused here with the same `code` ("permissionDenied", "networkError", "toolMissing", …). Nothing
// reaches the network or runs a program; files live in memory.
//
// createFakeHost(options) → host
//   folder       the extension's folder (a path or file: URL): reads manifest.json and locales/*.json
//   manifest     the manifest (instead of, or over, the folder's)
//   locales      { en: { key: text }, tr: { … } } (instead of the folder's)
//   item         the item host.run() and the others get when you pass none
//   context      { language, trigger, variant, target } for every call
//   preferences  values chosen in Settings; the rest come from the manifest's defaults
//   secrets      { id: value } for the manifest's `secret` preferences
//   http         { "https://host/path": response, "POST https://host/path": response } or (request) => response.
//                A response is { status = 200, headers, text | json | body }, an Error, or a function returning either.
//   exec         { tool: result | (args, { input, workDir, host }) => result }, a result being { exitCode, stdout, stderr }
//                or an Error. A tool of requires.tools missing here is not installed ("toolMissing").
//   ai           an answer, or (prompt, options) => answer, for yab.ai.generate; without it: "unavailable"
//   translate    { text, from }, or (text, { to, from }) => it, for yab.translate; without it: "unavailable"
//   vision       { ocr, readCodes, removeBackground }: answers or functions; without one: "unavailable"
//   history      the items yab.history returns, newest first
//   files        { path: text | Uint8Array }: files on the fake disk, such as an item's own files
//   storage      what yab.storage holds at the start
//   now          a Date, ISO text or milliseconds: Date.now() and new Date() inside host.run() and the others, and
//                the items' copiedAt
//
// host
//   yab                  the `yab` object; it is the global `yab` (and `fetch` the fake one) while a call below runs
//   run(action, item?, context?)            a run the person started; checks the result as the app does
//   hint(action, item?, context?)           the same run as a hint (no effects)
//   validate(detector, item?)               a detector's validate
//   preview(detector, item?, context?)      a detector's preview
//   capture(rule, item?, context?)          a capture rule
//   cancel()             cancels the calls in progress, as the person's ✕ does
//   install()            makes them the globals outside calls too; returns a function that puts the old ones back
//   calls                the yab calls in order, as { api, args } with callbacks and signals left out; t and plain
//                        reads (storage.get, files.read, files.exists, image.info) are not listed
//   notifications, opened, progress, results     what yab.notify, yab.open and yab.job.progress got, and what the
//                                                calls above returned
//   files, storage       the fake disk (a Map of path → bytes) and the store

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** An Error with a `code`, as the app's errors are: `throw yabError("unavailable", "…")`. */
export function yabError(code, message) {
  return Object.assign(new Error(message), { code });
}

const HOME = "/Users/test";
const TEXT_LIMIT = 10 * 1_048_576;
const HISTORY_TRIM = 65_536;
const STREAM_TAIL = 65_536;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const bytesOf = (data) => (data instanceof Uint8Array ? data : encoder.encode(String(data)));

/** The last `limit` bytes of `text`, on a character boundary. */
function tail(text, limit) {
  const bytes = encoder.encode(text);
  if (bytes.length <= limit) return text;
  return decoder.decode(bytes.subarray(bytes.length - limit)).replace(/^\uFFFD/, "");
}

/** The first `limit` bytes of `text`, on a character boundary. */
function head(text, limit) {
  const bytes = encoder.encode(text);
  if (bytes.length <= limit) return text;
  return decoder.decode(bytes.subarray(0, limit)).replace(/\uFFFD$/, "");
}

function clockOf(now) {
  if (now === undefined) return undefined;
  const value = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (Number.isNaN(value)) throw new TypeError(`now is not a time: ${now}`);
  return value;
}

/** Runs `body` with Date.now() and new Date() fixed at `time`, until what it returns settles. */
function withClock(time, body) {
  if (time === undefined) return body();
  const RealDate = globalThis.Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(time);
      else super(...args);
    }
    static now() {
      return time;
    }
  }
  globalThis.Date = FakeDate;
  const restore = () => {
    if (globalThis.Date === FakeDate) globalThis.Date = RealDate;
  };
  try {
    const result = body();
    if (result && typeof result.then === "function") return Promise.resolve(result).finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function readFolder(folder) {
  const directory = folder instanceof URL ? fileURLToPath(folder) : folder;
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const locales = {};
  const localesDirectory = path.join(directory, "locales");
  if (fs.existsSync(localesDirectory)) {
    for (const name of fs.readdirSync(localesDirectory).filter((file) => file.endsWith(".json"))) {
      locales[name.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(localesDirectory, name), "utf8"));
    }
  }
  return { manifest, locales };
}

/** Lowercase host names: a host is allowed when it equals a domain or ends with "." + domain; no domains: any host. */
function permitsHost(domains, host) {
  if (!/^[a-z0-9.-]+$/.test(host) && !host.startsWith("[")) return false;
  if (domains.length === 0) return true;
  const isAddress = host.startsWith("[") || /^[0-9.]+$/.test(host);
  return domains.some((domain) => host === domain || (!isAddress && host.endsWith(`.${domain}`)));
}

/** A file name the way yab.files.write takes it: "/" and ":" become "-"; ".", ".." and empty names are refused. */
function cleanName(name) {
  if (typeof name !== "string") throw yabError("badResult", "yab.files.write takes a file name");
  if (name.split("/").map((part) => part.trim()).some((part) => part === "." || part === "..")) {
    throw yabError("badResult", "a file name cannot contain \"..\" or \".\"");
  }
  const clean = name.replaceAll("/", "-").replaceAll(":", "-").trim();
  if (clean === "" || clean === "." || clean === "..") throw yabError("badResult", "a file name cannot be empty, \".\" or \"..\"");
  if ([...clean].length > 200) throw yabError("badResult", "a file name is at most 200 characters");
  return clean;
}

const RESULT_SHAPES = "expected {text}, {html, text}, {image}, {link: {url, title}}, {file}, {files} or {none: true}";
const CAPTURE_SHAPES = "expected {keep: true}, {ignore: true}, {replace: {text}}, {replace: {url}}, {addToCategory: name} or nothing";

export function createFakeHost(options = {}) {
  const fromFolder = options.folder ? readFolder(options.folder) : { manifest: {}, locales: {} };
  const manifest = { ...fromFolder.manifest, ...(options.manifest ?? {}) };
  const locales = options.locales ?? fromFolder.locales;
  const extensionID = typeof manifest.id === "string" ? manifest.id : "dev.example.extension";
  const permissions = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
  const domains = (manifest.network?.domains ?? []).map((domain) => String(domain).toLowerCase().replace(/\.+$/, ""));
  const toolSpecs = Array.isArray(manifest.requires?.tools) ? manifest.requires.tools : [];
  const declared = Array.isArray(manifest.preferences) ? manifest.preferences : [];
  const clock = clockOf(options.now);
  const nowISO = () => new Date(clock ?? Date.now()).toISOString();

  const calls = [];
  const notifications = [];
  const opened = [];
  const progress = [];
  const results = [];
  const files = new Map(Object.entries(options.files ?? {}).map(([file, data]) => [file, bytesOf(data)]));
  const storage = structuredClone(options.storage ?? {});
  const images = new Map();
  let imageCount = 0;
  let scopeCount = 0;

  // ---- Preferences ----
  const chosen = options.preferences ?? {};
  const preferences = {};
  const readableFolders = [];
  for (const preference of declared) {
    if (!isObject(preference) || typeof preference.id !== "string" || preference.type === "secret") continue;
    let value = Object.hasOwn(chosen, preference.id) ? chosen[preference.id] : preference.default;
    if (preference.type === "folder" && typeof value === "string" && value.startsWith("~")) value = HOME + value.slice(1);
    if (preference.type === "folder" && Object.hasOwn(chosen, preference.id) && typeof value === "string" && value.startsWith("/")) {
      readableFolders.push(value.replace(/\/+$/, ""));
    }
    if (value !== undefined) preferences[preference.id] = value;
  }
  for (const [id, value] of Object.entries(chosen)) if (!Object.hasOwn(preferences, id) && !declared.some((p) => p?.id === id)) preferences[id] = value;
  const secretIDs = new Set(declared.filter((preference) => preference?.type === "secret").map((preference) => preference.id));

  // ---- Calls and their scope ----
  // A scope is one call into the extension: what it may do, its signal, its work folder and what is pending in it.
  const current = new AsyncLocalStorage();
  const active = new Set();
  function makeScope(kind, effects) {
    const controller = new AbortController();
    const scope = { kind, effects, controller, workDir: `/tmp/yabbistir-work/${++scopeCount}`, pending: new Set(), cancelled: false };
    active.add(scope);
    return scope;
  }
  let defaultScope = makeScope("run", true);
  const scope = () => current.getStore() ?? defaultScope;
  const cancelled = () => yabError("cancelled", "the call was cancelled");

  function record(api, args) {
    calls.push({ api, args });
  }
  /** Throws when the call has ended or may not reach beyond itself. */
  function requireEffects(name) {
    const own = scope();
    if (own.cancelled) throw cancelled();
    if (!own.effects) throw yabError("permissionDenied", `${name} is not available in hints, detectors and previews`);
    return own;
  }
  function requirePermission(permission) {
    const own = requireEffects(permission);
    if (!permissions.has(permission)) throw yabError("permissionDenied", `${extensionID} has no ${permission} permission`);
    return own;
  }
  /** A promise that settles with `work` unless the call is cancelled first. */
  function pending(own, work, signal) {
    return new Promise((resolve, reject) => {
      const stop = () => reject(cancelled());
      if (signal?.aborted) return stop();
      own.pending.add(stop);
      signal?.addEventListener?.("abort", stop, { once: true });
      Promise.resolve()
        .then(work)
        .then(resolve, reject)
        .finally(() => {
          own.pending.delete(stop);
          signal?.removeEventListener?.("abort", stop);
        });
    });
  }
  const rejectWith = (body) => {
    try {
      return body();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  async function answer(value, ...args) {
    const settled = await (typeof value === "function" ? value(...args) : value);
    if (settled instanceof Error) throw settled;
    return settled;
  }

  // ---- HTTP ----
  function lookup(method, url, init) {
    const table = options.http;
    if (typeof table === "function") return table({ method, url, headers: init?.headers ?? {}, body: init?.body });
    if (isObject(table)) {
      if (Object.hasOwn(table, `${method} ${url}`)) return table[`${method} ${url}`];
      if (Object.hasOwn(table, url)) return table[url];
    }
    return undefined;
  }
  async function respond(method, url, init, host) {
    const entry = lookup(method, url, init);
    if (entry === undefined) throw yabError("networkError", `${host}: the request failed (no fake response for ${method} ${url})`);
    let response = await answer(entry, { method, url, headers: init?.headers ?? {}, body: init?.body });
    if (response === undefined) throw yabError("networkError", `${host}: the request failed (no fake response for ${method} ${url})`);
    if (typeof response === "string") response = { text: response };
    const headers = Object.fromEntries(Object.entries(response.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]));
    let body;
    if (response.json !== undefined) {
      body = encoder.encode(JSON.stringify(response.json));
      headers["content-type"] ??= "application/json";
    } else if (response.body !== undefined) body = bytesOf(response.body);
    else body = encoder.encode(response.text ?? "");
    return { status: response.status ?? 200, headers, body };
  }
  /** The checks yab.http.fetch and fetch make, in the app's order; returns the URL's host. */
  function checkRequest(url, init) {
    requirePermission("network");
    let target;
    try {
      target = new URL(String(url));
    } catch {
      throw yabError("badResult", "the URL is not valid");
    }
    if (!["http:", "https:"].includes(target.protocol)) throw yabError("permissionDenied", "only http and https URLs can be fetched");
    const host = target.hostname.toLowerCase().replace(/\.+$/, "");
    if (host === "") throw yabError("badResult", "the URL has no host");
    if (!permitsHost(domains, host)) throw yabError("permissionDenied", `${host} is not in the extension's domains`);
    const method = init?.method === undefined || init?.method === null ? "GET" : init.method;
    if (typeof method !== "string" || !/^[A-Za-z]+$/.test(method)) throw yabError("badResult", "method must be an HTTP method name");
    return { host, method: method.toUpperCase() };
  }
  const withoutCallbacks = (init) => {
    if (!isObject(init)) return init;
    const { signal, onLine, ...rest } = init;
    return rest;
  };

  const http = {
    fetch(url, init) {
      record("http.fetch", init === undefined ? [url] : [url, withoutCallbacks(init)]);
      return rejectWith(() => {
        const { host, method } = checkRequest(url, init);
        const own = scope();
        if (init?.toFile !== undefined && init.toFile !== null && typeof init.toFile !== "boolean" && typeof init.toFile !== "string") {
          throw yabError("badResult", "toFile must be true or a file name");
        }
        return pending(own, async () => {
          const { status, headers, body } = await respond(method, String(url), init, host);
          if (init?.toFile && status >= 200 && status < 300) {
            const fromURL = decodeURIComponent(new URL(String(url)).pathname.split("/").filter(Boolean).at(-1) ?? "");
            let name = typeof init.toFile === "string" ? cleanName(init.toFile) : "download";
            if (init.toFile === true && fromURL) {
              try {
                name = cleanName(fromURL);
              } catch {
                name = "download";
              }
            }
            const file = `${own.workDir}/${name}`;
            files.set(file, body);
            return { status, headers, file };
          }
          if (body.length > TEXT_LIMIT) throw yabError("networkError", "the response is larger than 10 MB; pass toFile");
          return { status, headers, text: decoder.decode(body) };
        }, init?.signal);
      });
    },
  };

  /** The web fetch, held to the same rules. */
  function fakeFetch(input, init) {
    const url = input instanceof URL ? input.href : String(input);
    record("fetch", init === undefined ? [url] : [url, withoutCallbacks(init)]);
    return rejectWith(() => {
      const { host, method } = checkRequest(url, init);
      return pending(scope(), async () => {
        const { status, headers, body } = await respond(method, url, init, host);
        if (body.length > TEXT_LIMIT) throw yabError("networkError", "the response is larger than 10 MB");
        const empty = [101, 204, 205, 304].includes(status);
        return new Response(empty ? null : body, { status, headers });
      }, init?.signal);
    });
  }

  // ---- Programs ----
  function exec(tool, args, execOptions) {
    record("exec", execOptions === undefined ? [tool, args] : [tool, args, withoutCallbacks(execOptions)]);
    return rejectWith(() => {
      const own = requirePermission("exec");
      if (typeof tool !== "string") throw yabError("badResult", "yab.exec takes the name of a tool from requires.tools");
      const spec = toolSpecs.find((candidate) => candidate?.name === tool);
      if (!spec) throw yabError("permissionDenied", `${tool} is not in the extension's required tools`);
      const table = options.exec ?? {};
      if (!Object.hasOwn(table, tool)) {
        throw yabError("toolMissing", `${tool} is not installed` + (spec.install ? `. Install it with: ${spec.install}` : ""));
      }
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
        throw yabError("badResult", "args must be an array of strings");
      }
      const onLine = execOptions?.onLine ?? undefined;
      if (onLine !== undefined && onLine !== null && typeof onLine !== "function") throw yabError("badResult", "onLine must be a function");
      const input = execOptions?.input ?? undefined;
      if (input !== undefined && input !== null && typeof input !== "string") throw yabError("badResult", "input must be a string");
      return pending(own, async () => {
        const result = await answer(table[tool], [...args], { input: input ?? undefined, workDir: own.workDir, host });
        const stdout = String(result?.stdout ?? "");
        const stderr = String(result?.stderr ?? "");
        if (typeof onLine === "function") {
          for (const [stream, text] of [["stdout", stdout], ["stderr", stderr]]) {
            for (const line of text.split(/\r\n|\r|\n/)) if (line !== "") onLine(line, stream);
          }
        }
        return { exitCode: result?.exitCode ?? 0, stdout: tail(stdout, STREAM_TAIL), stderr: tail(stderr, STREAM_TAIL) };
      }, execOptions?.signal);
    });
  }

  // ---- History ----
  function trimmed(item) {
    const copy = structuredClone(item);
    let truncated = false;
    if (typeof copy.text === "string" && encoder.encode(copy.text).length > HISTORY_TRIM) {
      copy.text = head(copy.text, HISTORY_TRIM);
      truncated = true;
    }
    if (typeof copy.richText?.html === "string" && encoder.encode(copy.richText.html).length > HISTORY_TRIM) {
      copy.richText.html = head(copy.richText.html, HISTORY_TRIM);
      truncated = true;
    }
    if (isObject(copy.image)) copy.image = { width: copy.image.width, height: copy.image.height };
    if (truncated) copy.truncated = true;
    return copy;
  }
  function historyCall(api, query, limit) {
    record(api, query === undefined ? (limit === undefined ? [] : [limit]) : limit === undefined ? [query] : [query, limit]);
    return rejectWith(() => {
      const own = scope();
      if (own.cancelled) throw cancelled();
      if (!permissions.has("history")) throw yabError("permissionDenied", `${extensionID} has no history permission`);
      if (own.kind !== "run") throw yabError("permissionDenied", "history is not available in rules, detectors and previews");
      if (api === "history.search" && typeof query !== "string") throw yabError("badResult", "yab.history.search takes a query");
      let count = 20;
      if (limit !== undefined && limit !== null) {
        if (typeof limit !== "number" || !Number.isFinite(limit)) throw yabError("badResult", "limit must be a number from 1 to 50");
        count = Math.min(50, Math.max(1, Math.floor(limit)));
      }
      const needle = query?.toLowerCase();
      const haystack = (item) => [item.text, item.url, item.richText?.html, ...(item.files ?? []).map((file) => file.name)]
        .filter((part) => typeof part === "string").join("\n").toLowerCase();
      const items = (options.history ?? []).filter((item) => needle === undefined || haystack(item).includes(needle));
      return pending(own, () => items.slice(0, count).map(trimmed));
    });
  }

  // ---- Images ----
  function handle(width, height, uti = "public.png") {
    const id = `fake-image-${++imageCount}`;
    images.set(id, { width, height, uti });
    return { __image: id, width, height };
  }
  function entry(value) {
    const found = isObject(value) && typeof value.__image === "string" ? images.get(value.__image) : undefined;
    if (found) return found;
    if (isObject(value) && typeof value.__image === "string" && Number.isFinite(value.width) && Number.isFinite(value.height)) {
      const adopted = { width: value.width, height: value.height, uti: "public.png" };
      images.set(value.__image, adopted);
      return adopted;
    }
    throw yabError("badResult", "expected an image handle (item.image or the result of a yab.image call)");
  }
  const FORMATS = { jpeg: "public.jpeg", png: "public.png", webp: "org.webmproject.webp", heic: "public.heic" };
  function pngSize(bytes) {
    const png = bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!png) return [1, 1];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
  }
  function visionCall(name, image) {
    record(`vision.${name}`, [image]);
    return rejectWith(() => {
      entry(image);
      const own = scope();
      const given = options.vision?.[name];
      if (given === undefined) throw yabError("unavailable", `the fake host has no vision.${name} answer; pass createFakeHost({ vision: { ${name} } })`);
      return pending(own, () => answer(given, image));
    });
  }

  // ---- yab ----
  const yab = {
    get language() {
      return languageNow();
    },
    t(key, args) {
      const language = languageNow();
      const defaultLocale = typeof manifest.defaultLocale === "string" ? manifest.defaultLocale : "en";
      let text = key;
      for (const table of [locales[language], locales[defaultLocale]]) {
        if (isObject(table) && typeof table[key] === "string") {
          text = table[key];
          break;
        }
      }
      for (const [name, value] of Object.entries(isObject(args) ? args : {})) {
        const replacement = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
        text = text.replaceAll(`{${name}}`, replacement);
      }
      return text;
    },
    get preferences() {
      return structuredClone(preferences);
    },
    secrets: {
      get(id) {
        record("secrets.get", [id]);
        if (typeof id !== "string") return null;
        if (manifest.preferences !== undefined && !secretIDs.has(id)) return null;
        return Object.hasOwn(options.secrets ?? {}, id) ? String(options.secrets[id]) : null;
      },
    },
    storage: {
      get(key) {
        return Object.hasOwn(storage, key) ? structuredClone(storage[key]) : undefined;
      },
      set(key, value) {
        record("storage.set", [key, value]);
        const next = { ...storage, [key]: value === undefined ? null : JSON.parse(JSON.stringify(value) ?? "null") };
        if (encoder.encode(JSON.stringify(next)).length > 1_048_576) throw new Error("yab.storage is full (1 MB); remove keys before adding more");
        storage[key] = next[key];
      },
      remove(key) {
        record("storage.remove", [key]);
        delete storage[key];
      },
    },
    image: {
      info(image) {
        const found = entry(image);
        return { width: found.width, height: found.height, uti: found.uti };
      },
      convert(image, convertOptions = {}) {
        record("image.convert", [image, convertOptions]);
        return rejectWith(() => {
          const found = entry(image);
          const format = String(convertOptions?.format ?? "png").toLowerCase();
          if (!Object.hasOwn(FORMATS, format)) throw yabError("badResult", `unknown image format "${format}"; use jpeg, png, webp or heic`);
          if (format === "webp") throw yabError("unavailable", "this Mac cannot write webp images");
          let { width, height } = found;
          const maxSize = convertOptions?.maxSize;
          if (Number.isFinite(maxSize) && maxSize >= 1 && Math.max(width, height) > maxSize) {
            const scale = maxSize / Math.max(width, height);
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
          }
          return Promise.resolve(handle(width, height, FORMATS[format]));
        });
      },
      resize(image, resizeOptions = {}) {
        record("image.resize", [image, resizeOptions]);
        return rejectWith(() => {
          const found = entry(image);
          const scale = resizeOptions?.scale ?? 1;
          const width = Math.round(resizeOptions?.width ?? found.width * scale);
          const height = Math.round(resizeOptions?.height ?? found.height * scale);
          if (!(width >= 1 && height >= 1 && width <= 16384 && height <= 16384)) {
            throw yabError("badResult", "resize takes a width, a height or a scale that gives 1 to 16384 pixels");
          }
          return Promise.resolve(handle(width, height));
        });
      },
      fromBytes(bytes, uti) {
        record("image.fromBytes", [bytes, uti]);
        if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw yabError("badResult", "yab.image.fromBytes takes a Uint8Array of an image file");
        const [width, height] = pngSize(bytes);
        return handle(width, height, uti ?? "public.png");
      },
    },
    vision: {
      ocr: (image) => visionCall("ocr", image),
      removeBackground: (image) => visionCall("removeBackground", image),
      readCodes: (image) => visionCall("readCodes", image),
    },
    qr: {
      generate(text, qrOptions = {}) {
        record("qr.generate", [text, qrOptions]);
        if (typeof text !== "string" || text === "") throw yabError("badResult", "yab.qr.generate takes a text");
        const size = Math.round(qrOptions?.size ?? 512);
        return handle(size, size);
      },
    },
    files: {
      get workDir() {
        return scope().workDir;
      },
      write(name, data) {
        record("files.write", [name, data]);
        const own = scope();
        if (own.cancelled) throw cancelled();
        const file = `${own.workDir}/${cleanName(name)}`;
        let bytes;
        if (typeof data === "string" || data instanceof Uint8Array) bytes = bytesOf(data);
        else if (isObject(data) && typeof data.__image === "string") {
          entry(data);
          bytes = encoder.encode(`fake image ${data.__image}`);
        } else throw yabError("badResult", "yab.files.write takes a string, a Uint8Array or an image handle");
        files.set(file, bytes);
        return file;
      },
      read(file) {
        const allowed = readable(file);
        if (!allowed) {
          throw yabError("badResult", "yab.files.read reads only files in yab.files.workDir, the item's own files and the folders chosen in preferences");
        }
        return new Uint8Array(files.get(allowed));
      },
      exists(file) {
        return readable(file) !== undefined;
      },
    },
    http,
    exec,
    notify(message) {
      record("notify", [message]);
      requireEffects("yab.notify");
      if (typeof message !== "string") throw yabError("badResult", "yab.notify takes a message");
      notifications.push([...message].slice(0, 200).join(""));
    },
    open(url) {
      record("open", [url]);
      requireEffects("yab.open");
      let link;
      try {
        link = new URL(String(url));
      } catch {
        link = undefined;
      }
      if (typeof url !== "string" || !link || !["http:", "https:"].includes(link.protocol) || link.hostname === "") {
        throw yabError("badResult", "only http and https links open");
      }
      opened.push(link.href === `${url}/` ? url : link.href);
    },
    history: {
      recent: (limit) => historyCall("history.recent", undefined, limit),
      search: (query, limit) => historyCall("history.search", query, limit),
    },
    ai: {
      generate(prompt, aiOptions) {
        record("ai.generate", aiOptions === undefined ? [prompt] : [prompt, aiOptions]);
        return rejectWith(() => {
          const own = requireEffects("yab.ai.generate");
          if (typeof prompt !== "string") throw yabError("badResult", "yab.ai.generate takes a prompt");
          if (aiOptions !== undefined && aiOptions !== null && !isObject(aiOptions)) {
            throw yabError("badResult", "yab.ai.generate's options are { instructions?, temperature?, maxTokens? }");
          }
          if (aiOptions?.instructions != null && typeof aiOptions.instructions !== "string") throw yabError("badResult", "instructions must be a string");
          for (const name of ["temperature", "maxTokens"]) {
            if (aiOptions?.[name] != null && !Number.isFinite(aiOptions[name])) throw yabError("badResult", `${name} must be a number`);
          }
          if (options.ai === undefined) throw yabError("unavailable", "the fake host has no AI answer; pass createFakeHost({ ai })");
          return pending(own, async () => String(await answer(options.ai, [...prompt].slice(0, 32_000).join(""), { ...(aiOptions ?? {}) })));
        });
      },
    },
    translate(text, translateOptions) {
      record("translate", [text, translateOptions]);
      return rejectWith(() => {
        const own = requireEffects("yab.translate");
        if (typeof text !== "string") throw yabError("badResult", "yab.translate takes a text");
        if (!isObject(translateOptions) || typeof translateOptions.to !== "string" || translateOptions.to === "") {
          throw yabError("badResult", "yab.translate needs the target language: { to: \"tr\" }");
        }
        const from = translateOptions.from ?? undefined;
        if (from !== undefined && (typeof from !== "string" || from === "")) throw yabError("badResult", "from must be a language code, like \"en\"");
        if (options.translate === undefined) throw yabError("unavailable", "the fake host has no translation; pass createFakeHost({ translate })");
        return pending(own, async () => {
          const result = await answer(options.translate, [...text].slice(0, 32_000).join(""), { to: translateOptions.to, ...(from ? { from } : {}) });
          return typeof result === "string" ? { text: result, from: from ?? translateOptions.to } : { ...result };
        });
      });
    },
    job: {
      progress(fraction, message) {
        record("job.progress", message === undefined ? [fraction] : [fraction, message]);
        let share = null;
        if (fraction !== undefined && fraction !== null) {
          if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
            throw yabError("badResult", "yab.job.progress takes a fraction from 0 to 1, or null");
          }
          share = Math.min(1, Math.max(0, fraction));
        }
        if (scope().cancelled) return;
        progress.push({ fraction: share, message: message === undefined || message === null ? null : String(message) });
      },
    },
  };

  /** The fake disk path `file` may be read at, or undefined. */
  function readable(file) {
    if (typeof file !== "string") throw yabError("badResult", "expected a file path");
    const own = scope();
    if (own.cancelled) return undefined;
    const normal = path.posix.normalize(file);
    if (!files.has(normal)) return undefined;
    if (normal.startsWith(`${own.workDir}/`)) return normal;
    const item = own.item ?? options.item;
    if ((item?.files ?? []).some((entry) => path.posix.normalize(String(entry.path)) === normal)) return normal;
    if (readableFolders.some((folder) => normal.startsWith(`${folder}/`))) return normal;
    return undefined;
  }

  // ---- Items and context ----
  function itemFor(item) {
    if (item === null) return null;
    const given = item ?? options.item ?? {};
    const kind = given.kind ?? (given.url !== undefined ? "link" : given.files !== undefined ? "file" : given.image !== undefined ? "image"
      : given.color !== undefined ? "color" : "text");
    return { id: 1, kind, ...(kind === "text" && given.text === undefined ? { text: "" } : {}), tags: [], copiedAt: nowISO(), ...structuredClone(given) };
  }
  function contextFor(overrides = {}, own = scope(), trigger = "search") {
    const base = { language: "en", variant: null, target: null, ...(options.context ?? {}), ...overrides };
    // A run's trigger may be set for every call; previews and capture rules always have their own.
    const defaultTrigger = trigger === "search" ? options.context?.trigger ?? trigger : trigger;
    return { language: base.language, preferences: structuredClone(preferences), trigger: overrides.trigger ?? defaultTrigger,
      variant: base.variant ?? null, target: base.target ?? null, signal: own.controller.signal };
  }
  const languageNow = () => scope().overrides?.language ?? options.context?.language ?? "en";

  /** Makes this host's `yab` and `fetch` the global ones; returns a function that puts the old ones back. */
  function setGlobals() {
    const previous = { yab: Object.getOwnPropertyDescriptor(globalThis, "yab"), fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch") };
    const ours = { yab, fetch: fakeFetch };
    for (const name of ["yab", "fetch"]) Object.defineProperty(globalThis, name, { value: ours[name], writable: true, configurable: true, enumerable: true });
    return () => {
      for (const name of ["yab", "fetch"]) {
        if (globalThis[name] !== ours[name]) continue;
        if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
        else delete globalThis[name];
      }
    };
  }

  // ---- Running the extension ----
  // The extension's code finds `yab` and `fetch` as globals, so they are this host's while the call runs.
  function call(kind, effects, item, overrides, invoke) {
    const own = makeScope(kind, effects);
    own.item = item;
    own.overrides = overrides ?? {};
    const restoreGlobals = setGlobals();
    return withClock(clock, () => new Promise((resolve, reject) => {
      own.pending.add(() => reject(cancelled()));
      current.run(own, () => {
        try {
          Promise.resolve(invoke(own)).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    })).finally(() => {
      active.delete(own);
      restoreGlobals();
    });
  }
  function checkResult(value, own) {
    if (!isObject(value)) throw yabError("badResult", `run returned ${shape(value)}; ${RESULT_SHAPES}`);
    if (typeof value.html === "string" || typeof value.text === "string") return;
    if (isObject(value.link)) {
      if (typeof value.link.url !== "string") throw yabError("badResult", `link.url is missing; ${RESULT_SHAPES}`);
      return;
    }
    const workFile = (file) => {
      if (typeof file !== "string") throw yabError("badResult", "a file result takes a path (a string from yab.files.write)");
      const normal = path.posix.normalize(file);
      if (!normal.startsWith(`${own.workDir}/`) || !files.has(normal)) throw yabError("badResult", "a file result must be a file in yab.files.workDir");
    };
    if (value.file !== undefined) return workFile(value.file);
    if (value.files !== undefined) {
      if (!Array.isArray(value.files) || value.files.length === 0) throw yabError("badResult", "files must be a list of paths with at least one file");
      value.files.forEach(workFile);
      return;
    }
    if (value.none === true) return;
    if (value.image !== undefined) {
      entry(value.image);
      return;
    }
    throw yabError("badResult", `run returned an object of another shape; ${RESULT_SHAPES}`);
  }
  const shape = (value) => (value === null || value === undefined ? "nothing" : Array.isArray(value) ? "an array"
    : typeof value === "object" ? "an object" : `a ${typeof value}`);

  function runAction(action, item, overrides, effects) {
    const subject = itemFor(item);
    return call("run", effects, subject, overrides, async (own) => {
      const value = await action.run(subject, contextFor(overrides, own, "search"));
      if (own.cancelled) throw cancelled();
      checkResult(value, own);
      results.push(value);
      return value;
    });
  }

  const host = {
    yab,
    calls,
    notifications,
    opened,
    progress,
    results,
    files,
    storage,
    /** A Context like the one a call gets. */
    context: (overrides) => contextFor(overrides),
    run: (action, item, overrides) => runAction(action, item, overrides, true),
    hint: (action, item, overrides) => runAction(action, item, overrides, false),
    validate(detector, item) {
      const subject = itemFor(item);
      return call("validate", false, subject, undefined, (own) => {
        const value = detector.validate(subject);
        if (value && typeof value.then === "function") throw yabError("badResult", "validate must answer at once, without a promise");
        if (own.cancelled) throw cancelled();
        const valid = typeof value === "boolean" ? value : value !== null && value !== undefined;
        results.push(valid);
        return valid;
      });
    },
    preview(detector, item, overrides) {
      const subject = itemFor(item);
      return call("preview", false, subject, overrides, async (own) => {
        const value = await detector.preview(subject, contextFor(overrides, own, "preview"));
        if (own.cancelled) throw cancelled();
        if (!Array.isArray(value)) throw yabError("badResult", "preview must return an array of sections");
        for (const section of value) {
          if (!["text", "code", "keyValue", "link", "image"].includes(section?.type)) {
            throw yabError("badResult", "unknown preview section type; expected text, code, keyValue, image or link");
          }
          if (section.type === "image") entry(section.image);
        }
        results.push(value);
        return value;
      });
    },
    capture(rule, item, overrides) {
      const subject = itemFor(item);
      return call("captureRule", false, subject, overrides, async (own) => {
        const value = await rule.run(subject, contextFor(overrides, own, "capture"));
        if (own.cancelled) throw cancelled();
        const ok = value === undefined || value === null || (isObject(value) && (value.keep === true || value.ignore === true
          || (isObject(value.replace) && ((typeof value.replace.text === "string" && value.replace.text !== "")
            || (typeof value.replace.url === "string" && value.replace.url !== "")))
          || (typeof value.addToCategory === "string" && value.addToCategory !== "")));
        if (!ok) throw yabError("badResult", `a capture rule returned something else; ${CAPTURE_SHAPES}`);
        results.push(value ?? undefined);
        return value ?? undefined;
      });
    },
    cancel() {
      for (const own of [...active]) {
        own.cancelled = true;
        own.controller.abort(cancelled());
        for (const stop of [...own.pending]) stop();
        own.pending.clear();
      }
      active.clear();
      defaultScope = makeScope("run", true);
    },
    install: () => setGlobals(),
  };
  return host;
}
