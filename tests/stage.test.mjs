// ril stage, unit, skip, gate and decision: the records of where the work stands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../lib/store.mjs';
import { ril } from './helpers/ril.mjs';
import { addScenario, fails, ok, status, withRepo } from './helpers/repo.mjs';
import { JARGON, addAgent, addUnit, proveS1, stateFiles, unit } from './helpers/recovery.mjs';

const withProject = (fn, ...init) => withRepo(fn, { gitInit: false, init });

test('stage forward ok, skip refused, skip forced is logged', () => {
  withProject((dir) => {
    assert.match(ok(dir, 'stage', 'get').stdout, /shape/);
    ok(dir, 'stage', 'set', 'design');
    assert.equal(load(dir).stage, 'design');

    const skip = fails(dir, 1, 'stage', 'set', 'build');
    assert.match(skip.stderr, /Next: /);
    assert.equal(load(dir).stage, 'design');

    ok(dir, '--force', 'the person asked to skip confirm', 'stage', 'set', 'build');
    const state = load(dir);
    assert.equal(state.stage, 'build');
    assert.equal(state.decisions.length, 1);
    assert.equal(state.decisions[0].why, 'the person asked to skip confirm');
    assert.equal(state.decisions[0].stage, 'design');
    assert.match(state.decisions[0].decision, /design.*build/);
  });
});

test('stage going back needs a reason and an unknown stage is refused', () => {
  withProject((dir) => {
    ok(dir, 'stage', 'set', 'design');
    const back = fails(dir, 1, 'stage', 'set', 'shape');
    assert.match(back.stderr, /Next: /);
    ok(dir, 'stage', 'set', 'shape', '--force', 'the idea changed');
    assert.equal(load(dir).stage, 'shape');
    assert.equal(load(dir).decisions.length, 1);
    assert.match(fails(dir, 1, 'stage', 'set', 'nowhere').stderr, /Next: /);
    assert.match(fails(dir, 1, 'stage', 'set').stderr, /Next: /);
  });
});

test('parked round trip', () => {
  withProject((dir) => {
    ok(dir, 'stage', 'set', 'design');
    ok(dir, 'stage', 'set', 'parked');
    let state = load(dir);
    assert.equal(state.stage, 'parked');
    assert.equal(state.parkedFrom, 'design');
    assert.match(ok(dir, 'stage', 'get').stdout, /design/);

    fails(dir, 1, 'stage', 'set', 'confirm'); // leaving the pause anywhere else needs a reason
    assert.equal(load(dir).stage, 'parked');

    ok(dir, 'stage', 'set', 'design');
    state = load(dir);
    assert.equal(state.stage, 'design');
    assert.equal(state.parkedFrom, null);
    assert.deepEqual(state.decisions, []);
  });
});

test('unit add, set and list', () => {
  withProject((dir) => {
    ok(dir, 'unit', 'add', 'P1', '--kind', 'plan', '--title', 'First plan');
    ok(dir, 'unit', 'add', 'T1', '--kind', 'task', '--parent', 'P1', '--title', 'First task');
    let units = load(dir).units;
    assert.deepEqual(units.map((u) => [u.id, u.kind, u.parent, u.state, u.checkpoint]), [['P1', 'plan', null, 'todo', null], ['T1', 'task', 'P1', 'todo', null]]);

    fails(dir, 1, 'unit', 'add', 'P1', '--kind', 'plan', '--title', 'again');
    fails(dir, 1, 'unit', 'add', 'T2', '--kind', 'job', '--title', 'x');
    fails(dir, 2, 'unit', 'add', 'T2', '--kind', 'task', '--parent', 'P9', '--title', 'x');

    ok(dir, 'unit', 'set', 'T1', '--state', 'doing');
    assert.equal(load(dir).units[1].state, 'doing');
    const warn = ok(dir, 'unit', 'set', 'T1', '--state', 'verified');
    assert.match(warn.stderr, /checkpoint/i);
    assert.equal(load(dir).units[1].state, 'verified');
    const quiet = ok(dir, 'unit', 'set', 'T1', '--state', 'verified', '--checkpoint', 'abc123');
    assert.equal(quiet.stderr, '');
    assert.equal(load(dir).units[1].checkpoint, 'abc123');
    fails(dir, 1, 'unit', 'set', 'T1', '--state', 'finished');
    fails(dir, 2, 'unit', 'set', 'T9', '--state', 'built');

    units = ok(dir, 'unit', 'list', '--kind', 'task').stdout;
    assert.ok(units.includes('T1') && !units.includes('P1'));
    assert.equal(JSON.parse(ok(dir, '--json', 'unit', 'list').stdout).length, 2);
  });
});

test('gate park twice reopens', () => {
  withProject((dir) => {
    ok(dir, 'gate', 'park', 'G1', '--question', 'Which colour?', '--options', 'red|blue', '--default', 'red');
    let g = load(dir).gates[0];
    assert.deepEqual([g.id, g.status, g.question, g.options, g.default, g.answer], ['G1', 'open', 'Which colour?', ['red', 'blue'], 'red', null]);

    ok(dir, 'gate', 'resolve', 'G1', '--answer', 'blue');
    g = load(dir).gates[0];
    assert.deepEqual([g.status, g.answer], ['resolved', 'blue']);
    assert.equal(ok(dir, 'gate', 'list', '--status', 'open').stdout.includes('G1'), false);

    ok(dir, 'gate', 'park', 'G1', '--question', 'Which size?', '--options', 'big|small|tiny', '--default', 'small');
    const { gates } = load(dir);
    assert.equal(gates.length, 1);
    assert.deepEqual([gates[0].status, gates[0].question, gates[0].options, gates[0].default, gates[0].answer], ['open', 'Which size?', ['big', 'small', 'tiny'], 'small', null]);
    assert.match(ok(dir, 'gate', 'list', '--status', 'open').stdout, /G1/);
    assert.match(ok(dir, 'status').stdout, /1 open question/);

    fails(dir, 2, 'gate', 'resolve', 'G9', '--answer', 'x');
    fails(dir, 1, 'gate', 'park', 'G2', '--question', 'q');
  });
});

