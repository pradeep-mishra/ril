import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ril } from './helpers/ril.mjs';
import { git, gitInit } from './helpers/repo.mjs';
import { commands } from '../lib/commands/index.mjs';
import { load, mutate, statePath } from '../lib/store.mjs';
import { oneline, full } from '../lib/render.mjs';
import { emptyState } from '../lib/schema.mjs';
import { parseFlags } from '../lib/args.mjs';
import { run } from '../lib/cli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- ril:managed:start -->';
const END = '<!-- ril:managed:end -->';
const LINE =
  'This project is managed by RIL. For any request about this project (continue, fix, change, status), start with the RIL front door (/ril); it re-reads .ril/ state.';

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-cli-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function inFolder(fn) {
  const p = folder();
  try {
    return fn(p.dir);
  } finally {
    p.cleanup();
  }
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
  inFolder((dir) => {
    const r = ril(dir, 'help');
    assert.equal(r.code, 0);
    for (const c of commands) assert.ok(r.stdout.includes(c.name), c.name);
    for (const name of ['init', 'status', 'progress', 'root', 'help']) assert.ok(commands.some((c) => c.name === name), name);
    const j = JSON.parse(ril(dir, 'help', '--json').stdout);
    assert.deepEqual(j.commands, commands.map((c) => ({ name: c.name, summary: c.summary })));
    assert.ok(ril(dir).stdout.includes('init'), 'no command shows help');
  });
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

test('Finder and Explorer files are excluded by init in a repo, and by the first checkpoint otherwise, once', () => {
  inFolder((dir) => {
    gitInit(dir);
    for (let i = 0; i < 2; i++) assert.equal(ril(dir, 'init').code, 0);
    assert.deepEqual(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8').match(/^(\.DS_Store|Thumbs\.db)$/gm), ['.DS_Store', 'Thumbs.db']);
  });
  inFolder((dir) => {
    assert.equal(ril(dir, 'init').code, 0);
    assert.ok(!fs.existsSync(path.join(dir, '.git')), 'init does not start a repository');
    for (const name of ['.DS_Store', 'Thumbs.db', 'app.txt']) fs.writeFileSync(path.join(dir, name), 'x');
    assert.equal(ril(dir, 'checkpoint').code, 0);
    assert.equal(git(dir, 'ls-files', '--', '.DS_Store', 'Thumbs.db', 'app.txt'), 'app.txt');
  });
});

test('init takes a name and a mode, and rejects a bad mode', () => {
  withProject((dir) => {
    const s = load(dir);
    assert.equal(s.project, 'Shop');
    assert.equal(s.mode, 'guided');
  }, '--name', 'Shop', '--mode', 'guided');
  inFolder((dir) => {
    const r = ril(dir, 'init', '--mode', 'loose');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Next:/);
    assert.equal(fs.existsSync(path.join(dir, '.ril')), false);
  });
});

test('init routing block preserves user content', () => {
  inFolder((dir) => {
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
  });
});

test('init replaces only the text between existing markers', () => {
  inFolder((dir) => {
    const file = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(file, `top\r\n${START}\r\nold text\r\n${END}\r\nbottom\r\n`);
    assert.equal(ril(dir, 'init').code, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), `top\r\n${START}\r\n${LINE}\r\n${END}\r\nbottom\r\n`);
  });
});

