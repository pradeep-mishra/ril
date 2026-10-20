import { RilError } from '../errors.mjs';
import { STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, logDecision, oneOf, reason, say } from '../records.mjs';
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
