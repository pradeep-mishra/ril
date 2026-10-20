// Whole-project tests with no model: the real CLI, real git repos, registered verifier agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load, mutate, statePath } from '../lib/store.mjs';
import { addScenario, fails, head, ok, record, register, status, writeBrief } from './helpers/repo.mjs';
import { ril } from './helpers/ril.mjs';
import { stateFiles } from './helpers/recovery.mjs';
import { advance, importScenarios, prove, ready, runChecker, trustKit, withProject, writeDoc, writeFeatureMaps, writeFinalReport } from './helpers/lifecycle.mjs';

const IDS = ['S1', 'S2'];
const BUILD = ['design', 'confirm', 'build'];
const proofFile = (dir, id) => path.join(dir, '.ril', 'evidence', id, 'run.txt');
const rows = (dir, checkpoint) => load(dir).ledger.filter((r) => r.checkpoint === checkpoint);

test('happy path: from the idea to done, step by step', () => {
  withProject((dir) => {
    importScenarios(dir, IDS);
    assert.deepEqual(load(dir).scenarios.map((s) => [s.id, s.method, s.status]), [['S1', 'cli', 'unproven'], ['S2', 'cli', 'unproven']]);
    fails(dir, 2, 'scenario', 'coverage'); // no feature maps yet
    writeFeatureMaps(dir, IDS);
    ok(dir, 'unit', 'add', 'P1', '--kind', 'plan', '--title', 'Plan 1: the commands');
    for (const stage of ['shape', 'design', 'confirm', 'build', 'accept']) {
      assert.equal(ok(dir, 'stage', 'set', stage).code, 0);
      assert.equal(load(dir).stage, stage);
    }
    register(dir, 'V1', 'verifier');
    trustKit(dir);
    writeFinalReport(dir);
    ok(dir, 'decision', 'log', '--stage', 'design', '--decision', 'Keep the list in one file', '--why', 'the simplest thing that survives a restart');
    const saved = ok(dir, 'checkpoint').stdout.trim();
    assert.ok(head(dir).startsWith(saved));

    fails(dir, 1, 'stage', 'set', 'done'); // nothing proven yet
    prove(dir, IDS);
    assert.deepEqual(load(dir).scenarios.map((s) => s.status), ['proven', 'proven']);
    for (const state of ['doing', 'built', 'verified']) ok(dir, 'unit', 'set', 'P1', '--state', state);
    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'both scenarios proven');
    ok(dir, 'stage', 'set', 'done');
    assert.equal(load(dir).stage, 'done');

    const full = ok(dir, 'status', '--full').stdout;
    assert.match(full, /Done: 2 of 2 scenarios proven/);
    for (const id of IDS) assert.match(full, new RegExp(`^  ${id}  Scenario ${id} - `, 'm'));
    const summary = ok(dir, 'ledger', 'summary').stdout;
    const list = ok(dir, 'scenario', 'list').stdout;
    for (const id of IDS) {
      assert.match(summary, new RegExp(`${id}\\s+proven`));
      assert.match(list, new RegExp(`${id}\\s+proven`));
    }
    assert.match(ok(dir, 'decision', 'list').stdout, /Keep the list in one file/);
    assert.equal(ok(dir, 'doctor', '--fix', '--quiet').stdout, '');
  });
});

test('cap path: the cap stops the rounds, a skip records the acceptance, the rest finishes', () => {
  withProject((dir) => {
    ready(dir, IDS, { stages: BUILD });
    for (let round = 1; round <= 5; round++) assert.match(ok(dir, 'round', 'bump', 'S1').stdout, new RegExp(`round ${round} of 5`));
    const before = stateFiles(dir);
    const stop = fails(dir, 4, 'round', 'bump', 'S1');
    assert.match(stop.stderr, /all 5 fix rounds/);
    fails(dir, 4, '--force', 'one more try', 'round', 'bump', 'S1');
    assert.deepEqual(stateFiles(dir), before, 'a refused bump stores nothing');
    assert.equal(load(dir).scenarios[0].round, 5);

    prove(dir, ['S2']);
    advance(dir, ['accept']);
    assert.match(fails(dir, 1, 'stage', 'set', 'done').stderr, /S1/);
    const skipped = ok(dir, 'skip', 'S1', '--reason', 'stuck');
    assert.match(skipped.stdout, /accepted without proof/);
    assert.equal(status(dir, 'S1'), 'parked');
    ok(dir, 'stage', 'set', 'done');
    assert.equal(load(dir).stage, 'done');
    assert.match(ok(dir, 'decision', 'list').stdout, /Accepted as unproven: S1 \(stuck\)/);
    assert.match(ok(dir, 'status').stdout, /1 of 2 scenarios proven, 1 set aside/);
    assert.match(ok(dir, 'doctor').stdout, /Set aside \(not counted as proven\): scenario S1/);
  }, { cap: 5 });
});

