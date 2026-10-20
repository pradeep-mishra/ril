import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpProject } from './helpers/tmp.mjs';
import { RilError } from '../lib/errors.mjs';
import { emptyState, validate } from '../lib/schema.mjs';
import { statePath, load, mutate } from '../lib/store.mjs';

const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'store-child.mjs');

function project() {
  const p = tmpProject();
  const state = emptyState({ project: 'demo', mode: 'guided', now: new Date('2026-01-01T00:00:00Z') });
  fs.writeFileSync(statePath(p.dir), JSON.stringify(state, null, 2));
  return p;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const lockFile = (dir) => path.join(dir, '.ril', '.lock');
const decide = (decision) => (s) => s.decisions.push({ ts: 't', stage: s.stage, decision, why: 'test' });

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

test('mutate persists and keeps a backup', () => {
  const { dir, cleanup } = project();
  try {
    mutate(dir, decide('first'));
    const afterFirst = read(statePath(dir));
    const result = mutate(dir, decide('second'));
    assert.equal(read(statePath(dir) + '.bak'), afterFirst);
    assert.deepEqual(load(dir), result);
    assert.deepEqual(result.decisions.map((d) => d.decision), ['first', 'second']);
    assert.equal(fs.existsSync(lockFile(dir)), false);
  } finally {
    cleanup();
  }
});

test('fn throwing writes nothing', () => {
  const { dir, cleanup } = project();
  try {
    const before = read(statePath(dir));
    assert.throws(() => mutate(dir, (s) => { s.cap = 6; throw new Error('boom'); }), /boom/);
    assert.equal(read(statePath(dir)), before);
    assert.equal(fs.existsSync(statePath(dir) + '.tmp'), false);
    assert.equal(fs.existsSync(statePath(dir) + '.bak'), false);
    assert.equal(fs.existsSync(lockFile(dir)), false);
  } finally {
    cleanup();
  }
});

test('invalid mutation is rejected', () => {
  const { dir, cleanup } = project();
  try {
    const before = read(statePath(dir));
    assert.throws(() => mutate(dir, (s) => { s.cap = 99; }), (e) => e instanceof RilError && /cap/.test(e.message));
    assert.equal(read(statePath(dir)), before);
    assert.equal(fs.existsSync(statePath(dir) + '.tmp'), false);
  } finally {
    cleanup();
  }
});

test('two processes, no lost update', async () => {
  const { dir, cleanup } = project();
  try {
    await Promise.all([run([dir, 'mutate', '50', 'a']), run([dir, 'mutate', '50', 'b'])]);
    const names = load(dir).decisions.map((d) => d.decision);
    assert.equal(names.length, 100);
    assert.equal(new Set(names).size, 100);
  } finally {
    cleanup();
  }
});

test('stale lock replaced', () => {
  const { dir, cleanup } = project();
  try {
    fs.writeFileSync(lockFile(dir), `99999999 ${new Date().toISOString()}`);
    mutate(dir, decide('dead pid'));
    fs.writeFileSync(lockFile(dir), `${process.pid} ${new Date(Date.now() - 121_000).toISOString()}`);
    mutate(dir, decide('old lock'));
    assert.equal(load(dir).decisions.length, 2);
    assert.equal(fs.existsSync(lockFile(dir)), false);
  } finally {
    cleanup();
  }
});

test('live lock times out', async () => {
  const { dir, cleanup } = project();
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

test('damaged json', () => {
  const { dir, cleanup } = project();
  try {
    fs.writeFileSync(statePath(dir), '{ "version": 1, ');
    assert.throws(() => load(dir), (e) => e instanceof RilError && e.code === 1 && /ril doctor --fix/.test(e.message));
    fs.writeFileSync(statePath(dir), JSON.stringify({ version: 1, cap: 99 }));
    assert.throws(() => load(dir), (e) => e instanceof RilError && e.code === 1 && /ril doctor --fix/.test(e.message));
  } finally {
    cleanup();
  }
});

test('mutate in a folder with no .ril asks for ril init', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-bare-'));
  try {
    assert.throws(() => mutate(dir, () => {}), (e) => e instanceof RilError && e.code === 2 && /Next: run ril init/.test(e.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('many processes racing to clear one stale lock lose no update', async () => {
  const { dir, cleanup } = project();
  try {
    fs.writeFileSync(lockFile(dir), `99999999 ${new Date().toISOString()}`);
    await Promise.all(Array.from({ length: 8 }, (_, i) => run([dir, 'mutate', '1', `c${i}`])));
    assert.equal(load(dir).decisions.length, 8);
    assert.equal(fs.existsSync(lockFile(dir) + '.break'), false);
  } finally {
    cleanup();
  }
});

test('parkedFrom is set only while parked', () => {
  const s = emptyState({ project: 'demo', mode: 'guided', now: new Date() });
  assert.match(validate({ ...s, parkedFrom: 'design' }).join('\n'), /parkedFrom/);
  assert.match(validate({ ...s, stage: 'parked' }).join('\n'), /parkedFrom/);
  assert.deepEqual(validate({ ...s, stage: 'parked', parkedFrom: 'design' }), []);
});

test('system error text stays out of the message and goes in detail', () => {
  const { dir, cleanup } = tmpProject();
  try {
    fs.mkdirSync(statePath(dir)); // a folder where the file should be: reading it fails
    assert.throws(() => load(dir), (e) => e instanceof RilError && !/E[A-Z]{3,}/.test(e.message) && /E[A-Z]{3,}/.test(e.detail));
  } finally {
    cleanup();
  }
});

test('the backup is written through a temp file and renamed into place', () => {
  const { dir, cleanup } = project();
  try {
    const before = read(statePath(dir));
    mutate(dir, decide('one'));
    assert.equal(read(statePath(dir) + '.bak'), before);
    assert.equal(fs.existsSync(statePath(dir) + '.bak.tmp'), false);
  } finally {
    cleanup();
  }
});

test('missing state asks for ril init', () => {
  const { dir, cleanup } = tmpProject();
  try {
    assert.equal(statePath(dir), path.join(dir, '.ril', 'state.json'));
    assert.throws(() => load(dir), (e) => e instanceof RilError && e.code === 2 && /Next: run ril init/.test(e.message));
  } finally {
    cleanup();
  }
});
