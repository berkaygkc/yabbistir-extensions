// From the editors' list entries to projects, rows and the values ↵ and ⇧↵ paste. Everything here is pure: the
// entries are read in editors.ts. Every loop and expression below is linear in its input, since a path is the person's
// but a folder's name can come from anywhere (a cloned repository, an unpacked archive).

import { dataFolderOf, type Editor } from "./editors.ts";

export interface Project {
  readonly editor: Editor;
  readonly kind: "folder" | "workspace";
  /** The URI exactly as the editor stored it. */
  readonly uri: string;
  /** `local`: on this Mac (file:); `remote`: on another machine (vscode-remote:); `virtual`: any other scheme. */
  readonly place: "local" | "remote" | "virtual";
  /** The URI's scheme, lowercased. */
  readonly scheme: string;
  /** The URI's authority, percent-decoded: "" on this Mac, "ssh-remote+host" for a remote one. */
  readonly authority: string;
  /** The URI's path, percent-decoded, without a trailing slash: the folder's or the workspace file's. */
  readonly path: string;
}

/** The most projects the column lists. */
export const CAP = 50;

/** Longer than any path macOS allows, even with every byte percent-encoded: such an entry is not a real one. */
const LONGEST_URI = 16_384;

/** Control characters and line separators: a path with one is left out rather than pasted. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const WORKSPACE_EXTENSION = ".code-workspace";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The text percent-decoded, or undefined when an escape is malformed. */
function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/** The path without its trailing slashes, "/" kept for the root. A loop: /\/+$/ is quadratic on many slashes. */
export function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 0x2f) end--;
  return path.slice(0, end);
}

/** A URI's parts, still encoded, or undefined when it is not `scheme://authority/path`. */
function partsOf(uri: string): { scheme: string; authority: string; path: string } | undefined {
  const separator = uri.indexOf("://");
  if (separator <= 0) return undefined;
  const scheme = uri.slice(0, separator);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) return undefined;
  const rest = uri.slice(separator + 3);
  let end = rest.length;
  for (const mark of ["?", "#"]) {
    const at = rest.indexOf(mark);
    if (at !== -1 && at < end) end = at;
  }
  const slash = rest.slice(0, end).indexOf("/");
  return {
    scheme: scheme.toLowerCase(),
    authority: slash === -1 ? rest.slice(0, end) : rest.slice(0, slash),
    path: slash === -1 ? "" : rest.slice(slash, end),
  };
}

/**
 * The project one list entry stands for, or undefined for an entry left out: a file (only folders and workspaces are
 * projects), an entry of a shape this version does not know, a malformed URI, a path with a control character, or one
 * of the editor's own untitled workspaces.
 */
export function projectOf(entry: unknown, editor: Editor, home: string): Project | undefined {
  if (!isRecord(entry)) return undefined;
  let kind: Project["kind"];
  let uri: unknown;
  if (typeof entry.folderUri === "string") {
    kind = "folder";
    uri = entry.folderUri;
  } else if (isRecord(entry.workspace) && typeof entry.workspace.configPath === "string") {
    kind = "workspace";
    uri = entry.workspace.configPath;
  } else {
    return undefined;
  }
  if (typeof uri !== "string" || uri.length > LONGEST_URI || UNSAFE.test(uri)) return undefined;
  const parts = partsOf(uri);
  if (parts === undefined) return undefined;
  const authority = decoded(parts.authority);
  const rawPath = decoded(parts.path);
  if (authority === undefined || rawPath === undefined || UNSAFE.test(authority) || UNSAFE.test(rawPath)) return undefined;
  const path = withoutTrailingSlashes(rawPath);
  const project = { editor, kind, uri, scheme: parts.scheme, authority, path };

  if (parts.scheme === "file") {
    // A file URI with a host is a network share as Windows writes it: no path on a Mac.
    if (authority !== "" || !path.startsWith("/")) return undefined;
    // Untitled workspaces live in the editor's own folder; the editor keeps them out of the list, and so does this.
    if (kind === "workspace" && path.startsWith(`${dataFolderOf(editor, home)}/Workspaces/`)) return undefined;
    return { ...project, place: "local" };
  }
  if (parts.scheme === "vscode-remote") {
    if (authority === "" || !path.startsWith("/")) return undefined;
    return { ...project, place: "remote" };
  }
  return { ...project, place: "virtual" };
}

