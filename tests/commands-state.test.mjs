import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ril } from './helpers/ril.mjs';
import { tmpProject } from './helpers/tmp.mjs';
import { load } from '../lib/store.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => path.join(fixtures, name);

// A fresh initialised project; runs fn(dir) and cleans up. `cap` goes to ril init when given.
function withProject(fn, ...initArgs) {
  const p = tmpProject();
  try {
    const r = ril(p.dir, 'init', ...initArgs);
    assert.equal(r.code, 0, r.stderr);
    return fn(p.dir);
  } finally {
    p.cleanup();
  }
}

function ok(dir, ...args) {
  const r = ril(dir, ...args);
  assert.equal(r.code, 0, `${args.join(' ')} -> ${r.stderr}`);
  return r;
}

function fails(dir, code, ...args) {
  const r = ril(dir, ...args);
  assert.equal(r.code, code, `${args.join(' ')} -> ${r.stdout}${r.stderr}`);
  return r;
}

const addScenario = (dir, id = 'S1', method = 'cli') =>
  ok(dir, 'scenario', 'add', id, '--title', `Title ${id}`, '--method', method, '--criterion', `Criterion ${id}`);

const lines = (text) => text.split('\n').filter(Boolean);

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

test('scenario import bad spec exits 6, one line per problem, adds nothing', () => {
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

test('scenario add idempotent and conflicting', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    addScenario(dir, 'S1');
    assert.equal(load(dir).scenarios.length, 1);
    const clash = fails(dir, 1, 'scenario', 'add', 'S1', '--title', 'Title S1', '--method', 'cli', '--criterion', 'something else');
    assert.match(clash.stderr, /Next: use scenario update/);
    assert.equal(load(dir).scenarios[0].criterion, 'Criterion S1');
    assert.match(fails(dir, 1, 'scenario', 'add', 'S2', '--title', 't', '--method', 'human', '--criterion', 'c').stderr, /Next: /);
    assert.match(fails(dir, 1, 'scenario', 'add', 'S2', '--title', 't', '--method', 'cli').stderr, /Next: /);
    assert.match(fails(dir, 1, 'scenario', 'add', '../S2', '--title', 't', '--method', 'cli', '--criterion', 'c').stderr, /Next: /);
    assert.equal(load(dir).scenarios.length, 1);
  });
});

test('scenario update while unproven, list and json', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    ok(dir, 'scenario', 'update', 'S1', '--criterion', 'new words', '--method', 'api');
    const s = load(dir).scenarios[0];
    assert.equal(s.criterion, 'new words');
    assert.equal(s.method, 'api');
    assert.equal(load(dir).decisions.length, 0);
    assert.match(ok(dir, 'scenario', 'list', '--status', 'unproven').stdout, /S1/);
    assert.equal(ok(dir, 'scenario', 'list', '--status', 'proven').stdout.includes('S1'), false);
    assert.equal(JSON.parse(ok(dir, '--json', 'scenario', 'list').stdout)[0].id, 'S1');
    fails(dir, 2, 'scenario', 'update', 'S9', '--title', 'x');
    fails(dir, 1, 'scenario', 'update', 'S1');
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
  });
});

test('rail 3 also holds for a project paused after confirm', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    for (const s of ['design', 'confirm', 'build', 'parked']) ok(dir, 'stage', 'set', s);
    fails(dir, 1, 'scenario', 'update', 'S1', '--criterion', 'x');
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

test('one reason covers both a tried scenario and the freeze after confirm, logged once', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    for (const s of ['design', 'confirm', 'build']) ok(dir, 'stage', 'set', s);
    tried(dir, 'S1', 'proven', 2);
    ok(dir, 'scenario', 'update', 'S1', '--method', 'api', '--force', 'wrong way to prove it');
    const state = load(dir);
    assert.deepEqual([state.scenarios[0].method, state.scenarios[0].status, state.scenarios[0].round], ['api', 'unproven', 0]);
    assert.equal(state.decisions.length, 1);
  });
});

