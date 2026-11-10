// Checks an extension folder the way the app does, and then by the store's own rules.
//
// The app's rules are the app's manifest validator, check for check and with the same codes: what the app refuses to
// load, this refuses too (schema/fixtures holds the cases both sides are tested on). The store adds rules of its
// own (STORE_CODES): an allowed license, README.md and CHANGELOG.md, a complete en locale, and the JSON schema.

import fs from "node:fs";
import path from "node:path";

import { checkICUPattern } from "./icu-regex.mjs";
import { checkSchema } from "./json-schema.mjs";

const manifestSchema = JSON.parse(fs.readFileSync(new URL("../../schema/manifest.schema.json", import.meta.url), "utf8"));

export const ALLOWED_LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0"];

/** Codes of the app's own checks. */
export const APP_CODES = [
  "manifestMissing", "manifestNotObject", "manifestUnreadable", "missingField", "notAString", "invalidID", "idFolderMismatch",
  "invalidVersion", "unsupportedAPIVersion", "defaultLocaleMissing", "unknownLocaleKey", "unknownCategory", "unknownPermission",
  "captureRulesNeedCapture", "networkNeedsDomains", "invalidDomain", "execNeedsTools", "toolsNeedExec", "notAnObject",
  "invalidToolName", "invalidMemberID", "duplicateID", "unknownPreferenceType", "secretDefault", "folderDefault",
  "choiceNeedsOptions", "unknownInput", "unknownOutput", "unknownTarget", "targetsOnlyNeedsTargets", "acceptsMissing",
  "kindsEmpty", "unknownKind", "invalidPattern", "captureRuleTags", "sourceActionCount", "unknownSourceActionKind",
  "sourceSecretNeedsSensitive", "sourceSecretWithNetwork", "sourceCopyNeedsText", "variantPreference", "indexMissing",
];

/** Codes of the rules only the store has. */
export const STORE_CODES = [
  "licenseNotAllowed", "readmeMissing", "changelogMissing", "enLocaleMissing", "enLocaleKeyMissing", "localeUnreadable",
  "unknownField", "schemaMismatch", "notARegularFile",
];

const CATEGORIES = ["text", "links", "images", "files", "developer", "media", "ai", "productivity"];
const GRANTABLE = ["network", "exec", "capture", "history"];
const PREFERENCE_TYPES = ["text", "toggle", "choice", "secret", "folder"];
const INPUTS = ["none", "item"];
const OUTPUTS = ["text", "html", "image", "link", "file", "files", "none"];
const TARGETS = ["finder", "terminal", "browser", "editor", "other"];
const KINDS = ["text", "code", "link", "color", "image", "file"];
const SOURCE_ACTION_KINDS = ["secret", "text"];

// The app matches these with ICU, where \d is any decimal digit.
export const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const VERSION_PATTERN = /^\p{Nd}+\.\p{Nd}+\.\p{Nd}+(-[0-9A-Za-z.-]+)?$/u;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const TOOL_PATTERN = /^[A-Za-z0-9._+-]+$/;
const MEMBER_PATTERN = /^[A-Za-z0-9._-]+$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};
const quoted = (value) => (typeof value === "string" ? `"${value}"` : "this");

/** One line per issue: `<path>: <field>: <message> (expected …) → fix: …`. */
export function formatIssue(issue) {
  return `${issue.path}: ${issue.field ? `${issue.field}: ` : ""}${issue.level === "warning" ? "warning: " : ""}${issue.message}`
    + `${issue.expected ? ` (expected ${issue.expected})` : ""}${issue.fix ? ` → fix: ${issue.fix}` : ""}`;
}

/**
 * Symbolic links and anything else that is not a plain file or folder in `folder`, `node_modules` aside. The build
 * would copy what a link points at into a public package, so the store takes regular files only. Links are reported,
 * never followed. Issue paths are relative to `relativeTo`.
 */
export function fileTypeIssues(folder, { relativeTo = process.cwd() } = {}) {
  const issues = [];
  const visit = (full, name) => {
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
      if (name !== "node_modules") for (const child of fs.readdirSync(full).sort()) visit(path.join(full, child), child);
      return;
    }
    if (stat.isFile()) return;
    issues.push({
      path: path.relative(relativeTo, full) || name, field: "", level: "error", code: "notARegularFile",
      message: stat.isSymbolicLink()
        ? "it is a symbolic link, and an extension holds only regular files and folders"
        : "it is not a regular file (a pipe, socket or device), and an extension holds only regular files and folders",
      fix: "Replace it with a copy of the file itself, or remove it.",
    });
  };
  let exists = true;
  try {
    fs.lstatSync(folder);
  } catch {
    exists = false;
  }
  if (exists) visit(folder, path.basename(folder));
  return issues;
}

