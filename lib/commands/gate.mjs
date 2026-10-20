import { RilError } from '../errors.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, find, need, oneId, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';

const PARK = 'ril gate park <id> --question <text> --options <a|b|c> --default <choice>';
const RESOLVE = 'ril gate resolve <id> --answer <text>';
const USAGE = `${PARK} | ${RESOLVE} | ril gate list [--status open|resolved]`;

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

function list(ctx, argv) {
  const { flags } = parseFlags(argv, { values: ['status'] });
  const gates = load(ctx.dir).gates.filter((g) => !flags.status || g.status === flags.status);
  if (ctx.json) return ctx.out(JSON.stringify(gates));
  if (!gates.length) return ctx.out('There are no questions to show.');
  for (const g of gates) ctx.out(`${g.id}  ${g.status}  ${g.question}`);
}

export default {
  name: 'gate',
  summary: 'Park a question for the person, answer it, list questions.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'gate', { park, resolve, list }),
};
