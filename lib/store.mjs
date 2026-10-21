// The one state file, .ril/state.json: loaded and checked, changed only under the lock,
// written to a temp file and renamed into place, with the previous version kept as .bak.
import fs from 'node:fs';
import path from 'node:path';
import { RilError, noProjectError } from './errors.mjs';
import { validate } from './schema.mjs';
import { withLock, sleep } from './lock.mjs';

export { withLock };

export function statePath(dir) {
  return path.join(dir, '.ril', 'state.json');
}

export function load(dir) {
  const file = statePath(dir);
  const { state, problem, detail, system, missing } = readState(file);
  if (missing) throw noProjectError(dir);
  if (!state) throw new RilError(`The project state at ${file} cannot be used: ${problem}${detail ? ` (${detail})` : ''}.`, { next: 'run ril doctor --fix', detail: system });
  return state;
}

// Windows can refuse a rename for a while when another program (often antivirus) has the file open.
function renameWithRetry(from, to) {
  const deadline = Date.now() + 1500;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (Date.now() >= deadline || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
      sleep(Math.min(10 * 2 ** attempt, 250));
    }
  }
}

// Writes `text` to `tmp` (which must not exist), flushes it to disk, then renames it over `file`.
function writeDurably(tmp, file, text) {
  fs.rmSync(tmp, { force: true }); // left over from a crashed write; we hold the lock
  try {
    const fd = fs.openSync(tmp, 'wx');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetry(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// Refuses a state that fails the checks; `what` starts the message.
function mustBeValid(state, what, next) {
  const problems = validate(state);
  if (problems.length) throw new RilError(`${what}: ${problems.join('; ')}.`, { next });
}

const notSaved = (file, err, again) => new RilError(`Could not save the project state at ${file}.`, { next: `check that the .ril folder is writable, then ${again}`, detail: err.message });

function writeState(dir, state) {
  const file = statePath(dir);
  try {
    writeDurably(`${file}.bak.tmp`, `${file}.bak`, fs.readFileSync(file, 'utf8'));
    writeDurably(`${file}.tmp`, file, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    throw notSaved(file, err, 'run ril doctor --fix');
  }
}

// Take the lock, load, let fn change the state in place, check it, then save it.
// If fn throws or the result is invalid, nothing is written. Do not call inside withLock (see lock.mjs).
export function mutate(dir, fn, { now = () => new Date() } = {}) {
  return withLock(dir, () => {
    const state = load(dir);
    fn(state);
    mustBeValid(state, 'The change was not saved because it would leave the project state invalid', 'correct the value and run the command again');
    writeState(dir, state);
    return state;
  }, { now });
}

// Reads a state file without throwing: { state } when it is sound, otherwise { problem } in plain words
// ({ missing: true } when there is no such file; `system` holds the system's own text).
export function readState(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? { problem: 'it is missing', missing: true } : { problem: 'it cannot be read', system: err.message };
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch (err) {
    return { problem: 'it is incomplete or garbled, probably cut off while it was being saved', system: err.message };
  }
  const problems = validate(state);
  if (!problems.length) return { state };
  return { problem: `it holds ${problems.length === 1 ? 'a value' : `${problems.length} values`} ril cannot use`, detail: problems.join('; ') };
}

// Copies a damaged state file to .ril/state.json.damaged-<yyyymmddhhmmss> (with -2, -3... if that name
// is taken; an earlier copy is never replaced). Returns the copy's file name, or null when there is no file.
function keepDamaged(file, at) {
  const base = `${path.basename(file)}.damaged-${at.toISOString().replace(/\D/g, '').slice(0, 14)}`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    try {
      fs.copyFileSync(file, path.join(path.dirname(file), name), fs.constants.COPYFILE_EXCL);
      return name;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

// Replaces a damaged .ril/state.json with its backup after `fn(state, kept)` has changed the backup's state
// in place (to record why), in one write. The damaged file is kept first under the name `kept` (see
// keepDamaged); the backup is left as it is. Returns false, changing nothing, when state.json is sound
// after all (another process repaired it first).
export function restoreBackup(dir, fn, { now = () => new Date() } = {}) {
  const file = statePath(dir);
  return withLock(dir, () => {
    if (readState(file).state) return false;
    const { state, problem } = readState(`${file}.bak`);
    if (!state) {
      throw new RilError(`The backup of the project state is damaged too (${problem}), so it was not used.`, { next: 'put back .ril/state.json from your own copy, or move the .ril folder aside and run ril init to start again' });
    }
    let kept;
    try {
      kept = keepDamaged(file, now());
    } catch (err) {
      throw new RilError(`Could not keep a copy of the damaged project state, so it was not replaced.`, { next: 'check that the .ril folder is writable, then run ril doctor --fix again', detail: err.message });
    }
    fn(state, kept);
    mustBeValid(state, 'The restored project state would be invalid', 'put back .ril/state.json from your own copy');
    try {
      writeDurably(`${file}.tmp`, file, `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      throw notSaved(file, err, 'run ril doctor --fix again');
    }
    return true;
  }, { now });
}

// Writes a brand-new .ril/state.json (creating .ril if needed) and refuses if one already exists.
// Takes the lock itself, so do not call it inside withLock.
export function createState(dir, state, { now = () => new Date() } = {}) {
  const file = statePath(dir);
  mustBeValid(state, 'The new project state would be invalid', 'correct the value and run the command again');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (err) {
    throw new RilError(`Could not create the .ril folder in ${dir}.`, { next: 'check that the folder is writable, then run ril init again', detail: err.message });
  }
  return withLock(dir, () => {
    if (fs.existsSync(file)) {
      throw new RilError(`There is already a project state at ${file}, so it was not replaced.`, { next: 'run ril status to see the project, or ril doctor --fix if it is damaged' });
    }
    try {
      writeDurably(`${file}.tmp`, file, `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      throw notSaved(file, err, 'run ril init again');
    }
    return state;
  }, { now });
}

// The nearest folder at or above `start` that holds a ril project (.ril/state.json), or null.
export function findProject(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(statePath(dir))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}