/** The projects in an editor's list entries (lines of JSON), newest first; lines that are not JSON are left out. */
export function projectsIn(entries: readonly string[], editor: Editor, home: string): Project[] {
  const projects: Project[] = [];
  for (const line of entries) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const project = projectOf(entry, editor, home);
    if (project !== undefined) projects.push(project);
  }
  return projects;
}

/**
 * What makes two projects the same, in one editor or two. A Mac's disk ignores case and Unicode normalization by
 * default, and so does the editor when it compares paths on a Mac; another machine's path is compared as it is.
 */
export function sameProjectKey(project: Project): string {
  if (project.place === "local") return `file:${project.path.normalize("NFC").toLowerCase()}`;
  return `${project.scheme}://${project.authority.toLowerCase()}${project.path}`;
}

/** One editor's projects, newest first, and when the editor last started (undefined when that is not known). */
export interface EditorProjects {
  readonly projects: readonly Project[];
  readonly started: number | undefined;
}

/**
 * The editors' lists as one, at most `cap` long. The editors keep no date with an entry, only an order, but each says
 * when it last started. So the lists are merged rank by rank, the editor started most recently first: each editor's
 * newest, then each one's second newest, and so on. Editors whose start is not known come after the others, and the
 * order of EDITORS breaks ties.
 *
 * A project in more than one list is listed once, at the first of its places, where it is most recent. It goes under
 * the editor started most recently of those that list it, the one the person is likelier to be using now; when that
 * does not tell them apart, under the one where it comes first.
 */
export function merged(lists: readonly EditorProjects[], cap = CAP): Project[] {
  const startOf = (list: EditorProjects): number => list.started ?? -Infinity;
  // Stable: lists that start alike keep the order of EDITORS. Two unknown starts give NaN, which counts as a tie.
  const ordered = [...lists].sort((a, b) => startOf(b) - startOf(a) || 0);

  // The project each one goes under: of its places, the one in the latest started editor, then the first one.
  const chosen = new Map<string, { project: Project; start: number; place: number }>();
  ordered.forEach((list, column) => {
    const start = startOf(list);
    list.projects.forEach((project, rank) => {
      const key = sameProjectKey(project);
      const place = rank * ordered.length + column;
      const held = chosen.get(key);
      if (held === undefined || start > held.start || (start === held.start && place < held.place)) chosen.set(key, { project, start, place });
    });
  });

  const seen = new Set<string>();
  const projects: Project[] = [];
  const longest = ordered.reduce((most, list) => Math.max(most, list.projects.length), 0);
  for (let rank = 0; rank < longest; rank++) {
    for (const list of ordered) {
      const project = list.projects[rank];
      if (project === undefined) continue;
      const key = sameProjectKey(project);
      if (seen.has(key)) continue;
      seen.add(key);
      projects.push(chosen.get(key)?.project ?? project);
      if (projects.length === cap) return projects;
    }
  }
  return projects;
}

/** FNV-1a, 64 bits, over the text's UTF-16 code units, as 16 hex digits: short, stable ids. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash ^ BigInt(text.charCodeAt(index))) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The row's id: the editor's and a hash of the kind and the URI, the same each time, at most 25 characters. */
export const rowIdOf = (project: Project): string => `${project.editor.id}-${fnv1a64(`${project.kind} ${project.uri}`)}`;

/** The shape of every id rowIdOf makes. */
export const ROW_ID = /^[a-z]{1,8}-[0-9a-f]{16}$/;

