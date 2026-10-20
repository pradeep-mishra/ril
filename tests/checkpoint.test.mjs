// ril checkpoint: what is saved, what is left out, and what happens without a repository or a git identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { entry, ril } from './helpers/ril.mjs';
import { inTmp, tmpProject } from './helpers/tmp.mjs';
import { fails, git, gitInit, head, lines, ok, withRepo } from './helpers/repo.mjs';

const inFolder = (fn) => inTmp(fn, { bare: true });

test('checkpoint', () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)\n');
    fs.writeFileSync(path.join(dir, '.ril', 'docs', 'x.md'), 'doc\n');
    const r = ok(dir, 'checkpoint', '--message', 'first save');
    const id = r.stdout.trim();
    assert.match(id, /^[0-9a-f]{7,40}$/);
    assert.ok(head(dir).startsWith(id));
    const files = lines(git(dir, 'ls-files'));
    assert.ok(files.includes('app.js'));
    assert.ok(!files.some((f) => f.startsWith('.ril/')), `.ril is never saved: ${files}`);
    assert.ok(lines(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8')).includes('.ril/'));

    // Documents, evidence and state change nothing: the saved version stays the same.
    fs.writeFileSync(path.join(dir, '.ril', 'docs', 'y.md'), 'more\n');
    fs.mkdirSync(path.join(dir, '.ril', 'evidence', 'S1'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ril', 'evidence', 'S1', 'run.txt'), 'out\n');
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'x', '--why', 'y');
    assert.equal(git(dir, 'status', '--porcelain'), '');
    assert.equal(ok(dir, 'checkpoint').stdout.trim(), id);
    assert.equal(git(dir, 'log', '-1', '--format=%s'), 'first save');

    // Nothing new to save: the same version comes back.
    assert.equal(ok(dir, 'checkpoint').stdout.trim(), id);
    assert.equal(JSON.parse(ok(dir, 'checkpoint', '--json').stdout).checkpoint, head(dir));
  }, { gitInit: false });

  const p = tmpProject();
  try {
    fails(p.dir, 2, 'checkpoint'); // no ril project here, so nothing is committed
    assert.ok(!fs.existsSync(path.join(p.dir, '.git')));
  } finally {
    p.cleanup();
  }
});

test('checkpoint in a project nested in a larger repo saves only the project', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-outer-'));
  try {
    gitInit(outer);
    fs.writeFileSync(path.join(outer, 'top.txt'), 'top\n');
    git(outer, 'add', 'top.txt');
    git(outer, 'commit', '-q', '-m', 'outer start');
    const dir = path.join(outer, 'app');
    fs.mkdirSync(dir);
    ok(dir, 'init');
    const first = ok(dir, 'checkpoint').stdout.trim();

    fs.writeFileSync(path.join(outer, 'outside.txt'), 'staged elsewhere\n');
    git(outer, 'add', 'outside.txt');
    assert.equal(ok(dir, 'checkpoint').stdout.trim(), first, 'only an outside file is staged: no new save');
    assert.equal(head(outer), first);

    fs.writeFileSync(path.join(dir, 'a.js'), 'code\n');
    const second = ok(dir, 'checkpoint').stdout.trim();
    assert.notEqual(second, first);
    const saved = lines(git(outer, 'show', '--name-only', '--format=', second));
    assert.deepEqual(saved, ['app/a.js']);
    assert.match(git(outer, 'status', '--porcelain'), /^A {2}outside\.txt/m, 'the outside file is still only staged');
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('a missing git identity is refused with the project-local commands, never --global', () => {
  withRepo((dir) => {
    git(dir, 'config', '--unset', 'user.name');
    git(dir, 'config', '--unset', 'user.email');
    fs.writeFileSync(path.join(dir, 'app.js'), 'code\n');
    const empty = path.join(dir, '.ril', 'no-gitconfig');
    fs.writeFileSync(empty, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'user.useConfigOnly', GIT_CONFIG_VALUE_1: 'true' };
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete env[key];
    const r = spawnSync(process.execPath, [entry, 'checkpoint'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^Next: .*git config user\.name "Your Name" and git config user\.email "you@example\.com"/m);
    assert.match(r.stderr, /only affects this project/);
    assert.doesNotMatch(r.stderr, /--global/);
  });
});

test('.ril and Finder and Explorer files are excluded by init in a repo, and by the first checkpoint otherwise, once', () => {
  inFolder((dir) => {
    gitInit(dir);
    for (let i = 0; i < 2; i++) assert.equal(ril(dir, 'init').code, 0);
    assert.deepEqual(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8').match(/^(\.ril\/|\.DS_Store|Thumbs\.db)$/gm), ['.ril/', '.DS_Store', 'Thumbs.db']);
  });
  inFolder((dir) => {
    assert.equal(ril(dir, 'init').code, 0);
    assert.ok(!fs.existsSync(path.join(dir, '.git')), 'init does not start a repository');
    for (const name of ['.DS_Store', 'Thumbs.db', 'app.txt']) fs.writeFileSync(path.join(dir, name), 'x');
    assert.equal(ril(dir, 'checkpoint').code, 0);
    assert.equal(git(dir, 'ls-files', '--', '.ril', '.DS_Store', 'Thumbs.db', 'app.txt'), 'app.txt');
    git(dir, 'add', '-f', '.ril');
    assert.equal(ril(dir, 'checkpoint').code, 0);
    assert.equal(git(dir, 'ls-files', '--', '.ril'), '', 'a tracked .ril is untracked by the next checkpoint');
  });
});
