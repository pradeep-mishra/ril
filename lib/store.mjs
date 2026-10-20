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