test('changing only the title of a tried scenario keeps its status', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    tried(dir, 'S1', 'proven', 2);
    fails(dir, 1, 'scenario', 'update', 'S1', '--title', 'new title');
    ok(dir, 'scenario', 'update', 'S1', '--title', 'new title', '--force', 'typo');
    const s = load(dir).scenarios[0];
    assert.deepEqual([s.title, s.status, s.round], ['new title', 'proven', 2]);
  });
});

test('scenario update refuses an empty title or criterion', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    for (const opt of ['--criterion', '--title', '--method']) {
      assert.match(fails(dir, 1, 'scenario', 'update', 'S1', opt, '  ').stderr, /Next: /, opt);
    }
    assert.equal(load(dir).scenarios[0].criterion, 'Criterion S1');
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

test('init takes the round cap once, from 5 to 10, default 8', () => {
  withProject((dir) => assert.equal(load(dir).cap, 8));
  withProject((dir) => assert.equal(load(dir).cap, 10), '--cap', '10');
  const p = tmpProject();
  try {
    for (const bad of ['4', '11', 'many']) {
      const r = ril(p.dir, 'init', '--cap', bad);
      assert.equal(r.code, 1, bad);
      assert.match(r.stderr, /Next: /);
    }
    assert.equal(fs.existsSync(path.join(p.dir, '.ril', 'state.json')), false);
  } finally {
    p.cleanup();
  }
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
    const todo = ok(dir, 'unit', 'list', '--state', 'todo').stdout;
    assert.ok(todo.includes('P1') && !todo.includes('T1'));
    assert.equal(JSON.parse(ok(dir, '--json', 'unit', 'list').stdout).length, 2);
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

test('a spec file and a feature map that start with a byte order mark still work', () => {
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
});

test('a criterion that wraps onto the next lines is kept whole', () => {
  withProject((dir) => {
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

test('a duplicate id in one spec is one problem and nothing is added; a colon in a title is kept', () => {
  withProject((dir) => {
    const dup = path.join(dir, 'dup.md');
    fs.writeFileSync(dup, '### S1: One\nCriterion: a\nProof: cli\n\n### S1: Again\nCriterion: b\nProof: cli\n');
    const r = fails(dir, 6, 'scenario', 'import', dup);
    const problems = lines(r.stderr).filter((l) => !l.startsWith('Next:'));
    assert.equal(problems.length, 1, r.stderr);
    assert.match(problems[0], /S1.*more than once/);
    assert.deepEqual(load(dir).scenarios, []);

    const colon = path.join(dir, 'colon.md');
    fs.writeFileSync(colon, '### S1: Add: a task, quickly\nCriterion: Run it: it works.\nProof: cli\n');
    ok(dir, 'scenario', 'import', colon);
    const s = load(dir).scenarios[0];
    assert.deepEqual([s.title, s.criterion], ['Add: a task, quickly', 'Run it: it works.']);
  });
});

test('a refused round bump past the cap leaves the state and its backup untouched', () => {
  withProject((dir) => {
    addScenario(dir, 'S1');
    for (let n = 0; n < 5; n++) ok(dir, 'round', 'bump', 'S1');
    const file = path.join(dir, '.ril', 'state.json');
    const before = [fs.readFileSync(file), fs.readFileSync(`${file}.bak`)];
    fails(dir, 4, 'round', 'bump', 'S1');
    assert.ok(fs.readFileSync(file).equals(before[0]));
    assert.ok(fs.readFileSync(`${file}.bak`).equals(before[1]));
  }, '--cap', '5');
});

test('a repeat init with a different cap says the cap was kept', () => {
  withProject((dir) => {
    const r = ok(dir, 'init', '--cap', '6');
    assert.equal(load(dir).cap, 5);
    assert.match(r.stdout, /fix-round limit.*kept at 5/i);
    assert.equal(lines(r.stdout).filter((l) => /kept at/.test(l)).length, 1);
    assert.doesNotMatch(ok(dir, 'init', '--cap', '5').stdout, /kept at/);
    assert.doesNotMatch(ok(dir, 'init').stdout, /kept at/);
  }, '--cap', '5');
});
