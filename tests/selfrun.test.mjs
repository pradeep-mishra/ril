import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { addScenario, commitFile, evidence, fails, head, ok, record, register, trustKit, withRepo } from './helpers/repo.mjs';

const say = (dir, line) => fs.writeFileSync(path.join(dir, '.ril', 'docs', 'verification', 'verify.md'), `${line}\n\n# Verify\n`);
const selfrun = (dir, version, extra = {}) => {
  const opts = { break: evidence(dir, 'kit', 'broken.txt'), restored: evidence(dir, 'kit', 'restored.txt'), verifier: 'V1', ...extra };
  return ['ledger', 'selfrun', version, ...Object.entries(opts).flatMap(([k, v]) => [`--${k}`, v])];
};

test('a kit is trusted only with its line and a self-run row for the version on that line', () => {
  withRepo((dir) => {
    addScenario(dir);
    register(dir, 'V1', 'verifier');
    const first = head(dir);
    fs.mkdirSync(path.join(dir, '.ril', 'docs', 'verification'), { recursive: true });
    say(dir, `Trusted: yes (${first.slice(0, 7)})`);
    assert.match(fails(dir, 1, ...selfrun(dir, 'abcdef1')).stderr, /not the current saved version/);
    assert.match(record(dir, 'S1', first, 'proven-cli').stderr, /not shown that it can fail/, 'the line alone is not enough');

    ok(dir, ...selfrun(dir, first));
    const [row] = load(dir).selfruns;
    assert.deepEqual({ ...row, ts: 0, kit: 0 }, { kit: 0, version: first, breakEvidence: '.ril/evidence/kit/broken.txt', restoredEvidence: '.ril/evidence/kit/restored.txt', verifier: 'V1', ts: 0 });
    say(dir, 'Trusted: no');
    assert.match(record(dir, 'S1', first, 'proven-cli').stderr, /not trusted/, 'the row alone is not enough');
    say(dir, `Trusted: yes (${first.slice(0, 7)})`);
    const second = commitFile(dir, 'app.js', 'code\n');
    assert.equal(record(dir, 'S1', second, 'proven-cli').code, 0, 'a later version keeps the trust of the version the line names');
    say(dir, `Trusted: yes (${second.slice(0, 7)})`);
    assert.match(record(dir, 'S1', second, 'proven-cli').stderr, /not shown that it can fail/, 'a row for another version does not count');
  });
});

test('a self-run needs a verifier, the current version and two different real evidence files', () => {
  withRepo((dir) => {
    addScenario(dir);
    register(dir, 'V1', 'verifier');
    register(dir, 'I1', 'implementer');
    ok(dir, 'agent', 'register', 'V2', '--role', 'verifier', '--task', 'verifier work', '--brief', path.join(import.meta.dirname, 'fixtures', 'agent-brief-good.md'));
    ok(dir, 'agent', 'set', 'V2', '--state', 'stopped');
    const now = head(dir);
    const same = evidence(dir, 'kit', 'same.txt');
    fs.writeFileSync(path.join(dir, '.ril', 'evidence', 'kit', 'copy.txt'), fs.readFileSync(path.join(dir, same)));
    const tries = [
      ['the same file twice', { break: same, restored: same }, /are the same/],
      ['two files with the same content', { break: same, restored: '.ril/evidence/kit/copy.txt' }, /are the same/],
      ['a non-verifier', { verifier: 'I1' }, /only a verifier/],
      ['a stopped verifier', { verifier: 'V2' }, /has stopped/],
      ['an unknown agent', { verifier: 'GHOST' }, /no agent called GHOST/],
      ['evidence outside .ril/evidence', { break: 'README.md' }, /outside \.ril\/evidence/],
      ['evidence that is missing', { restored: '.ril/evidence/kit/none.txt' }, /does not exist/],
    ];
    for (const [what, extra, says] of tries) assert.match(fails(dir, 1, ...selfrun(dir, now, extra)).stderr, says, what);
    fails(dir, 1, 'ledger', 'selfrun', now, '--verifier', 'V1');
    assert.equal(load(dir).selfruns.length, 0, 'nothing was recorded');

    const old = JSON.parse(fs.readFileSync(path.join(dir, '.ril', 'state.json'), 'utf8'));
    delete old.selfruns;
    fs.writeFileSync(path.join(dir, '.ril', 'state.json'), JSON.stringify(old));
    ok(dir, ...selfrun(dir, now));
    assert.equal(load(dir).selfruns.length, 1, 'a state saved before self-runs existed still loads');
  });
});

test('a self-run covers the kit content it saw: a changed body or feature map needs a new self-run, line 1 alone does not', () => {
  withRepo((dir) => {
    addScenario(dir);
    trustKit(dir);
    const kit = path.join(dir, '.ril', 'docs', 'verification', 'verify.md');
    const proof = () => record(dir, 'S1', head(dir), 'proven-cli');
    assert.equal(proof().code, 0);
    fs.writeFileSync(kit, fs.readFileSync(kit, 'utf8').replace('Trusted: yes', 'Trusted:   yes'));
    assert.equal(proof().code, 0, 'the first line is not part of what the self-run saw');
    for (const [what, change] of [['the body', () => fs.appendFileSync(kit, 'a weaker check\n')], ['a feature map', () => fs.mkdirSync(path.join(kit, '..', 'feature-map')) || fs.writeFileSync(path.join(kit, '..', 'feature-map', 'S1.md'), 'Method: cli\n')]]) {
      change();
      assert.match(proof().stderr, /kit changed after its self-run/, what);
      ok(dir, ...selfrun(dir, head(dir)));
      assert.equal(proof().code, 0, `a new self-run restores trust after ${what} changed`);
    }
  });
});
