// ril scenario (add, update, import, coverage) and ril round (rail 3 and rail 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../lib/store.mjs';
import { addScenario, fails, fixture, lines, ok, withRepo } from './helpers/repo.mjs';

const withProject = (fn, ...init) => withRepo(fn, { gitInit: false, init });

test('scenario import good spec', () => {
  for (const name of ['spec-good.md', 'spec-crlf.md']) {
    withProject((dir) => {
      assert.ok(name !== 'spec-crlf.md' || fs.readFileSync(fixture(name), 'utf8').includes('\r\n'));
      const check = ok(dir, 'scenario', 'import', fixture(name), '--check');
      assert.match(check.stdout, /3/);
      assert.equal(load(dir).scenarios.length, 0, '--check adds nothing');

      ok(dir, 'scenario', 'import', fixture(name));
      const { scenarios } = load(dir);
      assert.deepEqual(scenarios.map((s) => s.id), ['S1', 'S2', 'S3'], name);
      assert.deepEqual(scenarios.map((s) => s.method), ['cli', 'cli', 'cli']);
      assert.deepEqual(scenarios.map((s) => s.title), ['Add a task', 'See the list', 'Finish a task']);
      for (const s of scenarios) {
        assert.equal(s.status, 'unproven');
        assert.equal(s.round, 0);
        assert.ok(!s.criterion.includes('\r') && !s.title.includes('\r') && s.criterion.length > 20, name);
      }
      assert.match(scenarios[2].criterion, /^Running the done command/, 'leading "- " is dropped');

      ok(dir, 'scenario', 'import', fixture(name)); // again: nothing new, nothing broken
      assert.equal(load(dir).scenarios.length, 3);
    });
  }
});

test('scenario import bad spec exits 6, one line per problem, adds nothing; a duplicate id is one problem', () => {
  withProject((dir) => {
    for (const extra of [[], ['--check']]) {
      const r = fails(dir, 6, 'scenario', 'import', fixture('spec-bad.md'), ...extra);
      const problems = lines(r.stderr).filter((l) => !l.startsWith('Next:'));
      assert.equal(problems.length, 2, r.stderr);
      assert.ok(problems.some((l) => l.startsWith('S2') && l.includes('Proof')), r.stderr);
      assert.ok(problems.some((l) => l.startsWith('S3') && l.includes('human')), r.stderr);
      assert.match(r.stderr, /Next: /);
    }
    assert.deepEqual(load(dir).scenarios, [], 'the good scenario S1 is not added either');
    const dup = path.join(dir, 'dup.md'); // a duplicate id is one problem; a colon in a title is kept
    fs.writeFileSync(dup, '### S1: One\nCriterion: a\nProof: cli\n\n### S1: Again\nCriterion: b\nProof: cli\n');
    const d = fails(dir, 6, 'scenario', 'import', dup);
    assert.match(lines(d.stderr).filter((l) => !l.startsWith('Next:')).join('\n'), /^S1.*more than once/);
    assert.deepEqual(load(dir).scenarios, []);
    fs.writeFileSync(dup, '### S1: Add: a task, quickly\nCriterion: Run it: it works.\nProof: cli\n');
    ok(dir, 'scenario', 'import', dup);
    assert.deepEqual([load(dir).scenarios[0].title, load(dir).scenarios[0].criterion], ['Add: a task, quickly', 'Run it: it works.']);
  });
});

test('scenario import refuses an empty spec and a clash with different wording, and a missing file', () => {
  withProject((dir) => {
    const empty = path.join(dir, 'empty.md');
    fs.writeFileSync(empty, '# Nothing here\n');
    assert.match(fails(dir, 6, 'scenario', 'import', empty).stderr, /Next: /);

    addScenario(dir, 'S1', 'api');
    const r = fails(dir, 6, 'scenario', 'import', fixture('spec-good.md'));
    assert.match(r.stderr, /S1/);
    assert.equal(load(dir).scenarios.length, 1);

    const missing = fails(dir, 2, 'scenario', 'import', path.join(dir, 'nope.md'));
    assert.match(missing.stderr, /Next: /);
  });
});

