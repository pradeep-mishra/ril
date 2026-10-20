// Runs the end-to-end state checker against finished projects and against broken copies of one,
// each copy breaking exactly one condition.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { head, ok } from '../helpers/repo.mjs';
import { buildProject, docs, makeProject, ready, prove, runChecker, withProject } from '../helpers/lifecycle.mjs';
import { tmpProject } from '../helpers/tmp.mjs';

const IDS = ['S1', 'S2'];
const statePath = (dir) => path.join(dir, '.ril', 'state.json');
const edit = (dir, change) => {
  const state = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
  change(state);
  fs.writeFileSync(statePath(dir), JSON.stringify(state, null, 2));
};
const proofFile = (dir) => path.join(dir, '.ril', 'evidence', 'S1', 'run.txt');

let base;
let scratch;
before(() => {
  base = makeProject();
  buildProject(base.dir);
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-check-'));
});
after(() => {
  base?.cleanup();
  fs.rmSync(scratch, { recursive: true, force: true });
});

// A private copy of the finished project, with the damage applied.
function broken(damage) {
  const copy = fs.mkdtempSync(path.join(scratch, 'copy-'));
  fs.cpSync(base.dir, copy, { recursive: true });
  damage(copy);
  return runChecker(copy);
}

test('a finished project passes and the summary is plain', () => {
  const r = runChecker(base.dir);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /2 of 2 scenarios proven/);
  assert.match(r.text, /Recovery: nothing was needed/);
  assert.match(r.text, /ACCEPTED/);
});

test('decisions made and what recovery did are listed', () => {
  const r = broken((dir) => {
    ok(dir, 'decision', 'log', '--stage', 'accept', '--decision', 'Keep the list small', '--why', 'the person asked');
    edit(dir, (s) => void (s.agents[0].state = 'running'));
    ok(dir, 'doctor', '--fix', '--new-session'); // stops the working agent and logs the repair
  });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /Keep the list small \(the person asked\)/);
  assert.match(r.text, /Recovery: \d+ repairs logged/);
});

test('a parked scenario passes only with its acceptance on record', () => {
  withProject((dir) => {
    ready(dir, IDS);
    prove(dir, ['S2']);
    ok(dir, 'skip', 'S1', '--reason', 'stuck');
    ok(dir, 'stage', 'set', 'done');
    ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'S2 proven');
    ok(dir, 'checkpoint');
    const r = runChecker(dir);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /1 accepted as unproven/);
  });
});

test('a folder that is not a ril project, damaged state, or a wrong shape exits 2 with plain lines', () => {
  const empty = tmpProject();
  try {
    fs.rmSync(path.join(empty.dir, '.ril'), { recursive: true });
    const none = runChecker(empty.dir);
    assert.equal(none.code, 2);
    assert.match(none.text, /There is no ril project in /);
    const missingFolder = runChecker(path.join(empty.dir, 'nowhere'));
    assert.equal(missingFolder.code, 2);
    assert.match(missingFolder.text, /There is no ril project in /);
    fs.mkdirSync(path.join(empty.dir, '.ril'));
    const state = statePath(empty.dir);
    const shapes = ['{', '[]', 'null', '{"stage":"done","scenarios":{},"ledger":[],"agents":[],"decisions":[]}', '{"stage":"done","scenarios":[],"ledger":[],"agents":"x","decisions":[]}', '{"stage":"done","scenarios":[],"ledger":[],"agents":[]}'];
    for (const text of shapes) {
      fs.writeFileSync(state, text);
      const r = runChecker(empty.dir);
      assert.equal(r.code, 2, `${text}: ${r.text}`);
      assert.doesNotMatch(r.text, /\n\s+at |TypeError|SyntaxError/, text);
      assert.match(r.text, /state\.json|ril project/, text);
    }
  } finally {
    empty.cleanup();
  }
});

