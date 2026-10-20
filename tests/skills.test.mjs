import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ril } from './helpers/ril.mjs';
import { tmpProject } from './helpers/tmp.mjs';
import { checkBrief } from '../lib/brief.mjs';
import { kitTrust } from '../lib/proof.mjs';
import {
  headings, helpGroups, readFile, readRole, readSkill, repoRoot, rilCommandsIn, roleNames, skillNames,
} from './helpers/skills.mjs';

const ROLES = ['author', 'tester', 'implementer', 'reviewer', 'verifier', 'fixer'];
const PARTS = ['Outcome', 'Rules', 'Done when', 'Involve the person when', 'Ask the CLI'];
const TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'];
const OWNER = { author: 'ril-shape', tester: 'ril-build', implementer: 'ril-build', reviewer: 'ril-review', verifier: 'ril-verify', fixer: 'ril-verify' };
const DIRECTION = ['principles.md', 'templates/standing-rules.md', 'templates/agent-brief.md', 'templates/agent-report.md', 'templates/spec.md', 'templates/project-brief.md',
  'templates/feature-map.md', 'templates/stop-report.md', 'templates/verify.md'];

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
  assert.match(f.text, /^8\. Never edit the acceptance tests or the verify command's entries unless your brief is the tester's; write only what your `touch` lists\.$/m);
  assert.doesNotMatch(f.text, /proof kit/, 'kit documents are not protected; touch decides who writes them');
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
  assert.match(body, /Tasks run in parallel only when their `touch` sets are disjoint, otherwise one at a time\./);
  assert.ok(!body.includes('worktree'), 'ril-control names no worktrees');
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

const MODE_LOOKUP = 'the mode is on the first line of `ril status --full`';
const GUIDED_CHANGE = 'On "change it", a fresh `author` makes the change';
const LIGHT = 'must-fix only for a contradiction, an unprovable criterion or a missing case; everything else is noted; invent no risks';
const FULL = 'edge inputs, misuse, empty state, repeated actions, interruption, security, needless complexity';

test('ril-shape: asks the mode before init, command-line only, provable spec', () => {
  const { body, file } = readSkill('ril-shape');
  has(body, ['my assumption', 'Needs a person', '## Later', 'one question at a time', '`ril scenario import .ril/docs/spec.md`',
    '`Criterion:`', '`Proof: cli`', 'ui, api, cli and golden', '.ril/docs/intake.md', '`ril-review`', '`ril-control`',
    'install it for you, or guide you step by step', '`ril stage set design`'], file);
  has(body, ['`ril preflight ${CLAUDE_PLUGIN_ROOT}/recipes/cli`',
    '`ril allowlist write --recipe ${CLAUDE_PLUGIN_ROOT}/recipes/cli --tool claude`'], file);
  for (const cmd of ['init', 'scenario', 'gate', 'decision', 'preflight', 'allowlist', 'progress', 'stage']) {
    assert.ok(rilCommandsIn(body).includes(cmd), `${file} never mentions ril ${cmd}`);
  }
  const mode = body.indexOf('Ask the mode');
  const init = body.indexOf('`ril init --mode');
  assert.ok(mode >= 0 && init > mode, 'the mode is asked before ril init runs');
  assert.match(body, /Autonomous[^\n]*default/);
  assert.match(body, /what it should do, how it is put together, and the order I build it in/);
  assert.match(body, /command-line programs only/);
  assert.match(body, /web page, a phone app or a desktop window/);
  assert.match(body, /stop there/);
  assert.match(body, /the next \/ril resumes in shape/);
  assert.doesNotMatch(body, /Proof:\s*human/i, 'never a human proof');
});

test('ril-shape: wrong folder stops before init; base allowlist before the first spawn', () => {
  const { body } = readSkill('ril-shape');
  const folder = body.indexOf('open a new session in it and type /ril, then stop');
  const init = body.indexOf('`ril init --mode');
  assert.ok(folder >= 0 && folder < init, 'the folder check comes before init');
  const base = body.indexOf('`ril allowlist write --base --tool claude`');
  const trust = body.indexOf('trust this folder');
  const spawn = body.indexOf('Spawn an `author`');
  assert.ok(init >= 0 && base > init, 'base allowlist after init');
  assert.ok(trust > base && spawn > trust, 'trust message after the base allowlist, both before the first spawn');
  assert.ok(base < body.indexOf('**The interview'), 'base allowlist before the intake');
});

