import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ril } from './helpers/ril.mjs';
import { fails } from './helpers/repo.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = ['Bash(ril *)', 'Bash(git *)', 'Edit(.ril/**)', 'Read(.ril/**)'];

// A throwaway folder with no ril project in it, so these tests also prove no project is needed.
function tmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-pre-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function recipe(dir, tools, extra = {}) {
  const folder = path.join(dir, 'recipe');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'recipe.json'), JSON.stringify({ name: 'demo', type: 'cli', requires: tools, ...extra }));
  return folder;
}

const tool = (name, detect, extra = {}) => ({ name, detect, install: {}, guide: `Install ${name} from its website.`, human: false, ...extra });
const MISSING = tool('definitely-not-installed-xyz', 'definitely-not-installed-xyz --version');
const PRESENT = tool('node', 'node --version');
const settingsOf = (dir) => path.join(dir, '.claude', 'settings.json');
const readSettings = (dir) => JSON.parse(fs.readFileSync(settingsOf(dir), 'utf8'));

function withEnv(name, value, fn) {
  const before = process.env[name];
  process.env[name] = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

test('preflight reports missing tool', () => {
  tmp((dir) => {
    const r = ril(dir, 'preflight', recipe(dir, [MISSING]));
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), 'Missing: definitely-not-installed-xyz. I can install it for you, or guide you step by step.');
    assert.ok(!fs.existsSync(path.join(dir, '.ril')), 'preflight does not need or create a project');
  });
});

test('present tool passes', () => {
  tmp((dir) => {
    const r = ril(dir, 'preflight', recipe(dir, [PRESENT]));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'Everything this project needs is installed.');
  });
});

test('human tool shows only a guide', () => {
  tmp((dir) => {
    const r = ril(dir, 'preflight', recipe(dir, [{ ...MISSING, human: true, guide: 'open the vendor site and run the installer' }]));
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), 'Missing: definitely-not-installed-xyz. Only you can install this one; here is how: open the vendor site and run the installer');
    assert.doesNotMatch(r.stdout, /I can install/);
  });
});

test('timeout counts as missing', () => {
  tmp((dir) => {
    const slow = tool('slowpoke', 'node -e "setTimeout(()=>{},30000)"');
    const started = Date.now();
    const r = withEnv('RIL_DETECT_TIMEOUT_MS', '1000', () => ril(dir, 'preflight', recipe(dir, [slow])));
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^Missing: slowpoke\./);
    assert.ok(Date.now() - started < 20_000, 'the check was cut off at the timeout');
  });
});

test('a bad timeout setting is refused plainly', () => {
  tmp((dir) => {
    const folder = recipe(dir, [PRESENT]);
    for (const bad of ['0', 'soon', '-5']) {
      const r = withEnv('RIL_DETECT_TIMEOUT_MS', bad, () => ril(dir, 'preflight', folder));
      assert.equal(r.code, 1, bad);
      assert.match(r.stderr, /Next: /);
    }
  });
});

test('bad recipe.json exits 1, a missing one exits 2, each with a Next line', () => {
  tmp((dir) => {
    const folder = path.join(dir, 'recipe');
    fs.mkdirSync(folder);
    fails(dir, 2, 'preflight', folder);
    fails(dir, 2, 'preflight', path.join(dir, 'nowhere'));
    fails(dir, 1, 'preflight');
    const file = path.join(folder, 'recipe.json');
    for (const text of ['{ not json', '[]', '{"name":"x","requires":"node"}', '{"name":"x","requires":[{"name":"a"}]}', '{"name":"x","requires":[{"name":"a","detect":"node --version","guide":"g","human":"yes"}]}', '{"name":"x","requires":[],"allowlist":{"claude":"Bash(ril *)"}}']) {
      fs.writeFileSync(file, text);
      const r = fails(dir, 1, 'preflight', folder);
      assert.match(r.stderr, /recipe\.json/, text);
    }
  });
});

test('{recipe} in a detect command is the recipe folder', () => {
  tmp((dir) => {
    const folder = recipe(dir, [tool('helper', 'node "{recipe}/check.mjs"')]);
    fs.writeFileSync(path.join(folder, 'check.mjs'), 'process.exit(0);\n');
    assert.equal(ril(dir, 'preflight', folder).code, 0);
    fs.writeFileSync(path.join(folder, 'check.mjs'), 'process.exit(1);\n');
    assert.equal(ril(dir, 'preflight', folder).code, 2);
  });
});

test('preflight --json lists what is missing with the install command for this platform', () => {
  tmp((dir) => {
    const install = { [process.platform]: 'echo installing' };
    const folder = recipe(dir, [PRESENT, { ...MISSING, install }, { ...MISSING, name: 'other', install: {}, human: true }]);
    const r = ril(dir, 'preflight', folder, '--json');
    assert.equal(r.code, 2);
    const { missing } = JSON.parse(r.stdout);
    assert.deepEqual(missing.map((m) => [m.name, m.human, m.install]), [['definitely-not-installed-xyz', false, 'echo installing'], ['other', true, null]]);
    assert.equal(missing[0].guide, 'Install definitely-not-installed-xyz from its website.');
    const clean = ril(dir, 'preflight', recipe(dir, [PRESENT]), '--json');
    assert.equal(clean.code, 0);
    assert.deepEqual(JSON.parse(clean.stdout), { missing: [] });
  });
});

test('allowlist merges without removing existing entries', () => {
  tmp((dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const mine = { model: 'opus', hooks: { Stop: [] }, permissions: { deny: ['Bash(rm *)'], allow: ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)'] } };
    fs.writeFileSync(settingsOf(dir), JSON.stringify(mine));
    const folder = recipe(dir, [], { allowlist: { claude: ['Bash(node *)', 'Bash(git *)', 'Bash(node *)'] } });
    const r = ril(dir, 'allowlist', 'write', '--recipe', folder, '--tool', 'claude');
    assert.equal(r.code, 0, r.stderr);
    const after = readSettings(dir);
    assert.deepEqual(after.permissions.allow, ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)', 'Bash(ril *)', 'Edit(.ril/**)', 'Read(.ril/**)', 'Bash(node *)']);
    assert.deepEqual(after.permissions.deny, ['Bash(rm *)']);
    assert.equal(after.model, 'opus');
    assert.deepEqual(after.hooks, { Stop: [] });
    assert.match(r.stdout, /trust/i, 'the person is told to accept the trust prompt');
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const text = fs.readFileSync(settingsOf(dir), 'utf8');
    const again = ril(dir, 'allowlist', 'write', '--recipe', folder, '--tool', 'claude');
    assert.equal(again.code, 0);
    assert.equal(fs.readFileSync(settingsOf(dir), 'utf8'), text, 'a second run changes nothing');
    assert.ok(fs.readdirSync(path.join(dir, '.claude')).every((n) => !n.endsWith('.tmp')));
  });
});

test('allowlist --base writes the base entries', () => {
  tmp((dir) => {
    const r = ril(dir, 'allowlist', 'write', '--base', '--tool', 'claude');
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readSettings(dir), { permissions: { allow: BASE } });
    assert.match(r.stdout, /trust/i);
    const json = ril(dir, '--json', 'allowlist', 'write', '--base', '--tool', 'claude');
    assert.deepEqual(JSON.parse(json.stdout).added, []);
  });
});

test('allowlist --recipe adds the base entries and the recipe entries', () => {
  tmp((dir) => {
    const folder = recipe(dir, [], { allowlist: { claude: ['Bash(node *)'] } });
    assert.equal(ril(dir, 'allowlist', 'write', '--recipe', folder, '--tool', 'claude').code, 0);
    assert.deepEqual(readSettings(dir).permissions.allow, [...BASE, 'Bash(node *)']);
  });
});

test('allowlist never overwrites a settings file it cannot understand', () => {
  tmp((dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    for (const text of ['{ "permissions": ', '[]', 'null', '{"permissions":[]}', '{"permissions":{"allow":"Bash(ls *)"}}']) {
      fs.writeFileSync(settingsOf(dir), text);
      fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'claude');
      assert.equal(fs.readFileSync(settingsOf(dir), 'utf8'), text);
    }
  });
});

test('allowlist refuses a settings file or folder that is a link', (t) => {
  tmp((dir) => {
    const elsewhere = path.join(dir, 'elsewhere.json');
    fs.writeFileSync(elsewhere, '{}');
    fs.mkdirSync(path.join(dir, '.claude'));
    try {
      fs.symlinkSync(elsewhere, settingsOf(dir));
    } catch {
      return t.skip('links cannot be made here');
    }
    fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'claude');
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), '{}');
    fs.rmSync(path.join(dir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'real'));
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, '.claude'), 'junction');
    fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'claude');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'real')), []);
  });
});

test('allowlist checks its options', () => {
  tmp((dir) => {
    const folder = recipe(dir, []);
    const codex = fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'codex');
    assert.match(codex.stderr, /Codex/);
    fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'vim');
    fails(dir, 1, 'allowlist', 'write', '--base');
    fails(dir, 1, 'allowlist', 'write', '--tool', 'claude');
    fails(dir, 1, 'allowlist', 'write', '--base', '--recipe', folder, '--tool', 'claude');
    fails(dir, 2, 'allowlist', 'write', '--recipe', path.join(dir, 'nowhere'), '--tool', 'claude');
    fails(dir, 1, 'allowlist');
    assert.ok(!fs.existsSync(settingsOf(dir)), 'nothing was written');
  });
});

test('allowlist writes into the folder given by --dir', () => {
  tmp((dir) => {
    const project = path.join(dir, 'project');
    fs.mkdirSync(project);
    assert.equal(ril(dir, '--dir', project, 'allowlist', 'write', '--base', '--tool', 'claude').code, 0);
    assert.deepEqual(readSettings(project).permissions.allow, BASE);
    assert.ok(!fs.existsSync(settingsOf(dir)));
  });
});

test('the CLI recipe pack is complete and works with preflight and allowlist', () => {
  const folder = path.join(repoRoot, 'recipes', 'cli');
  const pack = JSON.parse(fs.readFileSync(path.join(folder, 'recipe.json'), 'utf8'));
  assert.equal(pack.name, 'cli');
  assert.equal(pack.type, 'cli');
  assert.deepEqual(pack.methods, { cli: 'proven-cli' });
  assert.deepEqual(pack.requires.map((r) => r.name), ['node', 'git']);
  const [node, git] = pack.requires;
  assert.equal(node.detect, 'node --version');
  assert.deepEqual(node.install, { darwin: 'brew install node', win32: 'winget install OpenJS.NodeJS.LTS', linux: null });
  assert.equal(git.detect, 'git --version');
  assert.deepEqual(git.install, { darwin: 'brew install git', win32: 'winget install Git.Git', linux: null });
  for (const r of pack.requires) assert.ok(r.guide.length > 20 && r.human === false, r.name);
  assert.deepEqual(pack.allowlist.claude, ['Bash(node *)', 'Bash(npm *)', 'Bash(git *)', 'Edit(.ril/**)']);

  const guide = fs.readFileSync(path.join(folder, 'recipe.md'), 'utf8');
  assert.ok(guide.trimEnd().split('\n').length < 80, 'recipe.md stays under 80 lines');
  for (const phrase of ['.ril/evidence/<scenario>/<checkpoint>/transcript.txt', 'exit code', 'stderr', 'verify', 'zero checks']) assert.ok(guide.includes(phrase), phrase);

  tmp((dir) => {
    const r = ril(dir, 'preflight', folder);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(ril(dir, 'allowlist', 'write', '--recipe', folder, '--tool', 'claude').code, 0);
    assert.deepEqual(readSettings(dir).permissions.allow, ['Bash(ril *)', 'Bash(git *)', 'Edit(.ril/**)', 'Read(.ril/**)', 'Bash(node *)', 'Bash(npm *)']);
  });
});