const TRUST = (line) => (dir) => fs.writeFileSync(docs(dir, 'verification', 'verify.md'), `# Verify\n\n${line}\n`);
const outsideFile = () => {
  const file = path.join(scratch, `outside-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(file, 'transcript kept elsewhere\n');
  return file;
};

const variants = [
  ['the stage is not done', (dir) => edit(dir, (s) => void (s.stage = 'accept')), /stage is accept/i],
  ['the proof is at an older saved version', (dir) => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log(2);\n');
    ok(dir, 'checkpoint');
  }, /no proven result at the current saved version/],
  ['the project has unsaved changes', (dir) => fs.writeFileSync(path.join(dir, 'notes.txt'), 'later\n'), /unsaved changes/],
  ['the kit says Trusted: no', TRUST('Trusted: no'), /Trusted: yes/],
  ['the kit says Trusted: yes/no', TRUST('Trusted: yes/no'), /Trusted: yes/],
  ['the kit says Trusted: yesterday', TRUST('Trusted: yesterday'), /Trusted: yes/],
  ['the kit line sits inside a code fence', TRUST('```\nTrusted: yes\n```'), /Trusted: yes/],
  ['the kit says Trusted: yes only on a later line', TRUST('Trusted: yes'), /Trusted: yes/],
  ['the kit is missing', (dir) => {
    fs.rmSync(docs(dir, 'verification', 'verify.md'));
  }, /Trusted: yes/],
  ['every scenario is set aside and none is proven', (dir) => edit(dir, (s) => {
    for (const sc of s.scenarios) {
      sc.status = 'parked';
      s.decisions.push({ ts: new Date().toISOString(), stage: 'accept', decision: `Accepted as unproven: ${sc.id}`, why: 'stuck' });
    }
  }), /No scenario is proven/],
  ['an agent is still working', (dir) => edit(dir, (s) => void (s.agents[0].state = 'running')), /still marked as working/],
  ['the verifier is not a verifier', (dir) => edit(dir, (s) => void (s.agents[0].role = 'implementer')), /not a verifier/],
  ['a proof ran zero checks', (dir) => edit(dir, (s) => void (s.ledger.find((r) => r.scenario === 'S1').checks = 0)), /ran 0 checks/],
  ['the review is none', (dir) => edit(dir, (s) => void (s.ledger.find((r) => r.scenario === 'S1').review = 'none')), /review of scenario S1 is none/],
  ['the review found risks nobody accepted', (dir) => edit(dir, (s) => void (s.ledger.find((r) => r.scenario === 'S1').review = 'risks')), /found risks and nobody recorded "Accepted risk for S1"/],
  ['a parked scenario has no acceptance', (dir) => edit(dir, (s) => void (s.scenarios[1].status = 'parked')), /nobody recorded "Accepted as unproven: S2"/],
  ['an evidence file is missing', (dir) => fs.rmSync(proofFile(dir)), /evidence for scenario S1/],
  ['an evidence file is empty', (dir) => fs.writeFileSync(proofFile(dir), ''), /evidence for scenario S1.*empty/],
  ['the evidence path is not text', (dir) => edit(dir, (s) => void (s.ledger.find((r) => r.scenario === 'S1').evidence = 42)), /evidence for scenario S1/],
  ['the evidence path is outside the project', (dir) => {
    const file = outsideFile();
    edit(dir, (s) => void (s.ledger.find((r) => r.scenario === 'S1').evidence = file));
  }, /evidence for scenario S1.*outside \.ril\/evidence/],
  ['the evidence is a product file', (dir) => edit(dir, (s) => void (s.ledger.find((r) => r.scenario === 'S1').evidence = 'README.md')), /evidence for scenario S1.*outside \.ril\/evidence/],
  ['the final report is missing', (dir) => {
    fs.rmSync(docs(dir, 'reports', 'final.md'));
  }, /final report .*missing/i],
  ['the final report has no "What is not covered" section', (dir) => {
    fs.writeFileSync(docs(dir, 'reports', 'final.md'), '# Final report\n\nAll good.\n');
  }, /no "What is not covered" section/],
  ['there are no scenarios', (dir) => edit(dir, (s) => void (s.scenarios = [])), /no scenarios/],
];
for (const [what, damage, says] of variants) {
  test(`checker fails when ${what}`, () => {
    const r = broken(damage);
    assert.equal(r.code, 1, r.text);
    assert.ok(r.problems.length >= 1, r.text);
    for (const line of r.problems) assert.match(line, says, `an unrelated problem was also reported:\n${r.text}`);
    assert.match(r.text, /NOT ACCEPTED/);
  });
}

test('checker fails when the evidence is a link to a file outside the project', (t) => {
  const file = outsideFile();
  let linked = true;
  const r = broken((dir) => {
    fs.rmSync(proofFile(dir));
    try {
      fs.symlinkSync(file, proofFile(dir));
    } catch {
      linked = false;
    }
  });
  if (!linked) return t.skip('this system does not let the test create links');
  assert.equal(r.code, 1, r.text);
  assert.ok(r.problems.length >= 1, r.text);
  for (const line of r.problems) assert.match(line, /evidence for scenario S1.*outside \.ril\/evidence/);
});
