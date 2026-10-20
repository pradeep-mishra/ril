// Gaps found in review of the ledger and rails, each closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { kitTrust } from '../lib/proof.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpProject } from './helpers/tmp.mjs';
import { addScenario, fails, git, gitInit, head, ok, record, register, status, trustKit, withRepo } from './helpers/repo.mjs';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ril');

const toAccept = (dir) => {
  for (const stage of ['design', 'confirm', 'build', 'accept']) ok(dir, 'stage', 'set', stage);
};

test('a user setting diff.relative does not hide changes outside the project from carry', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-outer-'));
  try {
    gitInit(outer);
    git(outer, 'config', 'diff.relative', 'true');
    const dir = path.join(outer, 'app');
    fs.mkdirSync(dir);
    ok(dir, 'init');
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    const from = ok(dir, 'checkpoint').stdout.trim();
    assert.equal(record(dir, 'S1', from, 'proven-cli').code, 0);
    fs.writeFileSync(path.join(outer, 'shared.js'), 'used by app\n');
    git(outer, 'add', 'shared.js');
    git(outer, 'commit', '-q', '-m', 'outside change');
    const r = fails(dir, 2, 'ledger', 'carry', 'S1', from, head(outer));
    assert.match(r.stderr, /shared\.js/);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('kit trust: only "Trusted: yes" on the first line of verify.md counts', () => {
  const p = tmpProject();
  try {
    const kit = path.join(p.dir, '.ril', 'docs', 'verification', 'verify.md');
    assert.equal(kitTrust(p.dir), 'none', 'no kit yet');
    fs.mkdirSync(path.dirname(kit), { recursive: true });
    const trust = (text) => {
      fs.writeFileSync(kit, text);
      return kitTrust(p.dir);
    };
    const untrusted = {
      'an empty file': '',
      'no': 'Trusted: no\n',
      'yes/no': 'Trusted: yes/no\n',
      'yes | no': 'Trusted: yes | no\n',
      'yes or no': 'Trusted: yes or no\n',
      'yes-ish': 'Trusted: yes-ish\n',
      'yesterday': 'Trusted: yesterday\n',
      'a note after a dash': 'Trusted: yes - shown failing\n',
      'a note after a colon': 'Trusted: yes: shown failing\n',
      'text after the note': 'Trusted: yes (shown failing) but not really\n',
      'bold markers': '**Trusted:** yes\n',
      'an indent': '  Trusted: yes\n',
      'a later line': '# Verify\n\nTrusted: yes\n',
      'a code fence': '```\nTrusted: yes\n```\n',
      'a comment': '<!-- Trusted: yes -->\n',
    };
    for (const [what, text] of Object.entries(untrusted)) assert.equal(trust(text), 'untrusted', what);
    const trusted = {
      'plain': 'Trusted: yes\n',
      'no line end': 'Trusted: yes',
      'any case': 'trusted: YES\n',
      'a note in brackets': 'Trusted: yes (shown failing on a broken copy)\n\n# Verify\n',
      'Windows line ends': 'Trusted: yes\r\n# Verify\r\n',
      'a byte order mark': '\uFEFFTrusted: yes\n',
    };
    for (const [what, text] of Object.entries(trusted)) assert.equal(trust(text), 'trusted', what);
  } finally {
    p.cleanup();
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

test('done without a git repository asks for a checkpoint first', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    toAccept(dir);
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    const r = fails(dir, 1, 'stage', 'set', 'done');
    assert.match(r.stderr, /ril checkpoint/);
    assert.match(r.stderr, /saved/);
    assert.doesNotMatch(r.stderr, /older version/);
    assert.equal(load(dir).stage, 'accept');
  });
});

test('acceptance wording ignores case, but the id must match exactly', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    toAccept(dir);
    const file = path.join(dir, '.ril', 'state.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.scenarios[0].status = 'parked';
    fs.writeFileSync(file, JSON.stringify(raw));
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Accepted as unproven: s1', '--why', 'wrong case id');
    fails(dir, 1, 'stage', 'set', 'done');
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'ACCEPTED AS UNPROVEN: S1', '--why', 'the sandbox is down');
    assert.doesNotMatch(fails(dir, 1, 'stage', 'set', 'done').stderr, /S1 \(/, 'S1 now counts as accepted');
    addScenario(dir, 'S2');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    assert.equal(record(dir, 'S2', head(dir), 'proven-cli').code, 0);
    ok(dir, 'stage', 'set', 'done');
  });
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'Accepted risk for s1: slow', '--why', 'wrong case id');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 1);
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'accepted RISK for S1: slow', '--why', 'agreed');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 0);
  });
});

test('blocked never replaces a failed result at the same saved version', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    const now = head(dir);
    assert.equal(record(dir, 'S1', now, 'failed', { review: 'none' }).code, 0);
    const blocked = record(dir, 'S1', now, 'blocked', { review: 'none' });
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /Next: /);
    assert.equal(load(dir).ledger.length, 1);
    assert.equal(load(dir).ledger[0].verdict, 'failed');
    assert.equal(status(dir), 'failing');
  });
});
