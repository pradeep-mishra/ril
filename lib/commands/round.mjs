import { RilError } from '../errors.mjs';
import { mutate } from '../store.mjs';
import { dispatch, find, logDecision, oneId, reason, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';

const USAGE = 'ril round bump <scenario> | ril round reset <scenario> --force "<reason>"';

function change(apply) {
  return (ctx, argv) => {
    const { rest } = parseFlags(argv);
    const id = oneId(rest, 'scenario', USAGE);
    let result;
    mutate(ctx.dir, (s) => {
      const scenario = find(s.scenarios, id, 'scenario', 'ril scenario list');
      result = apply(scenario, s, ctx);
      scenario.updated = ctx.now().toISOString();
    });
    say(ctx, result.text, { scenario: id, round: result.round });
  };
}

// The cap is a hard stop: nothing is stored and --force does not move it.
const bump = change((scenario, state) => {
  const round = (scenario.round || 0) + 1;
  if (round > state.cap) {
    throw new RilError(`Scenario ${scenario.id} has used all ${state.cap} fix rounds and is still not proven.`, { code: 4, next: 'stop and write the stop report' });
  }
  scenario.round = round;
  return { round, text: `Scenario ${scenario.id} is now in fix round ${round} of ${state.cap}.` };
});

// Starting the count again undoes the cap, so it needs the person's reason, which is logged.
const reset = change((scenario, state, ctx) => {
  const why = reason(ctx);
  if (!why) {
    throw new RilError(`Starting scenario ${scenario.id} again from round 0 takes away the limit on fix rounds, so it needs a reason.`, { next: `only if the person agreed, run ril round reset ${scenario.id} --force "<reason>"` });
  }
  logDecision(state, ctx, `Started scenario ${scenario.id} again from round 0 (it was at round ${scenario.round || 0})`, why);
  scenario.round = 0;
  return { round: 0, text: `Scenario ${scenario.id} starts again from round 0.` };
});

export default {
  name: 'round',
  summary: 'Count fix rounds for a scenario, up to the limit.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'round', { bump, reset }),
};
