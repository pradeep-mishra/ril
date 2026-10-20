// The one state file, .ril/state.json: loaded and checked, changed only under a lock,
// written to a temp file and renamed into place, with the previous version kept as .bak.
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';
import { validate } from './schema.mjs';

const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 120_000;

const rilDir = (dir) => path.join(dir, '.ril');
const lockPath = (dir) => path.join(rilDir(dir), '.lock');

export function statePath(dir) {
  return path.join(rilDir(dir), 'state.json');
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function load(dir) {
  const file = statePath(dir);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new RilError(`There is no ril project in ${dir} yet.`, { code: 2, next: 'run ril init' });
    }
    throw new RilError(`Could not read the project state at ${file}: ${err.message}`, { next: 'run ril doctor --fix' });
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new RilError(`The project state at ${file} is damaged and cannot be read.`, { next: 'run ril doctor --fix' });
  }
  const problems = validate(state);
  if (problems.length) {
    throw new RilError(`The project state at ${file} has problems: ${problems.join('; ')}.`, {
      next: 'run ril doctor --fix',
    });
  }
  return state;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, but owned by someone else
  }
}

function readLock(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// A lock is stale when its process is gone or it is older than two minutes.
// A lock with unreadable content is judged by the file's age alone.
function isStale(file, text, now) {
  const [pidText, ts] = text.trim().split(/\s+/);
  const pid = Number(pidText);
  const taken = Date.parse(ts);
  if (Number.isInteger(pid) && pid > 0 && !Number.isNaN(taken)) {
    return !pidAlive(pid) || now - taken > LOCK_STALE_MS;
  }
  try {
    return now - fs.statSync(file).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function tryTake(file, mine) {
  let fd;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw new RilError(`Could not create the lock file ${file}: ${err.message}`, { next: 'check that the .ril folder is writable' });
  }
  try {
    fs.writeSync(fd, mine);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function acquire(dir, now) {
  const file = lockPath(dir);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const mine = `${process.pid} ${now().toISOString()}`;
    if (tryTake(file, mine)) return mine;
    const held = readLock(file);
    // Re-read just before removing so we only clear the lock we judged stale.
    if (held !== null && isStale(file, held, now().getTime()) && readLock(file) === held) {
      fs.rmSync(file, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      const owner = held ? ` (held by process ${held.trim().split(/\s+/)[0]})` : '';
      throw new RilError(`Another ril command is changing the project state right now${owner}, and it did not finish within 3 seconds.`, {
        code: 5,
        next: 'wait a moment and try again; if this keeps happening, run ril doctor --fix',
      });
    }
    sleep(20 + Math.floor(Math.random() * 30));
  }
}

function release(dir, mine) {
  const file = lockPath(dir);
  if (readLock(file) === mine) fs.rmSync(file, { force: true });
}

export function withLock(dir, fn, { now = () => new Date() } = {}) {
  const mine = acquire(dir, now);
  try {
    return fn();
  } finally {
    release(dir, mine);
  }
}

// Windows can briefly refuse a rename while another process has the file open.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
      sleep(20);
    }
  }
}

function writeState(dir, state) {
  const file = statePath(dir);
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true }); // left over from a crashed write; we hold the lock
  try {
    const fd = fs.openSync(tmp, 'wx');
    try {
      fs.writeSync(fd, `${JSON.stringify(state, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.copyFileSync(file, `${file}.bak`);
    renameWithRetry(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new RilError(`Could not save the project state at ${file}: ${err.message}`, {
      next: 'check that the .ril folder is writable, then run ril doctor --fix',
    });
  }
}

// Take the lock, load, let fn change the state in place, check it, then save it.
// If fn throws or the result is invalid, nothing is written.
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
