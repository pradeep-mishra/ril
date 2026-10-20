import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);
const lineCount = (file) => fs.readFileSync(file, 'utf8').split('\n').length - (fs.readFileSync(file, 'utf8').endsWith('\n') ? 1 : 0);
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : null);

function mjsFiles(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(mjsFiles(full) ?? []));
    else if (entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('skills limit', (t) => {
  const entries = list(at('skills'));
  if (!entries) return t.skip('skills/ does not exist yet');
  assert.ok(entries.length <= 8, `skills/ has ${entries.length} entries, limit is 8`);
  for (const name of entries) {
    const file = at('skills', name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const n = lineCount(file);
    assert.ok(n <= 120, `skills/${name}/SKILL.md has ${n} lines, limit is 120`);
  }
});

test('roles limit', (t) => {
  const entries = list(at('agents'));
  if (!entries) return t.skip('agents/ does not exist yet');
  const roles = entries.filter((f) => f.endsWith('.md'));
  assert.ok(roles.length <= 6, `agents/ has ${roles.length} roles, limit is 6`);
});

test('commands limit', (t) => {
  const entries = list(at('lib', 'commands'));
  if (!entries) return t.skip('lib/commands/ does not exist yet');
  const commands = entries.filter((f) => f.endsWith('.mjs') && f !== 'index.mjs');
  assert.ok(commands.length <= 20, `lib/commands/ has ${commands.length} commands, limit is 20`);
});

test('file size', (t) => {
  const files = [...(mjsFiles(at('lib')) ?? []), ...(mjsFiles(at('bin')) ?? [])];
  if (files.length === 0) return t.skip('no .mjs files under lib/ or bin/ yet');
  for (const file of files) {
    const n = lineCount(file);
    assert.ok(n <= 300, `${path.relative(root, file)} has ${n} lines, limit is 300`);
  }
});

test('principles size', (t) => {
  const checks = [
    [at('principles.md'), 40],
    [at('templates', 'standing-rules.md'), 15],
  ];
  const present = checks.filter(([file]) => fs.existsSync(file));
  if (present.length === 0) return t.skip('principles.md and templates/standing-rules.md do not exist yet');
  for (const [file, limit] of present) {
    const n = lineCount(file);
    assert.ok(n <= limit, `${path.relative(root, file)} has ${n} lines, limit is ${limit}`);
  }
});

test('no dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(at('package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'package.json must not have a dependencies key');
});
