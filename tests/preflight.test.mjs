// ril preflight: which of the tools in the project's tool list are installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadTools } from '../lib/commands/tools.mjs';
import { inTmp } from './helpers/tmp.mjs';
import { failsIn, rilIn, writeTools } from './helpers/tools.mjs';

const tmp = (fn) => inTmp(fn, { bare: true });
const tool = (name, detect, extra = {}) => ({ name, detect, install: {}, guide: `Install ${name} from its website.`, human: false, reason: `${name} does the work.`, ...extra });
const MISSING = tool('definitely-not-installed-xyz', 'definitely-not-installed-xyz --version', { install: { [process.platform]: 'echo installing' } });
const PRESENT = tool('node', 'node --version');

test('preflight reports a missing tool, shows the list hash and says why each tool is needed', async () => {
  await tmp(async (dir) => {
    writeTools(dir, [PRESENT, MISSING]);
    const hash = loadTools(dir).hash;
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 2);
    assert.deepEqual(r.stdout.trim().split('\n'), [`Tool list ${hash}`, 'node: node does the work.', 'definitely-not-installed-xyz: definitely-not-installed-xyz does the work.', 'Missing: definitely-not-installed-xyz. I can install it for you, or guide you step by step.']);
    assert.ok(!fs.existsSync(path.join(dir, '.ril', 'state.json')), 'preflight does not need or create a project');
  });
});

test('a tool with no installer for this system gets guide-only text', async () => {
  await tmp(async (dir) => {
    writeTools(dir, [{ ...MISSING, install: {}, guide: 'download it from the vendor site' }]);
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^Missing: definitely-not-installed-xyz\. I have no automatic installer for this system; here is how: download it from the vendor site$/m);
    writeTools(dir, [{ ...MISSING, install: { [process.platform]: null } }]);
    assert.equal(JSON.parse((await rilIn(dir, ['preflight', '--json'])).stdout).missing[0].install, null);
  });
});

test('a present tool passes', async () => {
  await tmp(async (dir) => {
    writeTools(dir, [PRESENT]);
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Everything this project needs is installed\.$/m);
  });
});

test('a human-only tool shows only a guide', async () => {
  await tmp(async (dir) => {
    writeTools(dir, [{ ...MISSING, human: true, guide: 'open the vendor site and run the installer' }]);
    const r = await rilIn(dir, ['preflight']);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^Missing: definitely-not-installed-xyz\. Only you can install this one; here is how: open the vendor site and run the installer$/m);
    assert.doesNotMatch(r.stdout, /I can install/);
  });
});

test('a timeout counts as missing', async (t) => {
  if (process.platform === 'win32') return t.skip('the slow program is a script');
  await tmp(async (dir) => {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'slowpoke'), '#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n', { mode: 0o755 });
    writeTools(dir, [tool('slowpoke', 'slowpoke --version')]);
    const env = { PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}` };
    const started = Date.now();
    const r = await rilIn(dir, ['preflight'], { env: { ...env, RIL_DETECT_TIMEOUT_MS: '1000' } });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^Missing: slowpoke\./m);
    assert.ok(Date.now() - started < 20_000, 'the check was cut off at the timeout');
  });
});

test('a program inside the project folder never shadows the real one when probing', async (t) => {
  if (process.platform === 'win32') return t.skip('the shadow is a shell script');
  await tmp(async (dir) => {
    fs.writeFileSync(path.join(dir, 'shadowed-probe'), `#!/bin/sh\ntouch "${path.join(dir, 'marker')}"\n`, { mode: 0o755 });
    writeTools(dir, [tool('shadowed-probe', 'shadowed-probe --version')]);
    const r = await rilIn(dir, ['preflight'], { env: { PATH: `.${path.delimiter}${process.env.PATH}` } });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, 'marker')), 'the project folder is not searched');
  });
});

test('a detect command that is more than a version probe is refused and never run', async () => {
  await tmp(async (dir) => {
    writeTools(dir, [PRESENT, tool('sneaky', 'node --version; node -e "require(\'fs\').writeFileSync(\'marker\', \'x\')"')]);
    const r = await failsIn(dir, 1, ['preflight']);
    assert.match(r.stderr, /one program name/);
    assert.ok(!fs.existsSync(path.join(dir, 'marker')));
  });
});

test('preflight needs a usable tool list, and the old folder form is gone', async () => {
  await tmp(async (dir) => {
    const none = await failsIn(dir, 1, ['preflight']);
    assert.match(none.stderr, /no tool list/);
    writeTools(dir, '{ not json');
    await failsIn(dir, 1, ['preflight']);
    writeTools(dir, [PRESENT]);
    const old = await failsIn(dir, 1, ['preflight', 'some-folder']);
    assert.match(old.stderr, /tools\.json/);
  });
});

test('preflight --json adds the hash and the reasons and keeps the missing list', async () => {
  await tmp(async (dir) => {
    writeTools(dir, [PRESENT, MISSING, { ...MISSING, name: 'other', reason: 'other does the work.', install: {}, human: true }]);
    const r = await rilIn(dir, ['preflight', '--json']);
    assert.equal(r.code, 2);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hash, loadTools(dir).hash);
    assert.deepEqual(out.tools.map((t) => [t.name, t.reason]), [['node', 'node does the work.'], ['definitely-not-installed-xyz', 'definitely-not-installed-xyz does the work.'], ['other', 'other does the work.']]);
    assert.deepEqual(out.missing.map((m) => [m.name, m.human, m.install]), [['definitely-not-installed-xyz', false, 'echo installing'], ['other', true, null]]);
    assert.equal(out.missing[0].guide, 'Install definitely-not-installed-xyz from its website.');
    writeTools(dir, [PRESENT]);
    const clean = await rilIn(dir, ['preflight', '--json']);
    assert.equal(clean.code, 0);
    assert.deepEqual(JSON.parse(clean.stdout).missing, []);
  });
});