test('init appends after exactly one blank line to a file that ends with a newline', () => {
  inFolder((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'hello\n');
    ril(dir, 'init');
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), `hello\n\n${START}\n${LINE}\n${END}\n`);
  });
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
  inFolder((dir) => {
    const first = JSON.parse(ril(dir, 'init', '--json').stdout);
    assert.equal(first.created, true);
    const second = JSON.parse(ril(dir, 'init', '--json').stdout);
    assert.equal(second.created, false);
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

test('bin/ril is executable with a node shebang, and ril.cmd launches it', () => {
  const file = path.join(repoRoot, 'bin', 'ril');
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('#!/usr/bin/env node\n'));
  if (process.platform !== 'win32') assert.ok(fs.statSync(file).mode & 0o100, 'owner execute bit');
  assert.match(fs.readFileSync(path.join(repoRoot, 'bin', 'ril.cmd'), 'utf8'), /^@node "%~dp0ril" %\*\r?\n?$/);
});

// ---- fix round 1 ----

const DAMAGED = 'I left CLAUDE.md alone because its RIL block looks damaged. Fix or remove the lines between the RIL markers, then run ril init again.';

function initTwice(content, name = 'CLAUDE.md') {
  const { dir, cleanup } = folder();
  const file = path.join(dir, name);
  try {
    fs.writeFileSync(file, content, 'latin1');
    const first = ril(dir, 'init');
    const afterFirst = fs.readFileSync(file, 'latin1');
    const second = ril(dir, 'init');
    const afterSecond = fs.readFileSync(file, 'latin1');
    return { dir, first, second, afterFirst, afterSecond, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

const BLOCK = (nl = '\n') => `${START}${nl}${LINE}${nl}${END}${nl}`;

test('a damaged routing block is left alone, every time, and init carries on', () => {
  const cases = {
    'start without end': `user\n${START}\nmy stuff\n`,
    'end without start': `x\n${END}\ny\n`,
    'two pairs': `${START}\na\n${END}\n${START}\nb\n${END}\n`,
    'end before start': `${END}\nmiddle\n${START}\n`,
    'two starts, one end': `${START}\na\n${START}\nb\n${END}\n`,
  };
  for (const [label, content] of Object.entries(cases)) {
    const r = initTwice(content);
    try {
      for (const run of [r.first, r.second]) {
        assert.equal(run.code, 0, `${label}: ${run.stderr}`);
        assert.ok(run.stdout.split('\n').includes(DAMAGED), `${label}: ${run.stdout}`);
      }
      assert.equal(r.afterFirst, content, `${label}: first init`);
      assert.equal(r.afterSecond, content, `${label}: second init`);
      assert.equal(fs.readFileSync(path.join(r.dir, 'AGENTS.md'), 'utf8'), BLOCK(), `${label}: the other file still gets its block`);
      assert.ok(fs.existsSync(statePath(r.dir)), `${label}: init finished`);
    } finally {
      r.cleanup();
    }
  }
});

test('a marker that is not at the start of a line does not count', () => {
  for (const content of [`see ${START} here\nmore\n`, `a ${START}\nb ${END}\n`, `${START} trailing\n`]) {
    const r = initTwice(content);
    try {
      assert.equal(r.first.code, 0);
      assert.ok(r.afterFirst.startsWith(content), 'original bytes kept');
      assert.equal(r.afterFirst.split(`\n${START}\n`).length, 2, 'one real block added');
      assert.equal(r.afterSecond, r.afterFirst, 'second init changes nothing');
      assert.doesNotMatch(r.first.stdout, /damaged/);
    } finally {
      r.cleanup();
    }
  }
});

test('mixed line endings, a missing final newline and an empty file are handled', () => {
  const cases = [
    ['a\r\nb\nc', `a\r\nb\nc\r\n\r\n${BLOCK('\r\n')}`],
    ['a\nb', `a\nb\n\n${BLOCK()}`],
    ['a\n', `a\n\n${BLOCK()}`],
    ['', BLOCK()],
    ['a\n\n', `a\n\n${BLOCK()}`],
  ];
  for (const [content, expected] of cases) {
    const r = initTwice(content);
    try {
      assert.equal(r.afterFirst, expected, JSON.stringify(content));
      assert.equal(r.afterSecond, expected, `${JSON.stringify(content)} second`);
    } finally {
      r.cleanup();
    }
  }
});

function trySymlink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch {
    return false;
  }
}

const NO_LINKS = 'this system does not allow creating symbolic links';

test('a symlinked log.md is refused and the file it points to is unchanged', (t) => {
  withProject((dir) => {
    const outside = folder();
    try {
      const target = path.join(outside.dir, 'outside.txt');
      fs.writeFileSync(target, 'keep');
      fs.rmSync(path.join(dir, '.ril', 'log.md'));
      if (!trySymlink(target, path.join(dir, '.ril', 'log.md'))) return t.skip(NO_LINKS);
      const r = ril(dir, 'progress', 'hello');
      assert.equal(r.code, 1);
      assert.match(r.stderr, /Next:/);
      assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
    } finally {
      outside.cleanup();
    }
  });
});

test('a .ril that is a link, not a real folder, is refused', (t) => {
  const real = folder();
  const proj = folder();
  try {
    assert.equal(ril(real.dir, 'init').code, 0);
    if (!trySymlink(path.join(real.dir, '.ril'), path.join(proj.dir, '.ril'))) return t.skip(NO_LINKS);
    for (const args of [['progress', 'x'], ['init']]) {
      const r = ril(proj.dir, ...args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.stderr, /Next:/);
    }
    assert.equal(fs.readFileSync(path.join(real.dir, '.ril', 'log.md'), 'utf8'), '');
  } finally {
    real.cleanup();
    proj.cleanup();
  }
});

test('CLAUDE.md linked to AGENTS.md inside the project works and the link survives', (t) => {
  inFolder((dir) => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'shared notes\n');
    if (!trySymlink('AGENTS.md', path.join(dir, 'CLAUDE.md'))) return t.skip(NO_LINKS);
    const r = ril(dir, 'init');
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.lstatSync(path.join(dir, 'CLAUDE.md')).isSymbolicLink(), 'link kept');
    const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.equal(text, `shared notes\n\n${BLOCK()}`);
    assert.equal(ril(dir, 'init').code, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), text);
  });
});

