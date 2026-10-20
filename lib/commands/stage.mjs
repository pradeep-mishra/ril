import { RilError } from '../errors.mjs';
import { STAGES, UNIT_KINDS, UNIT_STATES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { acceptedUnproven, dispatch, find, logDecision, need, oneId, oneLine, oneOf, parseFlags, reason, say, show } from '../records.mjs';
import { head } from '../git.mjs';
import { passes } from '../proof.mjs';

const STAGE_USAGE = 'ril stage get | ril stage set <shape|design|confirm|build|accept|done|parked>';
const STEPS = STAGES.filter((s) => s !== 'parked');

const describe = (state) => (state.stage === 'parked' ? `The project is paused; it was in the ${state.parkedFrom} stage.` : `The project is in the ${state.stage} stage.`);

// Why moving from `from` to `to` is not an ordinary step, or '' when it is.
function oddity(state, to) {
  const from = state.stage;
  if (from === 'parked') return to === state.parkedFrom ? '' : `The project is paused, so it can only go back to the ${state.parkedFrom} stage.`;
  if (to === 'parked') return '';
  const move = STEPS.indexOf(to) - STEPS.indexOf(from);
  if (move === 1) return '';
  return move < 1 ? `Going back from ${from} to ${to} is not a normal step.` : `Going from ${from} straight to ${to} skips ${STEPS[STEPS.indexOf(from) + 1]}.`;
}

const NO_FORCE = '--force does not skip this check.';

// Rail 2: done only when every scenario is proven at the current saved version, or set aside with an
// "Accepted as unproven: <id>" decision, and at least one is proven. --force does not apply.
function unfinished(state, dir) {
  if (!state.scenarios.length) {
    throw new RilError(`There are no scenarios, so nothing has been proven. ${NO_FORCE}`, { next: 'add scenarios, prove them, then try again' });
  }
  const open = [];
  for (const s of state.scenarios) {
    if (s.status === 'proven' || (s.status === 'parked' && acceptedUnproven(state.decisions, s.id))) continue;
    open.push(s.status === 'parked' ? `${s.id} (set aside, but nobody recorded "Accepted as unproven: ${s.id}")` : `${s.id} (${s.status})`);
  }
  if (open.length) {
    throw new RilError(`The project cannot be done yet. These scenarios are not proven:\n${open.map((o) => `  ${o}`).join('\n')}\n${NO_FORCE}`, {
      next: 'prove each one with a verifier, or have the person accept it with ril decision log --decision "Accepted as unproven: <id>", then try again',
    });
  }
  const proven = state.scenarios.filter((s) => s.status === 'proven');
  if (!proven.length) {
    throw new RilError(`Nothing has been proven yet, so the project cannot be finished. Every scenario was set aside, and that is not a finished project. ${NO_FORCE}`, {
      next: 'write the stop report, then pause the project with ril stage set parked',
    });
  }
  const now = head(dir);
  if (!now) {
    throw new RilError(`The project cannot be done yet. It has no saved version, so ril cannot tell which version the proofs describe. ${NO_FORCE}`, {
      next: 'save the project with ril checkpoint, have a verifier check each scenario on that saved version, then try again',
    });
  }
  const stale = proven.filter((s) => !state.ledger.some((r) => r.scenario === s.id && r.checkpoint === now && passes(r)));
  if (stale.length) {
    throw new RilError(`The project cannot be done yet. These scenarios were proven on an older version, not the current saved version:\n${stale.map((s) => `  ${s.id}`).join('\n')}\n${NO_FORCE}`, {
      next: 'have a verifier check each one again on the current saved version',
    });
  }
}

function stageSet(ctx, argv) {
  const { rest } = parseFlags(argv);
  if (!rest[0]) throw new RilError('No stage was given.', { next: `run: ${STAGE_USAGE}` });
  const to = oneOf(rest[0], STAGES, 'stage');
  let message;
  const state = mutate(ctx.dir, (s) => {
    const from = s.stage;
    if (to === from) {
      message = describe(s);
      return;
    }
    if (to === 'done') unfinished(s, ctx.dir);
    const odd = oddity(s, to);
    if (odd && !reason(ctx)) {
      throw new RilError(`${odd} ril only moves one step at a time.`, { next: `if you really need this, run ril stage set ${to} --force "<why>"` });
    }
    if (odd) logDecision(s, ctx, `Moved the project from ${from} to ${to}`, reason(ctx));
    s.parkedFrom = to === 'parked' ? from : null;
    s.stage = to;
    message = describe(s);
  });
  say(ctx, message, { stage: state.stage, parkedFrom: state.parkedFrom });
}

function stageGet(ctx) {
  const state = load(ctx.dir);
  say(ctx, describe(state), { stage: state.stage, parkedFrom: state.parkedFrom });
}

const stageCommand = {
  name: 'stage',
  summary: 'Show or move the stage the project is in.',
  usage: STAGE_USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'stage', { get: stageGet, set: stageSet }),
};

