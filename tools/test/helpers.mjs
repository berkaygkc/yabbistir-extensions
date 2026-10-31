// Shared by the tests of the new, build, dev and test commands: a scratch repository root whose node_modules is the
// real one (so the templates' tests can import @yabbistir/api), and a way to run the commands as a person would.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = fileURLToPath(new URL("../..", import.meta.url));

export function scratchRoot(prefix = "yab-tools-") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.mkdirSync(path.join(root, "extensions"));
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"));
  return root;
}

/** Runs tools/<command>.mjs against `root`; `env` is added to a copy of the environment. */
export function run(command, args, { root, env = {}, input } = {}) {
  // A child that runs node --test must not believe it is inside this test run.
  const { NODE_TEST_CONTEXT, ...inherited } = process.env;
  const result = spawnSync(process.execPath, [path.join(repo, "tools", `${command}.mjs`), ...(root ? ["--root", root] : []), ...args], {
    encoding: "utf8",
    env: { ...inherited, NO_COLOR: "1", ...env },
    input,
    timeout: 120_000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

export const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
