// Failure drills: each builds the situation a crash or a killed session leaves behind, then runs ril doctor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load, mutate, statePath } from '../lib/store.mjs';
import { validate } from '../lib/schema.mjs';
import { ril } from './helpers/ril.mjs';
import { addScenario, commitFile, fails, git, head, ok, record, register, status, withRepo } from './helpers/repo.mjs';
import { addAgent, addUnit, deadPid, killMidWrite, minutesAgo, read, stateFiles, writeReport } from './helpers/recovery.mjs';

const lockFile = (dir) => path.join(dir, '.ril', '.lock');
const agent = (dir, id) => load(dir).agents.find((a) => a.id === id);
const unit = (dir, id) => load(dir).units.find((u) => u.id === id);
const JARGON = /\b(SHA|HEAD|stale|undefined|null|JSON\.parse|ENOENT)\b|\n\s+at /;

// Without --fix doctor reports, changes nothing and exits 1; with --fix it repairs and exits 0.
function reportsThenFixes(dir, ...extra) {
  const before = stateFiles(dir);
  const look = fails(dir, 1, 'doctor', ...extra);
  assert.match(look.stderr, /ril doctor --fix/);
  assert.deepEqual(stateFiles(dir), before, 'doctor without --fix changed the state');
  const fixed = ok(dir, 'doctor', '--fix', ...extra);
  assert.doesNotMatch(look.stdout + look.stderr + fixed.stdout, JARGON);
  return fixed;
}

// A second run finds nothing and changes nothing.
function settled(dir) {
  const before = stateFiles(dir);
  const again = ok(dir, 'doctor', '--fix', '--quiet');
  assert.equal(again.stdout + again.stderr, '');
  assert.deepEqual(stateFiles(dir), before);
}

test('damaged state restored', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'Keep it small', '--why', 'a test');
    fs.writeFileSync(statePath(dir), '{');
    fs.writeFileSync(lockFile(dir), `${deadPid()} ${new Date().toISOString()}`);
    fails(dir, 1, 'status');
    const fixed = reportsThenFixes(dir);
    assert.match(fixed.stdout, /backup/);
    assert.match(fixed.stdout, /lock/, 'the lock is reported, not cleared silently by the restore');
    const state = load(dir);
    assert.deepEqual(state.scenarios.map((s) => s.id), ['S1'], 'the backup holds the scenario');
    assert.ok(state.decisions.some((d) => /restored/i.test(d.decision) && /backup/i.test(d.decision)), 'a decision records the restore');
    ok(dir, 'status');
    settled(dir);
  });
});

test('damaged state and damaged backup: nothing is touched', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    fs.writeFileSync(statePath(dir), '{');
    fs.writeFileSync(`${statePath(dir)}.bak`, '{"version": 1}');
    const before = stateFiles(dir);
    for (const args of [['doctor'], ['doctor', '--fix']]) {
      const r = fails(dir, 1, ...args);
      assert.match(r.stderr, /backup/);
      assert.doesNotMatch(r.stderr, JARGON);
      assert.deepEqual(stateFiles(dir), before);
    }
  });
});

test('stale lock cleared', () => {
  withRepo((dir) => {
    fs.writeFileSync(lockFile(dir), `${deadPid()} ${new Date().toISOString()}`);
    reportsThenFixes(dir);
    assert.ok(!fs.existsSync(lockFile(dir)));
    settled(dir);
    fs.writeFileSync(lockFile(dir), `${process.pid} ${minutesAgo(10)}`);
    reportsThenFixes(dir);
    assert.ok(!fs.existsSync(lockFile(dir)), 'a lock older than two minutes is cleared even when its process lives');
  });
});

test('an empty lock left by a command killed while taking it is cleared', () => {
  withRepo((dir) => {
    fs.writeFileSync(lockFile(dir), '');
    const r = ok(dir, 'doctor', '--fix');
    assert.match(r.stdout, /lock/);
    assert.ok(!fs.existsSync(lockFile(dir)));
    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'Go on', '--why', 'the lock is gone');
  });
});