test('decision log and list', () => {
  withProject((dir) => {
    assert.match(ok(dir, 'decision', 'list').stdout, /no decisions/i);
    ok(dir, 'decision', 'log', '--stage', 'design', '--decision', 'use plain files', '--why', 'simplest thing');
    const d = load(dir).decisions[0];
    assert.deepEqual([d.stage, d.decision, d.why], ['design', 'use plain files', 'simplest thing']);
    assert.ok(!Number.isNaN(Date.parse(d.ts)));
    const out = ok(dir, 'decision', 'list').stdout;
    assert.ok(out.includes('use plain files') && out.includes('simplest thing'));
    assert.equal(JSON.parse(ok(dir, '--json', 'decision', 'list').stdout).length, 1);
    fails(dir, 1, 'decision', 'log', '--stage', 'nowhere', '--decision', 'x', '--why', 'y');
    fails(dir, 1, 'decision', 'log', '--stage', 'design', '--decision', 'x');
  });
});

test('every refusal in these commands says what to do next, and none uses internal words', () => {
  withProject((dir) => {
    addScenario(dir);
    const attempts = [
      ['stage', 'set', 'done'],
      ['stage'],
      ['unit', 'set', 'T9', '--state', 'todo'],
      ['scenario', 'bogus'],
      ['gate'],
      ['decision', 'bogus'],
      ['round', 'bump'],
    ];
    for (const args of attempts) {
      const r = ril(dir, ...args);
      assert.notEqual(r.code, 0, args.join(' '));
      assert.match(r.stderr, /Next: /, args.join(' '));
      assert.doesNotMatch(r.stderr, /undefined|\[object|mutate|state\.json/, args.join(' '));
    }
  });
});

test('skip parks and logs', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    addUnit(dir, 'U1');
    for (const stage of ['design', 'confirm', 'build', 'accept']) ok(dir, 'stage', 'set', stage);
    const r = ok(dir, 'skip', 'S1', '--reason', 'the payment sandbox is down');
    assert.match(r.stdout, /Carrying on with the other work\./);
    assert.equal(status(dir), 'parked');
    const d = load(dir).decisions.at(-1);
    assert.equal(d.decision, 'Accepted as unproven: S1');
    assert.equal(d.why, 'the payment sandbox is down');
    ok(dir, 'skip', 'U1', '--reason', 'blocked on a missing tool');
    assert.equal(unit(dir, 'U1').state, 'parked');
    assert.equal(load(dir).decisions.at(-1).decision, 'Set aside unit U1');
    const decisions = load(dir).decisions;
    for (const id of ['S1', 'U1']) {
      const again = ok(dir, 'skip', id, '--reason', 'again');
      assert.match(again.stdout, /already set aside; nothing changed/);
      assert.doesNotMatch(again.stdout + again.stderr, JARGON);
    }
    assert.deepEqual(load(dir).decisions, decisions, 'skipping twice changes nothing');
    assert.match(ok(dir, 'doctor').stdout, /S1/, 'doctor mentions what was set aside');
    assert.match(fails(dir, 1, 'stage', 'set', 'done').stderr, /Nothing has been proven yet/, 'setting everything aside does not finish the project');
  });
});

test('skip warns about a working agent and about a proof being set aside', () => {
  withRepo((dir) => {
    proveS1(dir);
    addUnit(dir, 'U1');
    addAgent(dir, 'A1', { unit: 'U1' });
    const u = ok(dir, 'skip', 'U1', '--reason', 'not needed');
    assert.match(u.stdout, /Agent A1 is still working on it/);
    assert.match(u.stdout, /Next: /);
    const s = ok(dir, 'skip', 'S1', '--reason', 'out of scope');
    assert.match(s.stdout, /S1 was proven/);
    assert.match(s.stdout, /proof is set aside/);
    assert.doesNotMatch(u.stdout + s.stdout, JARGON);
    assert.equal(status(dir), 'parked');
  });
});

test('skip refuses an unknown id, and an id that is both a unit and a scenario unless told which', () => {
  withRepo((dir) => {
    addScenario(dir, 'S5');
    addUnit(dir, 'S5');
    addScenario(dir, 'S1');
    const untouched = stateFiles(dir);
    fails(dir, 2, 'skip', 'S9', '--reason', 'gone');
    fails(dir, 1, 'skip', 'S1');
    fails(dir, 2, 'skip', 'S1', '--unit', '--reason', 'not a unit');
    assert.deepEqual(stateFiles(dir), untouched);
    const r = fails(dir, 1, 'skip', 'S5', '--reason', 'stuck');
    assert.match(r.stderr, /--unit/);
    assert.match(r.stderr, /--scenario/);
    assert.equal(status(dir, 'S5'), 'unproven');
    ok(dir, 'skip', 'S5', '--unit', '--reason', 'stuck');
    assert.equal(unit(dir, 'S5').state, 'parked');
    assert.equal(status(dir, 'S5'), 'unproven');
    ok(dir, 'skip', 'S5', '--scenario', '--reason', 'stuck');
    assert.equal(status(dir, 'S5'), 'parked');
  });
});