/**
 * Checks the extension in `folder`. `store: false` leaves the store's own rules out and checks only what the app checks.
 * Issue paths are relative to `relativeTo`.
 * @returns {{ issues: Array<{ path: string, field: string, level: "error" | "warning", code: string, message: string, expected?: string, fix?: string }> }}
 */
export function validateExtension(folder, { store = true, relativeTo = process.cwd() } = {}) {
  const issues = store ? fileTypeIssues(folder, { relativeTo }) : [];
  const display = (file) => path.relative(relativeTo, path.join(folder, file)) || file;
  const add = (file, field, code, message, { expected, fix, level = "error" } = {}) => {
    const issue = { path: display(file), field, level, code, message };
    if (expected !== undefined) issue.expected = expected;
    if (fix !== undefined) issue.fix = fix;
    issues.push(issue);
  };

  const storeFiles = () => {
    if (!store) return;
    if (!isFile(path.join(folder, "README.md"))) {
      add("README.md", "", "readmeMissing", "README.md is missing", { fix: "Add README.md: what the extension does, an example, and why it needs each permission." });
    }
    if (!isFile(path.join(folder, "CHANGELOG.md"))) {
      add("CHANGELOG.md", "", "changelogMissing", "CHANGELOG.md is missing", { fix: "Add CHANGELOG.md with a \"## <version>\" section for each version." });
    }
  };

  let text;
  try {
    text = fs.readFileSync(path.join(folder, "manifest.json"), "utf8");
  } catch {
    add("manifest.json", "", "manifestMissing", "manifest.json is missing", { fix: "Add manifest.json at the extension folder's root." });
    storeFiles();
    return { issues };
  }
  let root;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    root = undefined;
  }
  if (!isObject(root)) {
    add("manifest.json", "", "manifestNotObject", "manifest.json is not a JSON object", { fix: "Make manifest.json a valid JSON object." });
    storeFiles();
    return { issues };
  }

  const locales = readLocales(folder);
  const defaultLocale = typeof root.defaultLocale === "string" ? root.defaultLocale : "en";
  // Like the app: one unreadable locale file and no locale is read at all.
  const tables = locales.unreadable.length > 0 ? {} : locales.tables;

  const appIssues = [];
  checkManifest(root, { folder, defaultLocale, tables, source: store }, (field, code, message, options) => appIssues.push({ field, code, message, ...options }));
  if (!appIssues.some((issue) => (issue.level ?? "error") === "error")) {
    decodeManifest(root, (field, message, fix, expected) => appIssues.push({ field, code: "manifestUnreadable", message, fix, expected }));
  }
  for (const { field, code, message, expected, fix, level, file } of appIssues) {
    add(file ?? "manifest.json", field, code, message, { expected, fix, level });
  }
  if (!store) return { issues };

  // ---- The store's rules ----
  // The app loads a variant whose "preference" names no toggle, always shows it and warns; the store takes only a
  // variant that its setting can hide.
  for (const issue of issues) if (issue.code === "variantPreference") issue.level = "error";
  for (const language of locales.unreadable) {
    add(path.join("locales", `${language}.json`), "", "localeUnreadable", `locales/${language}.json is not a JSON object`,
      { fix: `Make locales/${language}.json a JSON object of keys and texts.` });
  }
  if (typeof root.license === "string" && root.license !== "" && !ALLOWED_LICENSES.includes(root.license)) {
    add("manifest.json", "license", "licenseNotAllowed", `"${root.license}" is not a license the store accepts`,
      { expected: ALLOWED_LICENSES.join(", "), fix: "Use one of the listed SPDX ids; MIT is the usual choice." });
  }
  storeFiles();

  const sameAsApp = (field, message) => appIssues.some((issue) => issue.field === field && issue.message === message);
  if (!Object.hasOwn(locales.tables, "en") && !locales.unreadable.includes("en")) {
    if (root.defaultLocale !== "en") {
      add(path.join("locales", "en.json"), "", "enLocaleMissing", "locales/en.json is missing",
        { fix: "Add locales/en.json: every extension ships English." });
    }
  } else if (!locales.unreadable.includes("en")) {
    for (const { field, key, wantsList } of localeKeys(root)) {
      if (Object.hasOwn(locales.tables.en, key)) continue;
      const message = `the key "${key}" is not in locales/en.json`;
      if (sameAsApp(field, message)) continue;
      add("manifest.json", field, "enLocaleKeyMissing", message, { fix: `Add "${key}" to locales/en.json${wantsList ? " as an array of keywords." : "."}` });
    }
  }

  const related = (a, b) => a === b || b.startsWith(`${a}.`) || b.startsWith(`${a}[`) || a.startsWith(`${b}.`) || a.startsWith(`${b}[`);
  for (const error of checkSchema(manifestSchema, root)) {
    if (error.keyword === "additionalProperties") {
      const name = error.field.split(/[.[]/).at(-1);
      add("manifest.json", error.field, "unknownField", `"${name}" is not a manifest field here`,
        { fix: `Remove "${name}", or check its spelling against schema/manifest.schema.json.` });
      continue;
    }
    if (appIssues.some((issue) => related(issue.field, error.field))) continue;
    add("manifest.json", error.field, "schemaMismatch", error.message,
      { expected: error.expected, fix: "Compare it with schema/manifest.schema.json." });
  }
  return { issues };
}

