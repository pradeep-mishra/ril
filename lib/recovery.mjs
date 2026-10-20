// What ril doctor repairs in the state itself: agents, units and proofs that a crash or a closed
// session left claiming more than is true. Nothing here trusts a claim it cannot check.
import fs from 'node:fs';
import path from 'node:path';
import { changedFiles, head, isRepo, projectPrefix, resolve } from './git.mjs';
import { checkEvidence, passes, realChanges } from './proof.mjs';

const HOUR_MS = 60 * 60 * 1000;

const hasReport = (dir, id) => {
  try {
    return fs.statSync(path.join(dir, '.ril', 'agents', String(id), 'report.md')).isFile();
  } catch {
    return false;
  }
};

const named = (files) => files.slice(0, 5).join(', ') + (files.length > 5 ? ` and ${files.length - 5} more` : '');

// Facts about the repository, looked up once and only when a proof needs them.
export function repoFacts(dir) {
  let facts;
  return () => {
    if (!facts) {
      const repo = isRepo(dir);
      facts = { repo, head: repo ? head(dir) : null, prefix: repo ? projectPrefix(dir) : '' };
    }
    return facts;
  };
}

// The newest passing ledger row for a scenario, or null.
function latestPass(ledger, id) {
  let best = null;
  for (const row of ledger) {
    if (row.scenario === id && passes(row) && (!best || String(row.ts) >= String(best.ts))) best = row;
  }
  return best;
}

// Why a proven scenario can no longer count as proven, or '' when its proof still holds.
function doubt(state, scenario, dir, facts) {
  const row = latestPass(state.ledger, scenario.id);
  if (!row) return 'there is no recorded pass for it';
  try {
    checkEvidence(dir, row.evidence, scenario.id);
  } catch {
    return `its evidence (${row.evidence}) is missing, empty or not a file`;
  }
  const git = facts();
  if (!git.repo) return 'the project has no git repository (or git cannot be run), so ril cannot tell which version was proven';
  if (!git.head) return 'nothing is saved in the git repository, so ril cannot tell which version was proven';
  try {
    if (!resolve(dir, row.checkpoint)) return 'the saved version it was proven on can no longer be found';
    if (row.checkpoint === git.head) return '';
    const real = realChanges(changedFiles(dir, row.checkpoint, git.head), git.prefix, scenario.method);
    return real.length ? `files changed since it was proven (${named(real)})` : '';
  } catch {
    return 'ril could not compare the saved version it was proven on with the current one';
  }
}

// Repairs `state` in place and returns one { problem, fix } per change. Running it again on the result
// changes nothing. `newSession` means no agent from an earlier session can still be working.
export function repair(state, { dir, now, newSession, facts }) {
  const at = now.toISOString();
  const found = [];
  for (const agent of state.agents) {
    if (agent.state !== 'running') continue;
    if (hasReport(dir, agent.id)) {
      Object.assign(agent, { state: 'done', updated: at });
      found.push({ problem: `Agent ${agent.id} is marked as working, but its report is on disk`, fix: 'marked it finished so its report can be collected' });
      continue;
    }
    const age = now.getTime() - Date.parse(agent.updated);
    if (!newSession && age <= HOUR_MS) continue; // a time that cannot be read counts as old
    Object.assign(agent, { state: 'stopped', updated: at });
    const why = newSession ? 'this is a new session' : 'it has not reported for over an hour';
    found.push({ problem: `Agent ${agent.id} is marked as working, but it is no longer running (${why}) and left no report`, fix: 'marked it stopped' });
  }
  for (const unit of state.units) {
    if (unit.state !== 'doing' || state.agents.some((a) => a.state === 'running' && a.unit === unit.id)) continue;
    Object.assign(unit, { state: 'todo', updated: at });
    found.push({ problem: `Unit ${unit.id} is marked in progress, but no agent is working on it`, fix: 'set it back to not started' });
  }
  for (const scenario of state.scenarios) {
    if (scenario.status !== 'proven') continue;
    const why = doubt(state, scenario, dir, facts);
    if (!why) continue;
    Object.assign(scenario, { status: 'unproven', updated: at });
    found.push({ problem: `Scenario ${scenario.id} is marked proven, but ${why}`, fix: 'marked it unproven, so a verifier must check it again' });
  }
  return found;
}
