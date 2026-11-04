import type { SourceRow, Sources } from "@yabbistir/api";

import { EDITORS, readEditor, type Editor } from "./editors.ts";
import {
  commandOf, merged, pathOf, projectsIn, ROW_ID, rowIdOf, shortPath, subtitleOf, titleOf, withoutTrailingSlashes,
  type EditorProjects, type Project,
} from "./projects.ts";

// The folders and workspaces opened recently in VS Code and the editors built from it, as a column. ↵ pastes the
// project's path; ⇧↵ pastes the editor's command that opens it. A source cannot open a link itself (yab.open throws
// in a source's calls, and opens only http and https), so the command is pasted, for a terminal.
//
// The lists are read with sqlite3, read-only, from the editors' own databases, whose paths start at the home folder:
// the `home` preference, a folder preference whose default "~" the app expands to it. Nothing is written anywhere and
// nothing is kept between calls: `run` reads the row's editor's list again to find the row's project.

/** Control characters and line separators, which no home folder's path has. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** What the app trims from a title's ends and turns into spaces: a title of only these is blank to it. */
const BLANK = /^[\p{Z}\t-\r\u0085\u2028\u2029]*$/u;

// The helper's memory only: the log lines already written, so each is said once while the helper runs.
const noted = new Set<string>();

/** The home folder from the preference: an absolute path without a trailing slash, or undefined when it is not one. */
export function homeOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || UNSAFE.test(value)) return undefined;
  const home = withoutTrailingSlashes(value);
  return home === "/" ? undefined : home;
}

/**
 * Said once per editor while the helper runs, naming only the editor: its database is there but could not be read
 * (`log.unreadable`), or it holds no list and there is no shared database, where a newer version would keep it
 * (`log.notFound`).
 */
function note(key: "log.unreadable" | "log.notFound", editor: Editor): void {
  const id = `${key} ${editor.id}`;
  if (noted.has(id)) return;
  noted.add(id);
  console.warn(yab.t(key, { editor: yab.t(editor.name) }));
}

/**
 * Every editor's projects, merged, newest first, by row id. An editor that is not installed, or has opened nothing,
 * adds none. One whose database cannot be read is left out, unless no editor could be read at all: then the listing
 * fails.
 */
async function recentProjects(home: string, signal: AbortSignal): Promise<Map<string, Project>> {
  const readings = await Promise.all(EDITORS.map((editor) => readEditor(editor, home, signal)));
  const lists: EditorProjects[] = [];
  let read = 0;
  let failed = 0;
  readings.forEach((reading, index) => {
    const editor = EDITORS[index];
    if (editor === undefined) return;
    if (reading.kind === "failed") {
      failed++;
      note("log.unreadable", editor);
    } else if (reading.kind === "list") {
      read++;
      lists.push({ projects: projectsIn(reading.entries, editor, home), started: reading.started });
    } else if (reading.kind === "notFound") {
      read++;
      note("log.notFound", editor);
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
  return projects;
}

function rowOf(id: string, project: Project, home: string): SourceRow {
  let title = titleOf(project);
  // A folder named only with spaces would leave a blank title, which fails the listing: its path stands in for it.
  if (BLANK.test(title)) title = project.place === "local" ? shortPath(project.path, home) : pathOf(project);
  return { id, title, subtitle: subtitleOf(project, home) };
}

export const sources: Sources = {
  projects: {
    async list(ctx) {
      const home = homeOf(ctx.preferences.home);
      if (home === undefined) return { locked: true, message: yab.t("noHome") };
      const projects = await recentProjects(home, ctx.signal);
      return { rows: [...projects].map(([id, project]) => rowOf(id, project, home)) };
    },

    async run(rowId, actionId, ctx) {
      const home = homeOf(ctx.preferences.home);
      if (home === undefined) throw new Error(yab.t("noHome"));
      // Every id this source lists has this shape and starts with its editor's id; anything else names no project.
      const editor = ROW_ID.test(rowId) ? EDITORS.find((each) => rowId.startsWith(`${each.id}-`)) : undefined;
      if (editor === undefined || (actionId !== "path" && actionId !== "open")) throw new Error(yab.t("gone"));
      // Only the row's editor is read: its list as it is now, in which the project is found by its id.
      const reading = await readEditor(editor, home, ctx.signal);
      if (reading.kind === "failed") {
        note("log.unreadable", editor);
        throw new Error(yab.t("readFailedOne", { editor: yab.t(editor.name) }));
      }
      const project = reading.kind === "list" ? projectsIn(reading.entries, editor, home).find((each) => rowIdOf(each) === rowId) : undefined;
      if (project === undefined) throw new Error(yab.t("gone"));
      return { text: actionId === "path" ? pathOf(project) : commandOf(project) };
    },
  },
};
