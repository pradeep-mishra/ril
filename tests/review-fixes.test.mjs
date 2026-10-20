// Gaps found in review of the ledger and rails, each closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { kitTrust } from '../lib/proof.mjs';
import { tmpProject } from './helpers/tmp.mjs';
import { addScenario, fails, git, gitInit, head, ok, record, register, status, withRepo } from './helpers/repo.mjs';

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

test('kit trust: only a plain "Trusted: yes" outside code and comments counts', () => {
  const p = tmpProject();
  try {
    const kit = path.join(p.dir, '.ril', 'docs', 'verification', 'verify.md');
    fs.mkdirSync(path.dirname(kit), { recursive: true });
    const trust = (text) => {
      fs.writeFileSync(kit, text);
      return kitTrust(p.dir);
    };
    const untrusted = {
      'yes/no': 'Trusted: yes/no\n',
      'yes | no': 'Trusted: yes | no\n',
      'yes or no': 'Trusted: yes or no\n',
      'yes-ish': 'Trusted: yes-ish\n',
      'a ~~~ line does not close a ``` block': '```\n~~~\nTrusted: yes\n```\n',
      'a ``` line does not close a ~~~ block': '~~~\n```\nTrusted: yes\n~~~\n',
      'a shorter fence does not close a longer one': '````\n```\nTrusted: yes\n````\n',
      'an indented code block': '# Verify\n\n    Trusted: yes\n',
      'a tab-indented code block': '# Verify\n\n\tTrusted: yes\n',
      'a multi-line HTML comment': '<!--\nTrusted: yes\n-->\n',
      'a comment opened after text': 'Notes <!-- draft\nTrusted: yes\n-->\n',
    };
    for (const [what, text] of Object.entries(untrusted)) assert.equal(trust(text), 'untrusted', what);
    const trusted = {
      'plain': 'Trusted: yes\n',
      'a note in brackets': 'Trusted: yes (shown failing on a broken copy)\n',
      'a note after a dash': 'Trusted: yes - shown failing\n',
      'a note after a colon': 'Trusted: yes: shown failing\n',
      'after a closed ~~~ block holding ```': '~~~\n```\n~~~\nTrusted: yes\n',
      'after a closed comment': '<!-- old -->\n<!--\nTrusted: no\n-->\nTrusted: yes\n',
      'a short indent': '  Trusted: yes\n',
    };
    for (const [what, text] of Object.entries(trusted)) assert.equal(trust(text), 'trusted', what);
  } finally {
    p.cleanup();
  }
});

test('done without a git repository asks for a checkpoint first', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
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
    ok(dir, 'stage', 'set', 'done');
  });
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
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
