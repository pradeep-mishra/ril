// ril init: the state, the routing blocks in CLAUDE.md and AGENTS.md, repeat runs, links, and the fix-round cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { entry, repoRoot, ril } from './helpers/ril.mjs';
import { inTmp, tmpProject } from './helpers/tmp.mjs';
import { lines, withRepo } from './helpers/repo.mjs';
import { load, mutate, statePath } from '../lib/store.mjs';

const folder = () => tmpProject({ bare: true });
const inFolder = (fn) => inTmp(fn, { bare: true });
const withProject = (fn, ...init) => withRepo(fn, { gitInit: false, init });
const START = '<!-- ril:managed:start -->';
const END = '<!-- ril:managed:end -->';
const LINE =
  'This project is managed by RIL. For any request about this project (continue, fix, change, status), start with the RIL front door (/ril); it re-reads .ril/ state.';

test('init creates state, folders and the routing blocks', () => {
  withProject((dir) => {
    const state = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
    assert.equal(state.version, 1);
    assert.equal(state.project, path.basename(dir));
    assert.equal(state.mode, 'autonomous');
    assert.equal(state.pluginRoot, repoRoot);
    for (const d of ['docs', 'evidence', 'agents']) assert.ok(fs.statSync(path.join(dir, '.ril', d)).isDirectory(), d);
    assert.ok(fs.existsSync(path.join(dir, '.ril', 'log.md')));
    for (const f of ['CLAUDE.md', 'AGENTS.md']) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), `${START}\n${LINE}\n${END}\n`, f);
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

test('init is idempotent', () => {
  withProject((dir) => {
    mutate(dir, (s) => s.decisions.push({ ts: 't', stage: s.stage, decision: 'keep me', why: 'test' }));
    const stateBefore = fs.readFileSync(statePath(dir), 'utf8');
    const backupBefore = fs.readFileSync(`${statePath(dir)}.bak`, 'utf8');
    const r = ril(dir, 'init', '--name', 'Other', '--mode', 'guided', '--cap', '6');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(lines(r.stdout).filter((l) => /fix-round limit.*kept at 8/.test(l)).length, 1);
    assert.equal(fs.readFileSync(statePath(dir), 'utf8'), stateBefore);
    assert.equal(fs.readFileSync(`${statePath(dir)}.bak`, 'utf8'), backupBefore, 'no state write happened');
    assert.equal(JSON.parse(ril(dir, 'init', '--json').stdout).created, false);
  });
});

test('init repairs the block, the folders and the plugin root', () => {
  withProject((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${START}\nwrong\n${END}\n`);
    fs.rmSync(path.join(dir, '.ril', 'evidence'), { recursive: true });
    mutate(dir, (s) => void (s.pluginRoot = '/somewhere/old'));
    assert.equal(ril(dir, 'init').code, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), `${START}\n${LINE}\n${END}\n`);
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
    [`top\r\n${START}\r\nold text\r\n${END}\r\nbottom\r\n`, `top\r\n${BLOCK('\r\n')}bottom\r\n`],
    ['a\r\nb\nc', `a\r\nb\nc\r\n\r\n${BLOCK('\r\n')}`],
    ['# My notes\r\n\r\nKeep \xe9 this\r\nno final newline', `# My notes\r\n\r\nKeep \xe9 this\r\nno final newline\r\n\r\n${BLOCK('\r\n')}`],
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
    fs.rmSync(path.join(dir, 'AGENTS.md'));
    fs.mkdirSync(path.join(dir, 'AGENTS.md'));
    assert.match(ril(dir, 'init').stdout, /I left AGENTS\.md alone because it is not an ordinary file\./);
  } finally {
    cleanup();
    outside.cleanup();
  }
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

test('init takes the round cap once, from 5 to 10, default 8', () => {
  withProject((dir) => assert.equal(load(dir).cap, 8));
  withProject((dir) => assert.equal(load(dir).cap, 10), '--cap', '10');
  inFolder((dir) => {
    for (const bad of ['4', '11', 'many']) {
      const r = ril(dir, 'init', '--cap', bad);
      assert.equal(r.code, 1, bad);
      assert.match(r.stderr, /Next: /);
    }
    assert.equal(fs.existsSync(path.join(dir, '.ril', 'state.json')), false);
  });
});

