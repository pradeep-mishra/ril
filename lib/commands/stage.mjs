import { RilError } from '../errors.mjs';
import { STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { acceptedUnproven, dispatch, logDecision, oneOf, reason, say } from '../records.mjs';
import { head } from '../git.mjs';
import { passes } from '../proof.mjs';
import { parseFlags } from '../args.mjs';

const USAGE = 'ril stage get | ril stage set <shape|design|confirm|build|accept|done|parked>';
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

function set(ctx, argv) {
  const { rest } = parseFlags(argv);
  if (!rest[0]) throw new RilError('No stage was given.', { next: `run: ${USAGE}` });
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

function get(ctx) {
  const state = load(ctx.dir);
  say(ctx, describe(state), { stage: state.stage, parkedFrom: state.parkedFrom });
}

export default {
  name: 'stage',
  summary: 'Show or move the stage the project is in.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'stage', { get, set }),
};
