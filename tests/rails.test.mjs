import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject } from './helpers/tmp.mjs';
import { load } from '../lib/store.mjs';
import { addScenario, commitFile, evidence, fails, fixture, git, head, lines, ok, record, register, status, trustKit, withRepo, writeBrief } from './helpers/repo.mjs';

test('register refuses unknown role and incomplete brief', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    fails(dir, 1, 'agent', 'register', 'X1', '--role', 'boss', '--task', 't', '--brief', fixture('agent-brief-good.md'));

    const bad = fails(dir, 6, 'agent', 'register', 'V9', '--role', 'verifier', '--task', 'verify S1', '--brief', fixture('agent-brief-bad.md'));
    const problems = lines(bad.stderr).filter((l) => !l.startsWith('Next:'));
    for (const want of [/\bgoal\b/, /\bacceptance\b/, /\brules\b.*two/, /\bril\b/, /\breport\b.*agent-report/, /\bstop\b/, /read the spec and work out what matters/]) {
      assert.ok(problems.some((l) => want.test(l)), `expected a problem matching ${want} in:\n${bad.stderr}`);
    }
    assert.equal(problems.length, 7, bad.stderr);
    assert.deepEqual(load(dir).agents, [], 'nothing registered');

    const mismatch = fails(dir, 6, 'agent', 'register', 'V9', '--role', 'tester', '--task', 't', '--brief', fixture('agent-brief-good.md'));
    assert.match(mismatch.stderr, /role/);
    const lineCount = fs.readFileSync(fixture('agent-brief-good.md'), 'utf8').split('\n').length - 1;
    const exactly = (n) => writeBrief(dir, 'verifier', (t) => `${t}${'- Stop again.\n'.repeat(n - lineCount)}`);
    const long = fails(dir, 6, 'agent', 'register', 'V9', '--role', 'verifier', '--task', 't', '--brief', exactly(61));
    assert.match(long.stderr, /61 lines.*60 lines/);
    assert.equal(lines(long.stderr).length, 2, 'only the length problem');
    const relRules = writeBrief(dir, 'verifier', (t) => t.replace('- /opt/ril/principles.md', '- principles.md'));
    assert.match(fails(dir, 6, 'agent', 'register', 'V9', '--role', 'verifier', '--task', 't', '--brief', relRules).stderr, /rules/);
    fails(dir, 2, 'agent', 'register', 'V9', '--role', 'verifier', '--task', 't', '--brief', path.join(dir, 'nope.md'));
    assert.deepEqual(load(dir).agents, []);

    ok(dir, 'agent', 'register', 'V1', '--role', 'verifier', '--task', 'verify S1', '--brief', fixture('agent-brief-good.md'));
    const [agent] = load(dir).agents;
    assert.equal(agent.id, 'V1');
    assert.equal(agent.role, 'verifier');
    assert.equal(agent.state, 'running');
    assert.equal(agent.unit, 'S1', 'unit comes from the brief when --unit is not given');

    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'S1 proven');
    assert.equal(load(dir).agents[0].state, 'done');
    assert.equal(load(dir).agents[0].result, 'S1 proven');
    fails(dir, 1, 'agent', 'set', 'V1', '--state', 'asleep');
    fails(dir, 2, 'agent', 'set', 'NOPE', '--state', 'done', '--result', 'finished');
    register(dir, 'T1', 'tester');
    assert.deepEqual(lines(ok(dir, 'agent', 'list', '--active').stdout).map((l) => l.split(/\s+/)[0]), ['T1']);
    assert.equal(lines(ok(dir, 'agent', 'list').stdout).length, 2);
  });
});

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