test('scenario update while unproven, an empty value, list and json', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    ok(dir, 'scenario', 'update', 'S1', '--criterion', 'new words', '--method', 'api');
    const s = load(dir).scenarios[0];
    assert.equal(s.criterion, 'new words');
    assert.equal(s.method, 'api');
    assert.equal(load(dir).decisions.length, 0);
    assert.match(ok(dir, 'scenario', 'list').stdout, /S1/);
    assert.equal(JSON.parse(ok(dir, '--json', 'scenario', 'list').stdout)[0].id, 'S1');
    fails(dir, 2, 'scenario', 'update', 'S9', '--title', 'x');
    fails(dir, 1, 'scenario', 'update', 'S1');
    for (const opt of ['--criterion', '--title', '--method']) {
      assert.match(fails(dir, 1, 'scenario', 'update', 'S1', opt, '  ').stderr, /Next: /, opt);
    }
    assert.equal(load(dir).scenarios[0].criterion, 'new words');
  });
});

test('rail 3: a scenario criterion is frozen after confirm unless forced with a reason', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    ok(dir, 'stage', 'set', 'design');
    ok(dir, 'stage', 'set', 'confirm');
    ok(dir, 'scenario', 'update', 'S1', '--criterion', 'still free at confirm');
    ok(dir, 'stage', 'set', 'build');

    const refused = fails(dir, 1, 'scenario', 'update', 'S1', '--criterion', 'x');
    assert.match(refused.stderr, /Next: /);
    assert.equal(load(dir).scenarios[0].criterion, 'still free at confirm');
    fails(dir, 1, 'scenario', 'update', 'S1', '--method', 'api');
    ok(dir, 'scenario', 'update', 'S1', '--title', 'a better title'); // the title is not frozen
    assert.equal(load(dir).scenarios[0].title, 'a better title');

    ok(dir, 'scenario', 'update', 'S1', '--criterion', 'x', '--force', 'the person changed their mind');
    assert.equal(load(dir).scenarios[0].criterion, 'x');
    assert.match(ok(dir, 'decision', 'list').stdout, /the person changed their mind/);
    ok(dir, 'stage', 'set', 'parked');
    fails(dir, 1, 'scenario', 'update', 'S1', '--criterion', 'y'); // still frozen while paused after confirm
  });
});

// Puts a scenario straight into a status and round, as a verifier and the fix loop would.
function tried(dir, id, status, round) {
  const file = path.join(dir, '.ril', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(state.scenarios.find((s) => s.id === id), { status, round });
  fs.writeFileSync(file, JSON.stringify(state));
}

test('a scenario that was already tried can change only with a reason, and then starts again', () => {
  for (const status of ['failing', 'proven', 'parked']) {
    withProject((dir) => {
      addScenario(dir, 'S1');
      tried(dir, 'S1', status, 3);
      const refused = fails(dir, 1, 'scenario', 'update', 'S1', '--criterion', 'x');
      assert.match(refused.stderr, /Next: .*--force/, status);
      assert.doesNotMatch(refused.stderr, /new scenario/, status);
      assert.deepEqual([load(dir).scenarios[0].criterion, load(dir).scenarios[0].status], ['Criterion S1', status]);

      ok(dir, 'scenario', 'update', 'S1', '--criterion', 'new words', '--force', 'the goal moved');
      const s = load(dir).scenarios[0];
      assert.deepEqual([s.criterion, s.status, s.round], ['new words', 'unproven', 0], status);
      assert.equal(load(dir).decisions.length, 1);
      assert.equal(load(dir).decisions[0].why, 'the goal moved');
      assert.match(ok(dir, 'decision', 'list').stdout, /the goal moved/);
    });
  }
});

test('one reason covers both a tried scenario and the freeze after confirm, logged once; a title-only change keeps the status', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    for (const s of ['design', 'confirm', 'build']) ok(dir, 'stage', 'set', s);
    tried(dir, 'S1', 'proven', 2);
    ok(dir, 'scenario', 'update', 'S1', '--method', 'api', '--force', 'wrong way to prove it');
    const state = load(dir);
    assert.deepEqual([state.scenarios[0].method, state.scenarios[0].status, state.scenarios[0].round], ['api', 'unproven', 0]);
    assert.equal(state.decisions.length, 1);
    addScenario(dir, 'S2');
    tried(dir, 'S2', 'proven', 2);
    fails(dir, 1, 'scenario', 'update', 'S2', '--title', 'new title');
    ok(dir, 'scenario', 'update', 'S2', '--title', 'new title', '--force', 'typo');
    const s2 = load(dir).scenarios[1];
    assert.deepEqual([s2.title, s2.status, s2.round], ['new title', 'proven', 2], 'a title change alone keeps the status');
  });
});

