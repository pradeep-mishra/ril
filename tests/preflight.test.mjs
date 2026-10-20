import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/cli.mjs';
import { loadTools, checkAllow } from '../lib/tools.mjs';
import { ril } from './helpers/ril.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = ['Bash(ril *)', 'Bash(git *)', 'Edit(./**)', 'Read(./**)'];
const DENY = ['Edit', 'Write'].flatMap((t) => ['.ril/state.json', '.ril/state.json.bak', '.ril/state.json.damaged-*', '.ril/.lock', '.ril/.lock.break', '.claude/**', '.git/**'].map((f) => `${t}(${f})`));

// A throwaway folder; most tests need no ril project in it, so they also prove none is needed.
async function tmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-pre-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Runs ril in this process so a test can set the environment.
async function rilIn(dir, args, { env = {} } = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, { cwd: dir, env: { ...process.env, ...env }, out: (t) => (stdout += `${t}\n`), err: (t) => (stderr += `${t}\n`) });
  return { code, stdout, stderr };
}

async function failsIn(dir, code, args, options) {
  const r = await rilIn(dir, args, options);
  assert.equal(r.code, code, `${args.join(' ')} -> ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /Next: /, `${args.join(' ')} has no Next line`);
  return r;
}

function fails(dir, code, ...args) {
  const r = ril(dir, ...args);
  assert.equal(r.code, code, `${args.join(' ')} -> ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /Next: /);
  return r;
}

// Writes <dir>/.ril/tools.json (as given, or as JSON text) and returns its hash.
function tools(dir, list, extra = {}) {
  fs.mkdirSync(path.join(dir, '.ril'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ril', 'tools.json'), typeof list === 'string' ? list : JSON.stringify(Array.isArray(list) ? { requires: list, ...extra } : list));
}

const tool = (name, detect, extra = {}) => ({ name, detect, install: {}, guide: `Install ${name} from its website.`, human: false, reason: `${name} does the work.`, ...extra });
const MISSING = tool('definitely-not-installed-xyz', 'definitely-not-installed-xyz --version', { install: { [process.platform]: 'echo installing' } });
const PRESENT = tool('node', 'node --version');
// An environment where git reads only the given text as its user settings (no system or home settings).
function gitConfig(dir, text) {
  const file = path.join(dir, 'gitconfig');
  fs.writeFileSync(file, text);
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0' };
}
const settingsOf = (dir) => path.join(dir, '.claude', 'settings.json');
const readSettings = (dir) => JSON.parse(fs.readFileSync(settingsOf(dir), 'utf8'));
// A ril project in `dir` whose tool list is `list`; approve() records the person's approval of the list as it is now.
function project(dir, list) {
  assert.equal(ril(dir, 'init').code, 0);
  tools(dir, list);
}
function approve(dir, text = (hash) => `Approved tools ${hash}`) {
  const hash = ril(dir, 'allowlist', 'hash').stdout.trim();
  assert.equal(ril(dir, 'decision', 'log', '--stage', 'design', '--decision', text(hash), '--why', 'the person said yes').code, 0);
  return hash;
}
const APPROVED = ['--approved', '--tool', 'claude'];
const LIST = { requires: [PRESENT], allow: ['Bash(node *)', 'mcp__panel__inspect'], humanSteps: [] };

test('preflight reports a missing tool, shows the list hash and says why each tool is needed', async () => {
  await tmp(async (dir) => {
    tools(dir, [PRESENT, MISSING]);
    const hash = loadTools(dir).hash;
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 2);
    assert.deepEqual(r.stdout.trim().split('\n'), [`Tool list ${hash}`, 'node: node does the work.', 'definitely-not-installed-xyz: definitely-not-installed-xyz does the work.', 'Missing: definitely-not-installed-xyz. I can install it for you, or guide you step by step.']);
    assert.ok(!fs.existsSync(path.join(dir, '.ril', 'state.json')), 'preflight does not need or create a project');
  });
});

test('a tool with no installer for this system gets guide-only text', async () => {
  await tmp(async (dir) => {
    tools(dir, [{ ...MISSING, install: {}, guide: 'download it from the vendor site' }]);
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^Missing: definitely-not-installed-xyz\. I have no automatic installer for this system; here is how: download it from the vendor site$/m);
    tools(dir, [{ ...MISSING, install: { [process.platform]: null } }]);
    assert.equal(JSON.parse((await rilIn(dir, ['preflight', '--json'])).stdout).missing[0].install, null);
  });
});

test('a present tool passes', async () => {
  await tmp(async (dir) => {
    tools(dir, [PRESENT]);
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Everything this project needs is installed\.$/m);
  });
});

test('a human-only tool shows only a guide', async () => {
  await tmp(async (dir) => {
    tools(dir, [{ ...MISSING, human: true, guide: 'open the vendor site and run the installer' }]);
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^Missing: definitely-not-installed-xyz\. Only you can install this one; here is how: open the vendor site and run the installer$/m);
    assert.doesNotMatch(r.stdout, /I can install/);
  });
});

test('a timeout counts as missing, and a bad timeout setting is refused plainly', async (t) => {
  if (process.platform === 'win32') return t.skip('the slow program is a script');
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'slowpoke'), '#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n', { mode: 0o755 });
    tools(dir, [tool('slowpoke', 'slowpoke --version')]);
    const env = { PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}` };
    const started = Date.now();
    const r = await rilIn(dir, ['preflight'], { env: { ...env, RIL_DETECT_TIMEOUT_MS: '1000' } });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^Missing: slowpoke\./m);
    assert.ok(Date.now() - started < 20_000, 'the check was cut off at the timeout');
    for (const bad of ['0', 'soon', '-5']) await failsIn(dir, 1, ['preflight'], { env: { ...env, RIL_DETECT_TIMEOUT_MS: bad } });
  });
});

test('a detect command that is more than a version probe is refused and never run', async () => {
  await tmp(async (dir) => {
    tools(dir, [PRESENT, tool('sneaky', 'node --version; node -e "require(\'fs\').writeFileSync(\'marker\', \'x\')"')]);
    const r = await failsIn(dir, 1, ['preflight']);
    assert.match(r.stderr, /one program name/);
    assert.ok(!fs.existsSync(path.join(dir, 'marker')));
  });
});

test('preflight needs a usable tool list, and the old folder form is gone', async () => {
  await tmp(async (dir) => {
    const none = await failsIn(dir, 1, ['preflight']);
    assert.match(none.stderr, /no tool list/);
    tools(dir, '{ not json');
    await failsIn(dir, 1, ['preflight']);
    tools(dir, [PRESENT]);
    const old = await failsIn(dir, 1, ['preflight', 'some-folder']);
    assert.match(old.stderr, /tools\.json/);
  });
});

test('preflight --json adds the hash and the reasons and keeps the missing list', async () => {
  await tmp(async (dir) => {
    tools(dir, [PRESENT, MISSING, { ...MISSING, name: 'other', reason: 'other does the work.', install: {}, human: true }]);
    const r = await rilIn(dir, ['preflight', '--json']);
    assert.equal(r.code, 2);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hash, loadTools(dir).hash);
    assert.deepEqual(out.tools.map((t) => [t.name, t.reason]), [['node', 'node does the work.'], ['definitely-not-installed-xyz', 'definitely-not-installed-xyz does the work.'], ['other', 'other does the work.']]);
    assert.deepEqual(out.missing.map((m) => [m.name, m.human, m.install]), [['definitely-not-installed-xyz', false, 'echo installing'], ['other', true, null]]);
    assert.equal(out.missing[0].guide, 'Install definitely-not-installed-xyz from its website.');
    tools(dir, [PRESENT]);
    const clean = await rilIn(dir, ['preflight', '--json']);
    assert.equal(clean.code, 0);
    assert.deepEqual(JSON.parse(clean.stdout).missing, []);
  });
});

test('allowlist merges without removing existing entries', async () => {
  await tmp(async (dir) => {
    project(dir, { requires: [], allow: ['Bash(node *)', 'Bash(git *)', 'Bash(node *)'] });
    approve(dir);
    fs.mkdirSync(path.join(dir, '.claude'));
    const mine = { model: 'opus', hooks: { Stop: [] }, permissions: { deny: ['Edit(.ril/.lock)', 'Bash(rm *)'], allow: ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)'] } };
    fs.writeFileSync(settingsOf(dir), JSON.stringify(mine));
    const r = ril(dir, 'allowlist', 'write', ...APPROVED);
    assert.equal(r.code, 0, r.stderr);
    const after = readSettings(dir);
    assert.deepEqual(after.permissions.allow, ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)', 'Bash(ril *)', 'Edit(./**)', 'Read(./**)', 'Bash(node *)']);
    assert.deepEqual(after.permissions.deny, ['Edit(.ril/.lock)', 'Bash(rm *)', ...DENY.filter((d) => d !== 'Edit(.ril/.lock)')], 'deny entries are added after the existing ones, never reordered or doubled');
    assert.equal(after.model, 'opus');
    assert.deepEqual(after.hooks, { Stop: [] });
    assert.match(r.stdout, /trust/i, 'the person is told to accept the trust prompt');
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const text = fs.readFileSync(settingsOf(dir), 'utf8');
    assert.equal(ril(dir, 'allowlist', 'write', ...APPROVED).code, 0);
    assert.equal(fs.readFileSync(settingsOf(dir), 'utf8'), text, 'a second run changes nothing');
    assert.ok(fs.readdirSync(path.join(dir, '.claude')).every((n) => !n.endsWith('.tmp')));
  });
});

test('allowlist only treats an identical entry as a duplicate', async () => {
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const near = ['Bash(ril*)', 'bash(git *)', 'Bash(git  *)', 'Edit(.ril/**)', ' Read(./**)'];
    const nearDeny = ['Edit(./.ril/state.json)', 'edit(.ril/.lock)'];
    fs.writeFileSync(settingsOf(dir), JSON.stringify({ permissions: { allow: near, deny: nearDeny } }));
    assert.equal((await rilIn(dir, ['allowlist', 'write', '--base', '--tool', 'claude'])).code, 0);
    assert.deepEqual(readSettings(dir).permissions.allow, [...near, ...BASE]);
    assert.deepEqual(readSettings(dir).permissions.deny, [...nearDeny, ...DENY]);
  });
});

test('allowlist --base writes the base entries', async () => {
  await tmp(async (dir) => {
    const r = ril(dir, 'allowlist', 'write', '--base', '--tool', 'claude');
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readSettings(dir), { permissions: { allow: BASE, deny: DENY } });
    assert.match(r.stdout, /trust/i);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const json = JSON.parse(ril(dir, '--json', 'allowlist', 'write', '--base', '--tool', 'claude').stdout);
    assert.deepEqual([json.added, json.denied], [[], []]);
  });
});

test('allowlist never overwrites a settings file it cannot understand', async () => {
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    for (const text of ['{ "permissions": ', '[]', 'null', '{"permissions":[]}', '{"permissions":{"allow":"Bash(ls *)"}}', '{"permissions":{"deny":"Edit(x)"}}', '{"permissions":{"deny":{}}}']) {
      fs.writeFileSync(settingsOf(dir), text);
      fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'claude');
      assert.equal(fs.readFileSync(settingsOf(dir), 'utf8'), text);
    }
  });
});

test('allowlist refuses a settings file or folder that is a link', async (t) => {
  await tmp(async (dir) => {
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

test('allowlist writes into the folder given by --dir', async () => {
  await tmp(async (dir) => {
    const project = path.join(dir, 'project');
    fs.mkdirSync(project);
    assert.equal(ril(dir, '--dir', project, 'allowlist', 'write', '--base', '--tool', 'claude').code, 0);
    assert.deepEqual(readSettings(project).permissions, { allow: BASE, deny: DENY });
    assert.ok(!fs.existsSync(settingsOf(dir)));
  });
});

test('allowlist --approved writes the base entries and the approved list, deny entries included', async () => {
  await tmp(async (dir) => {
    project(dir, LIST);
    approve(dir);
    assert.equal(ril(dir, 'allowlist', 'write', ...APPROVED).code, 0);
    assert.deepEqual(readSettings(dir).permissions, { allow: [...BASE, 'Bash(node *)', 'mcp__panel__inspect'], deny: DENY });
  });
});

test('allowlist --approved refuses without an approval, with an edited list, with a broad pattern, and --force changes nothing', async () => {
  await tmp(async (dir) => {
    project(dir, LIST);
    const none = fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    assert.match(none.stderr, /has not approved/);
    assert.match(none.stderr, new RegExp(`Approved tools ${ril(dir, 'allowlist', 'hash').stdout.trim()}`), 'the Next line names the decision to record');
    fails(dir, 1, '--force', 'trust me', 'allowlist', 'write', ...APPROVED);
    approve(dir, (hash) => `approved tools ${hash}`);
    fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    approve(dir);
    tools(dir, { ...LIST, allow: [...LIST.allow, 'Bash(npm publish)'] });
    fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    fails(dir, 1, '--force', 'trust me', 'allowlist', 'write', ...APPROVED);
    tools(dir, { ...LIST, allow: ['Bash(*)'] });
    approve(dir);
    const broad = fails(dir, 1, '--force', 'trust me', 'allowlist', 'write', ...APPROVED);
    assert.match(broad.stderr, /Bash\(\*\)/);
    assert.ok(!fs.existsSync(settingsOf(dir)), 'nothing was written');
  });
});

test('allowlist --approved needs a tool list that loads and a project', async () => {
  await tmp(async (dir) => {
    fails(dir, 2, 'allowlist', 'write', ...APPROVED);
    project(dir, LIST);
    fs.rmSync(path.join(dir, '.ril', 'tools.json'));
    fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    tools(dir, '{"requires":"node"}');
    fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    assert.ok(!fs.existsSync(settingsOf(dir)));
  });
});

test('allowlist hash prints the tool list hash, and --json gives it as {hash}', async () => {
  await tmp(async (dir) => {
    tools(dir, LIST);
    const { hash } = loadTools(dir);
    assert.equal(ril(dir, 'allowlist', 'hash').stdout, `${hash}\n`);
    assert.deepEqual(JSON.parse(ril(dir, '--json', 'allowlist', 'hash').stdout), { hash });
    fs.rmSync(path.join(dir, '.ril', 'tools.json'));
    fails(dir, 1, 'allowlist', 'hash');
  });
});

test('allowlist checks its options', async () => {
  await tmp(async (dir) => {
    project(dir, LIST);
    approve(dir);
    await failsIn(dir, 1, ['allowlist', 'write', '--base', '--tool', 'codex']);
    await failsIn(dir, 1, ['allowlist', 'write', '--base', '--tool', 'vim']);
    await failsIn(dir, 1, ['allowlist', 'write', '--base']);
    await failsIn(dir, 1, ['allowlist', 'write', '--tool', 'claude']);
    await failsIn(dir, 1, ['allowlist', 'write', '--base', '--approved', '--tool', 'claude']);
    await failsIn(dir, 1, ['allowlist', 'write', '--recipe', 'x', '--tool', 'claude']);
    await failsIn(dir, 1, ['allowlist']);
    assert.ok(!fs.existsSync(settingsOf(dir)), 'nothing was written');
  });
});

test('the cli-todo example has a tool list that loads, passes the permission check and preflight', async () => {
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, '.ril'));
    fs.copyFileSync(path.join(repoRoot, 'examples', 'cli-todo', 'tools.json'), path.join(dir, '.ril', 'tools.json'));
    const { tools: list } = loadTools(dir);
    assert.deepEqual(list.requires.map((r) => r.name), ['node', 'git']);
    assert.deepEqual(checkAllow(list.allow), []);
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });
});