test('stage skills read the mode from ril status --full', () => {
  for (const name of STAGE_SKILLS) assert.ok(readSkill(name).body.includes(MODE_LOOKUP), name);
});

test('guided change: a fresh author, a light review again, the controller never edits the spec', () => {
  const shape = readSkill('ril-shape').body;
  has(shape, [GUIDED_CHANGE, 'reviewed again at the light level', 'never edits the spec itself', 'does not ask again'], 'ril-shape');
  assert.ok(readSkill('ril-design').body.includes(GUIDED_CHANGE), 'ril-design');
});

test('ril-design: simple design, red flags, proof kit first, plans and the brief', () => {
  const { body, file } = readSkill('ril-design');
  has(body, ['walking skeleton', 'vertical slice', 'proves exactly one scenario', '`ril scenario coverage`', 'simplicity budget',
    'bug would cost the most', 'at most three', 'property-based or generated-input', 'Security and non-functional',
    'shallow module', 'one decision leaked into several modules', 'two modules writing the same state', 'two ways to do one task',
    'internals other code can import', 'a list kept by hand in two places', 'linter, type check, formatter', '`verify` command',
    'how many it ran', '`ril-recipe`', 'before any code', '`ril unit add plan-<n> --kind plan', 'one agent', '`ril-review`',
    'Accepted as unproven: <id>', '`ril scenario update', 'templates/project-brief.md', '<project>/.ril/docs/brief.md', '`author`'], file);
  const brief = body.indexOf('templates/project-brief.md');
  const confirm = body.indexOf('`ril stage set confirm`');
  assert.ok(brief >= 0 && confirm > brief, 'the brief is written before the stage moves to confirm');
  assert.match(body, /rewrite it\|accept it unproven\|drop it/);
  assert.match(body, /The brief itself is reviewed by `ril-review` at the light level/);
  assert.match(body, /every accepted risk and every criterion accepted as unproven/);
});

test('ril-design: a set-aside scenario still gets a feature map, never ril-recipe again', () => {
  const { body } = readSkill('ril-design');
  assert.match(body, /after `ril skip <id> --scenario[^\n]*feature map[^\n]*`Method: <its method>`[^\n]*set aside and why/);
  assert.match(body, /never run `ril-recipe` again for a set-aside scenario/i);
});

test('ril-review: only the artifact and the spec, triage in RESULT, two levels, round caps', () => {
  const { body, file } = readSkill('ril-review');
  has(body, ['only the artifact and the spec', 'never the author', 'must-fix', 'noted', 'RESULT', 'not STATUS', '`STATUS: done`',
    'fresh `author`', 'never a resumed one', 'fresh reviewer', 'at most 2 rounds', 'at most 3 rounds',
    'Accepted risk for <id or artifact>', '`ril decision log', 'plainly', '`ril-control`', '`<project>/.ril/docs/spec.md`',
    'the fix author gets the intake in the spec\'s place', '`--stage` is the current stage from `ril stage get`'], file);
  assert.doesNotMatch(body, /\(`\.ril\/docs\//, 'project paths are absolute');
  assert.match(body, new RegExp(`LIGHT, for a spec, design or plan[^\\n]*${LIGHT.replace(/[;]/g, '.')}`));
  assert.match(body, new RegExp(`FULL, for built code and the running program[^\\n]*${FULL}`));
});

test('project brief template: one page, plain, links, accepted risks and the go line', () => {
  const f = readFile('templates/project-brief.md');
  assert.ok(f.lines <= 30, `${f.lines} lines`);
  has(f.text, ['(spec.md)', '(design.md)', '(plans/plan-1.md)', 'My assumptions', 'What it will not do', 'What I need from you',
    'Where it runs and what it is built with', 'Reply **go** to start building, or tell me what to change.'], f.file);
  const need = f.text.slice(f.text.indexOf('## What I need from you'), f.text.indexOf('## Where to read more'));
  assert.match(need, /risk accepted at a review cap/);
  assert.match(need, /accepted as unproven/);
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

const ALL_SKILLS = ['ril', 'ril-control', 'ril-shape', 'ril-design', 'ril-review', 'ril-recipe', 'ril-build', 'ril-verify'];
const LAST_SKILLS = ['ril-recipe', 'ril-build', 'ril-verify'];
const at = (body, phrase) => {
  const i = body.indexOf(phrase);
  assert.ok(i >= 0, `missing: ${phrase}`);
  return i;
};

test('exactly the eight skills; the last three within 120 lines, with the five parts', () => {
  assert.deepEqual(skillNames().sort(), [...ALL_SKILLS].sort());
  for (const name of LAST_SKILLS) {
    const s = readSkill(name);
    assert.ok(s.lines <= 120, `${s.file} has ${s.lines} lines`);
    assert.deepEqual(headings(s.body), PARTS, s.file);
  }
});

test('ril-recipe: an untrusted kit with protected paths, a doctor and a self-run that must catch a break', () => {
  const { body, file } = readSkill('ril-recipe');
  has(body, ['`Trusted: no`', '`Protected:`', '`## Doctor`', '`## Self-run`', 'deliberate break', 'real UI proof', '`Method:',
    '`Covers:`', '`Synced at:`', 'templates/feature-map.md', 'templates/verify.md', 'recipes/cli/recipe.md', 'how many checks it ran',
    'drift', '`ril scenario coverage`'], file);
  assert.match(body, /never weaken/i);
  assert.match(body, /only prove command-line/);
  assert.match(body, /never invent a recipe/i);
  const gate = /`ril gate park [^`]*--options "rewrite it\|accept it unproven\|drop it"[^`]*`/.exec(body);
  assert.ok(gate, 'a scenario this version cannot prove is parked as a question for the person');
  for (const cmd of ['scenario', 'gate', 'preflight', 'allowlist']) assert.ok(rilCommandsIn(body).includes(cmd), `${file} never mentions ril ${cmd}`);
});