test('cap path: when every scenario is set aside, done is refused and the project is paused instead', () => {
  withProject((dir) => {
    ready(dir, IDS);
    for (const id of IDS) ok(dir, 'skip', id, '--reason', 'stuck after every fix round');
    const refused = fails(dir, 1, 'stage', 'set', 'done');
    assert.match(refused.stderr, /Nothing has been proven yet, so the project cannot be finished\./);
    assert.match(refused.stderr, /Next: .*stop report.*ril stage set parked/);
    fails(dir, 1, '--force', 'the person wants to stop', 'stage', 'set', 'done');
    assert.equal(load(dir).stage, 'accept');
    ok(dir, 'stage', 'set', 'parked');
    assert.match(ok(dir, 'stage', 'get').stdout, /paused/);
  });
});

test('recovery path: damaged state is restored from the backup and the project goes on to done', () => {
  withProject((dir) => {
    ready(dir, IDS);
    prove(dir, ['S1']);
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Keep going', '--why', 'one proof is in');
    const text = fs.readFileSync(statePath(dir), 'utf8');
    fs.writeFileSync(statePath(dir), text.slice(0, Math.floor(text.length / 2)));
    fails(dir, 1, 'status');
    assert.match(ok(dir, 'doctor', '--fix').stdout, /backup/);
    assert.equal(status(dir, 'S1'), 'proven', 'the proof survived');
    assert.equal(load(dir).ledger.length, 1);
    assert.ok(fs.readdirSync(path.join(dir, '.ril')).some((f) => f.startsWith('state.json.damaged-')), 'the damaged file is kept');
    assert.match(ok(dir, 'decision', 'list').stdout, /restored/i);

    prove(dir, ['S2']);
    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'both proven');
    ok(dir, 'stage', 'set', 'done');
    assert.equal(load(dir).stage, 'done');
  });
});

test('recovery path: a working agent with no report is stopped in a new session and its unit goes back', () => {
  withProject((dir) => {
    ready(dir, IDS, { stages: BUILD });
    ok(dir, 'unit', 'add', 'U1', '--kind', 'task', '--title', 'Write the add command');
    ok(dir, 'unit', 'set', 'U1', '--state', 'doing');
    ok(dir, 'agent', 'register', 'I1', '--role', 'implementer', '--task', 'build U1', '--unit', 'U1', '--brief', writeBrief(dir, 'implementer'));
    const agent = (id) => load(dir).agents.find((a) => a.id === id);
    const unit = () => load(dir).units.find((u) => u.id === 'U1').state;

    ok(dir, 'doctor', '--fix', '--quiet');
    assert.equal(agent('I1').state, 'running', 'a young agent is left alone in the same session');
    assert.equal(unit(), 'doing');
    assert.match(ok(dir, 'doctor', '--fix', '--new-session').stdout, /I1/);
    assert.equal(agent('I1').state, 'stopped');
    assert.equal(unit(), 'todo');
    assert.equal(agent('V1').state, 'stopped', 'every working agent without a report is stopped');

    register(dir, 'V2', 'verifier');
    prove(dir, IDS, { verifier: 'V2' });
    advance(dir, ['accept']);
    ok(dir, 'stage', 'set', 'done');
  });
});

test('recovery path: a proof whose evidence was deleted is demoted, and done waits until it is proven again', () => {
  withProject((dir) => {
    ready(dir, IDS);
    prove(dir, IDS);
    fs.rmSync(proofFile(dir, 'S1'));
    assert.match(ok(dir, 'doctor', '--fix').stdout, /S1/);
    assert.equal(status(dir, 'S1'), 'unproven');
    assert.equal(status(dir, 'S2'), 'proven');
    assert.match(fails(dir, 1, 'stage', 'set', 'done').stderr, /S1 \(unproven\)/);
    prove(dir, ['S1']);
    ok(dir, 'stage', 'set', 'done');
  });
});

test('stale path: a product change after the proof makes done refuse, and carry does not help', () => {
  withProject((dir) => {
    ready(dir, IDS);
    prove(dir, IDS);
    const a = head(dir);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log("v2");\n');
    ok(dir, 'checkpoint');
    const b = head(dir);
    assert.notEqual(a, b);
    assert.equal(ok(dir, 'doctor', '--fix', '--quiet').stdout, '', 'a later saved version is not a repair');
    assert.deepEqual(load(dir).scenarios.map((s) => s.status), ['proven', 'proven'], 'only re-checking or carry moves the proof forward');
    const refused = fails(dir, 1, 'stage', 'set', 'done');
    assert.match(refused.stderr, /older version/);
    assert.match(refused.stderr, /S1[\s\S]*S2/);
    const carry = fails(dir, 2, 'ledger', 'carry', 'S1', a, b);
    assert.match(carry.stderr, /NOT-TRIVIAL.*src\/app\.js/);
    fails(dir, 1, 'stage', 'set', 'done');
    prove(dir, IDS); // a verifier checks the new version
    ok(dir, 'stage', 'set', 'done');
  });
});