test('a lock held by a running command is left alone', () => {
  withRepo((dir) => {
    const held = `${process.pid} ${new Date().toISOString()}`;
    fs.writeFileSync(lockFile(dir), held);
    ok(dir, 'doctor', '--fix', '--quiet');
    assert.equal(read(lockFile(dir)), held);
  });
});

test('finished agent collected', () => {
  withRepo((dir) => {
    addUnit(dir, 'U1');
    addAgent(dir, 'A1', { minutes: 300 });
    writeReport(dir, 'A1');
    reportsThenFixes(dir, '--new-session');
    assert.equal(agent(dir, 'A1').state, 'done', 'a report on disk wins over age and a new session');
    settled(dir);
  });
});

test('dead agent stopped with --new-session', () => {
  withRepo((dir) => {
    addUnit(dir, 'U1');
    addAgent(dir, 'A1', { minutes: 2 });
    reportsThenFixes(dir, '--new-session');
    assert.equal(agent(dir, 'A1').state, 'stopped');
    assert.equal(unit(dir, 'U1').state, 'todo', 'its unit goes back to not started');
    settled(dir);
  });
});

test('young agent left alone without --new-session', () => {
  withRepo((dir) => {
    addUnit(dir, 'U1');
    addAgent(dir, 'A1', { minutes: 59 });
    const before = stateFiles(dir);
    const r = ok(dir, 'doctor', '--fix', '--quiet');
    assert.equal(r.stdout + r.stderr, '');
    assert.deepEqual(stateFiles(dir), before);
    assert.equal(agent(dir, 'A1').state, 'running');
    assert.equal(unit(dir, 'U1').state, 'doing');
  });
});

test('65-minute-old agent stopped', () => {
  withRepo((dir) => {
    addUnit(dir, 'U1');
    addAgent(dir, 'A1', { minutes: 65 });
    addAgent(dir, 'A2', { unit: 'S9', minutes: 65, state: 'failed' });
    reportsThenFixes(dir);
    assert.equal(agent(dir, 'A1').state, 'stopped');
    assert.equal(agent(dir, 'A2').state, 'failed', 'only running agents are touched');
    assert.equal(unit(dir, 'U1').state, 'todo');
    settled(dir);
  });
});

test('orphaned doing unit returns to todo', () => {
  withRepo((dir) => {
    addUnit(dir, 'U1');
    addUnit(dir, 'U2', 'built');
    addAgent(dir, 'A1', { unit: 'U2', minutes: 1 });
    reportsThenFixes(dir);
    assert.equal(unit(dir, 'U1').state, 'todo');
    assert.equal(unit(dir, 'U2').state, 'built');
    settled(dir);
  });
});

function proveS1(dir) {
  addScenario(dir, 'S1');
  register(dir, 'V1', 'verifier');
  assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
}

test('proven without evidence demoted', () => {
  withRepo((dir) => {
    proveS1(dir);
    fs.rmSync(path.join(dir, '.ril', 'evidence', 'S1', 'run.txt'));
    const fixed = reportsThenFixes(dir);
    assert.match(fixed.stdout, /S1/);
    assert.equal(status(dir), 'unproven');
    settled(dir);
  });
  withRepo((dir) => {
    proveS1(dir);
    fs.writeFileSync(path.join(dir, '.ril', 'evidence', 'S1', 'run.txt'), '');
    reportsThenFixes(dir);
    assert.equal(status(dir), 'unproven', 'an empty evidence file proves nothing');
  });
});

test('proven with a non-trivial change after its checkpoint demoted', () => {
  withRepo((dir) => {
    proveS1(dir);
    commitFile(dir, 'docs/guide.md', 'words\n');
    ok(dir, 'doctor', '--fix');
    assert.equal(status(dir), 'proven', 'a docs change keeps the proof');
    commitFile(dir, 'src/app.js', 'code\n');
    const fixed = reportsThenFixes(dir);
    assert.match(fixed.stdout, /src\/app\.js/);
    assert.equal(status(dir), 'unproven');
    settled(dir);
  });
});

