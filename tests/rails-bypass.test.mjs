// Ways around the ledger and the done check that were found in review, each closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ril } from './helpers/ril.mjs';
import { load } from '../lib/store.mjs';
import { addScenario, commitFile, fails, fixture, git, gitInit, head, lines, ok, record, register, status, withRepo, writeBrief } from './helpers/repo.mjs';

const toAccept = (dir) => {
  for (const stage of ['design', 'confirm', 'build', 'accept']) ok(dir, 'stage', 'set', stage);
};

function park(dir, id) {
  const file = path.join(dir, '.ril', 'state.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.scenarios.find((s) => s.id === id).status = 'parked';
  fs.writeFileSync(file, JSON.stringify(raw));
}

test('only an "Accepted risk for <id>" decision lets risks through', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
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

    // A carry decision names the scenario too, and does not count either.
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
    const from = head(dir);
    const to = commitFile(dir, 'README.md', '# more\n');
    ok(dir, 'ledger', 'carry', 'S1', from, to);
    assert.equal(record(dir, 'S1', to, 'proven-cli', { review: 'risks' }).code, 1, 'a carry decision is not risk acceptance');

    ok(dir, 'decision', 'log', '--stage', 'shape', '--decision', 'accepted RISK for S1: slow start', '--why', 'the person agreed');
    assert.equal(record(dir, 'S1', to, 'proven-cli', { review: 'risks' }).code, 0);
  });
});

test('only an "Accepted as unproven: <id>" decision lets a parked scenario through', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    toAccept(dir);
    ok(dir, '--force', 'x', 'scenario', 'update', 'S1', '--title', 'other');
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Changed the criterion of scenario S1', '--why', 'S1 was wrong');
    park(dir, 'S1');
    fails(dir, 1, 'stage', 'set', 'done');
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Accepted as unproven: S1', '--why', 'the sandbox is down');
    ok(dir, 'stage', 'set', 'done');
  });
});

test('done is refused with no scenarios', () => {
  withRepo((dir) => {
    toAccept(dir);
    assert.match(fails(dir, 1, 'stage', 'set', 'done').stderr, /There are no scenarios, so nothing has been proven/);
  });
});

test('done needs every proof at the current saved version', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    toAccept(dir);
    const first = head(dir);
    assert.equal(record(dir, 'S1', first, 'proven-cli').code, 0);
    commitFile(dir, 'src/a.js', 'code\n');
    const stale = fails(dir, 1, 'stage', 'set', 'done');
    assert.match(stale.stderr, /S1/);
    assert.match(stale.stderr, /ledger carry/);
    assert.doesNotMatch(stale.stderr, /\bSHA\b|\bHEAD\b/);
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
    const proved = head(dir);
    const docs = commitFile(dir, 'docs/guide.md', 'words\n');
    fails(dir, 1, 'stage', 'set', 'done');
    ok(dir, 'ledger', 'carry', 'S1', proved, docs);
    ok(dir, 'stage', 'set', 'done');
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
    assert.match(nowhere.stderr, /S99/);
    assert.deepEqual(load(dir).agents, []);

    assert.equal(reg('V1', fixture('agent-brief-good.md')).code, 0);
    assert.equal(reg('V1', fixture('agent-brief-good.md')).code, 0, 'the same job again changes nothing');
    const other = ril(dir, 'agent', 'register', 'V1', '--role', 'verifier', '--task', 'another job', '--brief', fixture('agent-brief-good.md'));
    assert.equal(other.code, 1);
    assert.match(other.stderr, /Next: /);
    assert.equal(load(dir).agents.length, 1);
  });
});

