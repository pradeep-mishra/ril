import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ril } from './helpers/ril.mjs';
import { commands } from '../lib/commands/index.mjs';
import { load, mutate, statePath } from '../lib/store.mjs';
import { oneline, full } from '../lib/render.mjs';
import { emptyState } from '../lib/schema.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- ril:managed:start -->';
const END = '<!-- ril:managed:end -->';
const LINE =
  'This project is managed by RIL. For any request about this project (continue, fix, change, status), start with the RIL front door (/ril); it re-reads .ril/ state.';

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-cli-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function withProject(fn, ...initArgs) {
  const p = folder();
  try {
    const r = ril(p.dir, 'init', ...initArgs);
    assert.equal(r.code, 0, r.stderr);
    return fn(p.dir);
  } finally {
    p.cleanup();
  }
}

const bytes = (file) => fs.readFileSync(file);
const jargon = /\b(SHA|trunk|head|playbook)\b|head/i;

test('help lists every group', () => {
  const { dir, cleanup } = folder();
  try {
    const r = ril(dir, 'help');
    assert.equal(r.code, 0);
    for (const c of commands) assert.ok(r.stdout.includes(c.name), c.name);
    for (const name of ['init', 'status', 'progress', 'root', 'help']) assert.ok(commands.some((c) => c.name === name), name);
    const j = JSON.parse(ril(dir, 'help', '--json').stdout);
    assert.deepEqual(j.commands, commands.map((c) => ({ name: c.name, summary: c.summary })));
    assert.ok(ril(dir).stdout.includes('init'), 'no command shows help');
  } finally {
    cleanup();
  }
});

test('every command has name, summary, usage and run', () => {
  for (const c of commands) {
    assert.equal(typeof c.name, 'string');
    assert.equal(typeof c.summary, 'string');
    assert.equal(typeof c.usage, 'string');
    assert.equal(typeof c.run, 'function');
  }
});

test('init creates state and ignore file', () => {
  withProject((dir) => {
    const state = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
    assert.equal(state.version, 1);
    assert.equal(state.project, path.basename(dir));
    assert.equal(state.mode, 'autonomous');
    assert.equal(state.pluginRoot, repoRoot);
    assert.equal(fs.readFileSync(path.join(dir, '.ril', '.gitignore'), 'utf8'), '*\n!docs/\n!docs/**\n!.gitignore\n');
    for (const d of ['docs', 'evidence', 'agents']) assert.ok(fs.statSync(path.join(dir, '.ril', d)).isDirectory(), d);
    assert.ok(fs.existsSync(path.join(dir, '.ril', 'log.md')));
    for (const f of ['CLAUDE.md', 'AGENTS.md']) {
      assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), `${START}\n${LINE}\n${END}\n`, f);
    }
  });
});

test('init takes a name and a mode, and rejects a bad mode', () => {
  withProject((dir) => {
    const s = load(dir);
    assert.equal(s.project, 'Shop');
    assert.equal(s.mode, 'guided');
  }, '--name', 'Shop', '--mode', 'guided');
  const { dir, cleanup } = folder();
  try {
    const r = ril(dir, 'init', '--mode', 'loose');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Next:/);
    assert.equal(fs.existsSync(path.join(dir, '.ril')), false);
  } finally {
    cleanup();
  }
});

test('init routing block preserves user content', () => {
  const { dir, cleanup } = folder();
  try {
    const original = Buffer.from('# My notes\r\n\r\nKeep \xe9 this\r\nno final newline');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), original);
    assert.equal(ril(dir, 'init').code, 0);
    const after = bytes(path.join(dir, 'CLAUDE.md'));
    assert.ok(after.subarray(0, original.length).equals(original), 'original bytes kept');
    const tail = after.subarray(original.length).toString('latin1');
    assert.equal(tail.split(START).length, 2, 'block added once');
    assert.ok(tail.startsWith('\r\n\r\n'), 'separated by a blank line');
    assert.doesNotMatch(after.toString('latin1'), /[^\r]\n/, 'the block uses the file\'s CRLF endings');

    assert.equal(ril(dir, 'init').code, 0);
    assert.ok(bytes(path.join(dir, 'CLAUDE.md')).equals(after), 'second init is byte-identical');
  } finally {
    cleanup();
  }
});

test('init replaces only the text between existing markers', () => {
  const { dir, cleanup } = folder();
  try {
    const file = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(file, `top\r\n${START}\r\nold text\r\n${END}\r\nbottom\r\n`);
    assert.equal(ril(dir, 'init').code, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), `top\r\n${START}\r\n${LINE}\r\n${END}\r\nbottom\r\n`);
  } finally {
    cleanup();
  }
});

