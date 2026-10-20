// What ril doctor repairs in the state itself: agents, units and proofs that a crash or a closed
// session left claiming more than is true. Nothing here trusts a claim it cannot check.
import fs from 'node:fs';
import path from 'node:path';
import { isRepo, resolve } from './git.mjs';
import { checkEvidence, passes } from './proof.mjs';

const HOUR_MS = 60 * 60 * 1000;

// A report counts once it is a non-empty file with a "STATUS:" line; an empty or half-written one does not.
const hasReport = (dir, id) => {
  try {
    const text = fs.readFileSync(path.join(dir, '.ril', 'agents', String(id), 'report.md'), 'utf8');
    return /^\s*STATUS:/m.test(text);
  } catch {
    return false;
  }
};

// A finished agent whose result nobody has collected yet still holds its unit.
const holds = (agent, unit) => agent.unit === unit.id && (agent.state === 'running' || (agent.state === 'done' && !agent.result));

// The newest passing ledger row for a scenario, or null.
function latestPass(ledger, id) {
  let best = null;
  for (const row of ledger) {
    if (row.scenario === id && passes(row) && (!best || String(row.ts) >= String(best.ts))) best = row;
  }
  return best;
}

// Why a proven scenario can no longer count as proven, or '' when its proof still holds. Later saved versions
// do not take a proof back: done already needs a pass at the current saved version, and carrying or
// checking again is how a proof moves forward.
function doubt(state, scenario, dir) {
  const row = latestPass(state.ledger, scenario.id);
  if (!row) return 'there is no recorded pass for it';
  try {
    checkEvidence(dir, row.evidence, scenario.id);
  } catch {
    return `its evidence (${row.evidence}) is missing, empty or not a file under .ril/evidence/`;
  }
  if (resolve(dir, row.checkpoint)) return '';
  return isRepo(dir) ? 'the saved version it was proven on can no longer be found' : 'the project has no git repository (or git cannot be run), so the saved version it was proven on can no longer be found';
}

// Repairs `state` in place and returns one { problem, fix, decision, why } per change. Running it again on
// the result changes nothing. `newSession` means no agent from an earlier session can still be working.
export function repair(state, { dir, now, newSession }) {
  const at = now.toISOString();
  const found = [];
  for (const agent of state.agents) {
    if (agent.state !== 'running') continue;
    if (hasReport(dir, agent.id)) {
      Object.assign(agent, { state: 'done', updated: at });
      found.push({ problem: `Agent ${agent.id} is marked as working, but its report is on disk`, fix: 'marked it finished so its report can be collected', decision: `ril doctor: marked agent ${agent.id} finished`, why: 'its report is on disk' });
      continue;
    }
    const age = now.getTime() - Date.parse(agent.updated);
    if (!newSession && age >= 0 && age <= HOUR_MS) continue; // a time in the future or that cannot be read counts as old
    Object.assign(agent, { state: 'stopped', updated: at });
    const why = newSession ? 'this is a new session' : 'it has not reported for over an hour';
    found.push({ problem: `Agent ${agent.id} is marked as working, but it is no longer running (${why}) and left no report`, fix: 'marked it stopped', decision: `ril doctor: marked agent ${agent.id} stopped`, why: `it is no longer running (${why}) and left no report` });
  }
  for (const unit of state.units) {
    if (unit.state !== 'doing' || state.agents.some((a) => holds(a, unit))) continue;
    Object.assign(unit, { state: 'todo', updated: at });
    found.push({ problem: `Unit ${unit.id} is marked in progress, but no agent is working on it`, fix: 'set it back to not started', decision: `ril doctor: set unit ${unit.id} back to not started`, why: 'no agent is working on it' });
  }
  for (const scenario of state.scenarios) {
    if (scenario.status !== 'proven') continue;
    const why = doubt(state, scenario, dir);
    if (!why) continue;
    Object.assign(scenario, { status: 'unproven', updated: at });
    found.push({ problem: `Scenario ${scenario.id} is marked proven, but ${why}`, fix: 'marked it unproven, so a verifier must check it again', decision: `ril doctor: marked scenario ${scenario.id} unproven`, why });
  }
  return found;
}