test('CLAUDE.md linked to a file outside the project is skipped and unchanged', (t) => {
  const { dir, cleanup } = folder();
  const outside = folder();
  try {
    const target = path.join(outside.dir, 'elsewhere.md');
    fs.writeFileSync(target, 'not yours\n');
    if (!trySymlink(target, path.join(dir, 'CLAUDE.md'))) return t.skip(NO_LINKS);
    const r = ril(dir, 'init');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /I left CLAUDE\.md alone because it points outside this project\./);
    assert.equal(fs.readFileSync(target, 'utf8'), 'not yours\n');
    assert.ok(fs.lstatSync(path.join(dir, 'CLAUDE.md')).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), BLOCK(), 'the other file is still done');
  } finally {
    cleanup();
    outside.cleanup();
  }
});

test('a routing file that is not an ordinary file is skipped', () => {
  inFolder((dir) => {
    fs.mkdirSync(path.join(dir, 'CLAUDE.md'));
    const r = ril(dir, 'init');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /I left CLAUDE\.md alone because it is not an ordinary file\./);
  });
});

test('init in a subfolder of a project says a project exists in the parent', () => {
  withProject((dir) => {
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    const r = ril(sub, 'init');
    assert.equal(r.code, 0, r.stderr);
    const real = fs.realpathSync(dir);
    assert.ok(r.stdout.includes(`A ril project already exists in ${real}; this creates a separate one in ${path.join(real, 'sub')}.`), r.stdout);
    assert.ok(fs.existsSync(statePath(sub)));
    const j = JSON.parse(ril(sub, 'init', '--json').stdout);
    assert.deepEqual(j.notes, []);
  });
  inFolder((dir) => {
    assert.doesNotMatch(ril(dir, 'init').stdout, /separate one/);
  });
});

test('two first-time inits at once both succeed', async () => {
  const entry = path.join(repoRoot, 'bin', 'ril');
  const exit = (dir) =>
    new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [entry, 'init'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('exit', (code) => resolve({ code, err }));
    });
  for (let round = 0; round < 6; round++) {
    const { dir, cleanup } = folder();
    try {
      const results = await Promise.all([exit(dir), exit(dir), exit(dir)]);
      for (const r of results) assert.equal(r.code, 0, r.err);
      assert.equal(load(dir).version, 1);
      assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), BLOCK());
    } finally {
      cleanup();
    }
  }
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