test('proven without a git repository or with a lost saved version demoted', () => {
  withRepo((dir) => {
    proveS1(dir);
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    const fixed = reportsThenFixes(dir);
    assert.match(fixed.stdout, /no git repository/);
    assert.equal(status(dir), 'unproven');
  });
  withRepo((dir) => {
    proveS1(dir);
    mutate(dir, (s) => {
      s.ledger[0].checkpoint = 'f'.repeat(40);
    });
    assert.match(reportsThenFixes(dir).stdout, /can no longer be found/);
    assert.equal(status(dir), 'unproven');
    settled(dir);
  });
});

test('git settings and a missing git are reported plainly', (t) => {
  withRepo((dir) => {
    proveS1(dir);
    git(dir, 'config', 'diff.relative', 'true');
    const r = ok(dir, 'doctor', '--fix', '--quiet');
    assert.match(r.stdout, /diff\.relative/);
    assert.match(r.stdout, /Next: /);
    assert.equal(status(dir), 'proven');
  });
  const bin = path.dirname(process.execPath);
  const env = { ...process.env, PATH: bin };
  if (process.platform === 'win32' || spawnSync('git', ['--version'], { env }).status === 0) return t.skip('git sits next to node here');
  withRepo((dir) => {
    proveS1(dir);
    const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ril');
    const r = spawnSync(process.execPath, [entry, 'doctor', '--fix'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /git is not installed/);
    assert.match(r.stderr, /Next: /);
    assert.equal(status(dir), 'unproven');
  });
});

test('kill mid-write', async () => {
  const { tmpProject } = await import('./helpers/tmp.mjs');
  const p = tmpProject();
  try {
    ok(p.dir, 'init');
    for (let i = 0; i < 20; i++) {
      await killMidWrite(p.dir, 60 + Math.floor(Math.random() * 300));
      const state = load(p.dir);
      assert.deepEqual(validate(state), []);
      const r = ril(p.dir, 'doctor', '--fix');
      assert.equal(r.code, 0, `round ${i}: ${r.stdout}${r.stderr}`);
      assert.deepEqual(validate(load(p.dir)), []);
      assert.ok(!fs.existsSync(lockFile(p.dir)), `round ${i}: the lock was left behind`);
    }
    assert.ok(load(p.dir).decisions.length > 0, 'the child did write');
  } finally {
    p.cleanup();
  }
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
    assert.match(load(dir).decisions.at(-1).decision, /^Set aside unit U1/);
    assert.match(ok(dir, 'doctor').stdout, /S1/, 'doctor mentions what was set aside');
    ok(dir, 'stage', 'set', 'done');
  });
});

test('skip unknown id exits 2 with Next', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    const before = stateFiles(dir);
    fails(dir, 2, 'skip', 'S9', '--reason', 'gone');
    fails(dir, 1, 'skip', 'S1');
    fails(dir, 2, 'skip', 'S1', '--unit', '--reason', 'not a unit');
    assert.deepEqual(stateFiles(dir), before);
  });
});

test('skip refuses an id that is both a unit and a scenario unless told which', () => {
  withRepo((dir) => {
    addScenario(dir, 'X1');
    addUnit(dir, 'X1');
    const r = fails(dir, 1, 'skip', 'X1', '--reason', 'stuck');
    assert.match(r.stderr, /--unit/);
    assert.match(r.stderr, /--scenario/);
    assert.equal(status(dir, 'X1'), 'unproven');
    ok(dir, 'skip', 'X1', '--unit', '--reason', 'stuck');
    assert.equal(unit(dir, 'X1').state, 'parked');
    assert.equal(status(dir, 'X1'), 'unproven');
    ok(dir, 'skip', 'X1', '--scenario', '--reason', 'stuck');
    assert.equal(status(dir, 'X1'), 'parked');
  });
});

test('doctor on a clean project is silent with --quiet and exits 0', () => {
  withRepo((dir) => {
    proveS1(dir);
    addUnit(dir, 'U1', 'todo');
    const before = stateFiles(dir);
    const r = ok(dir, 'doctor', '--fix', '--quiet');
    assert.equal(r.stdout + r.stderr, '');
    assert.deepEqual(stateFiles(dir), before);
    assert.match(ok(dir, 'doctor').stdout, /Nothing needed fixing/);
  });
});
