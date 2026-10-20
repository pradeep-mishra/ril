// The command line itself: help, options, errors, finding the project, and the status, progress and root commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, ril } from './helpers/ril.mjs';
import { inTmp, tmpProject } from './helpers/tmp.mjs';
import { addScenario, ok, withRepo } from './helpers/repo.mjs';
import { mutate } from '../lib/store.mjs';
import { oneline, full } from '../lib/commands/status.mjs';
import { emptyState } from '../lib/schema.mjs';
import { parseFlags } from '../lib/records.mjs';
import { commands, run } from '../lib/cli.mjs';

const folder = () => tmpProject({ bare: true });
const inFolder = (fn) => inTmp(fn, { bare: true });
const withProject = (fn, ...init) => withRepo(fn, { gitInit: false, init });
const jargon = /\b(SHA|trunk|head|playbook)\b|head/i;
const sc = (id, title, status, round = 0) => ({ id, title, method: 'cli', criterion: 'c', status, round, updated: 't' });

test('help lists every group', () => {
  inFolder((dir) => {
    const r = ril(dir, 'help');
    assert.equal(r.code, 0);
    for (const c of commands) {
      assert.ok(r.stdout.includes(c.name), c.name);
      assert.deepEqual([typeof c.summary, typeof c.usage, typeof c.run], ['string', 'string', 'function'], c.name);
    }
    for (const name of ['init', 'status', 'progress', 'root', 'help']) assert.ok(commands.some((c) => c.name === name), name);
    const j = JSON.parse(ril(dir, 'help', '--json').stdout);
    assert.deepEqual(j.commands, commands.map((c) => ({ name: c.name, summary: c.summary })));
    assert.ok(ril(dir).stdout.includes('init'), 'no command shows help');
  });
});

test('help text has no process jargon', () => {
  const words = /\b(SHA|trunk|head|playbook|stage machine)\b/i;
  for (const c of commands) {
    assert.doesNotMatch(c.summary, words, c.name);
    assert.doesNotMatch(c.usage, words, c.name);
  }
  inFolder((dir) => {
    assert.doesNotMatch(ril(dir, 'help').stdout, words);
  });
});

test('--help and -h print help and exit 0', () => {
  inFolder((dir) => {
    for (const args of [['--help'], ['-h'], ['init', '--help'], ['status', '-h']]) {
      const r = ril(dir, ...args);
      assert.equal(r.code, 0, args.join(' '));
      assert.equal(r.stderr, '');
    }
    assert.match(ril(dir, 'init', '--help').stdout, /Usage: ril init/);
    assert.equal(fs.existsSync(path.join(dir, '.ril')), false, 'help does not run the command');
    assert.ok(ril(dir, '--help').stdout.includes('progress'));
  });
});

test('flags: --help, --force and --json can come before the command', async () => {
  const spec = { values: ['dir', 'force'], bools: ['json', 'help'], keepUnknown: true };
  assert.deepEqual(parseFlags(['--json', '--force', 'why not', 'status', '--full'], spec), { flags: { json: true, force: 'why not' }, rest: ['status', '--full'] });
  assert.deepEqual(parseFlags(['--force=--odd reason', 'x'], spec).flags, { force: '--odd reason' });
  assert.deepEqual(parseFlags(['-h'], spec).flags, { help: true });
  assert.throws(() => parseFlags(['--force', '--json', 'status'], spec), (e) => e.code === 1 && /Next:/.test(e.message));

  const lines = [];
  const code = await run(['--json', 'root'], { out: (t) => lines.push(t), err: () => {} });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(lines[0]), { root: repoRoot });
  const errs = [];
  assert.equal(await run(['--json', '--force', 'because', 'nope'], { out: () => {}, err: (t) => errs.push(t) }), 1);
  assert.match(JSON.parse(errs[0]).next, /ril help/);
});

test('error has Next', () => {
  const home = folder();
  const empty = folder();
  try {
    const r = ril(home.dir, 'status', '--dir', empty.dir);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Next:/);
    assert.equal(r.stdout, '');
    const j = ril(home.dir, 'status', '--dir', empty.dir, '--json');
    assert.equal(j.code, 2);
    const e = JSON.parse(j.stderr);
    assert.doesNotMatch(e.error, /Next:/);
    assert.equal(e.error, `There is no ril project in ${empty.dir} yet.`);
    assert.equal(e.next, 'run ril init');
    assert.equal(e.detail, '');
  } finally {
    home.cleanup();
    empty.cleanup();
  }
});

test('unknown commands and flags fail with a Next line', () => {
  withProject((dir) => {
    for (const args of [['bogus'], ['status', '--nope'], ['init', '--mode'], ['progress']]) {
      const r = ril(dir, ...args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.stderr, /Next:/, args.join(' '));
    }
  });
});

test('the project is found from a subfolder, and --dir overrides', () => {
  withProject((dir) => {
    const sub = path.join(dir, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(ril(sub, 'status').code, 0);
    const other = folder();
    try {
      assert.equal(ril(other.dir, 'status', '--dir', dir).code, 0);
      assert.equal(ril(other.dir, 'status', `--dir=${dir}`).code, 0);
    } finally {
      other.cleanup();
    }
  });
});

test('a folder with .ril but no state file is not taken for the project', () => {
  withProject((dir) => {
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(path.join(sub, '.ril'), { recursive: true });
    const r = ril(sub, 'status');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /shape/);
  });
});

