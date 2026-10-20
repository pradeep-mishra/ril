import { load } from '../store.mjs';
import { parseFlags } from '../args.mjs';
import { changedLine } from '../seal.mjs';
import { full, oneline, summarise } from '../render.mjs';

export default {
  name: 'status',
  summary: 'Show where the project stands (--full for the details).',
  usage: 'ril status [--full]',
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { bools: ['full'] });
    const state = load(ctx.dir);
    const line = oneline(state);
    if (flags.full && !ctx.json) {
      const changed = changedLine(ctx.dir, state.seals);
      return ctx.out(full(state).trimEnd() + (changed ? `\n${changed}` : ''));
    }
    ctx.out(ctx.json ? JSON.stringify({ summary: line, ...summarise(state) }) : line);
  },
};
