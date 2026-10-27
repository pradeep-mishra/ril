// The project lock, .ril/.lock, holding "<pid> <ISO timestamp>".
// Stale locks (dead process, or older than two minutes) are cleared one process at a time,
// guarded by a second file, .ril/.lock.break.
import fs from 'node:fs';
import path from 'node:path';
import { RilError, noProjectError } from './errors.mjs';

const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 120_000;
const SHORT_STALE_MS = 5000; // an empty lock or a break file is only ever this young unless its writer crashed
const BUSY = ['EEXIST', 'EPERM', 'EACCES', 'EBUSY']; // Windows reports a file being deleted as EPERM or EBUSY

export const lockPath = (dir) => path.join(dir, '.ril', '.lock');

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, but owned by someone else
  }
}

// The lock file's text, or null when it is missing or cannot be read.
export function readLock(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function ageOf(file, now) {
  try {
    return now - fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// A lock is stale when its process is gone or it is older than two minutes.
// A lock without readable content (its writer crashed before writing) is stale after a few seconds.
export function isStale(file, text, now, maxAge = LOCK_STALE_MS) {
  const [pidText, ts] = text.trim().split(/\s+/);
  const pid = Number(pidText);
  const taken = Date.parse(ts);
  if (Number.isInteger(pid) && pid > 0 && !Number.isNaN(taken)) {
    return !pidAlive(pid) || now - taken > maxAge;
  }
  return ageOf(file, now) > SHORT_STALE_MS;
}

// Creates the file with `mine` as its content. Returns false when someone else has it
// (or Windows says it is busy); throws on any other error.
export function takeLock(file, mine, open = fs.openSync) {
  let fd;
  try {
    fd = open(file, 'wx');
  } catch (err) {
    if (BUSY.includes(err.code)) return false;
    throw err;
  }
  try {
    fs.writeSync(fd, mine);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

// Removes the lock only if it still holds `judged`, and only while holding .lock.break,
// so two processes can never both clear one stale lock and both take the new one.
// Returns true when the lock was removed.
export function clearStaleLock(file, judged, now, open = fs.openSync) {
  const brk = `${file}.break`;
  if (!takeLock(brk, `${process.pid} ${new Date(now).toISOString()}`, open)) {
    const held = readLock(brk);
    if (held !== null && isStale(brk, held, now, SHORT_STALE_MS)) fs.rmSync(brk, { force: true });
    return false;
  }
  try {
    if (readLock(file) !== judged) return false;
    fs.rmSync(file, { force: true });
    return true;
  } finally {
    fs.rmSync(brk, { force: true });
  }
}

// Deny rules in the project's Claude Code settings that name .ril; the sandbox turns each into a write block that stops ril itself.
export function rilDenied(dir) {
  return ['settings.json', 'settings.local.json'].flatMap((name) => {
    try {
      return (JSON.parse(fs.readFileSync(path.join(dir, '.claude', name), 'utf8')).permissions?.deny ?? []).filter((e) => String(e).includes('.ril'));
    } catch {
      return [];
    }
  });
}

// EPERM and EACCES usually mean Claude Code's sandbox or a permission rule is blocking writes.
const noLockFile = (file, code, detail) => {
  const denied = ['EPERM', 'EACCES'].includes(code) ? rilDenied(path.dirname(path.dirname(file))) : [];
  return new RilError(`ril could not create its lock file in ${path.dirname(file)}.`, {
    next: denied.length
      ? `the project's Claude Code settings deny writes to .ril (${denied.join(', ')}), which blocks ril itself; delete those lines from .claude/settings.json (older versions of ril wrote them), then try again`
      : ['EPERM', 'EACCES'].includes(code)
        ? 'a sandbox or a permission rule is probably blocking writes in the .ril folder; allow the command to run outside the sandbox or turn the sandbox off, then try again'
        : 'check that the .ril folder is writable and not open in another program, then try again',
    detail,
  });
};

function acquire(dir, now, openFile) {
  const file = lockPath(dir);
  let refused = ''; // takeLock treats EPERM and EACCES as "busy", so the last code is kept here
  const open = (...args) => { try { return openFile(...args); } catch (err) { refused = err.code; throw err; } };
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = null;
  for (;;) {
    const mine = `${process.pid} ${now().toISOString()}`;
    let taken;
    try {
      taken = takeLock(file, mine, open);
    } catch (err) {
      if (err.code === 'ENOENT') throw noProjectError(dir);
      throw noLockFile(file, err.code, err.message);
    }
    if (taken) return mine;
    try {
      held = readLock(file);
      if (held !== null && isStale(file, held, now().getTime()) && clearStaleLock(file, held, now().getTime(), open)) continue;
    } catch {
      held = null; // the lock changed under us or could not be read; try again
    }
    if (Date.now() >= deadline) {
      if (held === null && !fs.existsSync(file)) throw noLockFile(file, refused);
      const owner = held ? ` (held by process ${held.trim().split(/\s+/)[0]})` : '';
      throw new RilError(`Another ril command is changing the project state right now${owner}, and it did not finish within 3 seconds.`, { code: 5, next: 'wait a moment and try again; if this keeps happening, run ril doctor --fix' });
    }
    sleep(20 + Math.floor(Math.random() * 30));
  }
}

// Never lets a cleanup problem replace fn's result or error; a lock left behind is cleared later as stale.
function release(dir, mine) {
  try {
    const file = lockPath(dir);
    if (readLock(file) === mine) fs.rmSync(file, { force: true });
  } catch {
    // ignored on purpose, see above
  }
}

// Runs fn while holding the project lock. The lock is not re-entrant: calling withLock or
// mutate inside withLock in the same process waits 3 seconds and fails with code 5.
// `open` replaces fs.openSync for the lock file, for tests only.
export function withLock(dir, fn, { now = () => new Date(), open = fs.openSync } = {}) {
  const mine = acquire(dir, now, open);
  try {
    return fn();
  } finally {
    release(dir, mine);
  }
}
