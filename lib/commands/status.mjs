import { load } from '../store.mjs';
import { ownedFile, writeFileAtomic } from '../safe-fs.mjs';
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
      writeFileAtomic(ownedFile(ctx.dir, 'status.md'), text);
      if (!ctx.json) return ctx.out(text.trimEnd());
    }
    ctx.out(ctx.json ? JSON.stringify({ summary: line, ...summarise(state) }) : line);
  },
};