/** The last part of a path. */
function lastPart(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The authority as a person reads it. VS Code writes a resolver's kind and then its data after "+", and the data can
 * be long hex JSON (GitHub's "github+7b22…" holds a branch or a pull request), so only the kind is shown, as the
 * editor itself does. A remote project's authority is shown by remoteLabel instead.
 */
function shownAuthority(authority: string): string {
  const plus = authority.indexOf("+");
  return plus > 0 ? authority.slice(0, plus) : authority;
}

/** The row's title: the folder's name, or the workspace's without ".code-workspace". */
export function titleOf(project: Project): string {
  let name = lastPart(project.path);
  if (project.kind === "workspace" && name.length > WORKSPACE_EXTENSION.length && name.toLowerCase().endsWith(WORKSPACE_EXTENSION)) {
    name = name.slice(0, -WORKSPACE_EXTENSION.length);
  }
  // Only a virtual project can have no path, and only the root has an empty last part.
  if (name === "") name = project.path === "/" ? "/" : project.authority !== "" ? shownAuthority(project.authority) : project.uri;
  return name.normalize("NFC");
}

/** The path as a person reads it: "~/dev/site" inside the home folder, as it is elsewhere. */
export function shortPath(path: string, home: string): string {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

/**
 * Hex is how VS Code writes an SSH host it cannot put in a URI as it is: `{"hostName":"…"}` in hex. The name, or
 * undefined when the text is not that.
 */
function hexHostName(text: string): string | undefined {
  if (text.length < 4 || text.length % 2 !== 0 || text.length > 2048 || !/^[0-9a-fA-F]+$/.test(text)) return undefined;
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (isRecord(value) && typeof value.hostName === "string" && value.hostName !== "" && !UNSAFE.test(value.hostName)) return value.hostName;
  } catch {
    // Not hex JSON after all: a host whose name only looks like hex.
  }
  return undefined;
}

/** Where a remote project is, as the editor's own status bar says it: "SSH: build-box", "Dev Container". */
export function remoteLabel(authority: string): string {
  const plus = authority.indexOf("+");
  const type = plus === -1 ? authority : authority.slice(0, plus);
  const name = plus === -1 ? "" : authority.slice(plus + 1);
  switch (type) {
    case "ssh-remote": {
      const host = hexHostName(name) ?? name;
      return host === "" ? yab.t("remote.sshAnywhere") : yab.t("remote.ssh", { host });
    }
    case "dev-container":
    case "attached-container":
      return yab.t("remote.container");
    case "wsl":
      return name === "" ? yab.t("remote.wslAnywhere") : yab.t("remote.wsl", { name });
    case "tunnel":
      return name === "" ? yab.t("remote.tunnelAnywhere") : yab.t("remote.tunnel", { name });
    case "codespaces":
      return yab.t("remote.codespaces");
    default:
      return type === "" ? authority : type;
  }
}

/** The row's second line: the editor, then where the project is. */
export function subtitleOf(project: Project, home: string): string {
  const parts = [yab.t(project.editor.name)];
  if (project.place === "local") parts.push(shortPath(project.path.normalize("NFC"), home.normalize("NFC")));
  else if (project.place === "remote") parts.push(remoteLabel(project.authority), project.path);
  else parts.push(`${project.scheme}://${shownAuthority(project.authority)}${project.path}`);
  return parts.join(" · ").normalize("NFC");
}

/**
 * What ↵ pastes: the path, as it is on the disk it is on (this Mac's, or the remote machine's). A virtual project has
 * no path on any disk, so its URI stands for it.
 */
export function pathOf(project: Project): string {
  return project.place === "virtual" ? project.uri : project.path;
}

/** Characters no shell treats specially, letters of any script included. */
const SHELL_PLAIN = /^[\p{L}\p{N}\p{M}_@%+:,./-]+$/u;

/** The word as a shell reads it back: as it is when it is plain, in single quotes otherwise. */
export function shellWord(word: string): string {
  return SHELL_PLAIN.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * What ⇧↵ pastes: the editor's command that opens the project, for a terminal. A path on this Mac goes as it is; a
 * project elsewhere goes as its URI, which the command opens with --folder-uri (a folder) or --file-uri (a workspace).
 */
export function commandOf(project: Project): string {
  const command = project.editor.command;
  if (project.place === "local") return `${command} ${shellWord(project.path)}`;
  return `${command} ${project.kind === "workspace" ? "--file-uri" : "--folder-uri"} ${shellWord(project.uri)}`;
}
