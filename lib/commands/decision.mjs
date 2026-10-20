import { STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, logDecision, need, oneOf, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';

const USAGE = 'ril decision log --stage <stage> --decision <text> --why <text> | ril decision list';

function log(ctx, argv) {
  const { flags } = parseFlags(argv, { values: ['stage', 'decision', 'why'] });
  const stage = oneOf(need(flags, 'stage', USAGE), STAGES, 'stage');
  const decision = need(flags, 'decision', USAGE);
  const why = need(flags, 'why', USAGE);
  mutate(ctx.dir, (s) => logDecision(s, ctx, decision, why, stage));
  say(ctx, `Recorded: ${decision} (${why}).`, { stage, decision, why });
}

function list(ctx) {
  const { decisions } = load(ctx.dir);
  if (ctx.json) return ctx.out(JSON.stringify(decisions));
  if (!decisions.length) return ctx.out('There are no decisions on record yet.');
  for (const d of decisions) ctx.out(`${d.ts.slice(0, 10)}  ${d.stage}: ${d.decision} (${d.why})`);
}

export default {
  name: 'decision',
  summary: 'Record or list the decisions made along the way.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'decision', { log, list }),
};
