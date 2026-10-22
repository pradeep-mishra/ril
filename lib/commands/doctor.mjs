// ril doctor: finds what a crash, a killed process or a closed session left behind, and with --fix
// repairs what it safely can. It never calls load first, because the state file itself may be damaged.
import fs from 'node:fs';
import path from 'node:path';
import { RilError, noProjectError } from '../errors.mjs';
import { mutate, readState, restoreBackup, statePath } from '../store.mjs';
import { clearStaleLock, isStale, lockPath, readLock, sleep } from '../lock.mjs';
import { logDecision, parseFlags } from '../records.mjs';
import { gitInstalled, isRepo, resolve } from '../git.mjs';
import { checkEvidence, passes } from '../proof.mjs';

// What ril doctor repairs in the state itself: agents, units and proofs that a crash or a closed
// session left claiming more than is true. Nothing here trusts a claim it cannot check.

const HOUR_MS = 60 * 60 * 1000;
const REGISTERED_MS = 5 * 60 * 1000;

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
const holds = (agent, unit) => agent.unit === unit.id && (agent.state === 'registered' || agent.state === 'running' || (agent.state === 'done' && !agent.result));

// The newest passing ledger row for a scenario, or null.
function latestPass(ledger, id) {
  let best = null;
  for (const row of ledger) {
    if (row.scenario === id && passes(row) && (!best || String(row.ts) >= String(best.ts))) best = row;
  }
  return best;
}

