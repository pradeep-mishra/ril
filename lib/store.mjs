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
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw noProjectError(dir);
    throw new RilError(`Could not read the project state at ${file}.`, { next: 'run ril doctor --fix', detail: err.message });
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch (err) {
    throw new RilError(`The project state at ${file} is damaged and cannot be read.`, {
      next: 'run ril doctor --fix',
      detail: err.message,
    });
  }
  const problems = validate(state);
  if (problems.length) {
    throw new RilError(`The project state at ${file} has problems: ${problems.join('; ')}.`, {
      next: 'run ril doctor --fix',
    });
  }
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

function writeState(dir, state) {
  const file = statePath(dir);
  try {
    writeDurably(`${file}.bak.tmp`, `${file}.bak`, fs.readFileSync(file, 'utf8'));
    writeDurably(`${file}.tmp`, file, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    throw new RilError(`Could not save the project state at ${file}.`, {
      next: 'check that the .ril folder is writable, then run ril doctor --fix',
      detail: err.message,
    });
  }
}

// Take the lock, load, let fn change the state in place, check it, then save it.
// If fn throws or the result is invalid, nothing is written. Do not call inside withLock (see lock.mjs).
export function mutate(dir, fn, { now = () => new Date() } = {}) {
  return withLock(dir, () => {
    const state = load(dir);
    fn(state);
    const problems = validate(state);
    if (problems.length) {
      throw new RilError(`The change was not saved because it would leave the project state invalid: ${problems.join('; ')}.`, {
        next: 'correct the value and run the command again',
      });
    }
    writeState(dir, state);
    return state;
  }, { now });
}

// Reads a state file without throwing, for repairs: { state } when it is sound, otherwise { problem }
// in plain words ({ problem, missing: true } when there is no such file).
export function readState(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? { problem: 'it is missing', missing: true } : { problem: 'it cannot be read' };
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    return { problem: 'it is incomplete or garbled, probably cut off while it was being saved' };
  }
  const problems = validate(state);
  if (!problems.length) return { state };
  return { problem: `it holds ${problems.length === 1 ? 'a value' : `${problems.length} values`} ril cannot use`, detail: problems.join('; ') };
}

// Replaces a damaged .ril/state.json with its backup after `fn` has changed the backup's state in place
// (to record why), in one write. The backup itself is left as it is. Returns false, changing nothing,
// when state.json is sound after all (another process repaired it first).
export function restoreBackup(dir, fn, { now = () => new Date() } = {}) {
  const file = statePath(dir);
  return withLock(dir, () => {
    if (readState(file).state) return false;
    const { state, problem } = readState(`${file}.bak`);
    if (!state) {
      throw new RilError(`The backup of the project state is damaged too (${problem}), so it was not used.`, {
        next: 'put back .ril/state.json from your own copy, or move the .ril folder aside and run ril init to start again',
      });
    }
    fn(state);
    const problems = validate(state);
    if (problems.length) throw new RilError(`The restored project state would be invalid: ${problems.join('; ')}.`, { next: 'put back .ril/state.json from your own copy' });
    try {
      writeDurably(`${file}.tmp`, file, `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      throw new RilError(`Could not save the project state at ${file}.`, { next: 'check that the .ril folder is writable, then run ril doctor --fix again', detail: err.message });
    }
    return true;
  }, { now });
}

// Writes a brand-new .ril/state.json (creating .ril if needed) and refuses if one already exists.
// Takes the lock itself, so do not call it inside withLock.
export function createState(dir, state, { now = () => new Date() } = {}) {
  const file = statePath(dir);
  const problems = validate(state);
  if (problems.length) {
    throw new RilError(`The new project state would be invalid: ${problems.join('; ')}.`, {
      next: 'correct the value and run the command again',
    });
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (err) {
    throw new RilError(`Could not create the .ril folder in ${dir}.`, {
      next: 'check that the folder is writable, then run ril init again',
      detail: err.message,
    });
  }
  return withLock(dir, () => {
    if (fs.existsSync(file)) {
      throw new RilError(`There is already a project state at ${file}, so it was not replaced.`, {
        next: 'run ril status to see the project, or ril doctor --fix if it is damaged',
      });
    }
    try {
      writeDurably(`${file}.tmp`, file, `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      throw new RilError(`Could not save the project state at ${file}.`, {
        next: 'check that the .ril folder is writable, then run ril init again',
        detail: err.message,
      });
    }
    return state;
  }, { now });
}
