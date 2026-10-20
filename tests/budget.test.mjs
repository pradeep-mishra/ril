import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each check takes a repo root and returns { skip, violations }.
// skip is a message when the path under test does not exist yet.

function lineCount(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function dirEntries(dir, filter) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir, { withFileTypes: true }).filter(filter);
}

function mjsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mjsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

export function checkSkills(root) {
  const dirs = dirEntries(path.join(root, 'skills'), (e) => e.isDirectory());
  if (!dirs) return { skip: 'skills/ does not exist yet', violations: [] };
  const violations = [];
  if (dirs.length > 8) violations.push(`skills/ has ${dirs.length} skills, limit is 8`);
  for (const { name } of dirs) {
    const file = path.join(root, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const n = lineCount(file);
    if (n > 120) violations.push(`skills/${name}/SKILL.md has ${n} lines, limit is 120`);
  }
  return { violations };
}

export function checkRoles(root) {
  const roles = dirEntries(path.join(root, 'agents'), (e) => e.isFile() && e.name.endsWith('.md'));
  if (!roles) return { skip: 'agents/ does not exist yet', violations: [] };
  const violations = roles.length > 6 ? [`agents/ has ${roles.length} roles, limit is 6`] : [];
  return { violations };
}

export function checkCommands(root) {
  const commands = dirEntries(
    path.join(root, 'lib', 'commands'),
    (e) => e.isFile() && e.name.endsWith('.mjs') && e.name !== 'index.mjs',
  );
  if (!commands) return { skip: 'lib/commands/ does not exist yet', violations: [] };
  const violations = commands.length > 20 ? [`lib/commands/ has ${commands.length} commands, limit is 20`] : [];
  return { violations };
}

export function checkFileSize(root) {
  const libDir = path.join(root, 'lib');
  const binDir = path.join(root, 'bin');
  const hasLib = fs.existsSync(libDir);
  const hasBin = fs.existsSync(binDir);
  if (!hasLib && !hasBin) return { skip: 'neither lib/ nor bin/ exists yet', violations: [] };
  const files = [];
  if (hasLib) files.push(...mjsFiles(libDir));
  if (hasBin) {
    files.push(...mjsFiles(binDir));
    for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
      if (entry.isFile()) files.push(path.join(binDir, entry.name));
    }
  }
  const violations = [];
  for (const file of new Set(files)) {
    const n = lineCount(file);
    if (n > 300) violations.push(`${path.relative(root, file)} has ${n} lines, limit is 300`);
  }
  return { violations };
}

export function checkDocSizes(root) {
  const checks = [
    [path.join(root, 'principles.md'), 40],
    [path.join(root, 'templates', 'standing-rules.md'), 15],
  ];
  const present = checks.filter(([file]) => fs.existsSync(file));
  if (present.length === 0) {
    return { skip: 'principles.md and templates/standing-rules.md do not exist yet', violations: [] };
  }
  const violations = [];
  for (const [file, limit] of present) {
    const n = lineCount(file);
    if (n > limit) violations.push(`${path.relative(root, file)} has ${n} lines, limit is ${limit}`);
  }
  return { violations };
}

const dependencyKeys = ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'];

export function checkDependencies(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const violations = dependencyKeys
    .filter((key) => pkg[key] !== undefined)
    .map((key) => `package.json must not have a ${key} key`);
  return { violations };
}

function report(t, result) {
  if (result.skip) return t.skip(result.skip);
  assert.deepEqual(result.violations, []);
}

function withTempRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-budget-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const lines = (n) => 'x\n'.repeat(n);

test('skills limit', (t) => report(t, checkSkills(repoRoot)));
test('roles limit', (t) => report(t, checkRoles(repoRoot)));
test('commands limit', (t) => report(t, checkCommands(repoRoot)));
test('file size', (t) => report(t, checkFileSize(repoRoot)));
test('principles size', (t) => report(t, checkDocSizes(repoRoot)));
test('no dependencies', (t) => report(t, checkDependencies(repoRoot)));

test('checks can fail: extensionless bin file over 300 lines', () => {
  withTempRepo((dir) => {
    write(dir, 'bin/ril', lines(301));
    assert.equal(checkFileSize(dir).violations.length, 1);
    write(dir, 'bin/ril', lines(300));
    assert.deepEqual(checkFileSize(dir).violations, []);
  });
});

test('checks can fail: .mjs under lib over 300 lines', () => {
  withTempRepo((dir) => {
    write(dir, 'lib/deep/big.mjs', lines(301));
    assert.equal(checkFileSize(dir).violations.length, 1);
  });
});

test('checks can fail: more than 8 skills, stray files not counted', () => {
  withTempRepo((dir) => {
    for (let i = 0; i < 8; i++) write(dir, `skills/s${i}/SKILL.md`, lines(1));
    write(dir, 'skills/.DS_Store', 'junk');
    assert.deepEqual(checkSkills(dir).violations, []);
    write(dir, 'skills/s8/SKILL.md', lines(1));
    assert.equal(checkSkills(dir).violations.length, 1);
  });
});

test('checks can fail: SKILL.md over 120 lines', () => {
  withTempRepo((dir) => {
    write(dir, 'skills/a/SKILL.md', lines(121));
    assert.equal(checkSkills(dir).violations.length, 1);
  });
});

test('checks can fail: more than 6 roles, stray files not counted', () => {
  withTempRepo((dir) => {
    for (let i = 0; i < 6; i++) write(dir, `agents/r${i}.md`, 'x');
    write(dir, 'agents/.DS_Store', 'junk');
    assert.deepEqual(checkRoles(dir).violations, []);
    write(dir, 'agents/r6.md', 'x');
    assert.equal(checkRoles(dir).violations.length, 1);
  });
});

test('checks can fail: more than 20 commands, index and stray files not counted', () => {
  withTempRepo((dir) => {
    for (let i = 0; i < 20; i++) write(dir, `lib/commands/c${i}.mjs`, 'x');
    write(dir, 'lib/commands/index.mjs', 'x');
    write(dir, 'lib/commands/.DS_Store', 'junk');
    assert.deepEqual(checkCommands(dir).violations, []);
    write(dir, 'lib/commands/c20.mjs', 'x');
    assert.equal(checkCommands(dir).violations.length, 1);
  });
});

test('checks can fail: doc size limits', () => {
  withTempRepo((dir) => {
    write(dir, 'principles.md', lines(41));
    write(dir, 'templates/standing-rules.md', lines(16));
    assert.equal(checkDocSizes(dir).violations.length, 2);
  });
});

test('checks can fail: any dependency key except devDependencies', () => {
  for (const key of dependencyKeys) {
    withTempRepo((dir) => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', [key]: {} }));
      assert.equal(checkDependencies(dir).violations.length, 1, key);
    });
  }
  withTempRepo((dir) => {
    write(dir, 'package.json', JSON.stringify({ name: 'x', devDependencies: {} }));
    assert.deepEqual(checkDependencies(dir).violations, []);
  });
});

test('checks skip on an empty repo', () => {
  withTempRepo((dir) => {
    for (const check of [checkSkills, checkRoles, checkCommands, checkFileSize, checkDocSizes]) {
      assert.ok(check(dir).skip, check.name);
    }
  });
});
