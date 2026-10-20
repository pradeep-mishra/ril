// Writing files ril owns (inside .ril) or edits (CLAUDE.md, AGENTS.md) without following links
// to places outside the project, and without leaving a half-written file.
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';

function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Refuses a .ril that is a link or anything other than a real folder.
export function assertRilDir(dir) {
  const ril = path.join(dir, '.ril');
  const st = lstatOrNull(ril);
  if (st && !st.isDirectory()) {
    throw new RilError(`${ril} is a link or a file, not a real folder, so ril will not use it.`, {
      next: 'move it out of the way, then run ril init',
    });
  }
}

// The path of a file inside .ril that ril owns. Refuses a link or anything that is not an ordinary file.
export function ownedFile(dir, name) {
  assertRilDir(dir);
  const file = path.join(dir, '.ril', name);
  const st = lstatOrNull(file);
  if (st && !st.isFile()) {
    throw new RilError(`ril will not write to ${file} because it is a link or not an ordinary file.`, {
      next: 'delete or move it (ril makes a new one), then try again',
    });
  }
  return file;
}

// Writes through a temp file in the same folder, then renames it into place.
export function writeFileAtomic(file, text, encoding = 'utf8') {
  const tmp = `${file}.${process.pid}.tmp`;
  let mode;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // a new file: default permissions
  }
  fs.rmSync(tmp, { force: true });
  try {
    fs.writeFileSync(tmp, text, { encoding, flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// Appends to a file inside .ril, creating it if needed; never follows a link.
export function appendOwned(dir, name, text) {
  const file = ownedFile(dir, name);
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o666);
  try {
    if (text) fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

// Decides where a project file such as CLAUDE.md may be written.
// Returns { file } (the real path to write) or { skip } (why it was left alone).
export function resolveInProject(dir, name) {
  const file = path.join(dir, name);
  const st = lstatOrNull(file);
  if (!st) return { file };
  let real = file;
  if (st.isSymbolicLink()) {
    try {
      real = fs.realpathSync(file);
    } catch {
      return { skip: 'it is a broken link' };
    }
    const rel = path.relative(fs.realpathSync(dir), real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return { skip: 'it points outside this project' };
  }
  if (!fs.statSync(real).isFile()) return { skip: 'it is not an ordinary file' };
  return { file: real };
}