test('init appends after exactly one blank line to a file that ends with a newline', () => {
  const { dir, cleanup } = folder();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'hello\n');
    ril(dir, 'init');
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), `hello\n\n${START}\n${LINE}\n${END}\n`);
  } finally {
    cleanup();
  }
});

test('init is idempotent', () => {
  withProject((dir) => {
    mutate(dir, (s) => s.decisions.push({ ts: 't', stage: s.stage, decision: 'keep me', why: 'test' }));
    const stateBefore = fs.readFileSync(statePath(dir), 'utf8');
    const backupBefore = fs.readFileSync(`${statePath(dir)}.bak`, 'utf8');
    const r = ril(dir, 'init', '--name', 'Other', '--mode', 'guided');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.readFileSync(statePath(dir), 'utf8'), stateBefore);
    assert.equal(fs.readFileSync(`${statePath(dir)}.bak`, 'utf8'), backupBefore, 'no state write happened');
  });
});

test('init repairs the block, the ignore file and the plugin root', () => {
  withProject((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${START}\nwrong\n${END}\n`);
    fs.writeFileSync(path.join(dir, '.ril', '.gitignore'), 'x\n');
    fs.rmSync(path.join(dir, '.ril', 'evidence'), { recursive: true });
    mutate(dir, (s) => {
      s.pluginRoot = '/somewhere/old';
    });
    assert.equal(ril(dir, 'init').code, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), `${START}\n${LINE}\n${END}\n`);
    assert.equal(fs.readFileSync(path.join(dir, '.ril', '.gitignore'), 'utf8'), '*\n!docs/\n!docs/**\n!.gitignore\n');
    assert.ok(fs.existsSync(path.join(dir, '.ril', 'evidence')));
    assert.equal(load(dir).pluginRoot, repoRoot);
  });
});

test('init refuses a damaged state file instead of overwriting it', () => {
  withProject((dir) => {
    fs.writeFileSync(statePath(dir), '{not json');
    const r = ril(dir, 'init');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Next:/);
    assert.equal(fs.readFileSync(statePath(dir), 'utf8'), '{not json');
  });
});

test('init --json reports what happened', () => {
  const { dir, cleanup } = folder();
  try {
    const first = JSON.parse(ril(dir, 'init', '--json').stdout);
    assert.equal(first.created, true);
    const second = JSON.parse(ril(dir, 'init', '--json').stdout);
    assert.equal(second.created, false);
  } finally {
    cleanup();
  }
});

test('status oneline', () => {
  withProject((dir) => {
    const r = ril(dir, 'status');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stdout, /shape/);
    assert.match(r.stdout, /Waiting on you: nothing\./);
    assert.doesNotMatch(r.stdout, jargon);
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
  for (const w of ['implementer', 'write the parser', 'running', 'demo']) assert.ok(text.includes(w), w);
});

test('status --full prints the agent table and rewrites status.md', () => {
  withProject((dir) => {
    mutate(dir, (s) => {
      s.agents.push({ id: 'a1', role: 'tester', unit: 'p1', task: 'write tests', state: 'done', result: '3 tests written', started: 't', updated: 't' });
    });
    const r = ril(dir, 'status', '--full');
    assert.equal(r.code, 0, r.stderr);
    for (const w of ['tester', 'write tests', 'done', '3 tests written']) assert.ok(r.stdout.includes(w), w);
    assert.doesNotMatch(r.stdout, jargon);
    assert.equal(fs.readFileSync(path.join(dir, '.ril', 'status.md'), 'utf8'), r.stdout);
  });
});

test('status --json is machine readable', () => {
  withProject((dir) => {
    const j = JSON.parse(ril(dir, 'status', '--json').stdout);
    assert.equal(j.stage, 'shape');
    assert.equal(typeof j.summary, 'string');
  });
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
    assert.match(e.error, /no ril project/);
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
  const { dir, cleanup } = folder();
  try {
    const r = ril(dir, 'progress', 'hi');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Next: run ril init/);
  } finally {
    cleanup();
  }
});

test('root prints the plugin root', () => {
  const { dir, cleanup } = folder();
  try {
    assert.equal(ril(dir, 'root').stdout, `${repoRoot}\n`);
    assert.deepEqual(JSON.parse(ril(dir, 'root', '--json').stdout), { root: repoRoot });
  } finally {
    cleanup();
  }
});

test('bin/ril is executable with a node shebang, and ril.cmd launches it', () => {
  const file = path.join(repoRoot, 'bin', 'ril');
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('#!/usr/bin/env node\n'));
  if (process.platform !== 'win32') assert.ok(fs.statSync(file).mode & 0o100, 'owner execute bit');
  assert.match(fs.readFileSync(path.join(repoRoot, 'bin', 'ril.cmd'), 'utf8'), /^@node "%~dp0ril" %\*\r?\n?$/);
});
