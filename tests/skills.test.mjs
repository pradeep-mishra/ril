import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ril } from './helpers/ril.mjs';
import { tmpProject } from './helpers/tmp.mjs';
import { checkBrief } from '../lib/brief.mjs';
import {
  headings, helpGroups, readFile, readRole, readSkill, repoRoot, rilCommandsIn, roleNames, skillNames,
} from './helpers/skills.mjs';

const ROLES = ['author', 'tester', 'implementer', 'reviewer', 'verifier', 'fixer'];
const PARTS = ['Outcome', 'Rules', 'Done when', 'Involve the person when', 'Ask the CLI'];
const TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'];
const OWNER = { author: 'ril-shape', tester: 'ril-build', implementer: 'ril-build', reviewer: 'ril-review', verifier: 'ril-verify', fixer: 'ril-verify' };
const DIRECTION = ['principles.md', 'templates/standing-rules.md', 'templates/agent-brief.md', 'templates/agent-report.md', 'templates/spec.md', 'templates/project-brief.md'];

const skills = () => skillNames().map((name) => ({ name, ...readSkill(name) }));
const roles = () => roleNames().map((name) => ({ name, ...readRole(name) }));
const tools = (role) => role.frontmatter.tools.split(',').map((t) => t.trim());
const firstLine = (body) => body.split('\n').find((l) => l.trim() && !l.startsWith('#'));

test('the six roles and the two first skills exist', () => {
  assert.deepEqual(roleNames().sort(), [...ROLES].sort());
  for (const name of ['ril', 'ril-control']) assert.ok(skillNames().includes(name), name);
  assert.ok(!fs.existsSync(path.join(repoRoot, 'commands')), 'no commands/ folder: the ril skill gives /ril');
});

test('every skill and role has valid frontmatter', () => {
  for (const s of [...skills(), ...roles()]) {
    assert.equal(s.frontmatter.name, s.name, s.file);
    assert.ok(s.frontmatter.description, `${s.file} has no description`);
  }
});

test('five-part structure', () => {
  for (const s of skills().filter((x) => x.name !== 'ril-control')) assert.deepEqual(headings(s.body), PARTS, s.file);
});

test('every ril command mentioned exists', () => {
  const known = new Set(helpGroups());
  const files = [...skills(), ...roles(), ...DIRECTION.map(readFile)];
  for (const f of files) {
    for (const group of rilCommandsIn(f.text)) assert.ok(known.has(group), `${f.file} mentions ril ${group}, which does not exist`);
  }
});

test('rilCommandsIn reads inline code and fenced blocks only', () => {
  const text = 'ril nope outside\n`ril stage get` and `ril-control` and `/ril`\n```\nril doctor --fix\n```\n';
  assert.deepEqual(rilCommandsIn(text).sort(), ['doctor', 'stage']);
});

test('role files start by reading rules and block when missing', () => {
  for (const r of roles()) {
    const first = firstLine(r.body);
    assert.match(first, /rules/, r.file);
    assert.match(first, /STATUS: blocked/, r.file);
    assert.ok(r.body.trim().split('\n').length <= 15, `${r.file} body is over 15 lines`);
    assert.ok(r.body.includes(OWNER[r.name]), `${r.file} does not name ${OWNER[r.name]}`);
  }
  assert.ok(readRole('author').body.includes('ril-design'));
});

test('role tools and models', () => {
  for (const r of roles()) {
    for (const t of tools(r)) assert.ok(TOOLS.includes(t), `${r.file} lists unknown tool ${t}`);
    const strong = r.name === 'reviewer' || r.name === 'verifier';
    assert.equal(r.frontmatter.model, strong ? 'opus' : undefined, r.file);
    if (strong) assert.ok(!tools(r).includes('Edit'), `${r.file} must not edit product source`);
  }
  assert.match(readRole('tester').body, /never read the implementation/i);
});