// Why a proven scenario can no longer count as proven, or '' when its proof still holds. Later saved versions
// do not take a proof back: done already needs a pass at the current saved version, and checking again is how
// a proof moves forward.
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
function repair(state, { dir, now, newSession }) {
  const at = now.toISOString();
  const found = [];
  for (const agent of state.agents) {
    if (agent.state === 'registered') {
      const wait = now.getTime() - Date.parse(agent.updated);
      if (!newSession && wait >= 0 && wait <= REGISTERED_MS) continue;
      Object.assign(agent, { state: 'stopped', result: 'never started', updated: at });
      found.push({ problem: `registered but never started: ${agent.id}`, fix: 'marked it stopped (never started)', decision: `ril doctor: marked agent ${agent.id} stopped`, why: 'it was registered but never started' });
      continue;
    }
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
  // Only task units are held by agents; a plan stays started (the build playbook starts a plan only when it is todo).
  for (const unit of state.units) {
    if (unit.kind !== 'task' || unit.state !== 'doing' || state.agents.some((a) => holds(a, unit))) continue;
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

const USAGE = 'ril doctor [--fix] [--quiet] [--new-session]';
const EMPTY_LOCK_WAIT_MS = 6000; // a little over the time after which lock.mjs treats an empty lock as abandoned
const OWN_COPY = 'put back .ril/state.json from your own copy, or move the .ril folder aside and run ril init to start again';

// Rule 1: a damaged state file is replaced by a sound backup. Returns the state the other rules look at,
// or null when there is none to look at (both files damaged; that needs the person, and nothing is touched).
// Rule 2 (the lock) is checked before the restore, which would otherwise clear the lock unreported.
function checkState(ctx, fix, report) {
  const file = statePath(ctx.dir);
  const current = readState(file);
  const backup = current.state ? null : readState(`${file}.bak`);
  if (current.missing && backup.missing) throw noProjectError(ctx.dir);
  if (backup && !backup.state) {
    report.people.push({ problem: `The project state (.ril/state.json) is damaged (${current.problem}), and its backup (.ril/state.json.bak) is damaged too (${backup.problem}). ril changed nothing`, next: OWN_COPY });
    return null;
  }
  checkLock(ctx, fix, report);
  if (current.state) return current.state;
  report.found.push({ problem: `The project state (.ril/state.json) is damaged: ${current.problem}`, fix: 'put back the last good version from its backup (.ril/state.json.bak)' });
  if (!fix) return backup.state;
  restoreBackup(ctx.dir, (s, kept) => {
    const copy = kept ? ` The damaged file was kept as .ril/${kept}.` : '';
    logDecision(s, ctx, 'Restored the project state from its backup', `ril doctor found .ril/state.json damaged: ${current.problem}.${copy}`);
  }, { now: ctx.now });
  return readState(file).state;
}

// Rule 2: a lock whose process is gone, or that is older than two minutes, is removed.
// An empty lock belongs to a command that is just starting, or to one killed before it could write
// its process id; with --fix, doctor waits the few seconds it takes to tell which.
function checkLock(ctx, fix, report) {
  const file = lockPath(ctx.dir);
  let held = readLock(file);
  let now = ctx.now().getTime();
  const until = Date.now() + EMPTY_LOCK_WAIT_MS;
  while (fix && held !== null && held.trim() === '' && !isStale(file, held, now) && Date.now() < until) {
    sleep(100);
    held = readLock(file);
    now = ctx.now().getTime();
  }
  if (held === null || !isStale(file, held, now)) return;
  report.found.push({ problem: 'A lock was left behind by a ril command that is no longer running', fix: 'removed it' });
  if (fix) clearStaleLock(file, held, now);
}

// Rules 3 to 6, worked out on a copy first so that nothing is written when nothing is wrong.
function checkRecords(ctx, state, fix, env, report) {
  const preview = repair(structuredClone(state), env);
  if (!preview.length || !fix) return void report.found.push(...preview.map(({ problem, fix: action }) => ({ problem, fix: action })));
  let done = [];
  mutate(ctx.dir, (s) => {
    done = repair(s, env);
    for (const item of done) logDecision(s, ctx, item.decision, item.why);
  }, { now: ctx.now });
  report.found.push(...done.map(({ problem, fix }) => ({ problem, fix })));
}

// A missing git, which ril cannot fix, checked when proofs depend on it.
function checkGit(ctx, state, report) {
  if (!state.scenarios.some((s) => s.status === 'proven')) return;
  if (!gitInstalled(ctx.dir)) {
    report.people.push({ problem: 'git is not installed, or ril cannot find it, so ril cannot check which saved version each proof belongs to', next: 'install git, then run ril doctor --fix again and have a verifier check the scenarios again' });
  }
}

function parkedLine(state) {
  const items = [...state.units.filter((u) => u.state === 'parked').map((u) => `unit ${u.id}`), ...state.scenarios.filter((s) => s.status === 'parked').map((s) => `scenario ${s.id}`)];
  return items.length ? `Set aside (not counted as proven): ${items.join(', ')}.` : '';
}

function print(ctx, { fix, quiet }, report, parked) {
  const { found, people } = report;
  if (ctx.json) return ctx.out(JSON.stringify({ fixed: fix, found, needsYou: people, parked }));
  for (const f of found) ctx.out(fix ? `${f.problem}. Fixed: ${f.fix}.` : `${f.problem}. ril doctor --fix would have ${f.fix}.`);
  for (const p of people) ctx.err(`${p.problem}.\nNext: ${p.next}`);
  if (quiet) return;
  if (!found.length && !people.length) ctx.out('Nothing needed fixing.');
  if (parked) ctx.out(parked);
}

const doctorCommand = {
  name: 'doctor',
  summary: 'Check the project after a crash or a closed session, and repair what is safe (--fix).',
  usage: USAGE,
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { bools: ['fix', 'quiet', 'new-session'] });
    const fix = Boolean(flags.fix);
    const report = { found: [], people: [] };
    let state = checkState(ctx, fix, report);
    if (state) {
      checkGit(ctx, state, report);
      const env = { dir: ctx.dir, now: ctx.now(), newSession: Boolean(flags['new-session']) };
      checkRecords(ctx, state, fix, env, report);
      if (fix) state = readState(statePath(ctx.dir)).state ?? state;
    }
    print(ctx, { fix, quiet: Boolean(flags.quiet) }, report, state ? parkedLine(state) : '');
    if (report.people.length) {
      throw new RilError(`ril doctor found ${report.people.length === 1 ? 'a problem' : `${report.people.length} problems`} it cannot fix on its own (see above).`, { next: 'deal with each problem above, then run ril doctor again' });
    }
    if (!fix && report.found.length) {
      throw new RilError(`ril doctor found ${report.found.length === 1 ? 'one thing' : `${report.found.length} things`} to repair and changed nothing.`, { next: 'run ril doctor --fix' });
    }
  },
};

export default [doctorCommand];