test('feature map template: Method first, then Covers and Synced at, then the four parts', () => {
  const f = readFile('templates/feature-map.md');
  const lines = f.text.split('\n');
  assert.match(lines[0], /^Method: /);
  assert.match(lines[1], /^Covers: /);
  assert.match(lines[2], /^Synced at: /);
  assert.deepEqual(headings(f.text), ['Sub-features', 'How to get to it', 'Driving it', 'Gotchas']);
});

test('a filled feature map passes ril scenario coverage', () => {
  const p = tmpProject();
  try {
    assert.equal(ril(p.dir, 'init').code, 0);
    const add = ril(p.dir, 'scenario', 'add', 'S1', '--title', 'Greets', '--method', 'cli', '--criterion', 'hello prints hi');
    assert.equal(add.code, 0, add.stdout + add.stderr);
    assert.equal(ril(p.dir, 'scenario', 'coverage').code, 2, 'no map yet');
    const filled = readFile('templates/feature-map.md').text.replace(/^Method: <[^>\n]+>/, 'Method: cli').replace(/<[^>\n]+>/g, 'filled');
    const folder = path.join(p.dir, '.ril', 'docs', 'verification', 'feature-map');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'S1.md'), filled);
    const r = ril(p.dir, 'scenario', 'coverage');
    assert.equal(r.code, 0, r.stdout + r.stderr);
  } finally {
    p.cleanup();
  }
});

test('verify.md template: untrusted until the self-run, protected paths, the six parts', () => {
  const f = readFile('templates/verify.md');
  assert.ok(f.lines <= 40, `${f.lines} lines`);
  const lines = f.text.split('\n');
  assert.equal(lines[0], 'Trusted: no');
  const prot = lines.find((l) => l.startsWith('Protected: '));
  assert.ok(prot, 'a Protected: line');
  assert.doesNotMatch(prot, /\.ril\/docs\/verification/, 'the kit documents are not protected');
  has(prot, ['tests/acceptance/', 'scripts.verify', 'scripts.test'], 'Protected:');
  assert.doesNotMatch(prot, /package\.json(?!\s+scripts\.)/, 'only two keys of package.json, never the whole file');
  const drive = f.text.slice(f.text.indexOf('## Drive'), f.text.indexOf('## Evidence'));
  has(drive, ['tests/acceptance/', 'tests/regression/', 'how many checks it ran'], 'Drive');
  assert.deepEqual(headings(f.text), ['Launch', 'Drive', 'Evidence', 'Cleanup', 'Doctor', 'Self-run']);
  const selfRun = f.text.slice(f.text.indexOf('## Self-run'));
  has(selfRun, ['deliberate break', 'undo', 'cleanup', 'Trusted: yes (<saved version>)'], 'Self-run');
  assert.match(f.text.slice(f.text.indexOf('## Doctor'), f.text.indexOf('## Self-run')), /checks/);
});

