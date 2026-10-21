// ril allowlist write: the permissions written into .claude/settings.json, and the approval they wait for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkAllow, loadTools } from '../lib/commands/tools.mjs';
import { ril, repoRoot } from './helpers/ril.mjs';
import { fails } from './helpers/repo.mjs';
import { inTmp } from './helpers/tmp.mjs';
import { failsIn, rilIn, writeTools } from './helpers/tools.mjs';

const tmp = (fn) => inTmp(fn, { bare: true });
// The plugin folder as the host spells an absolute read rule: a second leading slash, drive letters as /c/.
const PLUGIN_READ = `Read(/${repoRoot.replace(/\\/g, '/').replace(/^(\w):/, (_, d) => `/${d.toLowerCase()}`)}/**)`;
const BASE = ['Bash(ril *)', 'Bash(git *)', 'Edit(./**)', 'Read(./**)', PLUGIN_READ];
// ril and git write the state, the lock and .git themselves, so only the permission settings are denied (and only to the Edit tool).
const DENY = ['Edit(.claude/**)'];
const OLD_DENY = ['Edit', 'Write'].flatMap((t) => ['.ril/state.json', '.ril/state.json.bak', '.ril/state.json.damaged-*', '.ril/.lock', '.ril/.lock.break', '.claude/**', '.git/**'].map((f) => `${t}(${f})`));
const PRESENT = { name: 'node', detect: 'node --version', install: {}, guide: 'Install node from its website.', human: false, reason: 'node does the work.' };
const settingsOf = (dir) => path.join(dir, '.claude', 'settings.json');
const readSettings = (dir) => JSON.parse(fs.readFileSync(settingsOf(dir), 'utf8'));
// A ril project in `dir` whose tool list is `list`; approve() records the person's approval of the list as it is now.
function project(dir, list) {
  assert.equal(ril(dir, 'init').code, 0);
  writeTools(dir, list);
}
function approve(dir, text = (hash) => `Approved tools ${hash}`) {
  const hash = loadTools(dir).hash;
  assert.equal(ril(dir, 'decision', 'log', '--stage', 'design', '--decision', text(hash), '--why', 'the person said yes').code, 0);
  return hash;
}
const APPROVED = ['--approved', '--tool', 'claude'];
const LIST = { requires: [PRESENT], allow: ['Bash(node *)', 'mcp__panel__inspect'], humanSteps: [] };

test('allowlist merges without removing existing entries', async () => {
  await tmp(async (dir) => {
    project(dir, { requires: [], allow: ['Bash(node *)', 'Bash(git *)', 'Bash(node *)'] });
    approve(dir);
    fs.mkdirSync(path.join(dir, '.claude'));
    const mine = { model: 'opus', hooks: { Stop: [] }, permissions: { deny: ['Bash(rm *)'], allow: ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)'] } };
    fs.writeFileSync(settingsOf(dir), JSON.stringify(mine));
    const r = ril(dir, 'allowlist', 'write', ...APPROVED);
    assert.equal(r.code, 0, r.stderr);
    const after = readSettings(dir);
    assert.deepEqual(after.permissions.allow, ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)', 'Bash(ril *)', 'Edit(./**)', 'Read(./**)', PLUGIN_READ, 'Bash(node *)']);
    assert.deepEqual(after.permissions.deny, ['Bash(rm *)', ...DENY], 'deny entries are added after the existing ones, never reordered or doubled');
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
    assert.doesNotMatch(fs.readFileSync(settingsOf(dir), 'utf8'), /Write\(|state\.json|\.lock|\.git\b/, 'no Write rule and no deny on the state, the lock or .git');
    assert.match(r.stdout, /trust/i);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const json = JSON.parse(ril(dir, '--json', 'allowlist', 'write', '--base', '--tool', 'claude').stdout);
    assert.deepEqual([json.added, json.denied, json.removed], [[], [], 0]);
  });
});

test('allowlist removes the deny entries older versions wrote and keeps every other entry', async () => {
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const mine = ['Bash(rm *)', 'Edit(./.ril/state.json)', 'Write(src/**)'];
    fs.writeFileSync(settingsOf(dir), JSON.stringify({ permissions: { allow: BASE, deny: [mine[0], ...OLD_DENY, ...mine.slice(1)] } }));
    const json = JSON.parse(ril(dir, '--json', 'allowlist', 'write', '--base', '--tool', 'claude').stdout);
    assert.equal(json.removed, OLD_DENY.length - 1);
    assert.deepEqual(readSettings(dir).permissions, { allow: BASE, deny: [mine[0], ...DENY, ...mine.slice(1)] });
    const text = fs.readFileSync(settingsOf(dir), 'utf8');
    assert.equal(ril(dir, 'allowlist', 'write', '--base', '--tool', 'claude').code, 0);
    assert.equal(fs.readFileSync(settingsOf(dir), 'utf8'), text, 'a second run changes nothing');
  });
});

test('allowlist says so in plain words when the sandbox refuses the settings file', async () => {
  await tmp(async (dir) => {
    const rename = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
    const r = await failsIn(dir, 1, ['allowlist', 'write', '--base', '--tool', 'claude']).finally(() => { fs.renameSync = rename; });
    assert.match(r.stderr, /sandbox.*\nNext: allow the command to run outside the sandbox/);
    assert.doesNotMatch(r.stderr, /doctor|EPERM|unexpected/);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.claude')), [], 'no temp file is left behind');
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

test('allowlist --approved refuses without an approval, with an edited list, with a broad pattern, and --force changes nothing', async () => {
  await tmp(async (dir) => {
    project(dir, LIST);
    const none = fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    assert.match(none.stderr, /has not approved/);
    assert.match(none.stderr, new RegExp(`Approved tools ${loadTools(dir).hash}`), 'the Next line names the decision to record');
    fails(dir, 1, '--force', 'trust me', 'allowlist', 'write', ...APPROVED);
    approve(dir, (hash) => `approved tools ${hash}`);
    fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    approve(dir);
    writeTools(dir, { ...LIST, allow: [...LIST.allow, 'Bash(npm publish)'] });
    fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    fails(dir, 1, '--force', 'trust me', 'allowlist', 'write', ...APPROVED);
    writeTools(dir, { ...LIST, allow: ['Bash(*)'] });
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
    writeTools(dir, '{"requires":"node"}');
    fails(dir, 1, 'allowlist', 'write', ...APPROVED);
    assert.ok(!fs.existsSync(settingsOf(dir)));
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