test('scenario coverage reports a missing feature map and passes when it exists', () => {
  withProject((dir) => {
    assert.match(ok(dir, 'scenario', 'coverage').stdout, /no scenarios/i);
    addScenario(dir, 'S1', 'cli');
    const missing = fails(dir, 2, 'scenario', 'coverage');
    assert.match(missing.stderr, /S1/);
    assert.match(missing.stderr, /Next: /);

    const mapDir = path.join(dir, '.ril', 'docs', 'verification', 'feature-map');
    fs.mkdirSync(mapDir, { recursive: true });
    fs.writeFileSync(path.join(mapDir, 'S1.md'), 'Method: api\r\nrest of the map\n');
    const wrong = fails(dir, 2, 'scenario', 'coverage');
    assert.match(wrong.stderr, /S1/);
    assert.match(wrong.stderr, /api/);

    fs.writeFileSync(path.join(mapDir, 'S1.md'), 'Method: cli\nrest of the map\n');
    ok(dir, 'scenario', 'coverage');
    addScenario(dir, 'S2', 'api');
    assert.match(fails(dir, 2, 'scenario', 'coverage').stderr, /S2/);
  });
});

test('a byte order mark in a spec or feature map still works, and a wrapped criterion is kept whole', () => {
  withProject((dir) => {
    const spec = path.join(dir, 'bom.md');
    fs.writeFileSync(spec, '\uFEFF### S1: A\nCriterion: c\nProof: cli\n\n### S2: B\nCriterion: d\nProof: cli\n\n### S3: C\nCriterion: e\nProof: cli\n');
    ok(dir, 'scenario', 'import', spec);
    assert.deepEqual(load(dir).scenarios.map((s) => s.id), ['S1', 'S2', 'S3']);
    const mapDir = path.join(dir, '.ril', 'docs', 'verification', 'feature-map');
    fs.mkdirSync(mapDir, { recursive: true });
    for (const id of ['S1', 'S2', 'S3']) fs.writeFileSync(path.join(mapDir, `${id}.md`), '﻿Method: cli  \r\nmore\r\n');
    ok(dir, 'scenario', 'coverage');
  });
  withProject((dir) => { // a criterion that wraps onto the next lines is kept whole
    const spec = path.join(dir, 'wrap.md');
    fs.writeFileSync(spec, [
      '### S1: Wrapped',
      '- Criterion: The list command shows',
      '  every open task,',
      'oldest first.',
      '- Proof: cli',
      'A note after the proof is not part of anything.',
      '',
      '### S2: Blank ends it',
      'Criterion: First line',
      '',
      'a separate paragraph',
      'Proof: api',
      '',
    ].join('\r\n'));
    ok(dir, 'scenario', 'import', spec);
    const [s1, s2] = load(dir).scenarios;
    assert.equal(s1.criterion, 'The list command shows every open task, oldest first.');
    assert.equal(s1.method, 'cli');
    assert.equal(s2.criterion, 'First line');
  });
});

test('rail 4: five bumps print 1 to 5, the sixth exits 4 and stores nothing', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    for (let n = 1; n <= 5; n++) {
      const r = ok(dir, 'round', 'bump', 'S1');
      assert.match(r.stdout, new RegExp(`\\b${n}\\b`), r.stdout);
      assert.equal(load(dir).scenarios[0].round, n);
    }
    const r = fails(dir, 4, 'round', 'bump', 'S1');
    assert.match(r.stderr, /Next: stop and write the stop report/);
    assert.equal(load(dir).scenarios[0].round, 5);
    fails(dir, 4, 'round', 'bump', 'S1', '--force', 'one more');
    assert.equal(load(dir).scenarios[0].round, 5);

    const unforced = fails(dir, 1, 'round', 'reset', 'S1');
    assert.match(unforced.stderr, /Next: .*ril round reset S1 --force "<reason>"/);
    assert.equal(load(dir).scenarios[0].round, 5, 'a reset without a reason changes nothing');
    fails(dir, 1, 'round', 'reset', 'S1', '--force', '  ');
    ok(dir, 'round', 'reset', 'S1', '--force', 'the person chose a new approach');
    assert.equal(load(dir).scenarios[0].round, 0);
    const logged = load(dir).decisions.at(-1);
    assert.match(logged.decision, /S1/);
    assert.equal(logged.why, 'the person chose a new approach');
    assert.match(ok(dir, 'round', 'bump', 'S1').stdout, /\b1\b/);
    fails(dir, 2, 'round', 'bump', 'S9');
    fails(dir, 2, 'round', 'reset', 'S9', '--force', 'gone');
  }, '--cap', '5');
});
