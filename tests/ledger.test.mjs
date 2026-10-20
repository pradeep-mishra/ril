// Rail 1: a scenario becomes proven only through a result a registered verifier records at the current saved version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { addScenario, commitFile, evidence, fails, git, head, ok, record, register, status, trustKit, withRepo } from './helpers/repo.mjs';

test('rail 1 table', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1', 'cli');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    register(dir, 'I1', 'implementer');
    const now = head(dir);

    const refusals = [
      ['a non-verifier agent', [now, 'proven-cli', { verifier: 'I1' }]],
      ['an unknown agent', [now, 'proven-cli', { verifier: 'GHOST' }]],
      ['a wrong checkpoint', ['0000000', 'proven-cli', {}]],
      ['a too short checkpoint', [now.slice(0, 6), 'proven-cli', {}]],
      ['missing evidence', [now, 'proven-cli', { evidence: '.ril/evidence/S1/none.txt' }]],
      ['a product file as evidence', [now, 'proven-cli', { evidence: 'README.md' }]],
      ['a method mismatch', [now, 'proven-ui', {}]],
      ['review none', [now, 'proven-cli', { review: 'none' }]],
      ['review risks without a decision', [now, 'proven-cli', { review: 'risks' }]],
      ['zero checks', [now, 'proven-cli', { checks: '0' }]],
      ['no checks', [now, 'proven-cli', { checks: null }]],
      ['a fraction of checks', [now, 'proven-cli', { checks: '1.5' }]],
      ['an unknown verdict', [now, 'passed', {}]],
    ];
    for (const [what, [cp, verdict, extra]] of refusals) {
      const r = record(dir, 'S1', cp, verdict, extra);
      assert.equal(r.code, 1, `${what} should be refused: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /Next: /, what);
      assert.doesNotMatch(r.stderr, /\bSHA\b|\bHEAD\b/, what);
      assert.equal(status(dir), 'unproven', what);
    }
    assert.deepEqual(load(dir).ledger, []);
    fails(dir, 2, 'ledger', 'check', 'S1', now);

    const good = record(dir, 'S1', now.slice(0, 7), 'proven-cli');
    assert.equal(good.code, 0, good.stderr);
    assert.equal(status(dir), 'proven');
    const [row] = load(dir).ledger;
    assert.equal(row.checkpoint, now, 'stored in full');
    assert.equal(row.checks, 3);
    assert.equal(row.verifier, 'V1');
    assert.equal(row.review, 'clean');
    assert.match(ok(dir, 'ledger', 'check', 'S1', now.slice(0, 7)).stdout, /S1/);

    // Same scenario and checkpoint again: one row, updated.
    assert.equal(record(dir, 'S1', now, 'proven-cli', { checks: '5' }).code, 0);
    assert.equal(load(dir).ledger.length, 1);
    assert.equal(load(dir).ledger[0].checks, 5);

    // risks is accepted once a decision about the scenario is on record.
    addScenario(dir, 'S2', 'cli');
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'Accepted risk for S2: slow start-up', '--why', 'the person agreed');
    assert.equal(record(dir, 'S2', now, 'proven-cli', { review: 'risks' }).code, 0);
    assert.equal(status(dir, 'S2'), 'proven');

    // blocked is recorded but proves nothing.
    addScenario(dir, 'S3', 'cli');
    assert.equal(record(dir, 'S3', now, 'blocked', { review: 'none', checks: null }).code, 0);
    assert.equal(status(dir, 'S3'), 'unproven');
    fails(dir, 2, 'ledger', 'check', 'S3', now);
    fails(dir, 2, 'ledger', 'record', 'NOPE', now, 'proven-cli', '--evidence', evidence(dir), '--verifier', 'V1', '--review', 'clean', '--checks', '1');

    // An old pass does not count once the scenario is no longer proven.
    ok(dir, '--force', 'the wording was wrong', 'scenario', 'update', 'S1', '--criterion', 'New wording');
    assert.equal(status(dir), 'unproven');
    assert.match(fails(dir, 2, 'ledger', 'check', 'S1', now).stderr, /NOT-VERIFIED/);

    const summary = JSON.parse(ok(dir, 'ledger', 'summary', '--json').stdout);
    assert.ok(Array.isArray(summary.scenarios));
    assert.equal(summary.scenarios.find((s) => s.id === 'S2').status, 'proven');
    assert.match(ok(dir, 'ledger', 'summary').stdout, /S2/);
  });
});

test('failed then proven', () => {
  withRepo((dir) => {
    addScenario(dir);
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    assert.equal(record(dir, 'S1', head(dir), 'failed', { review: 'none', checks: '2' }).code, 0);
    assert.equal(status(dir), 'failing');
    fails(dir, 2, 'ledger', 'check', 'S1', head(dir));
    const next = commitFile(dir, 'src/a.js', 'fixed\n');
    assert.equal(record(dir, 'S1', next, 'proven-cli').code, 0);
    assert.equal(status(dir), 'proven');
    ok(dir, 'ledger', 'check', 'S1', next);
  });
});

test('only an "Accepted risk for <id>" decision lets risks through', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
    ok(dir, '--force', 'x', 'scenario', 'update', 'S1', '--criterion', 'newer');
    assert.equal(status(dir), 'unproven');
    assert.ok(load(dir).decisions.some((d) => d.decision.includes('S1')), 'the forced change named S1');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 1, 'a forced-change decision is not risk acceptance');

    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'We looked at S1 risks', '--why', 'Accepted risk for S1 later');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 1, 'wording elsewhere does not count');
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'Not yet: Accepted risk for S1', '--why', 'still open');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 1, 'the wording must start the decision');
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'Accepted risk for S10: slow', '--why', 'agreed');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 1, 'another id does not count');

    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'Accepted risk for s1: slow', '--why', 'wrong case id');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 1, 'the id must match exactly');
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'accepted RISK for S1: slow start', '--why', 'the person agreed');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli', { review: 'risks' }).code, 0);
  });
});

test('evidence must be a non-empty file under .ril/evidence', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'proof.txt'), 'looks real\n');
      fs.mkdirSync(path.join(dir, '.ril', 'evidence', 'S1'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.ril', 'evidence', 'S1', 'empty.txt'), '');
      const cases = {
        'the project folder': '.',
        'a folder': '.ril/evidence/S1',
        'an escape': `../${path.basename(outside)}/proof.txt`,
        'a full path outside': path.join(outside, 'proof.txt'),
        'an empty file': '.ril/evidence/S1/empty.txt',
        'a missing file': '.ril/evidence/S1/none.txt',
        'a product file': 'README.md',
        'a product file by its full path': path.join(dir, 'README.md'),
        'a ril file outside the evidence folder': '.ril/log.md',
        'the evidence folder itself': '.ril/evidence',
        'an escape from the evidence folder': '.ril/evidence/../../README.md',
      };
      try {
        fs.symlinkSync(path.join(outside, 'proof.txt'), path.join(dir, '.ril', 'evidence', 'S1', 'link.txt'));
        cases['a link to outside'] = '.ril/evidence/S1/link.txt';
        fs.symlinkSync(path.join(dir, 'README.md'), path.join(dir, '.ril', 'evidence', 'S1', 'readme-link.txt'));
        cases['a link to a product file'] = '.ril/evidence/S1/readme-link.txt';
      } catch {
        // creating links needs extra rights on some systems
      }
      for (const [what, given] of Object.entries(cases)) {
        const r = record(dir, 'S1', head(dir), 'proven-cli', { evidence: given });
        assert.equal(r.code, 1, `${what}: ${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /Next: /, what);
        assert.match(r.stderr, /evidence belongs under \.ril\/evidence\/S1\/<saved version>\//, what);
      }
      assert.equal(status(dir), 'unproven');
      assert.deepEqual(load(dir).ledger, []);
      assert.match(record(dir, 'S1', head(dir), 'proven-cli', { evidence: '.ril/evidence/S1/empty.txt' }).stderr, /empty/);
      assert.match(record(dir, 'S1', head(dir), 'proven-cli', { evidence: path.join(outside, 'proof.txt') }).stderr, /outside \.ril\/evidence/);
      assert.match(record(dir, 'S1', head(dir), 'proven-cli', { evidence: 'README.md' }).stderr, /outside \.ril\/evidence/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('blocked never replaces a pass or a failure; failed replaces a pass', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    const now = head(dir);
    assert.equal(record(dir, 'S1', now, 'proven-cli').code, 0);
    const blocked = record(dir, 'S1', now, 'blocked', { review: 'none' });
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /Next: /);
    assert.equal(load(dir).ledger[0].verdict, 'proven-cli');
    ok(dir, 'ledger', 'check', 'S1', now);

    assert.equal(record(dir, 'S1', now, 'failed', { review: 'none' }).code, 0);
    assert.equal(status(dir), 'failing');
    assert.equal(load(dir).ledger.length, 1);
    assert.equal(load(dir).ledger[0].verdict, 'failed');
    fails(dir, 2, 'ledger', 'check', 'S1', now);
    assert.equal(record(dir, 'S1', now, 'blocked', { review: 'none' }).code, 1);
    assert.equal(load(dir).ledger[0].verdict, 'failed');
  });
});

test('a verifier that failed or was stopped cannot record', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    for (const state of ['failed', 'stopped']) {
      ok(dir, 'agent', 'set', 'V1', '--state', state, '--result', `it ${state}`);
      assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 1, state);
    }
    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'S1 checked');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
  });
});

test('record refuses while the project has unsaved changes', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    fs.writeFileSync(path.join(dir, 'app.js'), 'not saved yet\n');
    const r = record(dir, 'S1', head(dir), 'proven-cli');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ril checkpoint/);
    const saved = ok(dir, 'checkpoint').stdout.trim();
    assert.equal(record(dir, 'S1', saved, 'proven-cli').code, 0, 'a saved version records the result');
  });
});

test('record before anything is saved gives a plain error', () => {
  withRepo((dir) => {
    addScenario(dir);
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    fs.rmSync(path.join(dir, '.git'), { recursive: true });
    git(dir, 'init', '-q');
    const r = record(dir, 'S1', 'abcdef1', 'proven-cli');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ril checkpoint/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  });
});

test('a verifier may record only for the scenario it was registered for', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    addScenario(dir, 'S2');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    const r = record(dir, 'S2', head(dir), 'proven-cli', { verifier: 'V1' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /registered for S1, not for scenario S2/);
  });
});
