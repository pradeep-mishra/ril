// The proof kit: when it is trusted, the self-run that earns the trust, and the seal on protected files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { kitHash, kitTrust } from '../lib/proof.mjs';
import { tmpProject } from './helpers/tmp.mjs';
import { addScenario, commitFile, evidence, fails, fixture, git, head, ok, record, register, status, trustKit, withRepo } from './helpers/repo.mjs';

test('kit trust: only "Trusted: yes (<version>)" on the first line, with a self-run for that version, counts', () => {
  const p = tmpProject();
  try {
    const kit = path.join(p.dir, '.ril', 'docs', 'verification', 'verify.md');
    assert.equal(kitTrust(p.dir), 'none', 'no kit yet');
    fs.mkdirSync(path.dirname(kit), { recursive: true });
    const version = 'abc1234'.padEnd(40, '0');
    const trust = (text) => {
      fs.writeFileSync(kit, text);
      return kitTrust(p.dir, [{ version, kit: kitHash(p.dir) }]);
    };
    const untrusted = {
      'an empty file': '',
      'no': 'Trusted: no\n',
      'yes/no': 'Trusted: yes/no\n',
      'yes | no': 'Trusted: yes | no\n',
      'yes or no': 'Trusted: yes or no\n',
      'yes-ish': 'Trusted: yes-ish\n',
      'yesterday': 'Trusted: yesterday\n',
      'a note after a dash': 'Trusted: yes - shown failing\n',
      'a note after a colon': 'Trusted: yes: shown failing\n',
      'text after the note': 'Trusted: yes (shown failing) but not really\n',
      'bold markers': '**Trusted:** yes\n',
      'an indent': '  Trusted: yes\n',
      'a later line': '# Verify\n\nTrusted: yes\n',
      'a code fence': '```\nTrusted: yes\n```\n',
      'a comment': '<!-- Trusted: yes -->\n',
      'a bare yes': 'Trusted: yes\n',
      'no line end': 'Trusted: yes',
      'a note that is not a version': 'Trusted: yes (shown failing on a broken copy)\n',
      'a version too short': 'Trusted: yes (abc12)\n',
      'a version with no self-run row': 'Trusted: yes (def5678)\n',
    };
    for (const [what, text] of Object.entries(untrusted)) assert.equal(trust(text), 'untrusted', what);
    const trusted = {
      'a version': 'Trusted: yes (abc1234)\n',
      'any case': 'trusted: YES (ABC1234)\n',
      'the full id': `Trusted: yes (${version})\n\n# Verify\n`,
      'Windows line ends': 'Trusted: yes (abc1234)\r\n# Verify\r\n',
      'a byte order mark': '\uFEFFTrusted: yes (abc1234)\n',
    };
    for (const [what, text] of Object.entries(trusted)) assert.equal(trust(text), 'trusted', what);
    assert.equal(kitTrust(p.dir), 'untrusted', 'no self-runs at all (an old state)');
  } finally {
    p.cleanup();
  }
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
    ok(dir, 'agent', 'register', 'V2', '--role', 'verifier', '--task', 'verifier work', '--brief', fixture('agent-brief-good.md'));
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
    fs.writeFileSync(path.join(kit, '..', '.DS_Store'), 'finder');
    fs.symlinkSync('nowhere', path.join(kit, '..', 'dangling'));
    assert.equal(proof().code, 0, 'a dotfile and a dangling link are not part of the kit');
    for (const [what, change] of [['the body', () => fs.appendFileSync(kit, 'a weaker check\n')], ['a feature map', () => fs.mkdirSync(path.join(kit, '..', 'feature-map')) || fs.writeFileSync(path.join(kit, '..', 'feature-map', 'S1.md'), 'Method: cli\n')]]) {
      change();
      assert.match(proof().stderr, /kit changed after its self-run/, what);
      ok(dir, ...selfrun(dir, head(dir)));
      assert.equal(proof().code, 0, `a new self-run restores trust after ${what} changed`);
    }
  });
});

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