test('checkpoint in a project nested in a larger repo saves only the project', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-outer-'));
  try {
    gitInit(outer);
    fs.writeFileSync(path.join(outer, 'top.txt'), 'top\n');
    git(outer, 'add', 'top.txt');
    git(outer, 'commit', '-q', '-m', 'outer start');
    const dir = path.join(outer, 'app');
    fs.mkdirSync(dir);
    ok(dir, 'init');
    const first = ok(dir, 'checkpoint').stdout.trim();

    fs.writeFileSync(path.join(outer, 'outside.txt'), 'staged elsewhere\n');
    git(outer, 'add', 'outside.txt');
    assert.equal(ok(dir, 'checkpoint').stdout.trim(), first, 'only an outside file is staged: no new save');
    assert.equal(head(outer), first);

    fs.writeFileSync(path.join(dir, 'a.js'), 'code\n');
    const second = ok(dir, 'checkpoint').stdout.trim();
    assert.notEqual(second, first);
    const saved = lines(git(outer, 'show', '--name-only', '--format=', second));
    assert.deepEqual(saved, ['app/a.js']);
    assert.match(git(outer, 'status', '--porcelain'), /^A {2}outside\.txt/m, 'the outside file is still only staged');
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('evidence must be a non-empty file inside the project', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
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
      };
      try {
        fs.symlinkSync(path.join(outside, 'proof.txt'), path.join(dir, '.ril', 'evidence', 'S1', 'link.txt'));
        cases['a link to outside'] = '.ril/evidence/S1/link.txt';
      } catch {
        // creating links needs extra rights on some systems
      }
      for (const [what, given] of Object.entries(cases)) {
        const r = record(dir, 'S1', head(dir), 'proven-cli', { evidence: given });
        assert.equal(r.code, 1, `${what}: ${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /Next: /, what);
        assert.doesNotMatch(r.stderr, /does not exist in the project/, what);
      }
      assert.equal(status(dir), 'unproven');
      assert.match(record(dir, 'S1', head(dir), 'proven-cli', { evidence: '.ril/evidence/S1/empty.txt' }).stderr, /empty/);
      assert.match(record(dir, 'S1', head(dir), 'proven-cli', { evidence: path.join(outside, 'proof.txt') }).stderr, /outside/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('blocked never takes away a pass; failed replaces it', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
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
  });
});

test('the kit counts as trusted only when it says "Trusted: yes"', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    const kit = path.join(dir, '.ril', 'docs', 'verification', 'verify.md');
    fs.mkdirSync(path.dirname(kit), { recursive: true });
    const untrusted = ['# Verify\n', 'Trusted: no (not shown failing yet)\n', '**Trusted:** no\n', 'Trusted: maybe\n', '```\nTrusted: yes\n```\n'];
    for (const text of untrusted) {
      fs.writeFileSync(kit, text);
      const r = record(dir, 'S1', head(dir), 'proven-cli');
      assert.equal(r.code, 1, JSON.stringify(text));
      assert.match(r.stderr, /trusted/i);
    }
    fs.writeFileSync(kit, '# Verify\r\n\r\n  trusted: YES\r\n');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
  });
});

test('a verifier that failed or was stopped cannot record', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    for (const state of ['failed', 'stopped']) {
      ok(dir, 'agent', 'set', 'V1', '--state', state, '--result', `it ${state}`);
      assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 1, state);
    }
    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'S1 checked');
    assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
  });
});

test('carry is strict about what counts as a trivial change', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    addScenario(dir, 'G1', 'golden');
    register(dir, 'V1', 'verifier');
    const base = head(dir);
    assert.equal(record(dir, 'S1', base, 'proven-cli').code, 0);
    assert.equal(record(dir, 'G1', base, 'proven-golden').code, 0);

    const notTrivial = (rel) => {
      git(dir, 'checkout', '-q', base);
      const to = commitFile(dir, rel, 'x\n');
      const r = fails(dir, 2, 'ledger', 'carry', 'S1', base, to);
      assert.match(r.stderr, /NOT-TRIVIAL/, rel);
    };
    notTrivial('src/tests/helper.js');
    notTrivial('src/docs/page.js');
    notTrivial('src/README.md');
    notTrivial('src/a-spec.js');
    notTrivial('src/test_a.py');

    git(dir, 'checkout', '-q', base);
    const tests = commitFile(dir, 'tests/golden.json', '{}\n');
    ok(dir, 'ledger', 'carry', 'S1', base, tests);
    assert.match(fails(dir, 2, 'ledger', 'carry', 'G1', base, tests).stderr, /NOT-TRIVIAL/, 'tests are the golden set');
    const spec = commitFile(dir, 'src/a.spec.js', 'x\n');
    ok(dir, 'ledger', 'carry', 'S1', tests, spec);

    // Backwards (to an older version) is refused.
    fails(dir, 1, 'ledger', 'carry', 'S1', spec, base);
  });
});

test('carry sees changes outside the project folder in an enclosing repo', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-outer-'));
  try {
    gitInit(outer);
    const dir = path.join(outer, 'app');
    fs.mkdirSync(dir);
    ok(dir, 'init');
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    const from = ok(dir, 'checkpoint').stdout.trim();
    assert.equal(record(dir, 'S1', from, 'proven-cli').code, 0);
    fs.writeFileSync(path.join(outer, 'shared.js'), 'used by app\n');
    git(outer, 'add', 'shared.js');
    git(outer, 'commit', '-q', '-m', 'outside change');
    const r = fails(dir, 2, 'ledger', 'carry', 'S1', from, head(outer));
    assert.match(r.stderr, /shared\.js/);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test('record refuses while the project has unsaved changes', () => {
  withRepo((dir) => {
    addScenario(dir, 'S1');
    register(dir, 'V1', 'verifier');
    fs.writeFileSync(path.join(dir, 'app.js'), 'not saved yet\n');
    const r = record(dir, 'S1', head(dir), 'proven-cli');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ril checkpoint/);
    const saved = ok(dir, 'checkpoint').stdout.trim();
    assert.equal(record(dir, 'S1', saved, 'proven-cli').code, 0, 'changes inside .ril do not count');
  });
});
