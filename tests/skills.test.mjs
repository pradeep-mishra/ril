import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ril } from './helpers/ril.mjs';
import { tmpProject } from './helpers/tmp.mjs';
import { checkBrief } from '../lib/commands/agent.mjs';
import { kitHash, kitTrust } from '../lib/proof.mjs';
import { headings, helpGroups, readFile, repoRoot, rilCommandsIn } from './helpers/skills.mjs';

// Structure only: the shape of the router, playbooks, worker files and templates, and that what they name exists. Wording is not pinned.
const BUDGETS = {
  'skills/ril/SKILL.md': 1200, 'skills/ril/playbooks/shape.md': 300, 'skills/ril/playbooks/design.md': 450, 'skills/ril/playbooks/accept.md': 250,
  'skills/ril/playbooks/build.md': 400, 'skills/ril/playbooks/prove.md': 450, 'skills/ril/playbooks/prototype.md': 300, 'skills/ril/references/review.md': 300,
  'skills/ril/references/proof-kit.md': 500, 'skills/ril/worker-rules.md': 400, 'agents/ril-agent.md': 80, 'principles.md': 120,
};
const TEMPLATES = ['agent-brief', 'agent-report', 'spec', 'project-brief', 'feature-map', 'stop-report', 'verify', 'final-report'].map((n) => `templates/${n}.md`);
const PLAYBOOKS = ['shape', 'design', 'accept', 'build', 'prove', 'prototype'].map((n) => `skills/ril/playbooks/${n}.md`);
const words = (file) => readFile(file).text.split(/\s+/).filter(Boolean).length;
const keys = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
const inTempProject = (fn) => {
  const p = tmpProject();
  try {
    assert.equal(ril(p.dir, 'init').code, 0);
    fn(p.dir);
  } finally {
    p.cleanup();
  }
};

test('one router skill and one worker wrapper, each with name and description', () => {
  assert.deepEqual(fs.readdirSync(path.join(repoRoot, 'skills')), ['ril']);
  assert.deepEqual(fs.readdirSync(path.join(repoRoot, 'agents')), ['ril-agent.md']);
  for (const [file, name] of [['skills/ril/SKILL.md', 'ril'], ['agents/ril-agent.md', 'ril-agent']]) {
    const { frontmatter } = readFile(file);
    assert.equal(frontmatter.name, name, file);
    assert.ok(frontmatter.description, `${file} has no description`);
    assert.equal(frontmatter.tools, undefined, `${file} must not restrict tools`);
  }
});

test('the router has its three parts in order; every playbook and the review guide end in the evidence heading', () => {
  assert.deepEqual(headings(readFile('skills/ril/SKILL.md').body), ['Outcome', 'Rules', 'Done when']);
  for (const f of [...PLAYBOOKS, 'skills/ril/references/review.md']) {
    assert.equal(headings(readFile(f).text).at(-1), 'Evidence required for done', f);
  }
});

test('each direction file stays within its word budget, and the templates within theirs', () => {
  for (const [file, max] of Object.entries(BUDGETS)) assert.ok(words(file) <= max, `${file} has ${words(file)} words, budget ${max}`);
  const total = TEMPLATES.reduce((n, f) => n + words(f), 0);
  assert.ok(total <= 800, `templates have ${total} words, budget 800`);
  assert.ok(readFile('principles.md').lines <= 40);
});

test('every ril group named in direction text exists in ril help, and every file it names exists', () => {
  const known = new Set(helpGroups());
  for (const file of [...Object.keys(BUDGETS), ...TEMPLATES]) {
    const { text } = readFile(file);
    for (const group of rilCommandsIn(text)) assert.ok(known.has(group), `${file} names ril ${group}, which does not exist`);
    for (const named of text.match(/\b(?:skills|templates|agents)\/[\w./-]*\w\.md\b/g) ?? []) {
      assert.ok(fs.existsSync(path.join(repoRoot, named)), `${file} names ${named}, which does not exist`);
    }
  }
});

test('rilCommandsIn reads inline code and fenced blocks only', () => {
  const text = 'ril nope outside\n`ril stage get` and `ril-agent` and `/ril`\n```\nril doctor --fix\n```\n';
  assert.deepEqual(rilCommandsIn(text).sort(), ['doctor', 'stage']);
});

test('brief template has the ten fields in order and, filled, passes the brief check', () => {
  const { text } = readFile('templates/agent-brief.md');
  assert.deepEqual(keys(text, /^([a-z]+):/gm), ['role', 'unit', 'goal', 'inputs', 'acceptance', 'touch', 'rules', 'ril', 'report', 'stop']);
  const filled = text
    .split('\n').slice(1).join('\n')
    .replace('<author|tester|implementer|reviewer|verifier|fixer>', 'author')
    .replaceAll('<plugin folder>', repoRoot)
    .replace(/<[^>\n]+>/g, (p) => (p.includes('absolute path') ? '/abs/x.md' : 'filled'));
  assert.deepEqual(checkBrief(filled, 'author').problems, []);
});

test('agent-report has STATUS, RESULT, EVIDENCE and NEXT', () => {
  assert.deepEqual(keys(readFile('templates/agent-report.md').text, /^([A-Z]+):/gm), ['STATUS', 'RESULT', 'EVIDENCE', 'NEXT']);
});

test('spec template imports clean', () => {
  inTempProject((dir) => {
    const r = ril(dir, 'scenario', 'import', path.join(repoRoot, 'templates', 'spec.md'), '--check');
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });
});

test('a filled feature map passes ril scenario coverage', () => {
  inTempProject((dir) => {
    const add = ril(dir, 'scenario', 'add', 'S1', '--title', 'Greets', '--method', 'cli', '--criterion', 'hello prints hi');
    assert.equal(add.code, 0, add.stdout + add.stderr);
    assert.equal(ril(dir, 'scenario', 'coverage').code, 2, 'no map yet');
    const filled = readFile('templates/feature-map.md').text.replace(/^Method: <[^>\n]+>/, 'Method: cli').replace(/<[^>\n]+>/g, 'filled');
    const folder = path.join(dir, '.ril', 'docs', 'verification', 'feature-map');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'S1.md'), filled);
    const r = ril(dir, 'scenario', 'coverage');
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });
});

test('verify.md template starts "Trusted: no" then "Protected:", so the kit is untrusted until a self-run exists', () => {
  const { text } = readFile('templates/verify.md');
  assert.equal(text.split('\n')[0], 'Trusted: no');
  assert.equal(text.split('\n')[1].split(':')[0], 'Protected');
  const p = tmpProject();
  try {
    const kit = path.join(p.dir, '.ril', 'docs', 'verification');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(kit, 'verify.md'), text);
    assert.equal(kitTrust(p.dir), 'untrusted');
    fs.writeFileSync(path.join(kit, 'verify.md'), text.replace(/^Trusted: no$/m, 'Trusted: yes (abc1234)'));
    assert.equal(kitTrust(p.dir), 'untrusted', 'the line alone is not enough');
    assert.equal(kitTrust(p.dir, [{ version: 'abc1234'.padEnd(40, '0'), kit: kitHash(p.dir) }]), 'trusted');
  } finally {
    p.cleanup();
  }
});

test('stop report and final report templates have their headings', () => {
  assert.deepEqual(headings(readFile('templates/stop-report.md').text), ['What works', 'What does not work yet', 'What was tried', 'Evidence', 'Your options']);
  assert.deepEqual(headings(readFile('templates/final-report.md').text), ['What was built', 'What works', 'What is not covered', 'Decisions made for you', 'How to run it']);
});
