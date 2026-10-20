import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/cli.mjs';
import { ril } from './helpers/ril.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = ['Bash(ril *)', 'Bash(git *)', 'Edit(./**)', 'Read(./**)'];
const DENY = ['Edit(.ril/state.json)', 'Edit(.ril/state.json.bak)', 'Edit(.ril/state.json.damaged-*)', 'Edit(.ril/.lock)', 'Edit(.ril/.lock.break)'];
const NPM = ['Bash(npm test)', 'Bash(npm test *)', 'Bash(npm run verify)', 'Bash(npm run verify *)'];
const INSTALL = ['Bash(npm install *)', 'Bash(npm ci)', 'Bash(npm pack *)'];

// A throwaway folder with no ril project in it, so these tests also prove no project is needed.
// Test recipes live in <dir>/recipe and <dir> is the trusted recipe root for the in-process runs below.
async function tmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-pre-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Runs ril in this process so a test can point the trusted recipe root at a temp folder (an internal option, not a flag).
async function rilIn(dir, args, { root = dir, env = {} } = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, { cwd: dir, recipeRoot: root, env: { ...process.env, ...env }, out: (t) => (stdout += `${t}\n`), err: (t) => (stderr += `${t}\n`) });
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

function recipe(dir, tools, extra = {}, name = 'recipe') {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'recipe.json'), JSON.stringify({ name: 'demo', type: 'cli', requires: tools, ...extra }));
  return folder;
}

const tool = (name, detect, extra = {}) => ({ name, detect, install: {}, guide: `Install ${name} from its website.`, human: false, ...extra });
const MISSING = tool('definitely-not-installed-xyz', 'definitely-not-installed-xyz --version', { install: { [process.platform]: 'echo installing' } });
const PRESENT = tool('node', 'node --version');
const IDENTITY_GUIDE = 'Run these two commands inside your project folder, with your own name and email (this only affects this project): git config user.name "Your Name" and git config user.email "you@example.com"';
// An environment where git reads only the given text as its user settings (no system or home settings).
function gitConfig(dir, text) {
  const file = path.join(dir, 'gitconfig');
  fs.writeFileSync(file, text);
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0' };
}
const settingsOf = (dir) => path.join(dir, '.claude', 'settings.json');
const readSettings = (dir) => JSON.parse(fs.readFileSync(settingsOf(dir), 'utf8'));

test('preflight reports missing tool', async () => {
  await tmp(async (dir) => {
    const r = await rilIn(dir, ['preflight', recipe(dir, [MISSING])]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), 'Missing: definitely-not-installed-xyz. I can install it for you, or guide you step by step.');
    assert.ok(!fs.existsSync(path.join(dir, '.ril')), 'preflight does not need or create a project');
  });
});

test('a tool with no installer for this system gets guide-only text', async () => {
  await tmp(async (dir) => {
    const r = await rilIn(dir, ['preflight', recipe(dir, [{ ...MISSING, install: {}, guide: 'download it from the vendor site' }])]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), 'Missing: definitely-not-installed-xyz. I have no automatic installer for this system; here is how: download it from the vendor site');
    const nulled = await rilIn(dir, ['preflight', recipe(dir, [{ ...MISSING, install: { [process.platform]: null } }]), '--json']);
    assert.equal(JSON.parse(nulled.stdout).missing[0].install, null);
  });
});

test('present tool passes', async () => {
  await tmp(async (dir) => {
    const r = await rilIn(dir, ['preflight', recipe(dir, [PRESENT])]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'Everything this project needs is installed.');
  });
});

test('human tool shows only a guide', async () => {
  await tmp(async (dir) => {
    const r = await rilIn(dir, ['preflight', recipe(dir, [{ ...MISSING, human: true, guide: 'open the vendor site and run the installer' }])]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), 'Missing: definitely-not-installed-xyz. Only you can install this one; here is how: open the vendor site and run the installer');
    assert.doesNotMatch(r.stdout, /I can install/);
  });
});

test('timeout counts as missing', async () => {
  await tmp(async (dir) => {
    const slow = tool('slowpoke', 'node -e "setTimeout(()=>{},30000)"');
    const started = Date.now();
    const r = await rilIn(dir, ['preflight', recipe(dir, [slow])], { env: { RIL_DETECT_TIMEOUT_MS: '1000' } });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^Missing: slowpoke\./);
    assert.ok(Date.now() - started < 20_000, 'the check was cut off at the timeout');
  });
});

test('a bad timeout setting is refused plainly', async () => {
  await tmp(async (dir) => {
    const folder = recipe(dir, [PRESENT]);
    for (const bad of ['0', 'soon', '-5']) await failsIn(dir, 1, ['preflight', folder], { env: { RIL_DETECT_TIMEOUT_MS: bad } });
  });
});

test('bad recipe.json exits 1, a missing one exits 2, each with a Next line', async () => {
  await tmp(async (dir) => {
    const folder = path.join(dir, 'recipe');
    fs.mkdirSync(folder);
    await failsIn(dir, 2, ['preflight', folder]);
    await failsIn(dir, 2, ['preflight', path.join(dir, 'nowhere')]);
    await failsIn(dir, 1, ['preflight']);
    const file = path.join(folder, 'recipe.json');
    for (const text of ['{ not json', '[]', '{"name":"x","requires":"node"}', '{"name":"x","requires":[{"name":"a"}]}', '{"name":"x","requires":[{"name":"a","detect":"node --version","guide":"g","human":"yes"}]}', '{"name":"x","requires":[],"allowlist":{"claude":"Bash(ril *)"}}']) {
      fs.writeFileSync(file, text);
      const r = await failsIn(dir, 1, ['preflight', folder]);
      assert.match(r.stderr, /recipe\.json/, text);
    }
  });
});

test('{recipe} in a detect command is the recipe folder, even when the path has a space and a quote', async () => {
  await tmp(async (dir) => {
    const folder = recipe(dir, [tool('helper', 'node {recipe}/probe.mjs'), tool('viaenv', 'node -e "process.exit(process.env.RIL_RECIPE_DIR ? 0 : 1)"')], {}, "my recipe's folder");
    fs.writeFileSync(path.join(folder, 'probe.mjs'), 'process.exit(0);\n');
    const r = await rilIn(dir, ['preflight', folder]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    fs.writeFileSync(path.join(folder, 'probe.mjs'), 'process.exit(1);\n');
    assert.equal((await rilIn(dir, ['preflight', folder])).code, 2);
  });
});

test('the detect process gets the recipe folder in RIL_RECIPE_DIR', async () => {
  await tmp(async (dir) => {
    const folder = recipe(dir, [tool('same', 'node {recipe}/probe.mjs')]);
    fs.writeFileSync(path.join(folder, 'probe.mjs'), `import fs from 'node:fs';\nprocess.exit(fs.realpathSync(process.env.RIL_RECIPE_DIR) === ${JSON.stringify(fs.realpathSync(folder))} ? 0 : 1);\n`);
    assert.equal((await rilIn(dir, ['preflight', folder])).code, 0);
  });
});

test('preflight --json lists what is missing with the install command for this platform', async () => {
  await tmp(async (dir) => {
    const folder = recipe(dir, [PRESENT, MISSING, { ...MISSING, name: 'other', install: {}, human: true }]);
    const r = await rilIn(dir, ['preflight', folder, '--json']);
    assert.equal(r.code, 2);
    const { missing } = JSON.parse(r.stdout);
    assert.deepEqual(missing.map((m) => [m.name, m.human, m.install]), [['definitely-not-installed-xyz', false, 'echo installing'], ['other', true, null]]);
    assert.equal(missing[0].guide, 'Install definitely-not-installed-xyz from its website.');
    const clean = await rilIn(dir, ['preflight', recipe(dir, [PRESENT]), '--json']);
    assert.equal(clean.code, 0);
    assert.deepEqual(JSON.parse(clean.stdout), { missing: [] });
  });
});

test('a recipe outside the recipes that ship with ril is refused by both commands, with no way around it', async () => {
  await tmp(async (dir) => {
    const copy = path.join(dir, 'recipe-copy');
    fs.cpSync(path.join(repoRoot, 'recipes', 'cli'), copy, { recursive: true });
    fs.mkdirSync(path.join(dir, '.ril'));
    const hidden = path.join(dir, '.ril', 'recipe-copy');
    fs.cpSync(copy, hidden, { recursive: true });
    for (const folder of [copy, hidden, repoRoot, path.join(repoRoot, 'recipes')]) {
      const pre = fails(dir, 1, 'preflight', folder);
      assert.match(pre.stderr, /ship with ril/);
      const allow = fails(dir, 1, 'allowlist', 'write', '--recipe', folder, '--tool', 'claude');
      assert.match(allow.stderr, /ship with ril/);
      fails(dir, 1, '--force', 'trust me', 'preflight', folder);
    }
    assert.ok(!fs.existsSync(settingsOf(dir)), 'nothing was written');
    const ok = ril(dir, 'preflight', path.join(repoRoot, 'recipes', 'cli'));
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  });
});

test('a link inside the trusted folder that points outside is refused, and so is a ../ escape', async (t) => {
  await tmp(async (dir) => {
    const root = path.join(dir, 'trusted');
    fs.mkdirSync(root);
    const outside = recipe(dir, [PRESENT], {}, 'outside');
    try {
      fs.symlinkSync(outside, path.join(root, 'evil'), 'junction');
    } catch {
      return t.skip('links cannot be made here');
    }
    const inside = recipe(root, [PRESENT], {}, 'good');
    assert.equal((await rilIn(dir, ['preflight', inside], { root })).code, 0);
    for (const folder of [path.join(root, 'evil'), path.join(root, '..', 'outside'), root]) {
      const r = await failsIn(dir, 1, ['preflight', folder], { root });
      assert.match(r.stderr, /ship with ril/);
      await failsIn(dir, 1, ['allowlist', 'write', '--recipe', folder, '--tool', 'claude'], { root });
    }
    fs.mkdirSync(path.join(root, 'linked-file'));
    fs.symlinkSync(path.join(outside, 'recipe.json'), path.join(root, 'linked-file', 'recipe.json'));
    await failsIn(dir, 1, ['preflight', path.join(root, 'linked-file')], { root });
    assert.ok(!fs.existsSync(settingsOf(dir)));
  });
});

test('allowlist merges without removing existing entries', async () => {
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const mine = { model: 'opus', hooks: { Stop: [] }, permissions: { deny: ['Edit(.ril/.lock)', 'Bash(rm *)'], allow: ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)'] } };
    fs.writeFileSync(settingsOf(dir), JSON.stringify(mine));
    const folder = recipe(dir, [], { allowlist: { claude: ['Bash(node *)', 'Bash(git *)', 'Bash(node *)'] } });
    const r = await rilIn(dir, ['allowlist', 'write', '--recipe', folder, '--tool', 'claude']);
    assert.equal(r.code, 0, r.stderr);
    const after = readSettings(dir);
    assert.deepEqual(after.permissions.allow, ['Bash(ls *)', 'Bash(git *)', 'Edit(src/**)', 'Bash(ril *)', 'Edit(./**)', 'Read(./**)', 'Bash(node *)']);
    assert.deepEqual(after.permissions.deny, ['Edit(.ril/.lock)', 'Bash(rm *)', ...DENY.filter((d) => d !== 'Edit(.ril/.lock)')], 'deny entries are added after the existing ones, never reordered or doubled');
    assert.equal(after.model, 'opus');
    assert.deepEqual(after.hooks, { Stop: [] });
    assert.match(r.stdout, /trust/i, 'the person is told to accept the trust prompt');
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const text = fs.readFileSync(settingsOf(dir), 'utf8');
    const again = await rilIn(dir, ['allowlist', 'write', '--recipe', folder, '--tool', 'claude']);
    assert.equal(again.code, 0);
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

test('allowlist --recipe adds the base entries and the recipe entries', async () => {
  await tmp(async (dir) => {
    const folder = recipe(dir, [], { allowlist: { claude: ['Bash(node *)'] } });
    assert.equal((await rilIn(dir, ['allowlist', 'write', '--recipe', folder, '--tool', 'claude'])).code, 0);
    assert.deepEqual(readSettings(dir).permissions.allow, [...BASE, 'Bash(node *)']);
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

test('a settings file with comments is refused with a plain reason', async () => {
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    for (const text of ['{\n  // my rules\n  "permissions": { "allow": [] }\n}\n', '/* mine */ {"permissions":{"allow":[]}}', '{"permissions":{"allow":["Bash(ls *)"]}, // x\n"model":"opus"}']) {
      fs.writeFileSync(settingsOf(dir), text);
      const r = fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'claude');
      assert.match(r.stderr, /\(comments are not allowed in this file\)/);
      assert.equal(fs.readFileSync(settingsOf(dir), 'utf8'), text);
    }
    fs.writeFileSync(settingsOf(dir), '{ "permissions": ');
    assert.doesNotMatch(fails(dir, 1, 'allowlist', 'write', '--base', '--tool', 'claude').stderr, /comments/);
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

