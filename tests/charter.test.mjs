import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The owner's charter in numbers. CHARTER.md states the targets; tests/charter-budget.json holds today's
// ceilings (at or above the targets) and each test below fails when a measured value is above its ceiling.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'charter-budget.json'), 'utf8'));

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.isFile() && e.name !== '.DS_Store' ? [full] : [];
  });
};
const lineCount = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
};
const sumLines = (files) => files.reduce((n, f) => n + lineCount(f), 0);

// Direction text is everything the model is told: skills, roles, templates and principles.md.
const directionFiles = (root) =>
  [...walk(path.join(root, 'skills')), ...walk(path.join(root, 'agents')), ...walk(path.join(root, 'templates')), path.join(root, 'principles.md')]
    .filter((f) => fs.existsSync(f));

// Language, framework, package-manager and project-type instructions that must not appear in direction text.
const BANNED = ['package.json', 'npm', 'node -e', 'node_modules', '.bin/', 'tarball', 'scripts.', 'tests/acceptance', 'tests/regression', 'Node.js',
  'JavaScript', 'TypeScript', 'Python', 'pip', 'cargo', 'go build', 'Xcode', 'React', 'command-line programs only', 'recipes/cli', 'proven-cli', 'Proof: cli'];
// Case-insensitive; a word boundary only where the term starts or ends with a word character.
const bannedPattern = (term) =>
  new RegExp(`${/^\w/.test(term) ? '\\b' : ''}${term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${/\w$/.test(term) ? '\\b' : ''}`, 'gi');
const bannedHits = (text) => BANNED.reduce((n, term) => n + (text.match(bannedPattern(term)) || []).length, 0);

// A prose pin is one call of assert.match, assert.doesNotMatch or a bare has(...) helper in tests/skills.test.mjs
// (`.has(` on a Set is not a pin). Every such call counts, because each pins wording of a skill, role or template.
const pinCount = (text) => (text.match(/assert\.(?:match|doesNotMatch)\(|(?<![\w.])has\(/g) || []).length;

const commandGroups = (root) => {
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'ril'), 'help', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `ril help --json failed: ${r.stderr}`);
  return JSON.parse(r.stdout).commands.length;
};

const measure = {
  skillCount: (root) => fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).length,
  directionWords: (root) => directionFiles(root).reduce((n, f) => n + fs.readFileSync(f, 'utf8').split(/\s+/).filter(Boolean).length, 0),
  bannedTermHits: (root) => directionFiles(root).reduce((n, f) => n + bannedHits(fs.readFileSync(f, 'utf8')), 0),
  prosePins: (root) => pinCount(fs.readFileSync(path.join(root, 'tests', 'skills.test.mjs'), 'utf8')),
  engineLines: (root) => sumLines([...walk(path.join(root, 'lib')), ...walk(path.join(root, 'bin'))]),
  commandGroups,
  testLines: (root) => sumLines(walk(path.join(root, 'tests')).filter((f) => f.endsWith('.mjs'))),
  agentCount: (root) => fs.readdirSync(path.join(root, 'agents')).filter((n) => n.endsWith('.md')).length,
};
const TARGETS = { skillCount: 1, directionWords: 5500, bannedTermHits: 0, prosePins: 0, engineLines: 2500, commandGroups: 18, testLines: 4000, agentCount: 1 };

// Returns the failure message when the measured value is above the ceiling, else null.
const overCeiling = (key, measured, ceiling) => (measured > ceiling ? `${key} is ${measured}, above its ceiling ${ceiling} (target ${TARGETS[key]})` : null);

test('the budget lists every key with a numeric ceiling and the charter target', () => {
  assert.deepEqual(Object.keys(budget).sort(), Object.keys(measure).sort());
  for (const [key, entry] of Object.entries(budget)) {
    assert.ok(Number.isInteger(entry.ceiling) && entry.ceiling >= 0, `${key} has no ceiling`);
    assert.equal(entry.target, TARGETS[key], `${key} target is the charter's number`);
  }
});

