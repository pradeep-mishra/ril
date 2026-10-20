// ril doctor: finds what a crash, a killed process or a closed session left behind, and with --fix
// repairs what it safely can. It never calls load first, because the state file itself may be damaged.
import fs from 'node:fs';
import { RilError, noProjectError } from '../errors.mjs';
import { mutate, readState, restoreBackup, statePath } from '../store.mjs';
import { clearStaleLock, isStale, lockPath, sleep } from '../lock.mjs';
import { logDecision } from '../records.mjs';
import { parseFlags } from '../args.mjs';
import { gitInstalled } from '../git.mjs';
import { repair, repoFacts } from '../recovery.mjs';

const USAGE = 'ril doctor [--fix] [--quiet] [--new-session]';
const EMPTY_LOCK_WAIT_MS = 6000; // a little over the time after which lock.mjs treats an empty lock as abandoned
const OWN_COPY = 'put back .ril/state.json from your own copy, or move the .ril folder aside and run ril init to start again';

function readLock(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

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

export default {
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
      const env = { dir: ctx.dir, now: ctx.now(), newSession: Boolean(flags['new-session']), facts: repoFacts(ctx.dir) };
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
