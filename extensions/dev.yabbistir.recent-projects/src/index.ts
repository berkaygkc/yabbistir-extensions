import type { SourceRow, Sources } from "@yabbistir/api";

import { EDITORS, readEditor, type Editor } from "./editors.ts";
import {
  commandOf, merged, pathOf, projectsIn, ROW_ID, rowIdOf, shortPath, subtitleOf, titleOf, withoutTrailingSlashes,
  type Project,
} from "./projects.ts";

// The folders and workspaces opened recently in VS Code and the editors built from it, as a column. ↵ pastes the
// project's path; ⇧↵ pastes the editor's command that opens it. A source cannot open a link itself (yab.open throws
// in a source's calls, and opens only http and https), so the command is pasted, for a terminal.
//
// The lists are read with sqlite3, read-only, from the editors' own databases, whose paths start at the home folder:
// the `home` preference, a folder preference whose default "~" the app expands to it. Nothing is written anywhere, and
// the projects stay in a module variable for at most five minutes, for `run` to find a row's project.

/** How long `run` trusts the projects of the last listing. */
const LIFETIME = 5 * 60_000;

/** Control characters and line separators, which no home folder's path has. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** What the app trims from a title's ends and turns into spaces: a title of only these is blank to it. */
const BLANK = /^[\p{Z}\t-\r\u0085\u2028\u2029]*$/u;

// The helper's memory only, never yab.storage or a file: the last listing's projects by row id, and the editors whose
// database could not be read, said once in the log.
let cached: { at: number; home: string; projects: Map<string, Project> } | undefined;
const unreadable = new Set<string>();

/** The home folder from the preference: an absolute path without a trailing slash, or undefined when it is not one. */
export function homeOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || UNSAFE.test(value)) return undefined;
  const home = withoutTrailingSlashes(value);
  return home === "/" ? undefined : home;
}

/** Said once per editor while the helper runs: the editor's database is there but could not be read. */
function noteUnreadable(editor: Editor): void {
  if (unreadable.has(editor.id)) return;
  unreadable.add(editor.id);
  console.warn(yab.t("log.unreadable", { editor: yab.t(editor.name) }));
}

/**
 * Every editor's projects, merged, newest first. An editor that is not installed, or has opened nothing, adds none.
 * One whose database cannot be read is left out, unless no editor could be read at all: then the listing fails.
 */
async function recentProjects(home: string, signal: AbortSignal): Promise<Project[]> {
  const readings = await Promise.all(EDITORS.map((editor) => readEditor(editor, home, signal)));
  const lists: Project[][] = [];
  let read = 0;
  let failed = 0;
  readings.forEach((reading, index) => {
    const editor = EDITORS[index];
    if (editor === undefined) return;
    if (reading.kind === "failed") {
      failed++;
      noteUnreadable(editor);
    } else if (reading.kind === "list") {
      read++;
      lists.push(projectsIn(reading.entries, editor, home));
    } else if (reading.kind === "noList") {
      read++;
    }
  });
  if (failed > 0 && read === 0) throw new Error(yab.t("readFailed"));

  // Ids are hashes: two projects with one id would fail the whole listing, so a second one is left out.
  const projects = new Map<string, Project>();
  for (const project of merged(lists)) {
    const id = rowIdOf(project);
    if (!projects.has(id)) projects.set(id, project);
  }
  cached = { at: Date.now(), home, projects };
  return [...projects.values()];
}

function rowOf(project: Project, home: string): SourceRow {
  let title = titleOf(project);
  // A folder named only with spaces would leave a blank title, which fails the listing: its path stands in for it.
  if (BLANK.test(title)) title = project.place === "local" ? shortPath(project.path, home) : pathOf(project);
  return { id: rowIdOf(project), title, subtitle: subtitleOf(project, home) };
}

export const sources: Sources = {
  projects: {
    async list(ctx) {
      const home = homeOf(ctx.preferences.home);
      if (home === undefined) {
        cached = undefined;
        return { locked: true, message: yab.t("noHome") };
      }
      const projects = await recentProjects(home, ctx.signal);
      return { rows: projects.map((project) => rowOf(project, home)) };
    },

    async run(rowId, actionId, ctx) {
      const home = homeOf(ctx.preferences.home);
      if (home === undefined) {
        cached = undefined;
        throw new Error(yab.t("noHome"));
      }
      // Every id this source lists has this shape; anything else names no project.
      if (!ROW_ID.test(rowId)) throw new Error(yab.t("gone"));
      const age = cached === undefined ? Infinity : Date.now() - cached.at;
      let project = cached !== undefined && cached.home === home && age >= 0 && age <= LIFETIME ? cached.projects.get(rowId) : undefined;
      // The helper may have restarted since the list, or the list may be old: read the lists again.
      project ??= (await recentProjects(home, ctx.signal)).find((candidate) => rowIdOf(candidate) === rowId);
      if (project === undefined) throw new Error(yab.t("gone"));
      if (actionId === "path") return { text: pathOf(project) };
      if (actionId === "open") return { text: commandOf(project) };
      throw new Error(yab.t("gone"));
    },
  },
};