test('bin/ril is executable with a node shebang, and ril.cmd launches it', () => {
  const file = path.join(repoRoot, 'bin', 'ril');
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('#!/usr/bin/env node\n'));
  if (process.platform !== 'win32') assert.ok(fs.statSync(file).mode & 0o100, 'owner execute bit');
  assert.match(fs.readFileSync(path.join(repoRoot, 'bin', 'ril.cmd'), 'utf8'), /^@node "%~dp0ril" %\*\r?\n?$/);
});

test('progress appends', () => {
  withProject((dir) => {
    const r = ril(dir, 'progress', 'Plan 1 started');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'Plan 1 started\n');
    ril(dir, 'progress', 'two\nlines');
    const lines = fs.readFileSync(path.join(dir, '.ril', 'log.md'), 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z\tPlan 1 started$/);
    assert.ok(lines[1].endsWith('two lines'));
  });
});

test('progress without a project says so', () => {
  inFolder((dir) => {
    const r = ril(dir, 'progress', 'hi');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Next: run ril init/);
  });
});

test('root prints the plugin root', () => {
  inFolder((dir) => {
    assert.equal(ril(dir, 'root').stdout, `${repoRoot}\n`);
    assert.deepEqual(JSON.parse(ril(dir, 'root', '--json').stdout), { root: repoRoot });
  });
});

test('status prints one line, the full table with its agents, and json', () => {
  withProject((dir) => {
    const line = ril(dir, 'status');
    assert.equal(line.code, 0, line.stderr);
    assert.equal(line.stdout.trim().split('\n').length, 1);
    assert.match(line.stdout, /shape/);
    assert.match(line.stdout, /Waiting on you: nothing\./);
    mutate(dir, (s) => {
      s.agents.push({ id: 'a1', role: 'tester', unit: 'p1', task: 'write tests', state: 'done', result: '3 tests written', started: 't', updated: 't' });
    });
    const full = ril(dir, 'status', '--full');
    assert.equal(full.code, 0, full.stderr);
    for (const w of ['tester', 'write tests', 'finished', '3 tests written']) assert.ok(full.stdout.includes(w), w);
    assert.doesNotMatch(line.stdout + full.stdout, jargon);
    const j = JSON.parse(ril(dir, 'status', '--json').stdout);
    assert.equal(j.stage, 'shape');
    assert.equal(typeof j.summary, 'string');
  });
});

test('status line reflects plans, scenarios, rounds and open questions', () => {
  const s = emptyState({ project: 'demo', mode: 'autonomous' });
  s.stage = 'build';
  s.units = [1, 2, 3, 4].map((n) => ({ id: `p${n}`, kind: 'plan', parent: null, title: `P${n}`, state: n === 1 ? 'verified' : n === 2 ? 'doing' : 'todo', checkpoint: null, updated: 't' }));
  s.units.push({ id: 't1', kind: 'task', parent: 'p2', title: 'T', state: 'doing', checkpoint: null, updated: 't' });
  const sc = (i, status, round) => ({ id: `s${i}`, title: 'x', method: 'cli', criterion: 'c', status, round, updated: 't' });
  s.scenarios = [sc(1, 'proven', 0), sc(2, 'proven', 0), sc(3, 'proven', 0), sc(4, 'failing', 2), ...[5, 6, 7].map((i) => sc(i, 'unproven', 0))];
  assert.equal(oneline(s), 'Building plan 2 of 4: 3 of 7 scenarios proven, 1 failing (round 2 of 8). Waiting on you: nothing.');
  s.gates = [{ id: 'g1', status: 'open', question: 'q', options: [], default: null, answer: null }, { id: 'g2', status: 'resolved', question: 'q', options: [], default: null, answer: 'a' }];
  assert.match(oneline(s), /Waiting on you: 1 open question\.$/);
  s.agents = [{ id: 'a1', role: 'implementer', unit: 'p2', task: 'write the parser', state: 'running', result: '', started: 't', updated: 't' }];
  const text = full(s);
  for (const w of ['implementer', 'write the parser', 'working', 'demo', 'in progress']) assert.ok(text.includes(w), w);
});

test('status --full uses plain words for plan and agent states', () => {
  const s = emptyState({ project: 'demo', mode: 'guided' });
  const unit = (id, state) => ({ id, kind: 'plan', parent: null, title: id, state, checkpoint: null, updated: 't' });
  const raw = ['todo', 'doing', 'built', 'verified', 'failed', 'parked'];
  s.units = raw.map((st, i) => unit(`plan${i}`, st));
  const agent = (st) => ({ id: st, role: `role-${st}`, unit: null, task: 't', state: st, result: '', started: 't', updated: 't' });
  s.agents = ['running', 'done', 'failed', 'stopped'].map(agent);
  const lines = full(s).split('\n');
  const expected = { todo: 'not started', doing: 'in progress', built: 'built', verified: 'proven', failed: 'needs a fix', parked: 'set aside' };
  for (const [rawState, plain] of Object.entries(expected)) {
    assert.ok(lines.some((l) => l.includes(`plan${raw.indexOf(rawState)}`) && l.trimEnd().endsWith(`- ${plain}`)), `${rawState} -> ${plain}`);
  }
  const agentLine = (st) => lines.find((l) => l.includes(`role-${st}`));
  assert.match(agentLine('running'), /working/);
  assert.match(agentLine('done'), /finished/);
  assert.doesNotMatch(lines.filter((l) => l.includes('plan')).join('\n'), /\b(todo|doing|verified|failed|parked)\b/);
});

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
  withProject((dir) => {
    addScenario(dir, 'S1');
    assert.match(ok(dir, 'status', '--full').stdout, /^ {2}S1 {2}Title S1 - not proven yet$/m);
  });
});