test('allowlist checks its options', async () => {
  await tmp(async (dir) => {
    const folder = recipe(dir, []);
    const codex = await failsIn(dir, 1, ['allowlist', 'write', '--base', '--tool', 'codex']);
    assert.match(codex.stderr, /Codex/);
    await failsIn(dir, 1, ['allowlist', 'write', '--base', '--tool', 'vim']);
    await failsIn(dir, 1, ['allowlist', 'write', '--base']);
    await failsIn(dir, 1, ['allowlist', 'write', '--tool', 'claude']);
    await failsIn(dir, 1, ['allowlist', 'write', '--base', '--recipe', folder, '--tool', 'claude']);
    await failsIn(dir, 2, ['allowlist', 'write', '--recipe', path.join(dir, 'nowhere'), '--tool', 'claude']);
    await failsIn(dir, 1, ['allowlist']);
    assert.ok(!fs.existsSync(settingsOf(dir)), 'nothing was written');
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

test('the CLI recipe pack is complete and works with preflight and allowlist', async () => {
  const folder = path.join(repoRoot, 'recipes', 'cli');
  const pack = JSON.parse(fs.readFileSync(path.join(folder, 'recipe.json'), 'utf8'));
  assert.equal(pack.name, 'cli');
  assert.equal(pack.type, 'cli');
  assert.deepEqual(pack.methods, { cli: 'proven-cli' });
  assert.deepEqual(pack.requires.map((r) => r.name), ['node', 'git', 'git identity']);
  const [node, git, identity] = pack.requires;
  assert.equal(node.detect, 'node --version');
  assert.deepEqual(node.install, { darwin: 'brew install node', win32: 'winget install OpenJS.NodeJS.LTS', linux: null });
  assert.equal(git.detect, 'git --version');
  assert.deepEqual(git.install, { darwin: 'brew install git', win32: 'winget install Git.Git', linux: null });
  for (const r of [node, git]) assert.ok(r.guide.length > 20 && r.human === false, r.name);
  assert.equal(identity.detect, 'git config user.email');
  assert.equal(identity.human, true);
  assert.deepEqual(identity.install, { darwin: null, win32: null, linux: null });
  assert.equal(identity.guide, IDENTITY_GUIDE);
  assert.doesNotMatch(identity.guide, /--global/);
  assert.deepEqual(pack.allowlist.claude, ['Bash(node *)', ...NPM, ...INSTALL, 'Bash(git *)']);
  assert.ok(!pack.allowlist.claude.includes('Bash(npm *)'), 'npm publish and exec are not pre-approved');

  const guide = fs.readFileSync(path.join(folder, 'recipe.md'), 'utf8');
  assert.ok(guide.trimEnd().split('\n').length < 80, 'recipe.md stays under 80 lines');
  for (const phrase of ['.ril/evidence/<scenario>/<checkpoint>/transcript.txt', 'exit code', 'stderr', 'verify', 'zero checks', 'let the agent run the project it builds']) assert.ok(guide.includes(phrase), phrase);

  await tmp(async (dir) => {
    const root = path.join(repoRoot, 'recipes');
    const r = await rilIn(dir, ['preflight', folder], { root, env: gitConfig(dir, '[user]\n\tname = Pat\n\temail = pat@example.com\n') });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(ril(dir, 'allowlist', 'write', '--recipe', folder, '--tool', 'claude').code, 0);
    assert.deepEqual(readSettings(dir).permissions.allow, [...BASE, 'Bash(node *)', ...NPM, ...INSTALL]);
    assert.deepEqual(readSettings(dir).permissions.deny, DENY);
  });
});

test('the CLI recipe reports a missing git identity with the project-local commands', async () => {
  await tmp(async (dir) => {
    const root = path.join(repoRoot, 'recipes');
    const r = await rilIn(dir, ['preflight', path.join(root, 'cli')], { root, env: gitConfig(dir, '') });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.equal(r.stdout.trim(), `Missing: git identity. Only you can install this one; here is how: ${IDENTITY_GUIDE}`);
  });
});
