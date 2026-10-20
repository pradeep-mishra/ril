import { RilError } from '../errors.mjs';
import { STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, find, logDecision, need, oneId, oneOf, parseFlags, say, show } from '../records.mjs';

const PARK = 'ril gate park <id> --question <text> --options <a|b|c> --default <choice>';
const RESOLVE = 'ril gate resolve <id> --answer <text>';
const GATE_USAGE = `${PARK} | ${RESOLVE} | ril gate list [--status open|resolved]`;

// An existing id is reopened and overwritten.
function park(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['question', 'options', 'default'] });
  const id = oneId(rest, 'question', PARK);
  const question = need(flags, 'question', PARK);
  const options = need(flags, 'options', PARK).split('|').map((o) => o.trim()).filter(Boolean);
  const fallback = need(flags, 'default', PARK);
  if (!options.length) throw new RilError('The option --options has no choices in it.', { next: `run: ${PARK}` });
  const gate = { id, status: 'open', question, options, default: fallback, answer: null };
  let reopened = false;
  mutate(ctx.dir, (s) => {
    const at = s.gates.findIndex((g) => g.id === id);
    reopened = at !== -1;
    if (reopened) s.gates[at] = gate;
    else s.gates.push(gate);
  });
  say(ctx, `Question ${id} is ${reopened ? 'open again' : 'waiting for you'}: ${question} Choices: ${options.join(', ')}. If there is no answer I will go with ${fallback}.`, gate);
}

function resolve(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['answer'] });
  const id = oneId(rest, 'question', RESOLVE);
  const answer = need(flags, 'answer', RESOLVE);
  mutate(ctx.dir, (s) => {
    const gate = find(s.gates, id, 'question', 'ril gate list');
    gate.status = 'resolved';
    gate.answer = answer;
  });
  say(ctx, `Question ${id} is answered: ${answer}.`, { id, status: 'resolved', answer });
}

function gateList(ctx, argv) {
  const { flags } = parseFlags(argv, { values: ['status'] });
  const gates = load(ctx.dir).gates.filter((g) => !flags.status || g.status === flags.status);
  show(ctx, gates, 'There are no questions to show.', (g) => `${g.id}  ${g.status}  ${g.question}`);
}

const gateCommand = {
  name: 'gate',
  summary: 'Park a question for the person, answer it, list questions.',
  usage: GATE_USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'gate', { park, resolve, list: gateList }),
};

const DECISION_USAGE = 'ril decision log --stage <stage> --decision <text> --why <text> | ril decision list';

function log(ctx, argv) {
  const { flags } = parseFlags(argv, { values: ['stage', 'decision', 'why'] });
  const stage = oneOf(need(flags, 'stage', DECISION_USAGE), STAGES, 'stage');
  const decision = need(flags, 'decision', DECISION_USAGE);
  const why = need(flags, 'why', DECISION_USAGE);
  mutate(ctx.dir, (s) => logDecision(s, ctx, decision, why, stage));
  say(ctx, `Recorded: ${decision} (${why}).`, { stage, decision, why });
}

function decisionList(ctx) {
  show(ctx, load(ctx.dir).decisions, 'There are no decisions on record yet.', (d) => `${d.ts.slice(0, 10)}  ${d.stage}: ${d.decision} (${d.why})`);
}

const decisionCommand = {
  name: 'decision',
  summary: 'Record or list the decisions made along the way.',
  usage: DECISION_USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'decision', { log, list: decisionList }),
};

export default [gateCommand, decisionCommand];