test('rail 1 refuses everything but blocked while the kit is missing or not trusted', () => {
  withRepo((dir) => {
    addScenario(dir);
    register(dir, 'V1', 'verifier');
    const kit = path.join(dir, '.ril', 'docs', 'verification');
    const now = head(dir);
    for (const verdict of ['proven-cli', 'failed']) {
      const r = record(dir, 'S1', now, verdict);
      assert.equal(r.code, 1, verdict);
      assert.match(r.stderr, /proof kit has not been written yet/);
      assert.match(r.stderr, /Next: /);
    }
    assert.equal(record(dir, 'S1', now, 'blocked').code, 0, 'blocked is accepted without a kit');
    assert.equal(status(dir), 'unproven');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(kit, 'verify.md'), 'Trusted: no\n\n# Verify\n');
    for (const verdict of ['proven-cli', 'failed']) {
      const r = record(dir, 'S1', now, verdict);
      assert.equal(r.code, 1, verdict);
      assert.match(r.stderr, /trusted/i);
      assert.match(r.stderr, /Next: /);
    }
    assert.equal(record(dir, 'S1', now, 'blocked').code, 0);
    assert.equal(status(dir), 'unproven');
    fs.writeFileSync(path.join(kit, 'verify.md'), '# Verify\n\nTrusted: yes\n');
    assert.equal(record(dir, 'S1', now, 'proven-cli').code, 1, 'a later line does not count');
    fs.writeFileSync(path.join(kit, 'verify.md'), 'Trusted: yes\n\n# Verify\n');
    assert.match(fails(dir, 1, 'ledger', 'record', 'S1', now, 'proven-cli', '--evidence', evidence(dir), '--verifier', 'V1', '--review', 'clean', '--checks', '3').stderr, /not shown that it can fail/);
    trustKit(dir);
    assert.equal(record(dir, 'S1', now, 'proven-cli').code, 0);
    assert.equal(status(dir), 'proven');
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

test('rail 2', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    addScenario(dir, 'S2');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    for (const stage of ['design', 'confirm', 'build', 'accept']) ok(dir, 'stage', 'set', stage);
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);

    const refused = fails(dir, 1, 'stage', 'set', 'done');
    assert.match(refused.stderr, /S2/);
    assert.doesNotMatch(refused.stderr, /\bS1\b/);
    const forced = fails(dir, 1, '--force', 'ship it', 'stage', 'set', 'done');
    assert.match(forced.stderr, /force/i);
    assert.equal(load(dir).stage, 'accept');

    assert.equal(record(dir, 'S2', head(dir), 'proven-cli').code, 0);
    ok(dir, 'stage', 'set', 'done');
    assert.equal(load(dir).stage, 'done');
  });

  withRepo((dir) => {
    addScenario(dir, 'S1');
    for (const stage of ['design', 'confirm', 'build', 'accept']) ok(dir, 'stage', 'set', stage);
    // Parking a scenario is a later command; set the state directly here.
    const raw = JSON.parse(fs.readFileSync(path.join(dir, '.ril', 'state.json'), 'utf8'));
    raw.scenarios[0].status = 'parked';
    raw.decisions = [];
    fs.writeFileSync(path.join(dir, '.ril', 'state.json'), JSON.stringify(raw));
    assert.match(fails(dir, 1, 'stage', 'set', 'done').stderr, /S1/, 'parked without a decision is refused');
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Accepted as unproven: S1', '--why', 'the payment sandbox is down');
    addScenario(dir, 'S2');
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    assert.equal(record(dir, 'S2', head(dir), 'proven-cli').code, 0);
    ok(dir, 'stage', 'set', 'done');
  });
});

test('rail 2: a project where every scenario was set aside is not finished', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    addScenario(dir, 'S2');
    for (const stage of ['design', 'confirm', 'build', 'accept']) ok(dir, 'stage', 'set', stage);
    ok(dir, 'skip', 'S1', '--reason', 'the sandbox is down');
    ok(dir, 'skip', 'S2', '--reason', 'out of scope');
    const refused = fails(dir, 1, 'stage', 'set', 'done');
    assert.match(refused.stderr, /^Nothing has been proven yet, so the project cannot be finished\./m);
    assert.match(refused.stderr, /Next: .*stop report.*ril stage set parked/);
    assert.doesNotMatch(refused.stderr, /S1|S2/);
    const forced = fails(dir, 1, '--force', 'ship it anyway', 'stage', 'set', 'done');
    assert.match(forced.stderr, /Nothing has been proven yet/);
    assert.match(forced.stderr, /force/i);
    assert.equal(load(dir).stage, 'accept');
    ok(dir, 'stage', 'set', 'parked');
    assert.equal(load(dir).stage, 'parked');
  });
});

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

test('a done or failed agent must say what it did, so its unit is not held forever', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    for (const state of ['done', 'failed']) {
      const r = fails(dir, 1, 'agent', 'set', 'V1', '--state', state);
      assert.match(r.stderr, /--result/);
      assert.equal(load(dir).agents[0].state, 'running', 'nothing changed');
      fails(dir, 1, 'agent', 'set', 'V1', '--state', state, '--result', '  ');
    }
    ok(dir, 'agent', 'set', 'V1', '--state', 'stopped');
    ok(dir, 'agent', 'set', 'V1', '--state', 'running');
    ok(dir, 'agent', 'set', 'V1', '--state', 'failed', '--result', 'could not start the app');
    assert.equal(load(dir).agents[0].result, 'could not start the app');
  });
});
