import { RilError } from '../errors.mjs';
import { mutate } from '../store.mjs';
import { dispatch, find, oneId, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';

const USAGE = 'ril round bump <scenario> | ril round reset <scenario>';

function change(apply) {
  return (ctx, argv) => {
    const { rest } = parseFlags(argv);
    const id = oneId(rest, 'scenario', USAGE);
    let result;
    mutate(ctx.dir, (s) => {
      const scenario = find(s.scenarios, id, 'scenario', 'ril scenario list');
      result = apply(scenario, s);
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

const reset = change((scenario) => {
  scenario.round = 0;
  return { round: 0, text: `Scenario ${scenario.id} starts again from round 0.` };
});

export default {
  name: 'round',
  summary: 'Count fix rounds for a scenario, up to the limit.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'round', { bump, reset }),
};
