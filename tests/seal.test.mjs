import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { addScenario, commitFile, fails, git, head, ok, record, register, status, trustKit, withRepo } from './helpers/repo.mjs';

const ready = (dir, second = 'Protected: tests/acceptance/, scripts/verify.sh') => {
  addScenario(dir);
  register(dir, 'V1', 'verifier');
  trustKit(dir, second);
};
const tree = (dir, p) => git(dir, 'rev-parse', `HEAD:${p}`);

test('a seal stores the ids of the protected paths and a changed file refuses a proof until it is restored', () => {
  withRepo((dir) => {
    ready(dir);
    commitFile(dir, 'tests/acceptance/a.sh', 'check 1\n');
    assert.ok(head(dir).startsWith(ok(dir, 'checkpoint', '--seal').stdout.trim()));
    const [seal] = load(dir).seals;
    assert.equal(seal.version, head(dir));
    assert.deepEqual(seal.paths, { 'tests/acceptance': tree(dir, 'tests/acceptance'), 'scripts/verify.sh': null });
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0, 'unchanged protected paths pass');

    commitFile(dir, 'tests/acceptance/a.sh', 'check 1 weakened\n');
    assert.match(ok(dir, 'status', '--full').stdout, /Protected files changed since the last seal: tests\/acceptance/);
    assert.match(ok(dir, 'checkpoint').stderr, /Protected files changed since the last seal: tests\/acceptance/);
    ok(dir, '--force', 'redo', 'scenario', 'update', 'S1', '--criterion', 'again');
    const r = record(dir, 'S1', head(dir), 'proven-cli');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /tests\/acceptance/);
    assert.match(r.stderr, /Next: .*tester.*restore/);
    assert.equal(status(dir), 'unproven');
    assert.equal(record(dir, 'S1', head(dir), 'failed').code, 0, 'only a proof is refused');

    commitFile(dir, 'tests/acceptance/a.sh', 'check 1\n');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0, 'restored files match the seal again');
    commitFile(dir, 'tests/acceptance/a.sh', 'check 2\n');
    ok(dir, 'checkpoint', '--seal');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0, 'a new seal clears the refusal');
  });
});

test('a path that goes missing or appears counts as changed', () => {
  withRepo((dir) => {
    ready(dir);
    commitFile(dir, 'scripts/verify.sh', 'run\n');
    ok(dir, 'checkpoint', '--seal');
    git(dir, 'rm', '-q', 'scripts/verify.sh');
    git(dir, 'commit', '-q', '-m', 'drop');
    assert.match(record(dir, 'S1', head(dir), 'proven-cli').stderr, /scripts\/verify\.sh/);
    commitFile(dir, 'scripts/verify.sh', 'run\n');
    ok(dir, 'checkpoint', '--seal');
    trustKit(dir, 'Protected: tests/acceptance/');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0, 'a sealed path that is still the same passes');
    commitFile(dir, 'tests/acceptance/new.sh', 'x\n');
    assert.match(record(dir, 'S1', head(dir), 'proven-cli').stderr, /tests\/acceptance/, 'a sealed null that now exists');
  });
});

test('protected paths must be inside the project, need a seal, and a project without them is unaffected', () => {
  withRepo((dir) => {
    ready(dir, 'Protected: ../outside.sh');
    for (const bad of ['../outside.sh', '/etc/passwd', 'a/../../b', 'C:/x']) {
      trustKit(dir, `Protected: tests/acceptance/, ${bad}`);
      const r = record(dir, 'S1', head(dir), 'proven-cli');
      assert.equal(r.code, 1, bad);
      assert.match(r.stderr, /outside the project/);
      assert.match(r.stderr, /Next: /);
    }
    trustKit(dir, 'Protected: tests/acceptance/');
    const noSeal = record(dir, 'S1', head(dir), 'proven-cli');
    assert.equal(noSeal.code, 1);
    assert.match(noSeal.stderr, /sealed yet/);
    for (const second of ['', 'Notes: nothing protected']) {
      trustKit(dir, second);
      assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0, second);
    }
    assert.equal(ok(dir, 'checkpoint').stderr, '', 'no warning without a seal');
  });
});

test('a state without seals loads, and a bad seals value is reported', () => {
  withRepo((dir) => {
    ready(dir, 'second');
    const file = path.join(dir, '.ril', 'state.json');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete state.seals;
    fs.writeFileSync(file, JSON.stringify(state));
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
    ok(dir, 'checkpoint', '--seal');
    assert.deepEqual(load(dir).seals[0].paths, {});
    state.seals = [{ version: 1 }];
    fs.writeFileSync(file, JSON.stringify(state));
    assert.match(fails(dir, 1, 'status').stderr, /seals/);
  });
});
