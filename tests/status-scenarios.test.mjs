import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ril } from './helpers/ril.mjs';
import { full } from '../lib/render.mjs';
import { emptyState } from '../lib/schema.mjs';

const sc = (id, title, status, round = 0) => ({ id, title, method: 'cli', criterion: 'c', status, round, updated: 't' });

test('status --full lists each scenario with a plain proof status', () => {
  const s = emptyState({ project: 'demo', mode: 'guided' });
  s.cap = 8;
  s.scenarios = [sc('S1', 'Sign in', 'proven'), sc('S2', 'Checkout', 'failing', 2), sc('S3', 'Export', 'parked'), sc('S4', 'Search', 'unproven'), sc('S5', 'Help', 'failing', 0)];
  const lines = full(s).split('\n');
  const at = lines.indexOf('Scenarios:');
  assert.ok(at > 1, 'Scenarios section present after the summary line');
  assert.equal(lines[at - 1], '');
  assert.equal(lines[at + 1], '  S1  Sign in - proven');
  assert.equal(lines[at + 2], '  S2  Checkout - failing (fix round 2 of 8)');
  assert.equal(lines[at + 3], '  S3  Export - set aside');
  assert.equal(lines[at + 4], '  S4  Search - not proven yet');
  assert.equal(lines[at + 5], '  S5  Help - failing');
  assert.equal(lines[at + 6], '');
  assert.doesNotMatch(lines.slice(at, at + 6).join('\n'), /unproven|ledger|verdict/i);
});

test('Scenarios sits between the summary and the Plans, and says so when there are none', () => {
  const s = emptyState({ project: 'demo', mode: 'guided' });
  const none = full(s).split('\n');
  const at = none.indexOf('Scenarios:');
  assert.ok(at > 0);
  assert.deepEqual(none.slice(at + 1, at + 4), ['  No scenarios yet.', '', 'Agents:']);
  s.units = [{ id: 'p1', kind: 'plan', parent: null, title: 'P1', state: 'todo', checkpoint: null, updated: 't' }];
  s.scenarios = [sc('S1', 't', 'proven')];
  const text = full(s);
  assert.ok(text.indexOf('Scenarios:') < text.indexOf('Plans:'));
  assert.ok(text.indexOf('Plans:') < text.indexOf('Agents:'));
});

test('the CLI shows an added scenario in status --full', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-scn-'));
  try {
    assert.equal(ril(dir, 'init').code, 0);
    const a = ril(dir, 'scenario', 'add', 'S1', '--title', 't', '--method', 'cli', '--criterion', 'c');
    assert.equal(a.code, 0, a.stderr);
    const r = ril(dir, 'status', '--full');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^ {2}S1 {2}t - not proven yet$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
