// Checks a finished ril project after a real run: node tests/e2e/check-state.mjs <project-dir>
// Reads .ril/state.json and runs git read-only. Exit 0 when everything holds, 1 when something does not,
// 2 when the folder cannot be read at all. No dependencies.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('Usage: node tests/e2e/check-state.mjs <project-dir>');
  process.exit(2);
}

const readText = (...parts) => {
  try {
    return fs.readFileSync(path.join(dir, ...parts), 'utf8');
  } catch {
    return null;
  }
};

const raw = readText('.ril', 'state.json');
let state;
try {
  state = JSON.parse(raw);
} catch {
  console.error(`Cannot read ${path.join(dir, '.ril', 'state.json')}; is this a ril project folder?`);
  process.exit(2);
}

const git = (...args) => spawnSync('git', ['--no-optional-locks', ...args], { cwd: dir, encoding: 'utf8' });
const problems = [];
const fail = (text) => problems.push(text);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decided = (lead, id) => state.decisions.some((d) => new RegExp(`^${escape(lead)}${escape(id)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'i').test(String(d.decision ?? '').trim()));

// The current saved version.
const headRun = git('rev-parse', 'HEAD');
const now = headRun.status === 0 ? headRun.stdout.trim() : null;
if (!now) fail('The folder has no saved version (git has no commit here).');

if (state.stage !== 'done') fail(`The stage is ${state.stage}, not done.`);
if (!state.scenarios.length) fail('The project has no scenarios.');

let proven = 0;
let accepted = 0;
for (const s of state.scenarios) {
  if (s.status === 'parked') {
    if (decided('Accepted as unproven: ', s.id)) accepted++;
    else fail(`Scenario ${s.id} is set aside but nobody recorded "Accepted as unproven: ${s.id}".`);
    continue;
  }
  if (s.status !== 'proven') {
    fail(`Scenario ${s.id} is ${s.status}, not proven.`);
    continue;
  }
  proven++;
  const row = state.ledger.find((r) => r.scenario === s.id && r.checkpoint === now && String(r.verdict).startsWith('proven-'));
  if (!row) {
    fail(`Scenario ${s.id} has no proven result at the current saved version.`);
    continue;
  }
  const file = path.resolve(dir, row.evidence ?? '');
  const inside = path.relative(dir, file);
  const size = (() => {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  })();
  if (!row.evidence || inside.startsWith('..') || path.isAbsolute(inside) || size === 0) fail(`The evidence for scenario ${s.id} (${row.evidence}) is missing, empty or outside the project.`);
  const agent = state.agents.find((a) => a.id === row.verifier);
  if (agent?.role !== 'verifier') fail(`The result for scenario ${s.id} was recorded by ${row.verifier}, which is ${agent ? `a ${agent.role}` : 'not a known agent'}, not a verifier.`);
  if (row.review === 'risks' && !decided('Accepted risk for ', s.id)) fail(`The review of scenario ${s.id} found risks and nobody recorded "Accepted risk for ${s.id}".`);
  if (row.review !== 'clean' && row.review !== 'risks') fail(`The review of scenario ${s.id} is ${row.review}, not clean.`);
  if (!(row.checks >= 1)) fail(`The result for scenario ${s.id} ran ${row.checks} checks.`);
}

const finalReport = readText('.ril', 'docs', 'reports', 'final.md');
if (finalReport === null) fail('The final report .ril/docs/reports/final.md is missing.');
else if (!/^#{1,6}[ \t]*What is not covered[ \t]*$/im.test(finalReport)) fail('The final report has no "What is not covered" section.');

if (!/^[ \t]*Trusted:[ \t]*yes/im.test(readText('.ril', 'docs', 'verification', 'verify.md') ?? '')) fail('The proof kit (.ril/docs/verification/verify.md) does not say "Trusted: yes".');

const dirty = git('status', '--porcelain');
if (dirty.status !== 0) fail('git could not say whether the project is clean.');
else if (dirty.stdout.trim()) fail(`The project has unsaved changes:\n${dirty.stdout.trimEnd().split('\n').map((l) => `  ${l}`).join('\n')}`);

for (const a of state.agents.filter((x) => x.state === 'running')) fail(`Agent ${a.id} (${a.role}) is still marked as working.`);

const recovery = state.decisions.filter((d) => /^ril doctor/i.test(d.decision) || /restored.*backup/i.test(d.decision));
const made = state.decisions.filter((d) => !recovery.includes(d));
const stopped = state.agents.filter((a) => a.state === 'stopped').length;
console.log(`Stage: ${state.stage}`);
console.log(`Scenarios: ${proven} of ${state.scenarios.length} scenarios proven, ${accepted} accepted as unproven`);
console.log(`Results recorded: ${state.ledger.length}; agents: ${state.agents.length} (${stopped} stopped)`);
console.log(`Decisions made: ${made.length}`);
for (const d of made) console.log(`  - ${d.decision} (${d.why})`);
console.log(recovery.length || stopped ? `Recovery: ${recovery.length} repairs logged` : 'Recovery: nothing was needed');
for (const d of recovery) console.log(`  - ${d.decision}`);
if (problems.length) {
  for (const p of problems) console.log(`PROBLEM: ${p}`);
  console.log(`NOT ACCEPTED: ${problems.length} problem${problems.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log('ACCEPTED: every check passed.');
