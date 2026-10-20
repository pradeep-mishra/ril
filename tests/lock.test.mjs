import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from './helpers/tmp.mjs';
import { RilError } from '../lib/errors.mjs';
import { withLock, takeLock, clearStaleLock, isStale } from '../lib/lock.mjs';

const lockOf = (dir) => path.join(dir, '.ril', '.lock');
const fail = (code) => () => { throw Object.assign(new Error(`${code}: fake`), { code }); };
const ago = (file, ms) => fs.utimesSync(file, new Date(Date.now() - ms), new Date(Date.now() - ms));

function inProject(fn) {
  const { dir, cleanup } = tmpProject();
  try {
    return fn(dir);
  } finally {
    cleanup();
  }
}

test('takeLock treats busy and permission errors like a held lock', () => {
  inProject((dir) => {
    for (const code of ['EEXIST', 'EPERM', 'EACCES', 'EBUSY']) {
      assert.equal(takeLock(lockOf(dir), 'x', fail(code)), false, code);
    }
    assert.throws(() => takeLock(lockOf(dir), 'x', fail('ENOENT')), /ENOENT/);
    assert.equal(takeLock(lockOf(dir), 'mine'), true);
    assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), 'mine');
  });
});

test('withLock retries through brief Windows-style open errors', () => {
  inProject((dir) => {
    let calls = 0;
    const flaky = (...args) => (++calls <= 2 ? fail('EPERM')() : fs.openSync(...args));
    assert.equal(withLock(dir, () => 'ran', { open: flaky }), 'ran');
    assert.equal(calls, 3);
    assert.equal(fs.existsSync(lockOf(dir)), false);
  });
});

test('withLock in a folder with no .ril asks for ril init', () => {
  inProject((dir) => {
    fs.rmSync(path.join(dir, '.ril'), { recursive: true });
    assert.throws(() => withLock(dir, () => {}), (e) => e instanceof RilError && e.code === 2 && /Next: run ril init/.test(e.message));
  });
});

test('clearStaleLock removes only the lock it judged, and only while it holds the break file', () => {
  inProject((dir) => {
    const lock = lockOf(dir);
    const brk = `${lock}.break`;
    fs.writeFileSync(lock, 'stale');
    fs.writeFileSync(brk, `${process.pid} ${new Date().toISOString()}`);
    assert.equal(clearStaleLock(lock, 'stale', Date.now()), false, 'another process is clearing');
    assert.equal(fs.readFileSync(lock, 'utf8'), 'stale');

    fs.rmSync(brk);
    fs.writeFileSync(lock, 'fresh');
    assert.equal(clearStaleLock(lock, 'stale', Date.now()), false, 'lock changed since judged');
    assert.equal(fs.readFileSync(lock, 'utf8'), 'fresh');
    assert.equal(fs.existsSync(brk), false);

    fs.writeFileSync(lock, 'stale');
    assert.equal(clearStaleLock(lock, 'stale', Date.now()), true);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(fs.existsSync(brk), false);
  });
});

test('a break file left by a crash is cleared after a few seconds', () => {
  inProject((dir) => {
    const lock = lockOf(dir);
    fs.writeFileSync(lock, 'stale');
    fs.writeFileSync(`${lock}.break`, '');
    ago(`${lock}.break`, 10_000);
    clearStaleLock(lock, 'stale', Date.now()); // clears the abandoned break file
    assert.equal(clearStaleLock(lock, 'stale', Date.now()), true);
    assert.equal(fs.existsSync(lock), false);
  });
});

test('an empty lock is stale only once it is a few seconds old', () => {
  inProject((dir) => {
    const lock = lockOf(dir);
    fs.writeFileSync(lock, '');
    assert.equal(isStale(lock, '', Date.now()), false);
    ago(lock, 10_000);
    assert.equal(isStale(lock, '', Date.now()), true);
    assert.equal(withLock(dir, () => 'ran'), 'ran');
  });
});

test('a failure while releasing does not hide the result', () => {
  inProject((dir) => {
    // fn swaps the lock file for a folder, so reading it during release throws.
    const swap = () => {
      fs.rmSync(lockOf(dir));
      fs.mkdirSync(lockOf(dir));
      fs.writeFileSync(path.join(lockOf(dir), 'x'), 'x');
    };
    assert.equal(withLock(dir, () => { swap(); return 'kept'; }), 'kept');
    fs.rmSync(lockOf(dir), { recursive: true });
    assert.throws(() => withLock(dir, () => { swap(); throw new Error('original'); }), /original/);
  });
});
