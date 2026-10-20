// Builders for whole-project tests: a project in a temp git repo, walked through the real CLI with no model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { tmpProject } from './tmp.mjs';
import { git, gitInit, head, ok, record, register } from './repo.mjs';

// A fresh git repo with a local identity, `ril init` already run (optionally with a fix-round cap) and one commit.
export function withProject(fn, { cap } = {}) {
  const p = tmpProject();
  try {
    gitInit(p.dir);
    ok(p.dir, 'init', ...(cap ? ['--cap', String(cap)] : []));
    fs.writeFileSync(path.join(p.dir, 'README.md'), '# demo\n');
    git(p.dir, 'add', '-A');
    git(p.dir, 'commit', '-q', '-m', 'start');
    return fn(p.dir);
  } finally {
    p.cleanup();
  }
}

export const docs = (dir, ...parts) => path.join(dir, '.ril', 'docs', ...parts);

export function writeDoc(dir, rel, text) {
  fs.mkdirSync(path.dirname(docs(dir, rel)), { recursive: true });
  fs.writeFileSync(docs(dir, rel), text);
}

// Imports a spec that holds one cli scenario per id.
export function importScenarios(dir, ids) {
  const body = ids.map((id) => `### ${id}: Scenario ${id}\nCriterion: Running the ${id} command prints its result and exits 0.\nProof: cli\n`);
  writeDoc(dir, 'spec.md', `# Todo list tool\n\n## Scenarios\n\n${body.join('\n')}`);
  ok(dir, 'scenario', 'import', docs(dir, 'spec.md'));
}

export function writeFeatureMaps(dir, ids) {
  for (const id of ids) writeDoc(dir, `verification/feature-map/${id}.md`, `Method: cli\n\nRun the ${id} command and read what it prints.\n`);
  ok(dir, 'scenario', 'coverage');
}

export const advance = (dir, stages) => stages.forEach((stage) => ok(dir, 'stage', 'set', stage));
export const trustKit = (dir) => writeDoc(dir, 'verification/verify.md', `# Verify\n\nTrusted: yes (${head(dir).slice(0, 7)})\n`);
export const writeFinalReport = (dir) => writeDoc(dir, 'reports/final.md', '# Final report\n\nEvery scenario was proven.\n\n## What is not covered\n\nNothing beyond the spec.\n');

// Everything before the proofs: scenarios, feature maps, stages up to accept, a verifier V1, a trusted kit,
// the final report, and one saved version that holds it all.
export function ready(dir, ids = ['S1', 'S2'], { stages = ['design', 'confirm', 'build', 'accept'] } = {}) {
  importScenarios(dir, ids);
  writeFeatureMaps(dir, ids);
  advance(dir, ['shape', ...stages]);
  register(dir, 'V1', 'verifier');
  trustKit(dir);
  writeFinalReport(dir);
  ok(dir, 'checkpoint');
}

// Records a clean proof for each scenario at the current saved version.
export function prove(dir, ids, extra = {}) {
  for (const id of ids) {
    const r = record(dir, id, head(dir), 'proven-cli', extra);
    assert.equal(r.code, 0, `${id}: ${r.stdout}${r.stderr}`);
  }
}

// A finished project: all of the above, both proofs, the verifier finished and the stage set to done.
export function buildProject(dir, ids = ['S1', 'S2']) {
  ready(dir, ids);
  prove(dir, ids);
  ok(dir, 'agent', 'set', 'V1', '--state', 'done', '--result', 'every scenario proven');
  ok(dir, 'stage', 'set', 'done');
}