/** locales/*.json: the tables that read as JSON objects, and the languages whose file does not. */
function readLocales(folder) {
  const tables = {};
  const unreadable = [];
  let names = [];
  try {
    names = fs.readdirSync(path.join(folder, "locales"));
  } catch {
    names = [];
  }
  for (const name of names.filter((file) => file.endsWith(".json")).sort()) {
    const language = name.slice(0, -".json".length);
    try {
      const table = JSON.parse(fs.readFileSync(path.join(folder, "locales", name), "utf8").replace(/^\uFEFF/, ""));
      if (!isObject(table)) throw new Error("not an object");
      tables[language] = table;
    } catch {
      unreadable.push(language);
    }
  }
  return { tables, unreadable };
}

/** Every locale key the manifest uses, with the field that uses it. */
function localeKeys(root) {
  const keys = [];
  const take = (object, key, field, wantsList = false) => {
    if (isObject(object) && typeof object[key] === "string" && object[key] !== "") keys.push({ field, key: object[key], wantsList });
  };
  const list = (value) => (Array.isArray(value) ? value : []);
  take(root, "name", "name");
  take(root, "description", "description");
  list(root.preferences).forEach((preference, i) => {
    take(preference, "title", `preferences[${i}].title`);
    take(preference, "confirm", `preferences[${i}].confirm`);
    list(preference?.options).forEach((option, j) => take(option, "title", `preferences[${i}].options[${j}].title`));
  });
  const contributes = isObject(root.contributes) ? root.contributes : {};
  list(contributes.actions).forEach((action, i) => {
    const at = `contributes.actions[${i}]`;
    for (const key of ["title", "subtitle", "keywords", "verb", "failTitle"]) take(action, key, `${at}.${key}`, key === "keywords");
    list(action?.variants).forEach((variant, j) => {
      for (const key of ["title", "subtitle", "failTitle"]) take(variant, key, `${at}.variants[${j}].${key}`);
    });
  });
  list(contributes.captureRules).forEach((rule, i) => {
    take(rule, "title", `contributes.captureRules[${i}].title`);
    take(rule, "description", `contributes.captureRules[${i}].description`);
  });
  list(contributes.detectors).forEach((detector, i) => take(detector, "tag", `contributes.detectors[${i}].tag`));
  list(contributes.sources).forEach((source, i) => {
    take(source, "title", `contributes.sources[${i}].title`);
    list(source?.actions).forEach((action, j) => {
      for (const key of ["title", "label", "copyTitle", "copied"]) take(action, key, `contributes.sources[${i}].actions[${j}].${key}`);
    });
  });
  return keys;
}

// ---------------------------------------------------------------------------------------------------------------
// The app's checks, in the app's order.