for (const key of Object.keys(measure)) {
  test(`ceiling: ${key}`, (t) => {
    const entry = budget[key];
    assert.ok(entry, `tests/charter-budget.json has no ${key}`);
    const measured = measure[key](repoRoot);
    t.diagnostic(`${key}: measured ${measured}, ceiling ${entry.ceiling}, target ${entry.target}${measured > entry.target ? ` (${measured - entry.target} above target)` : ''}`);
    const failure = overCeiling(key, measured, entry.ceiling);
    assert.ok(failure === null, failure);
  });
}

test('CHARTER.md exists and is at most 40 lines', () => {
  const file = path.join(repoRoot, 'CHARTER.md');
  assert.ok(fs.existsSync(file), 'CHARTER.md is missing');
  assert.ok(lineCount(file) <= 40, `CHARTER.md has ${lineCount(file)} lines, limit is 40`);
});

test('no runtime dependencies in package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
    assert.equal(pkg[key], undefined, `package.json must not have a ${key} key`);
  }
  assert.equal(pkg.engines.node, '>=20.10');
});

test('line ends are LF everywhere except the CRLF fixture', () => {
  const attributes = fs.readFileSync(path.join(repoRoot, '.gitattributes'), 'utf8').split(/\r?\n/);
  assert.equal(attributes[0], '* text=auto eol=lf');
  assert.ok(attributes.includes('tests/fixtures/spec-crlf.md -text'), 'the CRLF fixture keeps its bytes');
});

test('every file under lib/ and bin/ is at most 300 lines, and there are at most 20 command files', () => {
  const big = [...walk(path.join(repoRoot, 'lib')), ...walk(path.join(repoRoot, 'bin'))].filter((f) => lineCount(f) > 300);
  assert.deepEqual(big.map((f) => path.relative(repoRoot, f)), [], 'files over 300 lines');
  const commands = fs.readdirSync(path.join(repoRoot, 'lib', 'commands')).filter((n) => n.endsWith('.mjs') && n !== 'index.mjs');
  assert.ok(commands.length <= 20, `lib/commands has ${commands.length} command files, limit is 20`);
});

// Names built from fragments so this file never contains them.
const FORBIDDEN = [['ps', 'tack'], ['pot', 'eto'], ['super', 'powers']].map((parts) => parts.join(''));
const namesIn = (text) => FORBIDDEN.filter((name) => text.toLowerCase().includes(name));
const SHIPPED = ['skills', 'agents', 'templates', 'recipes', 'principles.md', 'lib', 'bin', 'README.md', 'docs/decisions.md', 'CHARTER.md'];

test('no tracked shipped file names another plugin or product', () => {
  const r = spawnSync('git', ['ls-files', '-z', '--', ...SHIPPED], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ls-files failed: ${r.stderr}`);
  const files = r.stdout.split('\0').filter((f) => f && fs.existsSync(path.join(repoRoot, f)));
  assert.ok(files.length > 20, `only ${files.length} shipped files found`);
  const hits = files.map((f) => [f, namesIn(fs.readFileSync(path.join(repoRoot, f), 'utf8'))]).filter(([, names]) => names.length);
  assert.deepEqual(hits, []);
});

test('the checks can fail: ceilings, banned terms, prose pins, file sizes and names', () => {
  assert.equal(overCeiling('skillCount', 8, 8), null);
  assert.match(overCeiling('skillCount', 9, 8), /skillCount is 9, above its ceiling 8/);
  assert.equal(bannedHits('Run npm test, then NPM again; transcripts. keep scripts.test and pip, not pipeline.'), 4);
  assert.equal(bannedHits('uses node_modules/.bin/x and Node.js or JavaScript; a pipe, a react to it, go build'), 6);
  assert.equal(pinCount("assert.match(a, /x/);\nassert.doesNotMatch(a, /y/);\nhas(a, ['z'], 'f');\nknown.has(g);\nassert.ok(a);"), 3);
  assert.deepEqual(namesIn(`Built with ${FORBIDDEN[2].toUpperCase()}`), [FORBIDDEN[2]]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-charter-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'ril'), 'x\n'.repeat(301));
    assert.equal(lineCount(path.join(dir, 'bin', 'ril')), 301);
    assert.equal(measure.engineLines(dir), 301);
    fs.writeFileSync(path.join(dir, 'principles.md'), 'one two\nthree\n');
    assert.equal(measure.directionWords(dir), 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
