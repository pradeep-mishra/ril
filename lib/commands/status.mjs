import fs from 'node:fs';
import path from 'node:path';
import { load } from '../store.mjs';
import { parseFlags } from '../args.mjs';
import { full, oneline, summarise } from '../render.mjs';

export default {
  name: 'status',
  summary: 'Show where the project stands (--full for the details).',
  usage: 'ril status [--full]',
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { bools: ['full'] });
    const state = load(ctx.dir);
    const line = oneline(state);
    if (flags.full) {
      const text = full(state);
      fs.writeFileSync(path.join(ctx.dir, '.ril', 'status.md'), text);
      if (!ctx.json) return ctx.out(text.trimEnd());
    }
    ctx.out(ctx.json ? JSON.stringify({ summary: line, ...summarise(state) }) : line);
  },
};
