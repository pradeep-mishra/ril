// Runs the end-to-end state checker against a finished project and against five broken variants of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mutate } from '../../lib/store.mjs';
import { ok } from '../helpers/repo.mjs';
import { buildProject, ready, prove, withProject } from '../helpers/lifecycle.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-state.mjs');
const check = (dir) => {
  const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  return { code: r.status, text: r.stdout + r.stderr };
};

test('a finished project passes and the summary is plain', () => {
  withProject((dir) => {
    buildProject(dir);
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Keep the list small', '--why', 'the person asked');
    const r = check(dir);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /2 of 2 scenarios proven/);
    assert.match(r.text, /Keep the list small/);
    assert.match(r.text, /Recovery: nothing was needed/);
  });
});

test('a parked scenario passes only with its acceptance on record', () => {
  withProject((dir) => {
    ready(dir, ['S1', 'S2']);
    prove(dir, ['S2']);
    ok(dir, 'skip', 'S1', '--reason', 'stuck');
    ok(dir, 'stage', 'set', 'done');
    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'S2 proven');
    ok(dir, 'checkpoint');
    const r = check(dir);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /1 accepted as unproven/);
  });
});

const variants = [
  ['the stage is not done', (dir) => mutate(dir, (s) => void (s.stage = 'accept')), /stage/i],
  ['an evidence file is missing', (dir) => fs.rmSync(path.join(dir, '.ril', 'evidence', 'S1', 'run.txt')), /evidence/i],
  ['the verifier is not a verifier', (dir) => mutate(dir, (s) => void (s.agents[0].role = 'implementer')), /verifier/i],
  ['the review was none', (dir) => mutate(dir, (s) => void (s.ledger[0].review = 'none')), /review/i],
  ['the final report is missing', (dir) => fs.rmSync(path.join(dir, '.ril', 'docs', 'reports', 'final.md')), /final report/i],
];
for (const [what, damage, says] of variants) {
  test(`checker fails when ${what}`, () => {
    withProject((dir) => {
      buildProject(dir);
      damage(dir);
      const r = check(dir);
      assert.notEqual(r.code, 0, r.text);
      assert.match(r.text, says);
    });
  });
}