const UNIT_ADD = 'ril unit add <id> --kind plan|task [--parent <id>] --title <text>';
const UNIT_SET = 'ril unit set <id> --state todo|doing|built|verified|failed|parked [--checkpoint <text>]';
const UNIT_USAGE = `${UNIT_ADD} | ${UNIT_SET} | ril unit list [--kind <kind>]`;

function unitAdd(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['kind', 'parent', 'title'] });
  const id = oneId(rest, 'unit', UNIT_ADD);
  const kind = oneOf(need(flags, 'kind', UNIT_ADD), UNIT_KINDS, 'kind of unit');
  const title = need(flags, 'title', UNIT_ADD);
  let unit;
  mutate(ctx.dir, (s) => {
    if (s.units.some((u) => u.id === id)) throw new RilError(`There is already a unit called ${id}.`, { next: `use ril unit set ${id} to change it` });
    if (flags.parent) find(s.units, flags.parent, 'unit', 'ril unit list');
    unit = { id, kind, parent: flags.parent ?? null, title, state: 'todo', checkpoint: null, updated: ctx.now().toISOString() };
    s.units.push(unit);
  });
  say(ctx, `Added ${kind} ${id}: ${title}.`, unit);
}

function unitSet(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['state', 'checkpoint'] });
  const id = oneId(rest, 'unit', UNIT_SET);
  if (flags.state === undefined && flags.checkpoint === undefined) throw new RilError('There is nothing to change.', { next: `run: ${UNIT_SET}` });
  if (flags.state !== undefined) oneOf(flags.state, UNIT_STATES, 'state');
  let unit;
  mutate(ctx.dir, (s) => {
    unit = find(s.units, id, 'unit', 'ril unit list');
    if (flags.state !== undefined) unit.state = flags.state;
    if (flags.checkpoint !== undefined) unit.checkpoint = flags.checkpoint;
    unit.updated = ctx.now().toISOString();
  });
  const warning = unit.state === 'verified' && !unit.checkpoint
    ? `Warning: ${id} is marked proven without a checkpoint, so nothing says which version was checked. Next: run ril unit set ${id} --state verified --checkpoint <checkpoint>`
    : null;
  if (warning && !ctx.json) ctx.err(warning);
  say(ctx, `${id} is now ${unit.state}.`, { ...unit, warning });
}

function unitList(ctx, argv) {
  const { flags } = parseFlags(argv, { values: ['kind'] });
  const units = load(ctx.dir).units.filter((u) => !flags.kind || u.kind === flags.kind);
  show(ctx, units, 'There are no units to show.', (u) => `${u.id}  ${u.kind}  ${u.state}  ${u.title}`);
}

const unitCommand = {
  name: 'unit',
  summary: 'Add, update and list the plans and tasks.',
  usage: UNIT_USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'unit', { add: unitAdd, set: unitSet, list: unitList }),
};