test('brief template has the ten fields in order', () => {
  const { text } = readFile('templates/agent-brief.md');
  const fields = [...text.matchAll(/^([a-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(fields, ['role', 'unit', 'goal', 'inputs', 'acceptance', 'touch', 'rules', 'ril', 'report', 'stop']);
  assert.match(text, /at most 60 lines/);
  assert.match(text, /^report: agent-report$/m);
});

test('brief template, comment dropped and filled, passes the brief check', () => {
  const filled = readFile('templates/agent-brief.md').text
    .split('\n').slice(1).join('\n')
    .replace('<author|tester|implementer|reviewer|verifier|fixer>', 'author')
    .replaceAll('<plugin folder>', repoRoot)
    .replace(/<[^>\n]+>/g, (p) => (p.includes('absolute path') ? '/abs/x.md' : 'filled'));
  assert.deepEqual(checkBrief(filled, 'author').problems, []);
});

test('agent-report has the four keys', () => {
  const { text } = readFile('templates/agent-report.md');
  const keys = [...text.matchAll(/^([A-Z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ['STATUS', 'RESULT', 'EVIDENCE', 'NEXT']);
  assert.match(text, /^STATUS: done\|failed\|blocked$/m);
  assert.match(text, /^- <path>$/m);
});

test('standing rules: at most 15 lines, ten rules, rules first', () => {
  const f = readFile('templates/standing-rules.md');
  assert.ok(f.lines <= 15, `${f.lines} lines`);
  assert.equal([...f.text.matchAll(/^\d+\. /gm)].length, 10);
  assert.match(f.text, /^1\. Read this file and `principles.md` first; if either is missing reply `STATUS: blocked`\./m);
  assert.match(f.text, /the verifier alone records a verdict/);
});

test('principles.md has 10 numbered items and at most 40 lines', () => {
  const f = readFile('principles.md');
  assert.ok(f.lines <= 40, `${f.lines} lines`);
  assert.deepEqual([...f.text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(f.text, /Never lower a pass condition to get a pass\./);
});

test('ril-control refuses roles outside the six', () => {
  const { body } = readSkill('ril-control');
  const line = /Refuse any role outside ([^.]+)\./.exec(body);
  assert.ok(line, 'no refuse-roles rule');
  assert.deepEqual(line[1].split(/,\s*|\s+and\s+|,?\s+or\s+/).map((s) => s.trim()).sort(), [...ROLES].sort());
});

test('ril-control keeps the retry, parallel and always-a-result rules', () => {
  const { body } = readSkill('ril-control');
  assert.match(body, /You are the only agent that changes project state\./);
  assert.match(body, /Retry by how it failed: a cap hit or out-of-memory gets a smaller scope/);
  assert.match(body, /after two retries park the unit and replan around it/);
  assert.match(body, /Tasks run in parallel only when their `touch` sets are disjoint/);
  assert.match(body, /merge one at a time and run the tests after each merge/);
  assert.match(body, /--state done --result "/);
  assert.match(body, /--state failed --result "/);
  assert.match(body, /`ril root`/);
});

test('front door handles a missing ril, in all four cases', () => {
  const { body } = readSkill('ril');
  assert.match(body, /If `ril` cannot be run/);
  assert.match(body, /and stop/);
  assert.match(body, /Node\.js is missing/, 'node missing');
  assert.match(body, /`ril` is not found/, 'not found');
  assert.match(body, /ahead of this one on your PATH/, 'shadowed on PATH');
  assert.match(body, /chmod \+x/, 'not executable');
  assert.match(body, /There is no ril project[^\n]*is not a missing `ril`/, 'no project is not a missing ril');
});

test('front door: no project starts ril-shape before any doctor, never spawns', () => {
  const { body } = readSkill('ril');
  const shape = body.indexOf('No `.ril/` folder: start `ril-shape` (it runs `ril init` once it knows the mode); do not run doctor first.');
  const doctor = body.indexOf('Otherwise run `ril doctor --fix --quiet`');
  assert.ok(shape >= 0 && doctor > shape, 'the no-project rule must come before the doctor rule');
  assert.doesNotMatch(body, /run `ril init` \(do not run doctor first\)/, 'the front door no longer runs init itself');
  assert.match(body, /Never spawn an agent yourself/);
});

test('front door: skip, resume, confirm and catch-up details', () => {
  const { body } = readSkill('ril');
  assert.match(body, /`ril unit list` and `ril scenario list`/);
  assert.match(body, /`--unit` or `--scenario`/);
  assert.match(body, /Paused \(it was in the X stage\)/);
  assert.match(body, /`ril progress "Caught the person up\."`/);
  assert.match(body, /newer than the last/);
  assert.match(body, /summarise `\.ril\/docs\/brief\.md` in plain words and tell them where to read it/);
});

test('standing rules let workers write their touch paths', () => {
  const { text } = readFile('templates/standing-rules.md');
  assert.match(text, /^3\. Never edit `\.ril\/state\.json`, its backups, the lock or the log/m);
  assert.match(text, /Write only your own report and the paths in your brief's `touch` list/);
  assert.doesNotMatch(text, /Never change anything under `\.ril\/`/);
});

test('ril-control: touch paths, report format, spawn failure, gate flags', () => {
  const { body } = readSkill('ril-control');
  assert.match(body, /document path or evidence folder[^\n]*`touch`/);
  assert.match(body, /templates\/agent-report\.md[^\n]*`inputs`/);
  assert.match(body, /--result "could not start"/);
  assert.match(body, /back to `todo`/);
  assert.match(body, /`ril gate park <id> --question "[^`]*" --options [^`]* --default [^`]*`/);
  assert.match(body, /\*\*The person\.\*\* Whenever you involve the person, speak in plain words, one question at a time/);
  assert.match(body, /Never review a diff yourself/);
  assert.match(body, /never resume/);
});

test('failed means could not do the job; findings and failed verdicts go to a fix round', () => {
  const control = readSkill('ril-control').body;
  assert.match(control, /`STATUS: failed` means the worker could not do its job/);
  assert.match(control, /must-fix findings and a verifier's failed verdict go to the owning skill's fix round, never to a retry/);
  assert.match(readRole('reviewer').body, /`STATUS: done` with the findings in RESULT/);
  assert.match(readRole('verifier').body, /`STATUS: done` with the verdict in RESULT/);
  for (const r of roles()) {
    assert.match(r.body, /`STATUS: failed` only if you could not/, r.file);
    assert.match(r.body, /agent-report file in your inputs/, r.file);
  }
  assert.match(readRole('verifier').body, /`--review` comes from the reviewer's report in your `inputs`/);
});

test('front door reconciles first and catches the person up', () => {
  const { body } = readSkill('ril');
  for (const phrase of ['doctor --fix --quiet', '--new-session', 'Decisions I made for you', 'more simply', 'what happens next', 'saved version']) {
    assert.ok(body.includes(phrase), phrase);
  }
  for (const stage of ['shape', 'design', 'confirm', 'build', 'accept', 'done', 'parked']) assert.match(body, new RegExp(`\\| ${stage} \\|`), stage);
});

test('spec template imports clean', () => {
  const p = tmpProject();
  try {
    assert.equal(ril(p.dir, 'init').code, 0);
    const r = ril(p.dir, 'scenario', 'import', path.join(repoRoot, 'templates', 'spec.md'), '--check');
    assert.equal(r.code, 0, r.stdout + r.stderr);
  } finally {
    p.cleanup();
  }
});

const STAGE_SKILLS = ['ril-shape', 'ril-design', 'ril-review'];
const has = (body, phrases, file) => { for (const p of phrases) assert.ok(body.includes(p), `${file} lacks: ${p}`); };

test('the three stage skills exist, within 120 lines, with the five parts', () => {
  for (const name of STAGE_SKILLS) {
    assert.ok(skillNames().includes(name), name);
    const s = readSkill(name);
    assert.ok(s.lines <= 120, `${s.file} has ${s.lines} lines`);
    assert.deepEqual(headings(s.body), PARTS, s.file);
  }
  assert.ok(skillNames().length <= 8, 'at most 8 skills');
});

test('ril-shape: asks the mode before init, command-line only, provable spec', () => {
  const { body, file } = readSkill('ril-shape');
  has(body, ['my assumption', 'Needs a person', '## Later', 'one question at a time', 'play the idea back', 'what is wrong',
    'simplest stack', 'observe it instead', '`ril scenario import .ril/docs/spec.md`', '`Criterion:`', '`Proof: cli`',
    'ui, api, cli and golden', '.ril/docs/intake.md', '`ril-review`', '`ril-control`', 'install it for you, or guide you step by step',
    'trust this folder', '`ril stage set design`'], file);
  has(body, ['`ril preflight ${CLAUDE_PLUGIN_ROOT}/recipes/cli`', '`ril allowlist write --base --tool claude`',
    '`ril allowlist write --recipe ${CLAUDE_PLUGIN_ROOT}/recipes/cli --tool claude`'], file);
  for (const cmd of ['init', 'scenario', 'gate', 'decision', 'preflight', 'allowlist', 'progress', 'stage']) {
    assert.ok(rilCommandsIn(body).includes(cmd), `${file} never mentions ril ${cmd}`);
  }
  const mode = body.indexOf('Ask the mode');
  const init = body.indexOf('`ril init --mode');
  assert.ok(mode >= 0 && init > mode, 'the mode is asked before ril init runs');
  assert.match(body, /Autonomous[^\n]*default/);
  assert.match(body, /Guided/);
  assert.match(body, /command-line programs only/);
  assert.match(body, /web page, a phone app or a desktop window/);
  assert.match(body, /stop there/);
  assert.doesNotMatch(body, /Proof:\s*human/i, 'never a human proof');
  assert.match(body, /target and stack[^\n]*spec|spec[^\n]*target and stack/i, 'guided sign-offs');
});

test('ril-design: simple design, red flags, proof kit first, plans and the brief', () => {
  const { body, file } = readSkill('ril-design');
  has(body, ['walking skeleton', 'vertical slice', 'proves exactly one scenario', '`ril scenario coverage`', 'simplicity budget',
    'bug would cost the most', 'at most three', 'property-based or generated-input', 'Security and non-functional',
    'shallow module', 'one decision leaked into several modules', 'two modules writing the same state', 'two ways to do one task',
    'internals other code can import', 'a list kept by hand in two places', 'linter, type check, formatter', '`verify` command',
    'how many it ran', '`ril-recipe`', 'before any code', '`ril unit add plan-<n> --kind plan', 'one agent', '`ril-review`',
    'Accepted as unproven: <id>', '`ril scenario update', 'templates/project-brief.md', '.ril/docs/brief.md', '`author`'], file);
  const brief = body.indexOf('templates/project-brief.md');
  const confirm = body.indexOf('`ril stage set confirm`');
  assert.ok(brief >= 0 && confirm > brief, 'the brief is written before the stage moves to confirm');
  assert.match(body, /rewrite it\|accept it unproven\|drop it/);
  assert.match(body, /design[^\n]*plan list/i, 'guided sign-offs');
});

test('ril-review: only the artifact and the spec, triage in RESULT, round caps', () => {
  const { body, file } = readSkill('ril-review');
  has(body, ['only the artifact and the spec', 'never the author', 'must-fix', 'noted', 'RESULT', 'not STATUS', '`STATUS: done`',
    'fresh `author`', 'never a resumed one', 'fresh reviewer', 'at most 2 rounds', 'at most 3 rounds', 'never invent',
    'Accepted risk for <id or artifact>', '`ril decision log', 'plainly', '`ril-control`'], file);
  assert.match(body, /missing cases, contradictions, needless complexity, security/);
});

test('project brief template: one page, plain, links and the go line', () => {
  const f = readFile('templates/project-brief.md');
  assert.ok(f.lines <= 30, `${f.lines} lines`);
  has(f.text, ['(spec.md)', '(design.md)', '(plans/plan-1.md)', 'My assumptions', 'What it will not do', 'What I need from you',
    'Where it runs and what it is built with', 'Reply **go** to start building, or tell me what to change.'], f.file);
});

test('carried fixes: verifier review none, spawn reset only for units, absolute evidence touch', () => {
  assert.match(readRole('verifier').body, /no reviewer report[^\n]*`--review none`[^\n]*refuse/);
  const control = readSkill('ril-control').body;
  assert.match(control, /back to `todo`[^\n]*only when the unit is a plan or task/);
  assert.match(control, /`<project>\/\.ril\/evidence\/<scenario>\/<checkpoint>\/`/);
  assert.doesNotMatch(control, /verifier, `\.ril\/evidence/);
  const door = readSkill('ril').body;
  assert.match(door, /There is no ril project[^\n]*start `ril-shape`/);
});

// Names of other tools RIL must never mention, encoded so this file does not mention them either.
const FORBIDDEN = ['cHN0YWNr', 'cG90ZXRv', 'c3VwZXJwb3dlcnM='].map((b) => Buffer.from(b, 'base64').toString());

test('no file names another plugin', () => {
  const files = [...skills(), ...roles(), ...DIRECTION.map(readFile), readFile('tests/skills.test.mjs'), readFile('tests/helpers/skills.mjs')];
  for (const f of files) {
    for (const name of FORBIDDEN) assert.ok(!f.text.toLowerCase().includes(name), `${f.file} names another plugin`);
  }
});