test('verify.md template, as written, keeps the kit untrusted until its first line changes', () => {
  const p = tmpProject();
  try {
    const kit = path.join(p.dir, '.ril', 'docs', 'verification');
    fs.mkdirSync(kit, { recursive: true });
    const text = readFile('templates/verify.md').text;
    fs.writeFileSync(path.join(kit, 'verify.md'), text);
    assert.equal(kitTrust(p.dir), 'untrusted');
    fs.writeFileSync(path.join(kit, 'verify.md'), text.replace(/^Trusted: no$/m, 'Trusted: yes (abc1234)'));
    assert.equal(kitTrust(p.dir), 'trusted');
  } finally {
    p.cleanup();
  }
});

test('stop report template: the five parts and the four options', () => {
  const f = readFile('templates/stop-report.md');
  assert.deepEqual(headings(f.text), ['What works', 'What does not work yet', 'What was tried', 'Evidence', 'Your options']);
  const options = f.text.slice(f.text.indexOf('## Your options'));
  has(options, ['simplify the scenario', 'change the approach', 'give a hint', 'stop'], 'Your options');
});

test('ril-build: tasks file, a pilot first, tester then implementer, honest tests, protected paths, full review', () => {
  const { body, file } = readSkill('ril-build');
  has(body, ['<project>/.ril/docs/plans/plan-<n>-tasks.md', 'pilot', 'fresh', 'disjoint', '`Protected:`', '`ril-control`',
    'an expected value computed by the code under test', 'an assertion on data the test built itself',
    'an assertion looser than the contract', 'no positive case', 'fail when the behavior breaks', 'only internals change',
    'plan-<n>-t<k>', '`ril unit set', '`ril checkpoint`', 'FULL'], file);
  assert.match(body, /never sees the implementation/);
  assert.ok(at(body, '`tester`') < at(body, '`implementer`'), 'the tester comes before the implementer');
  const review = at(body, '`ril-review`');
  assert.ok(review < body.lastIndexOf('`ril-verify`'), 'review before verification');
  assert.match(body, /pilot[^\n]*before any other task starts/);
  assert.match(body, /T1[^\n]*tester[^\n]*`\.gitignore`[^\n]*node_modules/);
  for (const cmd of ['unit', 'agent', 'checkpoint', 'progress']) assert.ok(rilCommandsIn(body).includes(cmd), `${file} never mentions ril ${cmd}`);
});