// ril skip: sets aside one stuck unit or scenario with the person's reason, so the rest of the work goes on.

const SKIP_USAGE = 'ril skip <unit-or-scenario-id> --reason "<why>" [--unit | --scenario]';
const AFTER = 'Carrying on with the other work.';

// Which record `id` names: 'unit' or 'scenario', refusing an unknown or ambiguous id.
function pick(state, id, flags) {
  const unit = state.units.some((u) => u.id === id);
  const scenario = state.scenarios.some((s) => s.id === id);
  if (flags.unit && flags.scenario) throw new RilError('Use --unit or --scenario, not both.', { next: `run: ${SKIP_USAGE}` });
  if (flags.unit && !unit) throw new RilError(`There is no unit called ${id}.`, { code: 2, next: 'run ril unit list to see what exists' });
  if (flags.scenario && !scenario) throw new RilError(`There is no scenario called ${id}.`, { code: 2, next: 'run ril scenario list to see what exists' });
  if (!unit && !scenario) throw new RilError(`There is no unit or scenario called ${id}.`, { code: 2, next: 'run ril unit list or ril scenario list to see what exists' });
  if (unit && scenario && !flags.unit && !flags.scenario) {
    throw new RilError(`${id} is both a unit and a scenario, so ril does not know which one to set aside.`, { next: `say which: ril skip ${id} --unit --reason "<why>", or ril skip ${id} --scenario --reason "<why>"` });
  }
  return flags.unit || (unit && !flags.scenario) ? 'unit' : 'scenario';
}

const skipCommand = {
  name: 'skip',
  summary: 'Set aside a stuck unit or scenario, with the reason, and carry on with the rest.',
  usage: SKIP_USAGE,
  run(ctx, argv) {
    const { flags, rest } = parseFlags(argv, { values: ['reason'], bools: ['unit', 'scenario'] });
    const id = oneId(rest, 'unit or scenario', SKIP_USAGE);
    const why = oneLine(need(flags, 'reason', SKIP_USAGE), 'reason', SKIP_USAGE);
    let kind;
    let changed = true;
    const notes = [];
    mutate(ctx.dir, (s) => {
      kind = pick(s, id, flags);
      const at = ctx.now().toISOString();
      if (kind === 'unit') {
        const unit = s.units.find((u) => u.id === id);
        if (unit.state === 'parked') return void (changed = false);
        Object.assign(unit, { state: 'parked', updated: at });
        for (const a of s.agents.filter((x) => x.unit === id && x.state === 'running')) {
          notes.push(`Note: Agent ${a.id} is still working on it, and its work will not be used.\nNext: let it finish, or run ril agent set ${a.id} --state stopped`);
        }
        return logDecision(s, ctx, `Set aside unit ${id}`, why);
      }
      const scenario = s.scenarios.find((x) => x.id === id);
      if (scenario.status === 'parked' && acceptedUnproven(s.decisions, id)) return void (changed = false);
      if (scenario.status === 'proven') notes.push(`Warning: scenario ${id} was proven; that proof is set aside and no longer counts.\nNext: to count it again, have a verifier check it on the current saved version`);
      Object.assign(scenario, { status: 'parked', updated: at });
      logDecision(s, ctx, `Accepted as unproven: ${id}`, why);
    });
    const text = !changed
      ? `${kind === 'unit' ? 'Unit' : 'Scenario'} ${id} was already set aside; nothing changed. ${AFTER}`
      : kind === 'unit'
        ? `Set aside unit ${id} (${why}). ${AFTER}`
        : `Set aside scenario ${id} (${why}); it is recorded as accepted without proof and the final report will list it. ${AFTER}`;
    say(ctx, [text, ...notes].join('\n'), { id, kind, parked: true, changed, reason: why, notes });
  },
};

export default [stageCommand, unitCommand, skipCommand];
