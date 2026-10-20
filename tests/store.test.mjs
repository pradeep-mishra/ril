// The state file (.ril/state.json): validation, atomic saves with a backup, and the lock that serialises changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inTmp, tmpProject } from './helpers/tmp.mjs';
import { RilError } from '../lib/errors.mjs';
import { emptyState, validate } from '../lib/schema.mjs';
import { statePath, load, mutate, createState } from '../lib/store.mjs';
import { withLock, takeLock, clearStaleLock, isStale } from '../lib/lock.mjs';

const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'store-child.mjs');
const read = (file) => fs.readFileSync(file, 'utf8');
const lockFile = (dir) => path.join(dir, '.ril', '.lock');
const decide = (decision) => (s) => s.decisions.push({ ts: 't', stage: s.stage, decision, why: 'test' });
const fail = (code) => () => { throw Object.assign(new Error(`${code}: fake`), { code }); };
const ago = (file, ms) => fs.utimesSync(file, new Date(Date.now() - ms), new Date(Date.now() - ms));

// A project folder whose state file holds a fresh state.
const withState = (fn) => inTmp((dir) => {
  fs.writeFileSync(statePath(dir), JSON.stringify(emptyState({ project: 'demo', mode: 'guided' }), null, 2));
  return fn(dir);
});

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [child, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${err}`))));
  });
}

test('emptyState is valid and validate catches bad enums, duplicate ids and cap', () => {
  const s = emptyState({ project: 'demo', mode: 'autonomous', now: new Date() });
  assert.equal(s.version, 1);
  assert.equal(s.cap, 8);
  assert.equal(s.stage, 'shape');
  for (const key of ['units', 'scenarios', 'ledger', 'agents', 'gates', 'decisions']) assert.deepEqual(s[key], []);
  assert.deepEqual(validate(s), []);

  const unit = { id: 'p1', kind: 'plan', parent: null, title: 'x', state: 'todo', checkpoint: null, updated: 't' };
  const bad = { ...s, mode: 'loose', stage: 'nowhere', cap: 4, units: [unit, { ...unit }] };
  const problems = validate(bad).join('\n');
  for (const word of ['mode', 'stage', 'cap', 'p1']) assert.match(problems, new RegExp(word));
  assert.equal(validate({ ...s, cap: 11 }).length, 1);
  assert.equal(validate({ ...s, cap: 10 }).length, 0);
});

test('mutate persists and keeps a backup', () => withState((dir) => {
  mutate(dir, decide('first'));
  const afterFirst = read(statePath(dir));
  const result = mutate(dir, decide('second'));
  assert.equal(read(statePath(dir) + '.bak'), afterFirst);
  assert.deepEqual(load(dir), result);
  assert.deepEqual(result.decisions.map((d) => d.decision), ['first', 'second']);
  assert.equal(fs.existsSync(lockFile(dir)), false);
}));

test('fn throwing writes nothing', () => withState((dir) => {
  const before = read(statePath(dir));
  assert.throws(() => mutate(dir, (s) => { s.cap = 6; throw new Error('boom'); }), /boom/);
  assert.equal(read(statePath(dir)), before);
  assert.equal(fs.existsSync(statePath(dir) + '.tmp'), false);
  assert.equal(fs.existsSync(statePath(dir) + '.bak'), false);
  assert.equal(fs.existsSync(lockFile(dir)), false);
}));

test('invalid mutation is rejected', () => withState((dir) => {
  const before = read(statePath(dir));
  assert.throws(() => mutate(dir, (s) => { s.cap = 99; }), (e) => e instanceof RilError && /cap/.test(e.message));
  assert.equal(read(statePath(dir)), before);
  assert.equal(fs.existsSync(statePath(dir) + '.tmp'), false);
}));

test('two processes, no lost update', async () => withState(async (dir) => {
  await Promise.all([run([dir, 'mutate', '50', 'a']), run([dir, 'mutate', '50', 'b'])]);
  const names = load(dir).decisions.map((d) => d.decision);
  assert.equal(names.length, 100);
  assert.equal(new Set(names).size, 100);
}));

test('live lock times out', async () => {
  const { dir, cleanup } = tmpProject();
  fs.writeFileSync(statePath(dir), JSON.stringify(emptyState({ project: 'demo', mode: 'guided' })));
  const holder = spawn(process.execPath, [child, dir, 'hold'], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.on('data', (d) => String(d).includes('locked') && resolve());
      holder.on('exit', (code) => reject(new Error(`holder exited early with ${code}`)));
    });
    const before = read(statePath(dir));
    const start = Date.now();
    assert.throws(() => mutate(dir, decide('blocked')), (e) => e instanceof RilError && e.code === 5 && /Next:/.test(e.message));
    const waited = Date.now() - start;
    assert.ok(waited >= 2800 && waited < 6000, `waited ${waited} ms`);
    assert.equal(read(statePath(dir)), before);
  } finally {
    holder.kill();
    await new Promise((resolve) => (holder.exitCode !== null || holder.signalCode !== null ? resolve() : holder.on('exit', resolve)));
    cleanup();
  }
});

test('damaged json', () => withState((dir) => {
  fs.writeFileSync(statePath(dir), '{ "version": 1, ');
  assert.throws(() => load(dir), (e) => e instanceof RilError && e.code === 1 && /ril doctor --fix/.test(e.message));
  fs.writeFileSync(statePath(dir), JSON.stringify({ version: 1, cap: 99 }));
  assert.throws(() => load(dir), (e) => e instanceof RilError && e.code === 1 && /ril doctor --fix/.test(e.message));
}));

test('mutate in a folder with no .ril asks for ril init', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-bare-'));
  try {
    assert.throws(() => mutate(dir, () => {}), (e) => e instanceof RilError && e.code === 2 && /Next: run ril init/.test(e.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stale locks are replaced (dead process, old lock), also with many processes racing to clear one', async () => withState(async (dir) => {
  const dead = `99999999 ${new Date().toISOString()}`;
  fs.writeFileSync(lockFile(dir), dead);
  mutate(dir, decide('dead pid'));
  fs.writeFileSync(lockFile(dir), `${process.pid} ${new Date(Date.now() - 121_000).toISOString()}`);
  mutate(dir, decide('old lock'));
  assert.equal(load(dir).decisions.length, 2);
  assert.equal(fs.existsSync(lockFile(dir)), false);
  fs.writeFileSync(lockFile(dir), dead);
  await Promise.all(Array.from({ length: 8 }, (_, i) => run([dir, 'mutate', '1', `c${i}`])));
  assert.equal(load(dir).decisions.length, 10);
  assert.equal(fs.existsSync(lockFile(dir) + '.break'), false);
}));

test('parkedFrom is set only while parked', () => {
  const s = emptyState({ project: 'demo', mode: 'guided', now: new Date() });
  assert.match(validate({ ...s, parkedFrom: 'design' }).join('\n'), /parkedFrom/);
  assert.match(validate({ ...s, stage: 'parked' }).join('\n'), /parkedFrom/);
  assert.deepEqual(validate({ ...s, stage: 'parked', parkedFrom: 'design' }), []);
});

test('system error text stays out of the message and goes in detail', () => inTmp((dir) => {
  fs.mkdirSync(statePath(dir)); // a folder where the file should be: reading it fails
  assert.throws(() => load(dir), (e) => e instanceof RilError && !/E[A-Z]{3,}/.test(e.message) && /E[A-Z]{3,}/.test(e.detail));
}));

test('the backup is written through a temp file and renamed into place', () => withState((dir) => {
  const before = read(statePath(dir));
  mutate(dir, decide('one'));
  assert.equal(read(statePath(dir) + '.bak'), before);
  assert.equal(fs.existsSync(statePath(dir) + '.bak.tmp'), false);
}));

test('missing state asks for ril init', () => inTmp((dir) => {
  assert.equal(statePath(dir), path.join(dir, '.ril', 'state.json'));
  assert.throws(() => load(dir), (e) => e instanceof RilError && e.code === 2 && /Next: run ril init/.test(e.message));
}));

test('createState writes a new state file and creates .ril when needed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-create-'));
  try {
    const state = emptyState({ project: 'fresh', mode: 'guided' });
    createState(dir, state);
    assert.equal(read(statePath(dir)), `${JSON.stringify(state, null, 2)}\n`);
    assert.deepEqual(load(dir), state);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.ril')), ['state.json'], 'no temp, backup or lock files left');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createState refuses to replace an existing state file', () => withState((dir) => {
  const before = read(statePath(dir));
  assert.throws(
    () => createState(dir, emptyState({ project: 'other', mode: 'guided' })),
    (e) => e instanceof RilError && e.code === 1 && /Next: /.test(e.message),
  );
  assert.equal(read(statePath(dir)), before);
}));

test('createState refuses an invalid state and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-create-'));
  try {
    const bad = { ...emptyState({ project: 'x', mode: 'guided' }), mode: 'loose' };
    assert.throws(() => createState(dir, bad), (e) => e instanceof RilError && /Next: /.test(e.message));
    assert.equal(fs.existsSync(statePath(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('takeLock treats busy and permission errors like a held lock', () => {
  inTmp((dir) => {
    for (const code of ['EEXIST', 'EPERM', 'EACCES', 'EBUSY']) {
      assert.equal(takeLock(lockFile(dir), 'x', fail(code)), false, code);
    }
    assert.throws(() => takeLock(lockFile(dir), 'x', fail('ENOENT')), /ENOENT/);
    assert.equal(takeLock(lockFile(dir), 'mine'), true);
    assert.equal(fs.readFileSync(lockFile(dir), 'utf8'), 'mine');
  });
});

test('withLock retries through brief Windows-style open errors', () => {
  inTmp((dir) => {
    let calls = 0;
    const flaky = (...args) => (++calls <= 2 ? fail('EPERM')() : fs.openSync(...args));
    assert.equal(withLock(dir, () => 'ran', { open: flaky }), 'ran');
    assert.equal(calls, 3);
    assert.equal(fs.existsSync(lockFile(dir)), false);
  });
});

test('withLock in a folder with no .ril asks for ril init', () => {
  inTmp((dir) => {
    fs.rmSync(path.join(dir, '.ril'), { recursive: true });
    assert.throws(() => withLock(dir, () => {}), (e) => e instanceof RilError && e.code === 2 && /Next: run ril init/.test(e.message));
  });
});

test('clearStaleLock removes only the lock it judged, and only while it holds the break file', () => {
  inTmp((dir) => {
    const lock = lockFile(dir);
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
  inTmp((dir) => {
    const lock = lockFile(dir);
    fs.writeFileSync(lock, 'stale');
    fs.writeFileSync(`${lock}.break`, '');
    ago(`${lock}.break`, 10_000);
    clearStaleLock(lock, 'stale', Date.now()); // clears the abandoned break file
    assert.equal(clearStaleLock(lock, 'stale', Date.now()), true);
    assert.equal(fs.existsSync(lock), false);
  });
});

test('an empty lock is stale only once it is a few seconds old', () => {
  inTmp((dir) => {
    const lock = lockFile(dir);
    fs.writeFileSync(lock, '');
    assert.equal(isStale(lock, '', Date.now()), false);
    ago(lock, 10_000);
    assert.equal(isStale(lock, '', Date.now()), true);
    assert.equal(withLock(dir, () => 'ran'), 'ran');
  });
});

test('a failure while releasing does not hide the result', () => {
  inTmp((dir) => {
    // fn swaps the lock file for a folder, so reading it during release throws.
    const swap = () => {
      fs.rmSync(lockFile(dir));
      fs.mkdirSync(lockFile(dir));
      fs.writeFileSync(path.join(lockFile(dir), 'x'), 'x');
    };
    assert.equal(withLock(dir, () => { swap(); return 'kept'; }), 'kept');
    fs.rmSync(lockFile(dir), { recursive: true });
    assert.throws(() => withLock(dir, () => { swap(); throw new Error('original'); }), /original/);
  });
});