test('stale path: after a docs-only change the pass is carried and done goes through', () => {
  withProject((dir) => {
    ready(dir, IDS);
    prove(dir, IDS);
    const a = head(dir);
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'guide.md'), 'How to use it.\n');
    ok(dir, 'checkpoint');
    const b = head(dir);
    assert.match(fails(dir, 1, 'stage', 'set', 'done').stderr, /older version/);
    for (const id of IDS) ok(dir, 'ledger', 'carry', id, a, b);
    assert.equal(rows(dir, b).length, 2);
    ok(dir, 'stage', 'set', 'done');
    assert.equal(load(dir).stage, 'done');
  });
});

test('real accept order: proofs first, then the report and README, then the passes are carried', () => {
  withProject((dir) => {
    ready(dir, IDS, { report: false });
    prove(dir, IDS);
    const a = head(dir);
    writeFinalReport(dir);
    fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n\nHow to use it.\n');
    ok(dir, 'checkpoint');
    const b = head(dir);
    assert.notEqual(a, b);
    fails(dir, 1, 'stage', 'set', 'done'); // the proofs are one version behind
    for (const id of IDS) ok(dir, 'ledger', 'carry', id, a, b);
    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'both proven');
    ok(dir, 'stage', 'set', 'done');
    const checked = runChecker(dir);
    assert.equal(checked.code, 0, checked.text);
  });
});

// Each row is one way of trying to get past a rail. Every refusal must say what to do next.
function outside(dir) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-outside-'));
  try {
    const file = path.join(scratch, 'run.txt');
    fs.writeFileSync(file, 'a transcript kept elsewhere\n');
    return record(dir, 'S1', head(dir), 'proven-cli', { evidence: file });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test('rail refusals', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    register(dir, 'I1', 'implementer');
    const kit = (text) => writeDoc(dir, 'verification/verify.md', `${text}\n\n# Verify\n`);
    const proof = (verdict, extra) => () => record(dir, 'S1', head(dir), verdict, extra);
    const table = [
      ['a missing kit refuses a proof', null, proof('proven-cli'), 1, /proof kit has not been written yet/],
      ['a missing kit refuses a failure too', null, proof('failed'), 1, /proof kit has not been written yet/],
      ['a non-verifier records a proof', () => kit('Trusted: yes'), proof('proven-cli', { verifier: 'I1' }), 1, /only a verifier/],
      ['an untrusted kit refuses a proof', () => kit('Trusted: no'), proof('proven-cli'), 1, /not trusted/],
      ['an untrusted kit refuses a failure too', null, proof('failed'), 1, /not trusted/],
      ['blocked is accepted but proves nothing', null, proof('blocked', { review: 'none', checks: null }), 0, /could not be checked/],
      ['zero checks', () => kit('Trusted: yes'), proof('proven-cli', { checks: '0' }), 1, /no checks ran/],
      ['evidence outside the project', null, () => outside(dir), 1, /evidence belongs under \.ril\/evidence\/S1\/<saved version>\//],
      ['a product file as evidence', null, proof('proven-cli', { evidence: 'README.md' }), 1, /evidence belongs under \.ril\/evidence\/S1\/<saved version>\//],
      ['a kit trusted only on a later line', () => writeDoc(dir, 'verification/verify.md', '# Verify\n\nTrusted: yes\n'), proof('proven-cli'), 1, /not trusted/],
      ['done with zero scenarios', null, () => withProject((empty) => ril(empty, 'stage', 'set', 'done')), 1, /no scenarios/],
      ['a decision that only mentions the scenario', null, () => {
        mutate(dir, (s) => void (s.scenarios[0].status = 'parked'));
        ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Maybe S1 can be accepted as unproven', '--why', 'a thought, not a decision');
        return ril(dir, 'stage', 'set', 'done');
      }, 1, /nobody recorded "Accepted as unproven: S1"/],
    ];
    for (const [what, setup, run, code, says] of table) {
      setup?.();
      const r = run();
      assert.equal(r.code, code, `${what}: ${r.stdout}${r.stderr}`);
      assert.match(r.code ? r.stderr : r.stdout, says, what);
      if (code) assert.match(r.stderr, /Next: /, `${what} has no Next line`);
      assert.notEqual(status(dir, 'S1'), 'proven', `${what} proved the scenario`);
    }
    assert.ok(load(dir).ledger.every((r) => r.verdict === 'blocked'), 'only the blocked result was stored');
  });
});
