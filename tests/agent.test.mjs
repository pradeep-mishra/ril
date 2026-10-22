// Registering agents and checking their briefs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { addAgent, agent } from './helpers/recovery.mjs';
import { ril } from './helpers/ril.mjs';
import { addScenario, fails, fixture, lines, ok, register, withRepo, writeBrief } from './helpers/repo.mjs';

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
    assert.equal(agent.state, 'registered', 'registering is not starting');
    assert.equal(agent.unit, 'S1', 'unit comes from the brief when --unit is not given');
    assert.match(ok(dir, 'agent', 'list', '--active').stdout, /registered \(not started yet, \d+ min\)/);
    ok(dir, 'agent', 'set', 'V1', '--state', 'running');
    assert.equal(load(dir).agents[0].state, 'running');

    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'S1 proven');
    assert.equal(load(dir).agents[0].result, 'S1 proven');
    fails(dir, 1, 'agent', 'set', 'V1', '--state', 'asleep');
    fails(dir, 2, 'agent', 'set', 'NOPE', '--state', 'done', '--result', 'finished');
    register(dir, 'T1', 'tester');
    assert.deepEqual(lines(ok(dir, 'agent', 'list', '--active').stdout).map((l) => l.split(/\s+/)[0]), ['T1']);
    assert.equal(lines(ok(dir, 'agent', 'list').stdout).length, 2);
  });
});

test('a brief input may be an existing file of any name, never prose', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    fs.writeFileSync(path.join(dir, 'Makefile'), 'all:\n');
    fs.writeFileSync(path.join(dir, 'my notes.txt'), 'notes\n');
    const withInputs = (...items) => writeBrief(dir, 'verifier', (t) => t.replace('- .ril/docs/spec.md\n', items.map((i) => `- ${i}\n`).join('')));
    ok(dir, 'agent', 'register', 'V1', '--role', 'verifier', '--task', 't', '--brief', withInputs('Makefile', 'my notes.txt'));
    const prose = fails(dir, 6, 'agent', 'register', 'V2', '--role', 'verifier', '--task', 't', '--brief', withInputs('Makefile', 'read everything first'));
    assert.match(prose.stderr, /read everything first/);
    assert.match(prose.stderr, /file path/);
    fails(dir, 6, 'agent', 'register', 'V2', '--role', 'verifier', '--task', 't', '--brief', withInputs('Nothing'));
  });
});

test('brief shape problems: duplicate field, inline list value, unknown unit, a different job', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    const reg = (id, file, ...extra) => ril(dir, 'agent', 'register', id, '--role', 'verifier', '--task', 't', '--brief', file, ...extra);
    const dup = reg('V1', writeBrief(dir, 'verifier', (t) => `${t}goal: again\n`));
    assert.equal(dup.code, 6);
    assert.match(dup.stderr, /goal.*more than once/);
    const inline = reg('V1', writeBrief(dir, 'verifier', (t) => t.replace('touch:\n- .ril/evidence/S1/', 'touch: .ril/evidence/S1/')));
    assert.equal(inline.code, 6);
    assert.match(inline.stderr, /touch.*must be a list/);
    const nowhere = reg('V1', writeBrief(dir, 'verifier', (t) => t.replace('unit: S1', 'unit: S99')));
    assert.equal(nowhere.code, 6);
    assert.match(nowhere.stderr, /S99.*ril unit list.*ril scenario list.*shape, design, confirm/s, 'the message says what a unit may be');
    const given = reg('V1', fixture('agent-brief-good.md'), '--unit', 'S99');
    assert.equal(given.code, 2);
    assert.match(given.stderr, /ril unit list.*ril scenario list.*shape, design, confirm/s);
    assert.deepEqual(load(dir).agents, []);

    assert.equal(reg('V1', fixture('agent-brief-good.md')).code, 0);
    assert.equal(reg('V1', fixture('agent-brief-good.md')).code, 0, 'the same job again changes nothing');
    const other = ril(dir, 'agent', 'register', 'V1', '--role', 'verifier', '--task', 'another job', '--brief', fixture('agent-brief-good.md'));
    assert.equal(other.code, 1);
    assert.match(other.stderr, /Next: /);
    assert.equal(load(dir).agents.length, 1);
  });
});

test('a done or failed agent must say what it did, so its unit is not held forever', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    for (const state of ['done', 'failed']) {
      const r = fails(dir, 1, 'agent', 'set', 'V1', '--state', state);
      assert.match(r.stderr, /--result/);
      assert.equal(load(dir).agents[0].state, 'registered', 'nothing changed');
      fails(dir, 1, 'agent', 'set', 'V1', '--state', state, '--result', '  ');
    }
    ok(dir, 'agent', 'set', 'V1', '--state', 'stopped');
    ok(dir, 'agent', 'set', 'V1', '--state', 'failed', '--result', 'could not start the app');
    assert.equal(load(dir).agents[0].result, 'could not start the app');
  });
});

test('doctor stops a registered agent after 5 minutes as never started; an old running agent stays valid', () => {
  withRepo((dir) => {
    for (const [id, minutes, state] of [['A1', 6, 'registered'], ['A2', 4, 'registered'], ['A3', 1, 'running']]) addAgent(dir, id, { unit: 'S9', minutes, state });
    assert.match(fails(dir, 1, 'doctor').stdout, /registered but never started: A1/);
    ok(dir, 'doctor', '--fix');
    assert.deepEqual(['A1', 'A2', 'A3'].map((id) => agent(dir, id).state), ['stopped', 'registered', 'running']);
    ok(dir, 'doctor', '--fix', '--new-session');
    assert.deepEqual(['A1', 'A2'].map((id) => agent(dir, id).result), ['never started', 'never started']);
  });
});