function checkManifest(root, { folder, defaultLocale, tables, source }, report) {
  const issue = (field, code, message, fix, expected) => report(field, code, message, { fix, expected });

  /** A non-empty string at `key`, or an issue. */
  const string = (key, object, field, fix) => {
    if (!Object.hasOwn(object, key)) { issue(field, "missingField", `"${key}" is missing`, fix); return undefined; }
    const value = object[key];
    if (typeof value !== "string" || value === "") { issue(field, "notAString", `"${key}" must be a non-empty string`, fix); return undefined; }
    return value;
  };

  const localeKey = (key, object, field, wantsList = false) => {
    const name = string(key, object, field, `Add "${key}" with a key from locales/${defaultLocale}.json.`);
    if (name === undefined) return;
    if (!(Object.hasOwn(tables, defaultLocale) && Object.hasOwn(tables[defaultLocale], name))) {
      issue(field, "unknownLocaleKey", `the key "${name}" is not in locales/${defaultLocale}.json`,
        `Add "${name}" to locales/${defaultLocale}.json${wantsList ? " as an array of keywords." : "."}`);
    }
  };

  /** An action, variant, preference, rule, detector, source or source action id: present, usable, and once in its list. */
  const memberID = (object, field, what, seen) => {
    const id = string("id", object, field, `Give the ${what} an "id".`);
    if (id === undefined) return;
    if (!MEMBER_PATTERN.test(id)) {
      issue(field, "invalidMemberID", `"${id}" is not a usable ${what} id`, "Use only letters, digits, dots, underscores and dashes.",
        "letters, digits, \".\", \"_\" and \"-\"");
    } else if (seen.has(id)) {
      issue(field, "duplicateID", `the ${what} id "${id}" is used twice`, `Give every ${what} its own id.`);
    } else seen.add(id);
  };

  const acceptSpec = (value, field) => {
    if (!isObject(value)) { issue(field, "notAnObject", "\"accepts\" must be an object", "Write it as {\"kinds\": [\"text\"]}."); return; }
    const kinds = Array.isArray(value.kinds) ? value.kinds : [];
    if (kinds.length === 0) issue(`${field}.kinds`, "kindsEmpty", "\"kinds\" is empty", "List at least one kind, e.g. [\"text\"].", KINDS.join(", "));
    kinds.forEach((kind, index) => {
      if (!KINDS.includes(typeof kind === "string" ? kind : "")) {
        issue(`${field}.kinds[${index}]`, "unknownKind", `${quoted(kind)} is not a kind`, `Use one of: ${KINDS.join(", ")}.`, KINDS.join(", "));
      }
    });
    const pattern = typeof value.pattern === "string" ? checkICUPattern(value.pattern) : { valid: true };
    if (pattern.reason === "invalid") {
      issue(`${field}.pattern`, "invalidPattern", `"${value.pattern}" is not a valid regular expression`,
        "Fix the pattern so it compiles as an ICU regular expression.");
    } else if (pattern.reason === "unverifiable") {
      // The app may or may not compile it; the store does not pass what it cannot check.
      issue(`${field}.pattern`, "invalidPattern", `the store validator cannot verify ${pattern.construct} in "${value.pattern}"`,
        "Use a simpler pattern, e.g. a character class such as [A-Za-z], or a category or script such as \\p{L} or \\p{Latin}.");
    }
  };

  const list = (value) => (Array.isArray(value) ? value : []);

  /** A variant's "preference" names one of the extension's toggles, which shows and hides it; anything else, a warning. */
  const variantPreference = (value, field) => {
    const warn = (message) => report(field, "variantPreference", message,
      { fix: "Name one of this extension's \"toggle\" preferences, or remove \"preference\".", level: "warning" });
    if (typeof value !== "string") { warn("\"preference\" must be the id of a toggle preference; this variant is always offered"); return; }
    // The first preference with the id decides, as when the app reads the values.
    const named = list(root.preferences).find((preference) => isObject(preference) && preference.id === value);
    if (named === undefined) { warn(`there is no preference "${value}"; this variant is always offered`); return; }
    if (named.type === "toggle") return;
    const type = typeof named.type === "string" ? `a ${named.type} preference` : "a preference";
    warn(`"${value}" is ${type}, not a toggle; this variant is always offered`);
  };

  // Identity
  const id = string("id", root, "id", "Add an \"id\" such as \"dev.yourname.tool\".");
  if (id !== undefined) {
    const folderName = path.basename(path.resolve(folder));
    if (!ID_PATTERN.test(id)) {
      issue("id", "invalidID", `"${id}" is not a reverse-domain id`,
        "Use lowercase letters, digits and dashes separated by dots, e.g. \"dev.yourname.tool\".", "lowercase reverse-domain, e.g. dev.yourname.tool");
    } else if (id !== folderName) {
      issue("id", "idFolderMismatch", `the id "${id}" does not match the folder name "${folderName}"`,
        `Rename the folder to "${id}" or change the id to match it.`);
    }
  }
  const version = string("version", root, "version", "Add \"version\": \"1.0.0\".");
  if (version !== undefined && !VERSION_PATTERN.test(version)) {
    issue("version", "invalidVersion", `"${version}" is not semantic versioning`, "Write the version as \"1.0.0\".", "MAJOR.MINOR.PATCH");
  }
  if (typeof root.apiVersion !== "number") {
    issue("apiVersion", "missingField", "\"apiVersion\" is missing", "Add \"apiVersion\": 1.", "1");
  } else if (root.apiVersion !== 1) {
    issue("apiVersion", "unsupportedAPIVersion", `API version ${root.apiVersion.toLocaleString("en-US", { maximumFractionDigits: 6 })} is not supported`,
      "Set \"apiVersion\": 1.", "1");
  }
  const locale = string("defaultLocale", root, "defaultLocale", "Add \"defaultLocale\": \"en\".");
  if (locale !== undefined && !fs.existsSync(path.join(folder, "locales", `${locale}.json`))) {
    issue("defaultLocale", "defaultLocaleMissing", `there is no locales/${locale}.json for the default locale`,
      `Add locales/${locale}.json or set "defaultLocale" to a language you ship.`);
  }
  localeKey("name", root, "name");
  localeKey("description", root, "description");
  string("icon", root, "icon", "Add \"icon\": \"sf:<SF Symbol name>\" or \"icon.png\".");
  string("author", root, "author", "Add \"author\": your name or your GitHub user name, as you want to be credited.");
  string("license", root, "license", "Add \"license\", e.g. \"MIT\".");
  list(root.categories).forEach((category, index) => {
    if (!CATEGORIES.includes(typeof category === "string" ? category : "")) {
      issue(`categories[${index}]`, "unknownCategory", `${quoted(category)} is not a category`, `Use one of: ${CATEGORIES.join(", ")}.`, CATEGORIES.join(", "));
    }
  });

  // Permissions
  const granted = new Set();
  for (const permission of list(root.permissions)) {
    const name = typeof permission === "string" ? permission : "";
    if (GRANTABLE.includes(name)) granted.add(name);
    else issue("permissions", "unknownPermission", `${quoted(permission)} is not a permission`, `Use one of: ${GRANTABLE.join(", ")}.`, GRANTABLE.join(", "));
  }
  const contributes = isObject(root.contributes) ? root.contributes : {};
  if (list(contributes.captureRules).length > 0 && !granted.has("capture")) {
    issue("contributes.captureRules", "captureRulesNeedCapture", "captureRules need the capture permission",
      "Add \"capture\" to \"permissions\" or remove \"captureRules\".");
  }
  if (Object.hasOwn(root, "network")) {
    const network = root.network;
    if (!isObject(network) || !Array.isArray(network.domains)) {
      issue("network.domains", "networkNeedsDomains", "\"network\" needs a list of domains", "Write \"network\": {\"domains\": [\"example.com\"]}.");
    }
    list(isObject(network) ? network.domains : undefined).forEach((domain, index) => {
      if (!(typeof domain === "string" && HOST_PATTERN.test(domain))) {
        issue(`network.domains[${index}]`, "invalidDomain", `${quoted(domain)} is not a plain lowercase host name`,
          "Write only the host: no https://, no path and no \"*\".", "a lowercase host name such as video.example");
      }
    });
  }
  const tools = list(isObject(root.requires) ? root.requires.tools : undefined);
  if (granted.has("exec") && tools.length === 0) {
    issue("requires.tools", "execNeedsTools", "\"exec\" needs the tools the extension runs",
      "Add \"requires\": {\"tools\": [{\"name\": \"yt-dlp\", \"install\": \"brew install yt-dlp\"}]}.");
  } else if (!granted.has("exec") && tools.length > 0) {
    issue("requires.tools", "toolsNeedExec", "tools are listed but \"exec\" is not a permission", "Add \"exec\" to \"permissions\" or remove \"requires\".");
  }
  tools.forEach((tool, index) => {
    const field = `requires.tools[${index}]`;
    if (!isObject(tool)) { issue(field, "notAnObject", "a tool must be an object", "Write it as {\"name\", \"install\"}."); return; }
    const name = string("name", tool, `${field}.name`, "Give the tool a \"name\" such as \"yt-dlp\".");
    if (name !== undefined && !TOOL_PATTERN.test(name)) {
      issue(`${field}.name`, "invalidToolName", `"${name}" is not a usable tool name`, "Use the bare command name, not a path.",
        "letters, digits, \".\", \"_\", \"+\" and \"-\"");
    }
    string("install", tool, `${field}.install`, "Add \"install\" with the command that installs it, e.g. \"brew install yt-dlp\".");
  });

  // Preferences
  const preferenceIDs = new Set();
  list(root.preferences).forEach((preference, index) => {
    const field = `preferences[${index}]`;
    if (!isObject(preference)) { issue(field, "notAnObject", "a preference must be an object", "Write it as {\"id\", \"type\", \"title\", \"default\"}."); return; }
    memberID(preference, `${field}.id`, "preference", preferenceIDs);
    const type = string("type", preference, `${field}.type`, "Add \"type\": \"toggle\", \"text\", \"choice\", \"secret\" or \"folder\".");
    if (type !== undefined && !PREFERENCE_TYPES.includes(type)) {
      issue(`${field}.type`, "unknownPreferenceType", `"${type}" is not a preference type`, "Use \"text\", \"toggle\", \"choice\", \"secret\" or \"folder\".",
        PREFERENCE_TYPES.join(", "));
    }
    localeKey("title", preference, `${field}.title`);
    const defaultValue = preference.default ?? undefined;
    if (preference.type === "secret" && defaultValue !== undefined) {
      issue(`${field}.default`, "secretDefault", "a secret cannot have a default", "Remove \"default\"; the person types the secret in Settings.");
    }
    if (preference.type === "folder" && defaultValue !== undefined && !(typeof defaultValue === "string" && defaultValue.startsWith("~"))) {
      issue(`${field}.default`, "folderDefault", "a folder default must start with \"~\"",
        "Write the default as \"~/Downloads\" or remove it; the person chooses the folder in Settings.", "a path such as ~/Downloads");
    }
    if (Object.hasOwn(preference, "confirm")) localeKey("confirm", preference, `${field}.confirm`);
    if (preference.type === "choice" && list(preference.options).length === 0) {
      issue(`${field}.options`, "choiceNeedsOptions", "a choice needs options", "Add \"options\": [{\"id\", \"title\"}].");
    }
  });

  // Contributions
  const actionIDs = new Set();
  list(contributes.actions).forEach((action, index) => {
    const field = `contributes.actions[${index}]`;
    if (!isObject(action)) { issue(field, "notAnObject", "an action must be an object", "Write it as {\"id\", \"title\", …}."); return; }
    memberID(action, `${field}.id`, "action", actionIDs);
    localeKey("title", action, `${field}.title`);
    if (Object.hasOwn(action, "subtitle")) localeKey("subtitle", action, `${field}.subtitle`);
    localeKey("keywords", action, `${field}.keywords`, true);
    const input = string("input", action, `${field}.input`, "Add \"input\": \"item\" or \"none\".");
    if (input !== undefined && !INPUTS.includes(input)) issue(`${field}.input`, "unknownInput", `"${input}" is not an input`, "Use \"item\" or \"none\".", "item, none");
    const output = string("output", action, `${field}.output`, "Add \"output\", e.g. \"text\".");
    if (output !== undefined && !OUTPUTS.includes(output)) {
      issue(`${field}.output`, "unknownOutput", `"${output}" is not an output`, `Use one of: ${OUTPUTS.join(", ")}.`, OUTPUTS.join(", "));
    }
    if (Object.hasOwn(action, "verb")) localeKey("verb", action, `${field}.verb`);
    if (Object.hasOwn(action, "failTitle")) localeKey("failTitle", action, `${field}.failTitle`);
    const targets = list(action.targets);
    targets.forEach((target, targetIndex) => {
      if (!TARGETS.includes(typeof target === "string" ? target : "")) {
        issue(`${field}.targets[${targetIndex}]`, "unknownTarget", `${quoted(target)} is not a target`, `Use one of: ${TARGETS.join(", ")}.`, TARGETS.join(", "));
      }
    });
    if (action.targetsOnly === true && targets.length === 0) {
      issue(`${field}.targetsOnly`, "targetsOnlyNeedsTargets", "\"targetsOnly\" needs at least one entry in \"targets\"",
        "Add \"targets\": [\"finder\"] or remove \"targetsOnly\".");
    }
    if (input === "item") {
      if (Object.hasOwn(action, "accepts")) acceptSpec(action.accepts, `${field}.accepts`);
      else issue(`${field}.accepts`, "acceptsMissing", "an action that takes an item needs \"accepts\"", "Add \"accepts\": {\"kinds\": [\"text\"]}.");
    }
    const variantIDs = new Set();
    list(action.variants).forEach((variant, variantIndex) => {
      const variantField = `${field}.variants[${variantIndex}]`;
      if (!isObject(variant)) { issue(variantField, "notAnObject", "a variant must be an object", "Write it as {\"id\", \"title\"}."); return; }
      memberID(variant, `${variantField}.id`, "variant", variantIDs);
      localeKey("title", variant, `${variantField}.title`);
      if (Object.hasOwn(variant, "failTitle")) localeKey("failTitle", variant, `${variantField}.failTitle`);
      if (Object.hasOwn(variant, "preference") && variant.preference !== null) variantPreference(variant.preference, `${variantField}.preference`);
    });
  });

  const ruleIDs = new Set();
  list(contributes.captureRules).forEach((rule, index) => {
    const field = `contributes.captureRules[${index}]`;
    if (!isObject(rule)) { issue(field, "notAnObject", "a capture rule must be an object", "Write it as {\"id\", \"title\", \"accepts\"}."); return; }
    memberID(rule, `${field}.id`, "capture rule", ruleIDs);
    localeKey("title", rule, `${field}.title`);
    if (Object.hasOwn(rule, "description")) localeKey("description", rule, `${field}.description`);
    if (Object.hasOwn(rule, "accepts")) {
      acceptSpec(rule.accepts, `${field}.accepts`);
      // Rules run before tags exist, so a tag filter would never match.
      if (isObject(rule.accepts) && list(rule.accepts.tags).length > 0) {
        report(`${field}.accepts.tags`, "captureRuleTags", "capture rules never see tags; this rule would never run",
          { fix: "Remove \"tags\" from \"accepts\"; filter on \"kinds\" or \"pattern\" instead.", level: "warning" });
      }
    } else issue(`${field}.accepts`, "acceptsMissing", "a capture rule needs \"accepts\"", "Add \"accepts\": {\"kinds\": [\"link\"]}.");
  });

  // Sources: a secret is pasted, never kept, and never next to the network.
  const sourceIDs = new Set();
  let hasSecret = false;
  list(contributes.sources).forEach((source, index) => {
    const field = `contributes.sources[${index}]`;
    if (!isObject(source)) { issue(field, "notAnObject", "a source must be an object", "Write it as {\"id\", \"title\", \"actions\"}."); return; }
    memberID(source, `${field}.id`, "source", sourceIDs);
    localeKey("title", source, `${field}.title`);
    const actions = list(source.actions);
    if (actions.length < 1 || actions.length > 2) {
      issue(`${field}.actions`, "sourceActionCount", `a source needs one or two actions, not ${actions.length}`,
        "List one action, or two: ↵ runs the first and ⇧↵ the second.", "1 or 2");
    }
    const actionIDs = new Set();
    let sourceHasSecret = false;
    actions.forEach((action, actionIndex) => {
      const actionField = `${field}.actions[${actionIndex}]`;
      if (!isObject(action)) {
        issue(actionField, "notAnObject", "a source action must be an object", "Write it as {\"id\", \"kind\", \"title\", \"label\"}.");
        return;
      }
      memberID(action, `${actionField}.id`, "source action", actionIDs);
      const kind = string("kind", action, `${actionField}.kind`, "Add \"kind\": \"secret\" or \"text\".");
      if (kind !== undefined && !SOURCE_ACTION_KINDS.includes(kind)) {
        issue(`${actionField}.kind`, "unknownSourceActionKind", `"${kind}" is not a source action kind`, "Use \"secret\" or \"text\".",
          SOURCE_ACTION_KINDS.join(", "));
      }
      localeKey("title", action, `${actionField}.title`);
      localeKey("label", action, `${actionField}.label`);
      for (const key of ["copyTitle", "copied"]) {
        if (!Object.hasOwn(action, key)) continue;
        localeKey(key, action, `${actionField}.${key}`);
        if (kind === "secret") {
          issue(`${actionField}.${key}`, "sourceCopyNeedsText", `a secret action has no "${key}"; secrets are never copied to be kept`,
            `Remove "${key}" or make the action "kind": "text".`);
        }
      }
      if (kind === "secret") sourceHasSecret = true;
    });
    if (sourceHasSecret) {
      hasSecret = true;
      if (source.sensitive !== true) {
        issue(`${field}.sensitive`, "sourceSecretNeedsSensitive", "a source with a secret action must be sensitive", "Add \"sensitive\": true to the source.");
      }
    }
  });
  if (hasSecret && granted.has("network")) {
    issue("permissions", "sourceSecretWithNetwork", "an extension with a secret source action cannot ask for \"network\"",
      "Remove \"network\" from \"permissions\", or make the actions \"kind\": \"text\".");
  }

  const detectorIDs = new Set();
  list(contributes.detectors).forEach((detector, index) => {
    const field = `contributes.detectors[${index}]`;
    if (!isObject(detector)) { issue(field, "notAnObject", "a detector must be an object", "Write it as {\"id\", \"tag\", \"accepts\"}."); return; }
    memberID(detector, `${field}.id`, "detector", detectorIDs);
    localeKey("tag", detector, `${field}.tag`);
    if (Object.hasOwn(detector, "accepts")) acceptSpec(detector.accepts, `${field}.accepts`);
    else issue(`${field}.accepts`, "acceptsMissing", "a detector needs \"accepts\"", "Add \"accepts\": {\"kinds\": [\"text\"]}.");
  });

  // In the store's source folders index.js is built from src/index.ts; the app itself needs index.js.
  const entry = source ? ["index.js", path.join("src", "index.ts"), path.join("src", "index.js")] : ["index.js"];
  if (!entry.some((file) => isFile(path.join(folder, file)))) {
    report("", "indexMissing", "index.js is missing",
      { fix: "Build the extension so index.js sits next to manifest.json, or add src/index.ts to build it from.", file: "index.js" });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What the app does once the checks pass: it reads the manifest into its types. Anything those types cannot hold is
// "manifestUnreadable". Optional fields may be absent or null.

function decodeManifest(root, report) {
  const absent = (value) => value === undefined || value === null;
  const kinds = {
    string: [(value) => typeof value === "string", "a string", (key) => `Write "${key}" as text in quotes.`],
    boolean: [(value) => typeof value === "boolean", "true or false", (key) => `Write true or false, or remove "${key}".`],
    integer: [(value) => typeof value === "number" && Number.isInteger(value) && value >= -(2 ** 63) && value < 2 ** 63, "a whole number",
      (key) => `Write a whole number such as 1, or remove "${key}".`],
    array: [Array.isArray, "a list", (key) => `Write "${key}" as a list: [ … ].`],
    object: [isObject, "an object", (key) => `Write "${key}" as an object: { … }.`],
  };
  const expect = (object, key, field, kind, { required = false } = {}) => {
    const value = object[key];
    if (absent(value)) {
      if (required) report(field, `"${key}" is missing`, `Add "${key}"; see schema/manifest.schema.json.`);
      return false;
    }
    const [test, name, fix] = kinds[kind];
    if (test(value)) return true;
    report(field, `"${key}" must be ${name}`, fix(key), name);
    return false;
  };
  const strings = (object, key, field) => {
    if (expect(object, key, field, "array")) {
      object[key].forEach((value, index) => {
        if (typeof value !== "string") report(`${field}[${index}]`, `${field.split(".").at(-1)} must hold only text`, "Write each entry as text in quotes.", "a string");
      });
    }
  };
  const accepts = (value, field, checked) => {
    if (!checked) {
      if (absent(value)) return;
      if (!isObject(value)) { report(field, "\"accepts\" must be an object", "Write it as {\"kinds\": [\"text\"]}.", "an object"); return; }
      if (expect(value, "kinds", `${field}.kinds`, "array", { required: true })) strings(value, "kinds", `${field}.kinds`);
    }
    expect(value, "pattern", `${field}.pattern`, "string");
    strings(value, "tags", `${field}.tags`);
  };

  expect(root, "minAppVersion", "minAppVersion", "string");
  expect(root, "categories", "categories", "array");
  expect(root, "permissions", "permissions", "array");
  if (!absent(root.requires) && expect(root, "requires", "requires", "object")) {
    expect(root.requires, "tools", "requires.tools", "array", { required: true });
  }
  if (expect(root, "preferences", "preferences", "array")) {
    root.preferences.forEach((preference, index) => {
      const field = `preferences[${index}]`;
      if (!expect(preference, "options", `${field}.options`, "array")) return;
      preference.options.forEach((option, optionIndex) => {
        const optionField = `${field}.options[${optionIndex}]`;
        if (!isObject(option)) { report(optionField, "an option must be an object", "Write it as {\"id\", \"title\"}.", "an object"); return; }
        expect(option, "id", `${optionField}.id`, "string", { required: true });
        expect(option, "title", `${optionField}.title`, "string", { required: true });
      });
    });
  }
  if (absent(root.contributes) || !expect(root, "contributes", "contributes", "object")) return;
  const contributes = root.contributes;
  if (expect(contributes, "actions", "contributes.actions", "array")) {
    contributes.actions.forEach((action, index) => {
      const field = `contributes.actions[${index}]`;
      accepts(action.accepts, `${field}.accepts`, action.input === "item");
      if (expect(action, "variants", `${field}.variants`, "array")) {
        action.variants.forEach((variant, variantIndex) => expect(variant, "subtitle", `${field}.variants[${variantIndex}].subtitle`, "string"));
      }
      expect(action, "hint", `${field}.hint`, "boolean");
      expect(action, "priority", `${field}.priority`, "integer");
      expect(action, "targets", `${field}.targets`, "array");
      expect(action, "targetsOnly", `${field}.targetsOnly`, "boolean");
      expect(action, "job", `${field}.job`, "boolean");
    });
  }
  if (expect(contributes, "detectors", "contributes.detectors", "array")) {
    contributes.detectors.forEach((detector, index) => {
      const field = `contributes.detectors[${index}]`;
      accepts(detector.accepts, `${field}.accepts`, true);
      expect(detector, "validate", `${field}.validate`, "boolean");
      expect(detector, "preview", `${field}.preview`, "boolean");
      strings(detector, "suggests", `${field}.suggests`);
    });
  }
  if (expect(contributes, "captureRules", "contributes.captureRules", "array")) {
    contributes.captureRules.forEach((rule, index) => accepts(rule.accepts, `contributes.captureRules[${index}].accepts`, true));
  }
  if (expect(contributes, "sources", "contributes.sources", "array")) {
    contributes.sources.forEach((source, index) => expect(source, "sensitive", `contributes.sources[${index}].sensitive`, "boolean"));
  }
}
