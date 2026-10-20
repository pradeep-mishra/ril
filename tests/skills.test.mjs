import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ril } from './helpers/ril.mjs';
import { tmpProject } from './helpers/tmp.mjs';
import { checkBrief } from '../lib/brief.mjs';
import { kitHash, kitTrust } from '../lib/proof.mjs';
import { headings, helpGroups, readFile, readRole, readSkill, repoRoot, rilCommandsIn, roleNames, skillNames } from './helpers/skills.mjs';

// Structure only: the shape of skills, roles and templates, and that what they name exists. Wording is not pinned.
const PARTS = ['Outcome', 'Rules', 'Done when', 'Involve the person when', 'Ask the CLI'];
const TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'];
const TEMPLATES = ['standing-rules', 'agent-brief', 'agent-report', 'spec', 'project-brief', 'feature-map', 'stop-report', 'verify', 'final-report'].map((n) => `templates/${n}.md`);
const budget = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'charter-budget.json'), 'utf8'));

const skills = () => skillNames().map((name) => ({ name, ...readSkill(name) }));
const roles = () => roleNames().map((name) => ({ name, ...readRole(name) }));
const firstLine = (body) => body.split('\n').find((l) => l.trim() && !l.startsWith('#'));
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

test('skills and roles stay within the charter counts', () => {
  assert.ok(skillNames().length <= budget.skillCount.ceiling, `${skillNames().length} skills`);
  assert.ok(roleNames().length <= budget.agentCount.ceiling, `${roleNames().length} roles`);
});

test('every skill and role has valid frontmatter', () => {
  for (const s of [...skills(), ...roles()]) {
    assert.equal(s.frontmatter.name, s.name, s.file);
    assert.ok(s.frontmatter.description, `${s.file} has no description`);
  }
});

test('every skill has the five parts in order and at most 120 lines', () => {
  for (const s of skills()) {
    assert.deepEqual(headings(s.body), PARTS, s.file);
    assert.ok(s.lines <= 120, `${s.file} has ${s.lines} lines`);
  }
});

test('every ril group named in a skill, role or template exists in ril help', () => {
  const known = new Set(helpGroups());
  for (const f of [...skills(), ...roles(), ...TEMPLATES.map(readFile), readFile('principles.md')]) {
    for (const group of rilCommandsIn(f.text)) assert.ok(known.has(group), `${f.file} names ril ${group}, which does not exist`);
  }
});

test('rilCommandsIn reads inline code and fenced blocks only', () => {
  const text = 'ril nope outside\n`ril stage get` and `ril-control` and `/ril`\n```\nril doctor --fix\n```\n';
  assert.deepEqual(rilCommandsIn(text).sort(), ['doctor', 'stage']);
});

test('a role starts by reading its rules and blocks without them; its tools are known and a judge cannot edit', () => {
  for (const r of roles()) {
    const first = firstLine(r.body);
    assert.ok(first.includes('rules'), `${r.file} first action does not read the rules`);
    assert.ok(first.includes('STATUS: blocked'), `${r.file} first action has no blocked reply`);
    assert.ok(r.body.trim().split('\n').length <= 15, `${r.file} body is over 15 lines`);
    const tools = r.frontmatter.tools.split(',').map((t) => t.trim());
    for (const t of tools) assert.ok(TOOLS.includes(t), `${r.file} lists unknown tool ${t}`);
    if (r.name === 'reviewer' || r.name === 'verifier') assert.ok(!tools.includes('Edit'), `${r.file} must not edit product source`);
  }
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

test('standing rules are at most 15 lines and principles at most 40', () => {
  assert.ok(readFile('templates/standing-rules.md').lines <= 15);
  assert.ok(readFile('principles.md').lines <= 40);
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

test('verify.md template starts "Trusted: no", so the kit is untrusted until its first line changes and a self-run exists', () => {
  const { text } = readFile('templates/verify.md');
  assert.equal(text.split('\n')[0], 'Trusted: no');
  const p = tmpProject();
  try {
    const kit = path.join(p.dir, '.ril', 'docs', 'verification');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(kit, 'verify.md'), text);
    assert.equal(kitTrust(p.dir), 'untrusted');
    fs.writeFileSync(path.join(kit, 'verify.md'), text.replace(/^Trusted: no$/m, 'Trusted: yes (abc1234)'));
    assert.equal(kitTrust(p.dir), 'unshown', 'the line alone is not enough');
    assert.equal(kitTrust(p.dir, [{ version: 'abc1234'.padEnd(40, '0'), kit: kitHash(p.dir) }]), 'trusted');
  } finally {
    p.cleanup();
  }
});

test('stop report and final report templates have their headings', () => {
  assert.deepEqual(headings(readFile('templates/stop-report.md').text), ['What works', 'What does not work yet', 'What was tried', 'Evidence', 'Your options']);
  assert.deepEqual(headings(readFile('templates/final-report.md').text), ['What was built', 'What works', 'What is not covered', 'Decisions made for you', 'How to run it']);
});
