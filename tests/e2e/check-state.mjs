// Checks a finished ril project after a real run: node tests/e2e/check-state.mjs <project-dir>
// Reads .ril/state.json and runs git read-only. Exit 0 when everything holds, 1 when something does not,
// 2 when the folder cannot be read as a ril project. Uses only node and ril's own proof rules (no packages).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkEvidence, kitTrust } from '../../lib/proof.mjs';

if (!process.argv[2]) {
  console.error('Usage: node tests/e2e/check-state.mjs <project-dir>');
  process.exit(2);
}
const dir = path.resolve(process.argv[2]);
const cannot = (text) => {
  console.error(text);
  process.exit(2);
};
const readText = (...parts) => {
  try {
    return fs.readFileSync(path.join(dir, ...parts), 'utf8');
  } catch {
    return null;
  }
};

let state;
try {
  state = JSON.parse(readText('.ril', 'state.json') ?? '');
} catch {
  cannot(`There is no ril project in ${dir}, or its .ril/state.json cannot be read.`);
}
const shaped = state && typeof state === 'object' && ['scenarios', 'ledger', 'agents', 'decisions'].every((k) => Array.isArray(state[k]));
if (!shaped) cannot(`${path.join(dir, '.ril', 'state.json')} does not look like ril state (scenarios, ledger, agents and decisions must be lists).`);

const git = (...args) => spawnSync('git', ['--no-optional-locks', ...args], { cwd: dir, encoding: 'utf8' });
const problems = [];
const fail = (text) => problems.push(text);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decided = (lead, id) => state.decisions.some((d) => new RegExp(`^${escape(lead)}${escape(id)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'i').test(String(d?.decision ?? '').trim()));

let proven = 0;
let accepted = 0;
try {
  const headRun = git('rev-parse', 'HEAD');
  const now = headRun.status === 0 ? headRun.stdout.trim() : null;
  if (!now) fail('The folder has no saved version (git has no commit here).');
  if (state.stage !== 'done') fail(`The stage is ${state.stage}, not done.`);
  if (!state.scenarios.length) fail('The project has no scenarios.');
  else if (!state.scenarios.some((s) => s?.status === 'proven')) fail('No scenario is proven; setting every scenario aside does not finish a project.');

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
    const row = state.ledger.find((r) => r?.scenario === s.id && r.checkpoint === now && String(r.verdict).startsWith('proven-'));
    if (!row) {
      fail(`Scenario ${s.id} has no proven result at the current saved version.`);
      continue;
    }
    try {
      if (typeof row.evidence !== 'string' || !row.evidence) throw new Error('No evidence path was recorded.');
      checkEvidence(dir, row.evidence, s.id);
    } catch (err) {
      fail(`The evidence for scenario ${s.id} cannot be used: ${String(err.plain ?? err.message).split('\n')[0]}`);
    }
    const agent = state.agents.find((a) => a?.id === row.verifier);
    if (agent?.role !== 'verifier') fail(`The result for scenario ${s.id} was recorded by ${row.verifier}, which is ${agent ? `a ${agent.role}` : 'not a known agent'}, not a verifier.`);
    if (row.review === 'risks' && !decided('Accepted risk for ', s.id)) fail(`The review of scenario ${s.id} found risks and nobody recorded "Accepted risk for ${s.id}".`);
    else if (row.review !== 'clean' && row.review !== 'risks') fail(`The review of scenario ${s.id} is ${row.review}, not clean.`);
    if (!(row.checks >= 1)) fail(`The result for scenario ${s.id} ran ${row.checks} checks.`);
  }

  const finalReport = readText('.ril', 'docs', 'reports', 'final.md');
  if (finalReport === null) fail('The final report .ril/docs/reports/final.md is missing.');
  else if (!/^#{1,6}[ \t]*What is not covered[ \t]*$/im.test(finalReport)) fail('The final report has no "What is not covered" section.');

  let trust = 'none';
  try {
    trust = kitTrust(dir, state.selfruns);
  } catch {
    trust = 'unreadable';
  }
  if (trust !== 'trusted') fail('The proof kit (.ril/docs/verification/verify.md) is missing, or its first line does not say "Trusted: yes (<saved version>)" with a recorded self-run for that version.');

  const dirty = git('status', '--porcelain');
  if (dirty.status !== 0) fail('git could not say whether the project is clean.');
  else if (dirty.stdout.trim()) fail(`The project has unsaved changes:\n${dirty.stdout.trimEnd().split('\n').map((l) => `  ${l}`).join('\n')}`);

  for (const a of state.agents.filter((x) => x?.state === 'running')) fail(`Agent ${a.id} (${a.role}) is still marked as working.`);
} catch (err) {
  cannot(`Could not check ${dir}: ${err.message}`);
}

const recovery = state.decisions.filter((d) => /^ril doctor/i.test(d?.decision) || /restored.*backup/i.test(d?.decision));
const made = state.decisions.filter((d) => !recovery.includes(d));
const stopped = state.agents.filter((a) => a?.state === 'stopped').length;
console.log(`Stage: ${state.stage}`);
console.log(`Scenarios: ${proven} of ${state.scenarios.length} scenarios proven, ${accepted} accepted as unproven`);
console.log(`Results recorded: ${state.ledger.length}; agents: ${state.agents.length} (${stopped} stopped)`);
console.log(`Decisions made: ${made.length}`);
for (const d of made) console.log(`  - ${d?.decision} (${d?.why})`);
console.log(recovery.length || stopped ? `Recovery: ${recovery.length} repairs logged` : 'Recovery: nothing was needed');
for (const d of recovery) console.log(`  - ${d.decision}`);
if (problems.length) {
  for (const p of problems) console.log(`PROBLEM: ${p}`);
  console.log(`NOT ACCEPTED: ${problems.length} problem${problems.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log('ACCEPTED: every check passed.');