test('ril-verify: layers, reviewer first, verdicts, the fix loop and the stop report', () => {
  const { body, file } = readSkill('ril-verify');
  has(body, ['Layer 1 tests', 'Layer 2 live proof', 'Layer 3 adversarial review', 'Layer 4 break-it pass', '`Self-run`', 'Trusted: yes',
    '`ril ledger record', '--checks', 'RESULT', '`ril round bump', 'prototype', 'stop-', 'templates/stop-report.md', '`Protected:`', 'measured, inferred or guess',
    'expected, actual', 'assumption', 'Autonomous mode'], file);
  assert.match(body, /never lower a pass condition/i);
  assert.match(body, /`blocked`[^\n]*`ril doctor`[^\n]*never to a fixer/);
  assert.match(body, /reject zero/);
  const reviewer = at(body, 'Reviewer first');
  const verifier = at(body, 'Then the verifiers');
  assert.ok(reviewer < verifier, 'the reviewer runs before the verifiers');
  assert.match(body.slice(verifier), /reviewer's report[^\n]*`inputs`/);
  assert.match(body, /set aside[^\n]*never try to prove/i);
  for (const cmd of ['ledger', 'round', 'agent', 'scenario', 'skip', 'decision', 'checkpoint', 'stage']) {
    assert.ok(rilCommandsIn(body).includes(cmd), `${file} never mentions ril ${cmd}`);
  }
});

test('ril-verify accept mode: fresh verifier, traceability, scans, guide, final report, then done', () => {
  const { body, file } = readSkill('ril-verify');
  const accept = body.slice(at(body, '**Accept mode'));
  has(accept, ['fresh', 'traceability', 'secrets', 'README', 'how-to-use', "person's machine", '<project>/.ril/docs/reports/final.md',
    'What is not covered', 'accepted without proof', '`ril decision list`', '`ril ledger carry', '`ril scenario list`', '`ril ledger summary`'], file);
  assert.ok(at(accept, 'final.md') < at(accept, '`ril stage set done`'), 'the final report before done');
  const done = at(accept, '`ril stage set done`');
  const carry = at(accept, '`ril ledger carry');
  assert.ok(accept.lastIndexOf('`ril checkpoint`', carry) > at(accept, 'final.md') && carry < done, 'checkpoint, then carry, then done');
  assert.match(accept, /one fresh verifier per scenario/);
  has(accept, ['`git grep', 'audit'], file);
});

const PROTECTED_CHECK = /Every saved version since the plan's start that changed a `Protected:` path must be a `Tester version`: run `git log --format='%h %s' <plan start>\.\.<[^>]+> -- <Protected paths>`[^\n]*every subject must start `Tester version`, except a version that a later `Tester version restoring <id>` message names as restored/;

test('protected set: acceptance tests and the verify entries only; kit documents follow touch', () => {
  for (const name of LAST_SKILLS) assert.doesNotMatch(readSkill(name).body, /`Protected:`[^\n]{0,80}\.ril\/docs\/verification/, name);
  const recipe = readSkill('ril-recipe').body;
  has(recipe, ['tests/acceptance/', '`scripts.verify`', '`scripts.test`'], 'ril-recipe');
  assert.match(recipe, /kit documents[^\n]*only by an author or verifier whose brief lists them in `touch`/i);
  const build = readSkill('ril-build').body;
  assert.match(build, /dependencies and `bin`[^\n]*implementer/);
  for (const name of ['ril-build', 'ril-verify']) has(readSkill(name).body, ['tests/regression/'], name);
});

test('tester versions: saved and stored on the task unit, and checked by the reviewer and the verifier', () => {
  const build = readSkill('ril-build').body;
  assert.match(build, /`ril checkpoint --message "Tester version for [^"]*"`/);
  assert.match(build, /`ril unit set plan-<n>-t<k> --checkpoint <id>`/);
  assert.match(build, /no implementer or fixer is running/);
  assert.match(build, PROTECTED_CHECK, 'the FULL reviewer checks the protected entries');
  const verify = readSkill('ril-verify').body;
  assert.match(verify.slice(at(verify, 'Then the verifiers')), PROTECTED_CHECK, 'the verifier checks the protected entries');
  assert.match(verify, /implementer or fixer change to a `Protected:` path fails the round/);
});

test('ril-verify: review per scenario, untrusted kit, one batch per round, no competing fixers', () => {
  const { body } = readSkill('ril-verify');
  assert.match(body, /`clean` when the reviewer's report has no open must-fix that affects this scenario/);
  assert.match(body, /`risks` when `Accepted risk for <this scenario's id>`/);
  assert.match(body, /otherwise `none`[^\n]*refuse/);
  assert.match(body, /Until then only `blocked` can be recorded/);
  assert.match(body, /one batch per round/i);
  assert.match(body, /collect them all, take one `ril checkpoint`/);
  assert.match(body, /a second `ril checkpoint`[^\n]*invalidates/);
  for (const gone of ['two fixers', 'worktree', 'competing fixers']) assert.ok(!body.includes(gone), `ril-verify still says ${gone}`);
  assert.match(body, /two failures with the same cause[^\n]*writes down its assumption and tests it/i);
  assert.match(body, /competing attempts are not used in this version/);
  assert.match(body, /back to `ril-build`/);
  assert.match(body, /simplify[^\n]*`ril-shape`/);
  assert.match(body, /change the approach[^\n]*`ril-design`/);
  assert.ok(!readSkill('ril-control').body.includes('compet'), 'ril-control has no competing-fixers exception');
  assert.ok(!readSkill('ril-build').body.includes('worktree'), 'ril-build names no worktrees');
});

test('ril-review: accepted risks carry each affected scenario id, never a plan id', () => {
  const { body } = readSkill('ril-review');
  assert.match(body, /built code and the running program[^\n]*one decision per affected scenario[^\n]*never a plan id/);
  assert.match(body, /`ril decision log --stage <stage> --decision "Accepted risk for S2: <finding>" --why "<reason>"`/);
  for (const name of ['ril-review', 'ril-verify', 'ril-build']) assert.ok(!readSkill(name).body.includes('each scenario it affects'), `${name} keeps single-decision wording`);
  assert.match(body, /must-fix names the scenario ids it affects/);
});

test('drift check: no verdict unless a real regression, which records failed and enters the fix loop', () => {
  const recipe = readSkill('ril-recipe').body;
  assert.match(recipe, /records no verdict unless[^\n]*real regression/);
  assert.match(recipe, /real regression[^\n]*`failed`[^\n]*fix loop/);
  const done = recipe.slice(at(recipe, '## Done when'), at(recipe, '## Involve the person when'));
  assert.match(done, /`Trusted: no`[^\n]*first writing/);
  assert.match(readRole('verifier').body, /Self-run or drift-check[^\n]*no verdict unless your brief says/);
});

test('concrete rules, not vague ones', () => {
  for (const name of LAST_SKILLS) {
    const { body } = readSkill(name);
    for (const vague of ['small enough for one agent', 'where the host supports', 'whatever scanners exist', 'installed inside the project only']) {
      assert.ok(!body.includes(vague), `${name} says: ${vague}`);
    }
  }
  assert.match(readSkill('ril-build').body, /at most 5 files in `Files:`/);
});

test('author role covers every document authors write, from its goal and touch', () => {
  const r = readRole('author');
  has(r.frontmatter.description, ['verify.md', 'feature map', 'README', 'how-to', 'final report', 'tasks', 'brief'], r.file);
  assert.match(r.body, /`goal`[^\n]*`touch`/);
});

test('protected check: a window from the plan start, restored only by a tester that names the violation', () => {
  const build = readSkill('ril-build').body;
  const verify = readSkill('ril-verify').body;
  for (const [name, body] of [['ril-build', build], ['ril-verify', verify]]) {
    assert.match(body, PROTECTED_CHECK, name);
    assert.match(body, /`Protected:` (?:must-fix|violation)[^\n]*fresh `tester`[^\n]*never a fixer/, name);
    assert.match(body, /`ril checkpoint --message "Tester version restoring <violating version id> for <task unit>"`/, name);
    for (const gone of ['newest tester version', 'resets the baseline', 'git diff --name-only <newest']) assert.ok(!body.includes(gone), `${name} still says ${gone}`);
  }
  assert.match(build, /`ril unit set plan-<n> --state doing --checkpoint <the id it printed>`/, 'the plan start is stored on the plan unit');
});

test('drift regression: fixed and verified within its own plan, then back to the new plan', () => {
  const rule = /regressed scenario's own plan[^\n]*(?:plan start|its start)[^\n]*task units[^\n]*verifiers run only for the regressed scenarios[^\n]*back to `ril-build` for plan/;
  assert.match(readSkill('ril-verify').body, rule);
  assert.match(readSkill('ril-recipe').body, rule);
});

test('protected set also covers the lifecycle scripts; T1 tester writes the .gitignore; implementer sees verify.md', () => {
  const prot = readFile('templates/verify.md').text.split('\n').find((l) => l.startsWith('Protected: '));
  for (const k of ['scripts.preverify', 'scripts.postverify', 'scripts.pretest', 'scripts.posttest']) {
    assert.ok(prot.includes(k), `template Protected lacks ${k}`);
    for (const name of ['ril-recipe', 'ril-build']) assert.ok(readSkill(name).body.includes(`\`${k}\``), `${name} lacks ${k}`);
  }
  const build = readSkill('ril-build').body;
  assert.match(build, /tester[^\n]*`touch`[^\n]*for T1 also `package\.json` and the project `\.gitignore`/);
  assert.match(build, /the implementer never writes `\.gitignore`/);
  assert.doesNotMatch(build, /`Files:` include the `\.gitignore`/);
  assert.match(build, /implementer[^\n]*`inputs`[^\n]*`<project>\/\.ril\/docs\/verification\/verify\.md`/);
  const outcome = build.slice(0, build.indexOf('## Rules'));
  assert.ok(!outcome.includes('proof kit'), 'the outcome names the protected entries, not the proof kit');
  assert.match(outcome, /acceptance tests and the verify command/);
});

test('ril-recipe: the author acceptance list is whole; kit documents rule is its own paragraph', () => {
  const { body } = readSkill('ril-recipe');
  const who = body.slice(body.indexOf('**Who writes the kit.**'), body.indexOf('**Kit documents**'));
  has(who, ['`## Self-run`', 'labelled measured, inferred or guess'], 'author acceptance');
  assert.match(body, /\n\n\*\*Kit documents\*\*/);
  assert.match(body, /regression in an earlier plan's scenario[^\n]*back to `ril-build` for plan/);
});

test('ril-verify: fix-loop verifiers also cover a regressed earlier scenario', () => {
  assert.match(readSkill('ril-verify').body, /one fresh verifier per scenario of the plan, at that saved version/);
});
