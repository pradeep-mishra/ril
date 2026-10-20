// Shared helpers for tests that need a ril project inside a git repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ril } from './ril.mjs';
import { tmpProject } from './tmp.mjs';
import { load } from '../../lib/store.mjs';

// Children inherit this: a fixed identity and no commit signing, whatever the machine's own git settings are.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Ril Test',
  GIT_AUTHOR_EMAIL: 'ril-test@example.com',
  GIT_COMMITTER_NAME: 'Ril Test',
  GIT_COMMITTER_EMAIL: 'ril-test@example.com',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.autocrlf',
  GIT_CONFIG_VALUE_1: 'false',
});

export const fixture = (name) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', name);
export const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const lines = (text) => text.split('\n').filter(Boolean);
export const head = (dir) => git(dir, 'rev-parse', 'HEAD');

export function ok(dir, ...args) {
  const r = ril(dir, ...args);
  assert.equal(r.code, 0, `${args.join(' ')} -> ${r.stdout}${r.stderr}`);
  return r;
}

export function fails(dir, code, ...args) {
  const r = ril(dir, ...args);
  assert.equal(r.code, code, `${args.join(' ')} -> ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /Next: /, `${args.join(' ')} has no Next line`);
  return r;
}

export function gitInit(dir) {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Ril Test');
  git(dir, 'config', 'user.email', 'ril-test@example.com');
}

// An initialised project inside a git repo with a local identity and one commit.
export function withRepo(fn, { gitInit: withGit = true } = {}) {
  const p = tmpProject();
  try {
    if (withGit) gitInit(p.dir);
    ok(p.dir, 'init');
    if (withGit) {
      fs.writeFileSync(path.join(p.dir, 'README.md'), '# demo\n');
      git(p.dir, 'add', '-A');
      git(p.dir, 'commit', '-q', '-m', 'start');
    }
    return fn(p.dir);
  } finally {
    p.cleanup();
  }
}

export function commitFile(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `change ${rel}`);
  return head(dir);
}

export function evidence(dir, id = 'S1') {
  const rel = `.ril/evidence/${id}/run.txt`;
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), 'transcript\n');
  return rel;
}

// Writes a proof kit whose first line says it is trusted, so verifiers may record results.
export function trustKit(dir) {
  const file = path.join(dir, '.ril', 'docs', 'verification', 'verify.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'Trusted: yes (shown failing on a broken copy)\n\n# Verify\n');
}

export const addScenario = (dir, id = 'S1', method = 'cli') =>
  ok(dir, 'scenario', 'add', id, '--title', `Title ${id}`, '--method', method, '--criterion', `Criterion ${id}`);

// Writes a brief for `role` inside .ril (which git ignores), based on the good fixture.
export function writeBrief(dir, role, edit = (t) => t, name = role) {
  const file = path.join(dir, '.ril', 'agents', name, 'brief.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, edit(fs.readFileSync(fixture('agent-brief-good.md'), 'utf8').replace('role: verifier', `role: ${role}`)));
  return file;
}

// Registers an agent; the good brief names S1, so S1 must exist.
export const register = (dir, id, role) =>
  ok(dir, 'agent', 'register', id, '--role', role, '--task', `${role} work`, '--brief', role === 'verifier' ? fixture('agent-brief-good.md') : writeBrief(dir, role));

export const record = (dir, scenario, checkpoint, verdict, extra = {}) => {
  const opts = { evidence: evidence(dir, scenario), verifier: 'V1', review: 'clean', checks: '3', ...extra };
  const args = ['ledger', 'record', scenario, checkpoint, verdict];
  for (const [k, v] of Object.entries(opts)) if (v !== null) args.push(`--${k}`, v);
  return ril(dir, ...args);
};

export const status = (dir, id = 'S1') => load(dir).scenarios.find((s) => s.id === id).status;
