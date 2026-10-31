// Packs an extension folder into a .yabext, byte for byte the same every time for the same files: entries in sorted
// order, every date 1980-01-01 00:00, fixed permissions and no extra fields, so the SHA-256 of the archive is a
// function of its contents only. The folder itself is the archive's root, which is what the app unpacks.
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

const FIXED_DATE = new Date(1980, 0, 1, 0, 0, 0); // fflate reads local time; 1980-01-01 00:00 is the DOS epoch
const UNIX_FILE = (0o100644 << 16) >>> 0;

/** Every file under `directory`, as paths relative to it with "/" separators, in plain code-point order. */
export function listFiles(directory, prefix = "") {
  const found = [];
  for (const entry of fs.readdirSync(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listFiles(directory, relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The .yabext bytes of `directory`, whose files go under `<rootName>/`. */
export function zipFolder(directory, rootName) {
  const entries = {};
  for (const file of listFiles(directory)) {
    entries[`${rootName}/${file}`] = [new Uint8Array(fs.readFileSync(path.join(directory, file))), { level: 6, mtime: FIXED_DATE, os: 3, attrs: UNIX_FILE }];
  }
  return zipSync(entries);
}
